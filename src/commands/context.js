// owner: RStack developed by Richardson Gunde
//
// rstack-agents context (#255): the framework-neutral CONTEXT INJECTOR.
//
// Wire it into any harness's prompt/session hook (Claude Code UserPromptSubmit
// and SessionStart) and it emits a small, structural RStack situational packet —
// active run id + current stage, count of pending approvals + open decisions, and
// a one-line orchestrator pointer — so ANY harness agent starts each prompt
// RStack-aware. This closes the Pi-only "orchestrator packet injection" gap: on
// Pi the extension injects run context; every other harness was blind to it.
//
// Output contract (Claude Code): a single JSON line on stdout
//   { "hookSpecificOutput": { "hookEventName": "...", "additionalContext": "..." } }
// which Claude Code appends to the model's context. Other harnesses can read the
// same JSON or just the additionalContext string.
//
// This is CONTEXT, not a gate. The hard rules (deliberate, tested — they mirror
// observe's contract):
//   (a) NEVER blocks / denies — context hooks can't deny anyway; we ALWAYS exit 0.
//   (b) NEVER throws out of the handler — everything is wrapped, best-effort.
//   (c) NO active run → output NOTHING (empty stdout), exit 0. We never create or
//       demand run state, and never inject an empty/misleading packet.
//   (d) NEVER injects secrets — the packet is built ONLY from structural facts we
//       generate (a run id, a canonical stage id, integer counts, a static
//       pointer string). It never echoes tool inputs, file contents, decision
//       question text, or any user/agent free text, so there is no channel for a
//       credential to reach the model through this hook.
//   (e) Small + fast — the injected text is capped (~1KB) and we do bounded disk
//       reads only (no network).

import { resolve } from 'node:path';

import { resolveRunId } from '../core/harness/runs.js';
import { readPipelineState } from '../core/harness/pipeline-state.js';
import { readApprovals, pendingApprovals } from '../core/tracker/approvals.js';
import { readDecisions, summarizeDecisions } from '../core/harness/decisions.js';

// Env a host sets so the injector targets a specific run (mirrors observe/guard).
export const CONTEXT_RUN_ID_ENV = 'RSTACK_RUN_ID';

// Hard cap on the injected string so a context hook can never bloat the prompt.
// Everything we build is short and structural; this is a belt-and-suspenders
// ceiling, matching the issue's "<~1KB" requirement.
const MAX_CONTEXT_CHARS = 1024;

// The orchestrator pointer is a static string — the canonical entry point a host
// agent should read to drive a governed run. No user data, safe to inject.
const ORCHESTRATOR_POINTER =
  'Route multi-step work through the RStack orchestrator (agents/core/orchestrator.md); '
  + 'inspect state with `rstack-agents pipeline status`.';

/** A run id we generate is already `[A-Za-z0-9._-]+`; strip anything else defensively. */
function safeRunId(runId) {
  return String(runId ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128);
}

/** Canonical stage ids look like `07-code`; keep them tidy and bounded. */
function safeStageId(stageId) {
  const s = String(stageId ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  return s || null;
}

/**
 * Build the RStack context string for a run from already-loaded, structural
 * facts. Returns a short (<~1KB) plain string, or '' when there is nothing
 * worth injecting. Never throws; callers pass in whatever they could read.
 */
export function buildContextString({ runId, stageId, pendingApprovalCount = 0, openDecisionCount = 0 }) {
  const id = safeRunId(runId);
  if (!id) return '';
  const stage = safeStageId(stageId);
  const parts = [];
  parts.push(`RStack governed run active: ${id}${stage ? ` (current stage: ${stage})` : ''}.`);

  const approvals = Number.isFinite(pendingApprovalCount) ? Math.max(0, Math.trunc(pendingApprovalCount)) : 0;
  const decisions = Number.isFinite(openDecisionCount) ? Math.max(0, Math.trunc(openDecisionCount)) : 0;
  if (approvals > 0 || decisions > 0) {
    const bits = [];
    if (approvals > 0) bits.push(`${approvals} pending approval${approvals === 1 ? '' : 's'}`);
    if (decisions > 0) bits.push(`${decisions} open decision${decisions === 1 ? '' : 's'}`);
    parts.push(`Blockers: ${bits.join(', ')} — resolve before shipping.`);
  }

  parts.push(ORCHESTRATOR_POINTER);
  const text = parts.join(' ');
  return text.length > MAX_CONTEXT_CHARS
    ? `${text.slice(0, MAX_CONTEXT_CHARS - 1)}…`
    : text;
}

/**
 * Parse the (optional) hook payload for its hookEventName so we can echo it back
 * in the Claude Code output shape. Accepts Claude Code JSON on stdin; any parse
 * failure just yields a null event name (we still emit valid output).
 */
export function parseHookEventName(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const name = parsed.hook_event_name ?? parsed.hookEventName;
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    }
  } catch {
    // non-JSON stdin — we still emit context, just without echoing the event name
  }
  return null;
}

