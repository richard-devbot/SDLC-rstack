// owner: RStack developed by Richardson Gunde
//
// Traceability drift detection (#74): AI-assisted runs move fast and leave
// debris — requirements no task ever picked up, completed tasks without
// contracts, validator PASSes pointing at files that no longer exist, stale
// approvals. This scanner walks the `.rstack` artifacts a run ALREADY has (no
// migration, tolerant readers throughout) and reports findings with severity,
// type, artifact path, and a remediation — so drift is a reviewable report,
// not a vague feeling that the run "got messy".
//
// Severity model: `error` = the evidence chain is broken (a governed claim has
// no proof); `warning` = the chain is intact but degrading (unreferenced
// requirement, stale side-reference). status: FAIL on any error, WARN on any
// warning, PASS otherwise.

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { resolveRunId, runDirectory, rstackStateDir } from './runs.js';

export const DRIFT_SEVERITIES = Object.freeze(['error', 'warning']);

const COMPLETED_STATUSES = new Set(['PASS', 'DONE_WITH_CONCERNS']);
// Approval artifacts with a prefix are virtual (guardrail-override:004-impl,
// decision:D3) — they name a gate, not a file on disk.
const VIRTUAL_ARTIFACT = /[:]/;
// Conservative path detector for evidence strings: at least one separator,
// no spaces (commands like "npm test" are evidence too, just not paths).
const PATHISH = /^[^\s:*?"<>|]+[\\/][^\s:*?"<>|]+$/;

async function readJsonQuiet(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function readJsonlQuiet(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    const lines = (await readFile(filePath, 'utf8')).split('\n');
    const events = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* tolerant per-line parse */ }
    }
    return events;
  } catch {
    return [];
  }
}

// Requirements from the stage-02 artifacts, whichever shape the run used:
// requirements.json / requirement_spec.json, bare array or
// {functional, non_functional, requirements}.
async function loadRequirements(runDir) {
  const stageDir = join(runDir, 'artifacts', 'stages', '02-requirements');
  const requirements = [];
  let entries = [];
  try { entries = (await readdir(stageDir)).filter((name) => name.endsWith('.json')); } catch { return requirements; }
  for (const name of entries) {
    const parsed = await readJsonQuiet(join(stageDir, name));
    const lists = Array.isArray(parsed)
      ? [parsed]
      : [parsed?.functional, parsed?.non_functional, parsed?.requirements].filter(Array.isArray);
    for (const list of lists) {
      for (const item of list) {
        if (typeof item === 'string' && item.trim()) requirements.push({ id: null, text: item.trim(), source: name });
        else if (item && typeof item === 'object') {
          requirements.push({
            id: typeof item.id === 'string' ? item.id : null,
            text: String(item.description ?? item.requirement ?? item.title ?? item.text ?? '').trim(),
            source: name,
          });
        }
      }
    }
  }
  return requirements;
}

function taskSearchText(task) {
  return JSON.stringify([task.id, task.title, task.description, task.acceptance_criteria]).toLowerCase();
}

function finding(severity, type, artifact, message, remediation, extra = {}) {
  return { severity, type, artifact, message, remediation, ...extra };
}

