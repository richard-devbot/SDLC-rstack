// owner: RStack developed by Richardson Gunde
//
// rstack-agents statusline (#257): a Claude Code statusLine command that renders
// live RStack context on the terminal status bar — the last productivity surface
// of the full hook system (guard/observe/context/notify-hook/gate).
//
// Claude Code statusLine contract: the command receives session JSON on stdin
//   { "model": { "display_name": "..." }, "cwd": "...", "workspace": { ... }, ... }
// and prints ONE line to stdout that Claude Code renders as the status line.
// It runs frequently (on every render tick), so it MUST be fast and MUST NOT
// disrupt the session.
//
// This is DISPLAY, not a gate. The hard rules (mirroring context's discipline):
//   (a) ALWAYS exit 0 — a status line never blocks or errors the session.
//   (b) NEVER throws out of the handler — everything is best-effort wrapped.
//   (c) ALWAYS prints exactly ONE line — never blank-crash. With no active run
//       we still print a minimal `⬡ rstack  <model>  <cwd-basename>` line.
//   (d) NEVER prints secrets or free text — the line is built ONLY from
//       structural facts we generate (a run id, a canonical stage id, integer
//       counts) plus the host-supplied model name + cwd basename. It never
//       echoes tool inputs, file contents, decision question text, or any
//       user/agent free text, so no credential can reach the terminal here.
//   (e) Fast + bounded — one resolve + a few bounded disk reads, no network.
//       Every segment is truncated so the line can never blow up the status bar.

import { basename, resolve } from 'node:path';

import { resolveRunId } from '../core/harness/runs.js';
import { readPipelineState } from '../core/harness/pipeline-state.js';
import { readApprovals, approvalSummary } from '../core/tracker/approvals.js';
import { readDecisions, summarizeDecisions } from '../core/harness/decisions.js';

// Env a host sets so the statusline targets a specific run (mirrors context/guard).
export const STATUSLINE_RUN_ID_ENV = 'RSTACK_RUN_ID';

// The brand mark. A hexagon nods to the RStack "⬡" identity used elsewhere.
const BRAND = '⬡ rstack';

// Segment separator — two spaces for a clean, minimal, dependency-free look
// (no powerline glyphs / ANSI so it renders identically everywhere). See the
// reference status_line.py for the powerline taste; we deliberately keep it
// simple and portable.
const SEP = '  ';

// Per-segment truncation caps so no single field can overrun the status bar.
const MAX_MODEL = 24;
const MAX_STAGE = 24;
const MAX_DIR = 32;
const MAX_LINE = 200;