/**
 * The whole context operation, wrapped so it NEVER throws. Resolves the active
 * run and gathers structural facts best-effort — any single read that fails is
 * simply omitted from the packet (a missing decisions file doesn't sink the run
 * id + stage). Returns { additionalContext, hookEventName, runId, reason }.
 * `additionalContext` is '' when there is no active run (silent no-op).
 */
export async function runContext({
  stdinText = '', source, project, runId, env = process.env, cwd = process.cwd(),
} = {}) {
  const hookEventName = parseHookEventName(stdinText);
  try {
    const projectRoot = resolve(project ?? env.RSTACK_PROJECT_ROOT ?? cwd);

    let selectedRun;
    try {
      selectedRun = await resolveRunId(projectRoot, runId ?? env[CONTEXT_RUN_ID_ENV]);
    } catch {
      // No active run (or an invalid id): silent no-op — inject nothing.
      return { additionalContext: '', hookEventName, reason: 'no active run — nothing to inject (silent no-op)' };
    }

    // Current stage — best-effort. regenerateIfMissing builds the rollup if the
    // run has none yet; a failure here just drops the stage from the packet.
    let stageId = null;
    try {
      const state = await readPipelineState(projectRoot, selectedRun, { regenerateIfMissing: true });
      stageId = state?.current?.stage_id ?? null;
    } catch { /* stage is optional in the packet */ }

    // Pending approvals — the project-level queue (.rstack/approvals.jsonl),
    // filtered to this run when the entry carries a runId.
    let pendingApprovalCount = 0;
    try {
      const all = await readApprovals(projectRoot);
      const pend = pendingApprovals(all);
      pendingApprovalCount = pend.filter((a) => !a.runId || a.runId === selectedRun).length;
    } catch { /* approvals are optional in the packet */ }

    // Open (pending) decisions from the Decision Queue for this run.
    let openDecisionCount = 0;
    try {
      const decisions = await readDecisions(projectRoot, selectedRun);
      openDecisionCount = summarizeDecisions(decisions).pending;
    } catch { /* decisions are optional in the packet */ }

    const additionalContext = buildContextString({
      runId: selectedRun, stageId, pendingApprovalCount, openDecisionCount,
    });
    return {
      additionalContext,
      hookEventName,
      runId: selectedRun,
      reason: additionalContext ? 'injected' : 'nothing to inject',
    };
  } catch (error) {
    // Best-effort: a failed context build must NEVER surface as an error to the
    // hook. Emit nothing and move on.
    return { additionalContext: '', hookEventName, reason: `context failed (ignored): ${error?.message ?? error}` };
  }
}

/** Read the hook payload from stdin (capped); empty string when stdin is a TTY. */
const MAX_STDIN_BYTES = 1_000_000;
export async function readStdinText(stream = process.stdin) {
  if (stream.isTTY) return '';
  let data = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) {
    data += chunk;
    if (data.length >= MAX_STDIN_BYTES) return data.slice(0, MAX_STDIN_BYTES);
  }
  return data;
}

/**
 * CLI wrapper. ALWAYS resolves to exit code 0 (context hooks never block). When
 * there is context to inject, prints the Claude Code hookSpecificOutput JSON on
 * stdout; otherwise prints NOTHING (a no-op hook must not add prompt noise).
 */
export async function runContextCommand(opts = {}, { stdinText = '', env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const result = await runContext({
    stdinText,
    source: opts.source ?? env.RSTACK_OBSERVE_SOURCE,
    project: opts.project,
    runId: opts.runId,
    env,
    cwd,
  });

  if (result.additionalContext) {
    const payload = {
      hookSpecificOutput: {
        hookEventName: opts.hookEventName ?? result.hookEventName ?? 'UserPromptSubmit',
        additionalContext: result.additionalContext,
      },
    };
    stdout.write(`${JSON.stringify(payload)}\n`);
  }
  if (opts.verbose) {
    stderr.write(`[rstack context] ${result.additionalContext ? 'injected' : 'skipped'}: ${result.reason}\n`);
  }
  return 0; // rule (a): never blocks, always exit 0.
}
