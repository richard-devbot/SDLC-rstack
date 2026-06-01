import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CANONICAL_SDLC_STAGES } from '../../harness/stages.js';
import { readJson, readJsonlSync } from './files.js';

// owner: RStack developed by Richardson Gunde

export function inferHost(manifest) {
  return manifest?.host ?? manifest?.framework ?? manifest?.runtime ?? manifest?.mode ?? 'unknown';
}

export function buildActivityTimeline(events) {
  const minutes = {};
  for (const ev of events ?? []) {
    const min = ev.ts?.slice(0, 16);
    if (!min) continue;
    if (!minutes[min]) {
      minutes[min] = {
        toolCalls: 0,
        stagesDone: [],
        tasksPassed: 0,
        tasksFailed: 0,
        guardrails: 0,
        approvals: 0,
        quality: [],
      };
    }
    const m = minutes[min];
    if (ev.type === 'tool_call') m.toolCalls++;
    if (ev.type === 'stage_completed') m.stagesDone.push(ev.stage_id ?? '');
    if (ev.type === 'task_validated' && ev.status === 'PASS') m.tasksPassed++;
    if (ev.type === 'task_validated' && ev.status === 'FAIL') m.tasksFailed++;
    if (ev.type === 'guardrail_triggered' || ev.type === 'approval_gate_blocked') m.guardrails++;
    if (ev.type === 'approval_gate') m.approvals++;
    if (ev.type === 'quality_score_recorded') {
      m.quality.push({
        task: ev.task_id,
        score: ev.score,
        pass: ev.pass_checks,
        total: ev.total_checks,
      });
    }
  }
  return Object.entries(minutes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([minute, data]) => ({ minute, ...data }));
}

export function deriveRunStatus(manifest, events) {
  if (manifest?.completed_at) return 'done';
  if (!events?.length) return 'idle';
  const last = events[events.length - 1];
  if (last?.type === 'session_shutdown') {
    const lastTs = last.ts ? new Date(last.ts).getTime() : 0;
    return Date.now() - lastTs > 30 * 60 * 1000 ? 'stalled' : 'ended';
  }
  const lastTs = last?.ts ? new Date(last.ts).getTime() : 0;
  if (lastTs && Date.now() - lastTs > 30 * 60 * 1000) return 'stalled';
  return 'active';
}

export function stageIdForTask(task) {
  if (!task) return null;
  if (CANONICAL_SDLC_STAGES.some((stage) => stage.id === task.id)) return task.id;
  if (task.stage_id) return task.stage_id;
  const artifactStage = (task.stage_artifacts ?? []).find((artifact) => artifact.stage_id);
  return artifactStage?.stage_id ?? null;
}

export async function enrichTasks(projectRoot, runId, tasks) {
  const tasksDir = join(projectRoot, '.rstack', 'runs', runId, 'tasks');
  return Promise.all((tasks ?? []).map(async (task) => {
    const taskDir = join(tasksDir, task.id);
    const [builder, validation, promptText] = await Promise.all([
      readJson(join(taskDir, 'builder.json'), null),
      readJson(join(taskDir, 'validation.json'), null),
      readFile(join(taskDir, 'prompt.md'), 'utf8').catch(() => ''),
    ]);
    const checks = validation?.checks ?? [];
    return {
      ...task,
      builder,
      validation,
      prompt_preview: promptText ? promptText.slice(0, 700) : '',
      stageId: stageIdForTask(task),
      agent_name: builder?.agent ?? task.agent ?? task.specialist ?? 'rstack-agent',
      risk_count: Array.isArray(builder?.risks) ? builder.risks.length : 0,
      evidence_count: Array.isArray(checks) ? checks.length : 0,
    };
  }));
}

export async function getRunsForRoot(projectRoot) {
  const runsDir = join(projectRoot, '.rstack', 'runs');
  if (!existsSync(runsDir)) return [];
  let entries;
  try { entries = await readdir(runsDir); } catch { return []; }

  const runs = await Promise.all(entries.map(async (runId) => {
    const runDir = join(runsDir, runId);
    const stagesDir = join(runDir, 'artifacts', 'stages');

    const [manifest, metrics, tasksRaw, contextText, planText, requirements] = await Promise.all([
      readJson(join(runDir, 'manifest.json'), {}),
      readJson(join(runDir, 'metrics.json'), {}),
      readJson(join(runDir, 'tasks.json'), null),
      readFile(join(runDir, 'context.md'), 'utf8').catch(() => ''),
      readFile(join(runDir, 'plan.md'), 'utf8').catch(() => ''),
      readJson(join(stagesDir, '02-requirements', 'requirements.json'), null),
    ]);

    const rawTasks = Array.isArray(tasksRaw)
      ? tasksRaw
      : Array.isArray(tasksRaw?.tasks) ? tasksRaw.tasks : [];
    const tasks = await enrichTasks(projectRoot, runId, rawTasks);
    const events = readJsonlSync(join(runDir, 'events.jsonl'));
    const evidence = readJsonlSync(join(runDir, 'evidence.jsonl'));

    const reqList = Array.isArray(requirements)
      ? requirements
      : Array.isArray(requirements?.functional) ? requirements.functional
      : Array.isArray(requirements?.requirements) ? requirements.requirements : [];

    const brief = contextText
      ? contextText.split('\n').filter((line) => line.trim() && !line.startsWith('#')).slice(0, 3).join(' ').slice(0, 300)
      : '';

    return {
      runId,
      projectRoot,
      manifest,
      metrics,
      tasks,
      events,
      evidence,
      activityTimeline: buildActivityTimeline(events),
      derivedStatus: deriveRunStatus(manifest, events),
      host: inferHost(manifest),
      brief,
      requirements: reqList.slice(0, 20),
      hasPlan: planText.length > 50,
    };
  }));

  return runs.filter((run) => run.manifest && typeof run.manifest === 'object');
}

export async function getAllRuns(roots) {
  const perRoot = await Promise.all((roots ?? []).map((root) => getRunsForRoot(root)));
  const seen = new Set();
  return perRoot.flat()
    .filter((run) => (seen.has(run.runId) ? false : seen.add(run.runId)))
    .sort((a, b) => b.runId.localeCompare(a.runId));
}
