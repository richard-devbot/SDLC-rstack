// owner: RStack developed by Richardson Gunde
//
// rstack-agents guard (#227): the framework-neutral enforcement guard.
//
// Any harness with a tool-call hook (Claude Code PreToolUse, codex/gemini
// equivalents, custom loops) pipes the pending tool call through this command
// and treats the exit code as the verdict:
//
//   exit 0 → allow (verdict JSON on stdout)
//   exit 2 → block (verdict JSON on stdout, human reason on stderr — the
//            Claude Code PreToolUse convention: exit 2 blocks the call and
//            feeds stderr back to the model)
//
// This command REUSES the harness enforcement modules — it duplicates zero
// classification logic (#131: one source of truth):
//
//   - validator/reviewer/security contexts → validator-sandbox.js policy:
//     any write/destructive/publish/secret-path op is denied outright, no
//     approval or RSTACK_ALLOW_DESTRUCTIVE escape hatch (mirrors the Pi
//     tool_call hook exactly).
//   - builder context → destructive-actions.js classifyDestructiveAction;
//     destructive actions are gated on the audited per-task
//     `destructive-action:<taskId>` approval via guardrails.js
//     evaluateDestructiveAction (the #133 trusted-approval path — cross-run
//     replay rejected). RSTACK_ALLOW_DESTRUCTIVE=1 is honored exactly like
//     the Pi path (builder gate only, never the validator sandbox).
//
// Failure policy (documented, deliberate):
//   - A destructive action that cannot resolve a task id, a run, or its
//     approvals FAILS CLOSED — blocked, with a reason explaining how to
//     provide --task / an approval.
//   - Input that cannot be classified AT ALL (empty stdin, no flags, junk)
//     FAILS OPEN with a stderr warning — a guard that hard-errors on every
//     hook call would get uninstalled, which is worse than allowing an
//     unclassifiable call. Raw non-JSON text is first sniffed as a shell
//     command, so destructive-looking raw input still hits the gate; the
//     fail-open path is reachable only when there is literally nothing to
//     classify.

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { classifyDestructiveAction } from '../core/harness/destructive-actions.js';
import { evaluateDestructiveAction } from '../core/harness/guardrails.js';
import { evaluateValidatorAction, isValidatorContext, isValidatorRole } from '../core/harness/validator-sandbox.js';
import { resolveRunId, runDirectory } from '../core/harness/runs.js';

export const GUARD_CONTEXTS = Object.freeze(['builder', 'validator', 'reviewer', 'security']);

// Contexts governed by the validator sandbox (deny-outright, no override).
const VALIDATOR_CLASS = new Set(['validator', 'reviewer', 'security']);

export const EXIT_ALLOW = 0;
export const EXIT_BLOCK = 2;

/** Env var a harness sets on subprocesses to declare the agent context. */
export const GUARD_CONTEXT_ENV = 'RSTACK_AGENT_CONTEXT';

/** Env var a harness sets so the guard knows which task's approval gates a destructive action. */
export const GUARD_TASK_ENV = 'RSTACK_TASK_ID';

/**
 * Env var to opt back into legacy fail-OPEN behavior when the guard cannot RUN
 * — a load/exec failure, NOT a classification decision (#371). The default is
 * fail-CLOSED: a governance guard that silently vanishes on an install hiccup,
 * a cold-`npx` registry miss, or a crash is worse than one that blocks and says
 * why. Host adapters (Tau/Operator/custom) read the SAME env so the policy is
 * uniform across harnesses.
 */
export const GUARD_FAIL_OPEN_ENV = 'RSTACK_GUARD_FAIL_OPEN';

export function guardFailOpen(env = process.env) {
  return env[GUARD_FAIL_OPEN_ENV] === '1';
}

/**
 * Verdict for a guard that COULD NOT RUN (an unexpected throw, unreadable
 * state, or — reported by a host adapter — the guard process crashed/timed out
 * or produced no verdict). This is categorically different from an allow/block
 * DECISION: here the classifier never ran, so "exit != 2" must NOT be read as
 * "allow". Fails closed by default (block, exit 2) so enforcement is never
 * silently skipped; `RSTACK_GUARD_FAIL_OPEN=1` restores the legacy allow.
 * Returns the same { verdict, exitCode } shape as runGuard.
 */
