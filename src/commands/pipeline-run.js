// owner: RStack developed by Richardson Gunde
//
// Resume-aware pipeline runner (#124): advance a run from current harness
// state — skip completed work, re-enter retryable failures, stop at human
// gates. This first version invokes only model-free tools through the
// existing operator bridge (sdlc_build_next prepares packets, sdlc_validate
// judges contracts); it never calls an external model.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateTaskClaim, loadProjectGuardrails } from '../core/harness/guardrails.js';
import { classifyRetryDecision } from '../core/harness/retry-policy.js';
import { runDirectory, resolveRunId } from '../core/harness/runs.js';
import { buildPipelineState, writePipelineState } from '../core/harness/pipeline-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PASSED = new Set(['PASS', 'PASSED', 'SUCCESS', 'SUCCEEDED', 'DONE', 'COMPLETED']);
const RUNNING = new Set(['RUNNING', 'IN_PROGRESS', 'STARTED']);

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizeTasks(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.tasks)) return raw.tasks;
  return [];
}

// Claim order mirrors sdlc_build_next exactly (#265): FAIL retries first so
// the retry policy engages at the point of failure, then BLOCKED tasks
// (claimable only via an approved override), then fresh PENDING/READY work.
function nextClaimableTask(tasks) {
  return tasks.find((task) => String(task.status || '').toUpperCase() === 'FAIL')
    || tasks.find((task) => String(task.status || '').toUpperCase() === 'BLOCKED')
    || tasks.find((task) => ['PENDING', 'READY'].includes(String(task.status || '').toUpperCase()))
    || null;
}

// Decide the single next backend action for the run. Pure given its inputs —
// the runner and --dry-run share it, so what dry-run prints is exactly what
// a live step would do.
export function planNextAction({ state, tasks, events, approvals, guardrails, taskContext = {} }) {
  const blockers = state?.approval_blockers ?? [];
  if (blockers.length) {
    const first = blockers[0];
    return {
      action: 'stop',
      stopped_on: 'pending_approval',
      detail: `Approval pending for ${first.artifact ?? 'an artifact'}${first.stage_id ? ` (stage ${first.stage_id})` : ''} — approve via sdlc_approve or the Business Hub, then run again.`,
    };
  }

  const active = tasks.find((task) => RUNNING.has(String(task.status || '').toUpperCase()));
  if (active) {
    if (taskContext[active.id]?.builderExists) {
      return {
        action: 'validate',
        task_id: active.id,
        detail: `Task ${active.id} has a builder contract — validate it.`,
      };
    }
    return {
      action: 'stop',
      stopped_on: 'missing_contract',
      task_id: active.id,
      detail: `Task ${active.id} is IN_PROGRESS with no builder.json yet — execute the prepared packet (tasks/${active.id}/prompt.md) with your agent, then run again.`,
    };
  }

  const candidate = nextClaimableTask(tasks);
  if (!candidate) {
    const allPassed = tasks.length > 0 && tasks.every((task) => PASSED.has(String(task.status || '').toUpperCase()));
    if (allPassed) {
      return { action: 'stop', stopped_on: 'complete', detail: 'All tasks passed — pipeline complete, no backend action required.' };
    }
    const needsContext = tasks.find((task) => String(task.status || '').toUpperCase() === 'NEEDS_CONTEXT');
    if (needsContext) {
      return {
        action: 'stop',
        stopped_on: 'ask_user',
        task_id: needsContext.id,
        detail: `Task ${needsContext.id} needs human context (validator returned ask_user) — answer the open question, set the task READY, then run again.`,
      };
    }
    return { action: 'stop', stopped_on: 'no_actionable_work', detail: 'No claimable, active, or retryable task found — inspect the run with pipeline status.' };
  }

  const status = String(candidate.status || '').toUpperCase();
  if (status === 'FAIL' || status === 'BLOCKED') {
    // Retry policy + claim gate agree by construction (both count
    // task_started events); the claim check also honors an approved
    // guardrail-override, so a blocked task with an override proceeds.
    const claim = evaluateTaskClaim({ task: candidate, events, approvals, guardrails });
    if (!claim.allowed) {
      const validation = taskContext[candidate.id]?.validation ?? null;
      const decision = classifyRetryDecision({ task: candidate, validation, events, guardrails });
      return {
        action: 'stop',
        stopped_on: 'blocked_retry_policy',
        task_id: candidate.id,
        detail: `Task ${candidate.id} exhausted its retry budget (${decision.attempt}/${decision.max_attempts}) — approve '${claim.override_artifact}' via sdlc_approve or the Business Hub to grant one more attempt.`,
      };
    }
    return {
      action: 'claim',
      task_id: candidate.id,
      retry: true,
      detail: `Re-enter ${status === 'BLOCKED' ? 'override-approved' : 'retryable'} task ${candidate.id} — prepare a fresh builder packet.`,
    };
  }

  return { action: 'claim', task_id: candidate.id, retry: false, detail: `Start next pending task ${candidate.id} — prepare its builder packet.` };
}