/** Collapse whitespace and hard-truncate a display segment (adds … when cut). */
function clip(value, max) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/** A run id we generate is already `[A-Za-z0-9._-]+`; strip anything else defensively. */
function safeRunId(runId) {
  return String(runId ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
}

/** Canonical stage ids look like `07-code`; keep them tidy and bounded. */
function safeStageId(stageId) {
  const s = String(stageId ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, MAX_STAGE);
  return s || null;
}

/** Non-negative integer or 0 — counts are always structural, never free text. */
function safeCount(n) {
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/**
 * Parse the (optional) Claude Code session payload from stdin for the two fields
 * we surface: the model display name and the working directory. Accepts the
 * documented shape ({ model: { display_name }, cwd, workspace: { current_dir } })
 * and tolerates a bare string model. Any parse failure yields sensible defaults;
 * this never throws.
 */
export function parseSessionInput(raw) {
  const out = { modelName: 'Claude', cwd: null };
  if (typeof raw !== 'string' || !raw.trim()) return out;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out; // non-JSON stdin — fall back to defaults, still print a line
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;

  const model = parsed.model;
  if (typeof model === 'string' && model.trim()) {
    out.modelName = model.trim();
  } else if (model && typeof model === 'object') {
    const name = model.display_name ?? model.displayName ?? model.id ?? model.name;
    if (typeof name === 'string' && name.trim()) out.modelName = name.trim();
  }

  const workspace = parsed.workspace;
  const cwd = parsed.cwd
    ?? (workspace && typeof workspace === 'object' ? workspace.current_dir ?? workspace.currentDir : null);
  if (typeof cwd === 'string' && cwd.trim()) out.cwd = cwd.trim();

  return out;
}

/**
 * Build the RStack status line from already-resolved, structural facts. Returns
 * a single compact line. NEVER throws. Shapes:
 *   active run: `⬡ rstack  <model>  <stage>  ✔<approved>/⧗<pending>  ◇<decisions>`
 *   no run:     `⬡ rstack  <model>  <cwd-basename>`
 */
export function buildStatusLine({
  modelName, cwd, runId, stageId,
  approvedCount = 0, pendingApprovalCount = 0, openDecisionCount = 0,
} = {}) {
  const model = clip(modelName, MAX_MODEL) || 'Claude';
  const segments = [BRAND, model];

  const id = safeRunId(runId);
  if (id) {
    const stage = safeStageId(stageId);
    segments.push(stage || 'run');
    segments.push(`✔${safeCount(approvedCount)}/⧗${safeCount(pendingApprovalCount)}`);
    segments.push(`◇${safeCount(openDecisionCount)}`);
  } else {
    // No active run: a minimal, honest line — never blank, never an error.
    const dir = clip(cwd ? basename(cwd) : '', MAX_DIR);
    segments.push(dir || 'no run');
  }

  const line = segments.join(SEP);
  return line.length > MAX_LINE ? line.slice(0, MAX_LINE - 1) + '…' : line;
}

/**
 * The whole statusline operation, wrapped so it NEVER throws. Resolves the
 * active run (best-effort) and gathers structural facts; any single read that
 * fails is simply omitted (a missing decisions file drops the decision count,
 * not the whole line). Returns { line, runId, reason }.
 */
export async function runStatusline({
  stdinText = '', project, runId, env = process.env, cwd = process.cwd(),
} = {}) {
  const { modelName, cwd: sessionCwd } = parseSessionInput(stdinText);
  const displayCwd = sessionCwd ?? cwd;
  try {
    const projectRoot = resolve(project ?? env.RSTACK_PROJECT_ROOT ?? sessionCwd ?? cwd);

    let selectedRun;
    try {
      selectedRun = await resolveRunId(projectRoot, runId ?? env[STATUSLINE_RUN_ID_ENV]);
    } catch {
      // No active run (or an invalid id): minimal line, no run segment.
      return {
        line: buildStatusLine({ modelName, cwd: displayCwd }),
        reason: 'no active run — minimal line',
      };
    }

    // Current stage — best-effort. A failure just drops the stage label.
    let stageId = null;
    try {
      const state = await readPipelineState(projectRoot, selectedRun, { regenerateIfMissing: true });
      stageId = state?.current?.stage_id ?? null;
    } catch { /* stage is optional in the line */ }

    // Approvals for this run — approved + pending counts (project-level queue,
    // filtered to this run when the entry carries a runId).
    let approvedCount = 0;
    let pendingApprovalCount = 0;
    try {
      const all = await readApprovals(projectRoot);
      const forRun = all.filter((a) => !a.runId || a.runId === selectedRun);
      const summary = approvalSummary(forRun);
      approvedCount = summary.approved;
      pendingApprovalCount = summary.pending;
    } catch { /* approvals are optional in the line */ }

    // Open (pending) decisions from the Decision Queue for this run.
    let openDecisionCount = 0;
    try {
      const decisions = await readDecisions(projectRoot, selectedRun);
      openDecisionCount = summarizeDecisions(decisions).pending;
    } catch { /* decisions are optional in the line */ }

    return {
      line: buildStatusLine({
        modelName, cwd: displayCwd, runId: selectedRun, stageId,
        approvedCount, pendingApprovalCount, openDecisionCount,
      }),
      runId: selectedRun,
      reason: 'rendered active run',
    };
  } catch (error) {
    // Best-effort: a failed build must NEVER surface as an error to the host.
    // Fall back to the minimal line so the status bar still shows something safe.
    return {
      line: buildStatusLine({ modelName, cwd: displayCwd }),
      reason: `statusline failed (ignored): ${error?.message ?? error}`,
    };
  }
}

/** Read the session payload from stdin (capped); empty string when stdin is a TTY. */
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
 * CLI wrapper. ALWAYS resolves to exit code 0 (a status line never blocks) and
 * ALWAYS prints exactly one line on stdout that Claude Code renders. Errors are
 * swallowed into the minimal line; --verbose prints a one-line note to stderr.
 */
export async function runStatuslineCommand(opts = {}, { stdinText = '', env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const result = await runStatusline({
    stdinText,
    project: opts.project,
    runId: opts.runId,
    env,
    cwd,
  });
  stdout.write(`${result.line}\n`);
  if (opts.verbose) {
    stderr.write(`[rstack statusline] ${result.reason}\n`);
  }
  return 0; // rule (a): never blocks, always exit 0.
}