export function guardUnavailableVerdict(reason, env = process.env) {
  const failOpen = guardFailOpen(env);
  return {
    verdict: verdictOf(failOpen ? 'allow' : 'block', {
      category: 'guard-unavailable',
      reason: failOpen
        ? `guard could not run (${reason}); ${GUARD_FAIL_OPEN_ENV}=1 is set — allowing WITHOUT enforcement`
        : `guard could not run (${reason}) — failing closed so enforcement is not silently skipped. Fix the guard (\`rstack-agents doctor\`) or set ${GUARD_FAIL_OPEN_ENV}=1 to allow tool calls without enforcement.`,
      context: null,
      tool: null,
    }),
    exitCode: failOpen ? EXIT_ALLOW : EXIT_BLOCK,
  };
}

/**
 * Resolve the effective agent context. Precedence:
 *   1. RSTACK_VALIDATOR_CONTEXT=1 (the delegate-stamped sandbox env) always
 *      wins — a sandboxed subprocess must not escape by passing
 *      `--context builder` (the flag travels with the hook command, the env
 *      travels with the subprocess).
 *   2. Subagent identity (#372): the calling subagent's name is a validator
 *      role. Claude Code delivers it as `agent_type` in the PreToolUse payload,
 *      and plugin subagents IGNORE agent-def hooks (a documented CC security
 *      rule), so the SESSION guard is the only place that can sandbox a plugin
 *      validator's tool calls. This escalates to the validator sandbox and
 *      beats the static `--context builder` the hook wiring passes. It is
 *      ONE-WAY (escalate to the stricter sandbox only) — it never downgrades an
 *      explicit validator context to builder — so a spoofed `agent_type` can
 *      only make a call MORE restricted, never less. Same role pattern the Pi
 *      delegate uses to stamp read-only workers, applied uniformly.
 *   3. --context flag.
 *   4. RSTACK_AGENT_CONTEXT env.
 *   5. builder.
 * An unrecognized explicit value falls through to builder (the caller warns).
 */
export function resolveGuardContext(flag, env = process.env, agentType = null) {
  if (isValidatorContext(env)) return 'validator';
  if (agentType && isValidatorRole(agentType)) return 'validator';
  const explicit = String(flag ?? env[GUARD_CONTEXT_ENV] ?? '').trim().toLowerCase();
  if (GUARD_CONTEXTS.includes(explicit)) return explicit;
  return 'builder';
}

/**
 * Parse hook input into a { toolName, input } tool-call shape. Accepts:
 *   - Claude Code PreToolUse JSON: { tool_name, tool_input: {...} }
 *   - Pi-style: { toolName, input: {...} } or { tool, input }
 *   - shorthand: { command: "..." }
 *   - raw non-JSON text → sniffed as a bash command (so destructive-looking
 *     raw input still classifies instead of failing open)
 * Returns { ok, toolName, input, agentType?, sniffed?, empty? }. `agentType` is
 * the calling subagent's name when the host supplies it (Claude Code PreToolUse
 * `agent_type`) — used to escalate to the validator sandbox (#372). ok:false
 * means there is nothing classifiable at all.
 */
export function parseHookInput(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: false, empty: true, toolName: null, input: null };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const toolName = typeof parsed.tool_name === 'string' ? parsed.tool_name
        : typeof parsed.toolName === 'string' ? parsed.toolName
          : typeof parsed.tool === 'string' ? parsed.tool : null;
      const input = parsed.tool_input && typeof parsed.tool_input === 'object' ? parsed.tool_input
        : parsed.input && typeof parsed.input === 'object' ? parsed.input
          : typeof parsed.command === 'string' ? { command: parsed.command }
            : {};
      // Subagent identity for validator-sandbox escalation (#372). Claude Code
      // PreToolUse delivers `agent_type`; accept a couple of aliases too.
      const agentType = typeof parsed.agent_type === 'string' ? parsed.agent_type
        : typeof parsed.agentType === 'string' ? parsed.agentType
          : typeof parsed.agent === 'string' ? parsed.agent : null;
      const inferred = toolName ?? (typeof input.command === 'string' ? 'bash' : null);
      return { ok: true, toolName: inferred, input, agentType };
    }
    // Valid JSON but not an object (a number, a string, an array) — nothing
    // classifiable in it.
    return { ok: false, empty: false, toolName: null, input: null };
  } catch {
    // Not JSON: sniff the raw text as a shell command. This keeps the
    // fail-open path honest — `rm -rf /` piped as plain text still blocks.
    return { ok: true, sniffed: true, toolName: 'bash', input: { command: text } };
  }
}