export async function scanRunDrift(projectRoot, runId) {
  const selected = await resolveRunId(projectRoot, runId);
  const runDir = runDirectory(projectRoot, selected);
  const rel = (...parts) => join('.rstack', 'runs', selected, ...parts);
  const findings = [];

  const taskState = await readJsonQuiet(join(runDir, 'tasks.json'));
  const tasks = Array.isArray(taskState?.tasks) ? taskState.tasks : [];
  const requirements = await loadRequirements(runDir);
  const evidence = await readJsonlQuiet(join(runDir, 'evidence.jsonl'));
  const approvals = await readJsonQuiet(join(runDir, 'approvals.json'));
  const readiness = await readJsonQuiet(join(runDir, 'readiness.json'));

  // 1. Every requirement is referenced by at least one task (by id, or by a
  // meaningful text prefix when the requirement has no id).
  const taskTexts = tasks.map(taskSearchText);
  for (const requirement of requirements) {
    const needle = (requirement.id ?? requirement.text.slice(0, 60)).toLowerCase();
    if (!needle) continue;
    if (!taskTexts.some((text) => text.includes(needle))) {
      findings.push(finding('warning', 'requirement-without-task',
        rel('artifacts', 'stages', '02-requirements', requirement.source),
        `Requirement ${requirement.id ?? JSON.stringify(requirement.text.slice(0, 60))} is not referenced by any task.`,
        'Plan a task for it, or record it in the stage-02 won\'t-have / out-of-scope list.',
        { requirement_id: requirement.id }));
    }
  }

  const waivedTasks = new Set();
  const approvedArtifacts = [];
  for (const record of Array.isArray(approvals) ? approvals : []) {
    if (record?.status !== 'APPROVED' && record?.status !== 'CONSUMED') continue;
    if (typeof record.artifact !== 'string') continue;
    approvedArtifacts.push(record.artifact);
    const waiver = record.artifact.match(/^(?:guardrail-override|validation-waiver|waiver):(.+)$/);
    if (waiver) waivedTasks.add(waiver[1]);
  }

  for (const task of tasks) {
    if (!task?.id) continue;
    const taskRef = rel('tasks.json');

    // 2. Task completeness: owner/agent, stage, expected artifact, status.
    const missing = [];
    if (!task.status) missing.push('status');
    if (!task.agent && !(Array.isArray(task.pipeline_agents) && task.pipeline_agents.length)) missing.push('owner/agent');
    const stageIds = Array.isArray(task.stage_artifacts) ? task.stage_artifacts.map((item) => item?.stage_id).filter(Boolean) : [];
    if (!stageIds.length) missing.push('stage');
    if (!task.artifact_path && !stageIds.length) missing.push('expected artifact');
    if (missing.includes('stage') && missing.includes('expected artifact')) {
      findings.push(finding('warning', 'orphaned-task', taskRef,
        `Task ${task.id} names no stage and no expected artifact — its work cannot be traced.`,
        'Re-plan the task with stage_artifacts, or delete it if it is debris.',
        { task_id: task.id }));
    } else if (missing.length) {
      findings.push(finding('warning', 'task-missing-fields', taskRef,
        `Task ${task.id} is missing ${missing.join(', ')}.`,
        'Fill the missing fields in tasks.json so ownership and evidence stay attributable.',
        { task_id: task.id }));
    }

    if (!task.output_dir) continue;
    const completed = COMPLETED_STATUSES.has(task.status);
    const builderPath = join(projectRoot, task.output_dir, 'builder.json');
    const validationPath = join(projectRoot, task.output_dir, 'validation.json');
    const builder = completed ? await readJsonQuiet(builderPath) : null;

    // 3./4. Completed work must carry its contracts (or an explicit waiver).
    if (completed && !existsSync(builderPath)) {
      findings.push(finding('error', 'missing-builder-contract', `${task.output_dir}/builder.json`,
        `Task ${task.id} is ${task.status} but has no builder contract.`,
        'Re-run the builder, or reset the task status — a completed task without a contract is an unaudited claim.',
        { task_id: task.id }));
    }
    if (completed && !existsSync(validationPath)) {
      const waived = waivedTasks.has(task.id);
      findings.push(finding(waived ? 'warning' : 'error', 'missing-validator-contract', `${task.output_dir}/validation.json`,
        `Task ${task.id} is ${task.status} but has no validator contract${waived ? ' (waived by approval)' : ''}.`,
        waived ? 'Waiver on record — no action required, kept visible for audit.' : 'Run sdlc_validate, or record an explicit waiver approval.',
        { task_id: task.id, waived }));
    }

    // 5. A validator PASS must rest on recorded evidence.
    const validation = await readJsonQuiet(validationPath);
    if (validation?.status === 'PASS') {
      const passChecks = Array.isArray(validation.checks) ? validation.checks.filter((check) => check?.status === 'PASS').length : 0;
      if (!passChecks) {
        findings.push(finding('error', 'validator-pass-without-evidence', `${task.output_dir}/validation.json`,
          `Task ${task.id} has a PASS verdict with zero passing checks recorded.`,
          'Re-run sdlc_validate — a verdict without checks is not evidence.',
          { task_id: task.id }));
      }
    }

    // 6. Files the builder claims to have modified must still exist.
    for (const file of Array.isArray(builder?.files_modified) ? builder.files_modified : []) {
      if (typeof file !== 'string' || !file.trim()) continue;
      if (!existsSync(resolve(projectRoot, file))) {
        findings.push(finding('warning', 'stale-file-reference', `${task.output_dir}/builder.json`,
          `Task ${task.id} claims modified file ${file}, which no longer exists.`,
          'The file was deleted or renamed after completion — update downstream references or note the removal.',
          { task_id: task.id, path: file }));
      }
    }
  }

  // 6b. Path-like evidence entries must still exist.
  const knownTaskIds = new Set(tasks.map((task) => task?.id).filter(Boolean));
  for (const event of evidence) {
    if (event?.task_id && !knownTaskIds.has(event.task_id)) {
      findings.push(finding('warning', 'evidence-unknown-task', rel('evidence.jsonl'),
        `Evidence event references task ${event.task_id}, which is not in tasks.json.`,
        'The task was removed after evidence was recorded — keep the ledger append-only but note the removal.',
        { task_id: event.task_id }));
      continue;
    }
    const items = Array.isArray(event?.evidence) ? event.evidence : [];
    for (const item of items) {
      if (typeof item !== 'string' || !PATHISH.test(item)) continue;
      if (!existsSync(resolve(projectRoot, item))) {
        findings.push(finding('warning', 'stale-file-reference', rel('evidence.jsonl'),
          `Evidence for ${event.task_id ?? 'a task'} points at ${item}, which no longer exists.`,
          'The referenced file was deleted or renamed — the evidence trail is now cold.',
          { task_id: event.task_id ?? null, path: item }));
      }
    }
  }

  // 7. An APPROVED artifact must still exist (virtual gate names excluded).
  for (const artifact of approvedArtifacts) {
    if (VIRTUAL_ARTIFACT.test(artifact)) continue;
    const candidates = [
      join(runDir, artifact),
      join(runDir, 'artifacts', artifact),
    ];
    let found = candidates.some((candidate) => existsSync(candidate));
    if (!found) {
      try {
        const stagesDir = join(runDir, 'artifacts', 'stages');
        for (const stage of await readdir(stagesDir)) {
          if (existsSync(join(stagesDir, stage, artifact))) { found = true; break; }
        }
      } catch { /* no stage artifacts yet */ }
    }
    if (!found) {
      findings.push(finding('warning', 'approval-artifact-missing', rel('approvals.json'),
        `Approval on record for "${artifact}", but no such artifact exists in the run.`,
        'The approved artifact was renamed or deleted after approval — re-approve the current artifact.',
        { approved_artifact: artifact }));
    }
  }

  // 8. Readiness must not contradict the task board.
  const readyish = typeof readiness?.status === 'string' && ['READY', 'ready'].includes(readiness.status);
  if (readyish) {
    const blocking = tasks.filter((task) => ['FAIL', 'BLOCKED'].includes(task?.status)).map((task) => task.id);
    if (blocking.length) {
      findings.push(finding('error', 'readiness-contradiction', rel('readiness.json'),
        `readiness.json reports ${readiness.status} while ${blocking.length} task(s) are failing or blocked: ${blocking.join(', ')}.`,
        'Re-run the readiness check — a READY report over failing tasks is drift, not readiness.',
        { task_ids: blocking }));
    }
  }

  const errors = findings.filter((item) => item.severity === 'error').length;
  const warnings = findings.length - errors;
  return {
    run_id: selected,
    status: errors ? 'FAIL' : warnings ? 'WARN' : 'PASS',
    summary: {
      requirements: requirements.length,
      tasks: tasks.length,
      orphaned_tasks: findings.filter((item) => item.type === 'orphaned-task').length,
      missing_evidence: findings.filter((item) => ['missing-builder-contract', 'missing-validator-contract', 'validator-pass-without-evidence'].includes(item.type)).length,
      stale_references: findings.filter((item) => ['stale-file-reference', 'approval-artifact-missing', 'evidence-unknown-task'].includes(item.type)).length,
      errors,
      warnings,
    },
    findings,
  };
}

const STATUS_RANK = { PASS: 0, WARN: 1, FAIL: 2 };

// Whole-project scan: every run under .rstack/runs, worst status wins.
export async function scanProjectDrift(projectRoot) {
  const runsDir = join(rstackStateDir(projectRoot), 'runs');
  let runIds = [];
  try {
    runIds = (await readdir(runsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch { /* no runs yet */ }
  const runs = [];
  for (const runId of runIds) {
    runs.push(await scanRunDrift(projectRoot, runId));
  }
  const status = runs.reduce((acc, run) => (STATUS_RANK[run.status] > STATUS_RANK[acc] ? run.status : acc), 'PASS');
  return { status, run_count: runs.length, runs };
}