// Default tool invoker: shells the model-free tool through the generic
// framework bridge. Injectable so tests never spawn subprocesses.
export function bridgeInvoker(projectRoot) {
  const bridge = resolve(__dirname, '..', '..', 'bin', 'rstack-bridge.ts');
  return (toolName, params) => new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npx', ['tsx', bridge, toolName, JSON.stringify(params)], {
      cwd: projectRoot,
      env: { ...process.env, RSTACK_PROJECT_ROOT: projectRoot, RSTACK_BRIDGE_CALLER: 'pipeline-run', RSTACK_NO_BUSINESS_HUB: '1', RSTACK_NO_BROWSER: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`${toolName} failed (exit ${code}): ${stderr.slice(0, 400)}`));
    });
  });
}

async function loadRunSnapshot(projectRoot, runId) {
  const dir = runDirectory(projectRoot, runId);
  const tasks = normalizeTasks(await readJson(join(dir, 'tasks.json'), []));
  const approvals = await readJson(join(dir, 'approvals.json'), []);
  const eventsRaw = await readFile(join(dir, 'events.jsonl'), 'utf8').catch(() => '');
  const events = eventsRaw.split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const taskContext = {};
  for (const task of tasks) {
    const taskDir = join(dir, 'tasks', task.id ?? '');
    taskContext[task.id] = {
      builderExists: existsSync(join(taskDir, 'builder.json')),
      validation: await readJson(join(taskDir, 'validation.json'), null),
    };
  }
  return { tasks, approvals: Array.isArray(approvals) ? approvals : [], events, taskContext };
}

export async function runPipeline(projectRoot, { runId, maxSteps = 5, dryRun = false, invokeTool } = {}) {
  const selected = await resolveRunId(projectRoot, runId);
  const invoke = invokeTool ?? bridgeInvoker(projectRoot);
  const steps = [];
  let stoppedOn = null;

  for (let step = 0; step < maxSteps; step++) {
    // Regenerate the rollup each step so decisions always reflect what the
    // previous step just changed. Dry-run builds the state in memory and
    // persists NOTHING — not even the rollup file.
    const state = dryRun
      ? await buildPipelineState(projectRoot, selected)
      : (await writePipelineState(projectRoot, selected)).state;
    const snapshot = await loadRunSnapshot(projectRoot, selected);
    const guardrails = await loadProjectGuardrails(projectRoot);
    const plan = planNextAction({ state, ...snapshot, guardrails });
    steps.push({ step: step + 1, ...plan, dry_run: dryRun });

    if (plan.action === 'stop') {
      stoppedOn = plan.stopped_on;
      break;
    }
    if (dryRun) {
      // Dry-run reports the first live action and stops: without executing
      // it, later plans would be speculation, not a plan.
      stoppedOn = 'dry_run';
      break;
    }
    if (plan.action === 'validate') {
      await invoke('sdlc_validate', { run_id: selected, task_id: plan.task_id });
    } else if (plan.action === 'claim') {
      await invoke('sdlc_build_next', { run_id: selected });
    }
  }

  if (!stoppedOn) stoppedOn = 'max_steps';
  return { run_id: selected, steps, stopped_on: stoppedOn };
}

export function formatRunReport(report) {
  const lines = [`Run: ${report.run_id}`];
  for (const step of report.steps) {
    lines.push(`Step ${step.step}: [${step.action}${step.task_id ? ` ${step.task_id}` : ''}] ${step.detail}`);
  }
  const closing = {
    complete: 'Pipeline complete.',
    pending_approval: 'Stopped: waiting on a human approval.',
    ask_user: 'Stopped: a task needs human context.',
    blocked_retry_policy: 'Stopped: retry budget exhausted — a guardrail override is required.',
    missing_contract: 'Stopped: a builder packet is prepared and awaiting agent execution.',
    no_actionable_work: 'Stopped: nothing actionable — inspect with pipeline status.',
    max_steps: 'Stopped: reached --max-steps.',
    dry_run: 'Dry run: no state was written.',
  };
  lines.push(closing[report.stopped_on] ?? `Stopped: ${report.stopped_on}.`);
  return lines.join('\n');
}