function verdictOf(decision, { category = null, reason, context, tool = null, extra = {} }) {
  return { decision, category, reason, context, tool, ...extra };
}

/**
 * Run the guard decision. Options mirror the CLI flags; `stdinText` is the
 * raw hook payload used when no --tool/--command/--path flag is given.
 * Returns { verdict, exitCode, warnings } and never throws.
 */
export async function runGuard({
  tool, command, path, context: contextFlag, task, project, runId,
  explain = false, stdinText = '', env = process.env, cwd = process.cwd(),
} = {}) {
  const warnings = [];

  // Resolve the action under test: explicit flags win over stdin. Parse stdin
  // FIRST so the calling subagent's identity (`agent_type`) is known before we
  // resolve the context — a validator subagent must land in the sandbox even
  // though the hook wiring passes a static `--context builder` (#372).
  let toolName = null;
  let input = null;
  let agentType = null;
  if (tool !== undefined || command !== undefined || path !== undefined) {
    toolName = tool ?? (command !== undefined ? 'bash' : 'write');
    input = {};
    if (command !== undefined) input.command = String(command);
    if (path !== undefined) input.file_path = String(path);
  } else {
    const parsed = parseHookInput(stdinText);
    if (!parsed.ok) {
      // Nothing classifiable at all — fail open with a loud warning (see the
      // failure-policy note in the header).
      warnings.push(parsed.empty
        ? 'no input to classify (empty stdin, no --tool/--command/--path flags) — allowing'
        : 'input parsed as JSON but contains no recognizable tool call — allowing');
      return {
        verdict: verdictOf('allow', { reason: 'unclassifiable input', context: resolveGuardContext(contextFlag, env) }),
        exitCode: EXIT_ALLOW,
        warnings,
      };
    }
    if (parsed.sniffed) warnings.push('input was not valid JSON — classified the raw text as a shell command');
    toolName = parsed.toolName;
    input = parsed.input;
    agentType = parsed.agentType ?? null;
  }

  const context = resolveGuardContext(contextFlag, env, agentType);
  const explicit = String(contextFlag ?? env[GUARD_CONTEXT_ENV] ?? '').trim().toLowerCase();
  if (explicit && !GUARD_CONTEXTS.includes(explicit)) {
    warnings.push(`unknown context '${explicit}' — defaulting to '${context}'`);
  }
  if (context === 'validator' && agentType && isValidatorRole(agentType) && !isValidatorContext(env)) {
    warnings.push(`subagent '${agentType}' is a validator role — enforcing the read-only validator sandbox (#372)`);
  }

  // Validator sandbox contexts: deny-outright policy, no approval path, and
  // RSTACK_ALLOW_DESTRUCTIVE is deliberately NOT consulted (mirrors the Pi
  // tool_call hook ordering exactly).
  if (VALIDATOR_CLASS.has(context)) {
    const sandbox = evaluateValidatorAction({ toolName, input });
    const decision = sandbox.allowed ? 'allow' : 'block';
    const reason = sandbox.allowed
      ? `${context} context: read-safe action allowed`
      : `RStack validator sandbox blocked '${toolName}': ${sandbox.reason}`;
    if (explain) {
      return {
        verdict: verdictOf(decision, { category: sandbox.allowed ? null : 'validator-sandbox', reason: `explain mode: ${reason}`, context, tool: toolName, extra: { explain: true } }),
        exitCode: EXIT_ALLOW,
        warnings,
      };
    }
    return {
      verdict: verdictOf(decision, { category: sandbox.allowed ? null : 'validator-sandbox', reason, context, tool: toolName }),
      exitCode: sandbox.allowed ? EXIT_ALLOW : EXIT_BLOCK,
      warnings,
    };
  }

  // Builder context: classify via the single source of truth (#131).
  const classified = classifyDestructiveAction({ toolName: toolName ?? '', input });

  if (explain) {
    return {
      verdict: verdictOf(classified.destructive ? 'block' : 'allow', {
        category: classified.category,
        reason: classified.destructive
          ? `explain mode (approval lookup skipped): ${classified.reason} — would require an approved 'destructive-action:<taskId>' artifact or RSTACK_ALLOW_DESTRUCTIVE=1`
          : 'explain mode: non-destructive action',
        context,
        tool: toolName,
        extra: { explain: true },
      }),
      exitCode: EXIT_ALLOW,
      warnings,
    };
  }

  if (!classified.destructive) {
    return {
      verdict: verdictOf('allow', { reason: 'non-destructive action', context, tool: toolName }),
      exitCode: EXIT_ALLOW,
      warnings,
    };
  }

  // Same escape hatch, same scope as the Pi hook: builder gate only.
  if (env.RSTACK_ALLOW_DESTRUCTIVE === '1') {
    return {
      verdict: verdictOf('allow', {
        category: classified.category,
        reason: `RSTACK_ALLOW_DESTRUCTIVE=1 override — destructive action (${classified.category}) allowed without approval`,
        context,
        tool: toolName,
      }),
      exitCode: EXIT_ALLOW,
      warnings,
    };
  }

  // Destructive: gate on the audited per-task approval. Every failure from
  // here on FAILS CLOSED — a destructive action with unresolvable state is
  // blocked, never waved through.
  const taskId = task ?? env[GUARD_TASK_ENV];
  if (!taskId) {
    return {
      verdict: verdictOf('block', {
        category: classified.category,
        reason: `destructive action (${classified.category}) blocked: no task id to key the approval on — pass --task <taskId> or set ${GUARD_TASK_ENV}, then approve 'destructive-action:<taskId>' via sdlc_approve or the Business Hub. ${classified.reason}`,
        context,
        tool: toolName,
      }),
      exitCode: EXIT_BLOCK,
      warnings,
    };
  }

  try {
    const projectRoot = resolve(project ?? cwd);
    const selectedRun = await resolveRunId(projectRoot, runId);
    let approvals = [];
    try {
      const parsed = JSON.parse(await readFile(join(runDirectory(projectRoot, selectedRun), 'approvals.json'), 'utf8'));
      if (Array.isArray(parsed)) approvals = parsed;
    } catch {
      // Missing or corrupt approvals.json means NO trusted approvals — the
      // gate below fails closed on an empty set.
    }
    const gate = evaluateDestructiveAction({ action: classified, taskId, approvals, expectedRunId: selectedRun });
    if (gate.allowed) {
      return {
        verdict: verdictOf('allow', {
          category: classified.category,
          reason: `destructive action (${classified.category}) approved via audited '${gate.approval_artifact}' record on run ${selectedRun}`,
          context,
          tool: toolName,
          extra: { approval_artifact: gate.approval_artifact, run_id: selectedRun },
        }),
        exitCode: EXIT_ALLOW,
        warnings,
      };
    }
    return {
      verdict: verdictOf('block', {
        category: classified.category,
        reason: gate.reason,
        context,
        tool: toolName,
        extra: { approval_artifact: gate.approval_artifact, run_id: selectedRun },
      }),
      exitCode: EXIT_BLOCK,
      warnings,
    };
  } catch (error) {
    // Run resolution failed (no run, invalid run id, unreadable state):
    // fail closed with actionable guidance.
    return {
      verdict: verdictOf('block', {
        category: classified.category,
        reason: `destructive action (${classified.category}) blocked: could not resolve run approvals (${error.message}) — start a run or pass --run-id, then approve 'destructive-action:${taskId}'. Fail closed.`,
        context,
        tool: toolName,
      }),
      exitCode: EXIT_BLOCK,
      warnings,
    };
  }
}

/** Read the full hook payload from stdin; empty string when stdin is a TTY. */
export async function readStdinText(stream = process.stdin) {
  if (stream.isTTY) return '';
  let data = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) data += chunk;
  return data;
}

/**
 * CLI wrapper: prints the single-line verdict JSON on stdout, warnings and
 * the block reason on stderr, and returns the exit code. Never throws.
 */
export async function runGuardCommand(opts = {}, { stdinText = '', env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const { verdict, exitCode, warnings } = await runGuard({ ...opts, stdinText, env, cwd });
  for (const warning of warnings) stderr.write(`[rstack guard] ${warning}\n`);
  stdout.write(`${JSON.stringify(verdict)}\n`);
  if (exitCode === EXIT_BLOCK) stderr.write(`[rstack guard] BLOCKED: ${verdict.reason}\n`);
  return exitCode;
}
