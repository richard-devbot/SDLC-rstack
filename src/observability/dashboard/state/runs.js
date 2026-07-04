import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CANONICAL_SDLC_STAGES } from '../../../core/harness/stages.js';
import { cleanOrphanedTmpFiles } from '../../../core/harness/safe-write.js';
import { deriveRunTimeline, deriveRunTotals, deriveStageElapsed } from '../../metrics/derive.js';
import { stageReportIndex } from './stage-reports.js';
import { readJson, readJsonTracked, readJsonlTracked } from './files.js';

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
    if (ev.type === 'stage_completed' && ev.stage_id) m.stagesDone.push(ev.stage_id);
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

// Index the run's real deliverables so the UI can offer them for reading:
// artifacts/ (top level + per stage), specs/, plan.md, context.md.
async function indexArtifacts(runDir) {
  const index = [];
  const push = async (relPath, stage) => {
    try {
      const info = await stat(join(runDir, relPath));
      if (info.isFile()) index.push({ path: relPath, stage, size: info.size });
    } catch { /* missing — skip */ }
  };
  for (const name of ['plan.md', 'context.md']) await push(name, 'run');
  const artifactsDir = join(runDir, 'artifacts');
  try {
    for (const entry of await readdir(artifactsDir, { withFileTypes: true })) {
      if (entry.isFile()) await push(join('artifacts', entry.name), 'run');
      if (entry.isDirectory() && entry.name === 'stages') {
        for (const stage of await readdir(join(artifactsDir, 'stages'))) {
          try {
            for (const file of await readdir(join(artifactsDir, 'stages', stage))) {
              await push(join('artifacts', 'stages', stage, file), stage);
            }
          } catch { /* not a dir */ }
        }
      }
    }
  } catch { /* no artifacts dir */ }
  return index.sort((a, b) => a.stage.localeCompare(b.stage) || a.path.localeCompare(b.path));
}

export async function getRunsForRoot(projectRoot, options = {}) {
  const runsDir = join(projectRoot, '.rstack', 'runs');
  if (!existsSync(runsDir)) return [];
  let entries;
  try { entries = await readdir(runsDir); } catch { return []; }
  // Scoped parse: the rollup index passes the set of runs that actually need
  // a full re-parse; everything else is served from .rstack/index.json.
  if (options.only) entries = entries.filter((runId) => options.only.has(runId));

  const runs = await Promise.all(entries.map(async (runId) => {
    const runDir = join(runsDir, runId);
    const stagesDir = join(runDir, 'artifacts', 'stages');

    // Sweep `*.tmp.<pid>` files orphaned by a crashed atomic writer so they
    // never accumulate in run dirs; fresh in-flight tmp files are left alone.
    await cleanOrphanedTmpFiles(runDir);

    // Per-run damage report (#82): parse failures in canonical run files are
    // recorded here and surfaced in Diagnostics instead of silently skipped.
    const integrity = [];
    const rel = (name) => join('.rstack', 'runs', runId, name);

    const [manifest, metrics, tasksRaw, contextText, planText, requirements, runApprovals, projectProfile, budgetPolicy] = await Promise.all([
      readJsonTracked(join(runDir, 'manifest.json'), {}, integrity, rel('manifest.json')),
      readJsonTracked(join(runDir, 'metrics.json'), {}, integrity, rel('metrics.json')),
      readJsonTracked(join(runDir, 'tasks.json'), null, integrity, rel('tasks.json')),
      readFile(join(runDir, 'context.md'), 'utf8').catch(() => ''),
      readFile(join(runDir, 'plan.md'), 'utf8').catch(() => ''),
      readJson(join(stagesDir, '02-requirements', 'requirements.json'), null),
      readJsonTracked(join(runDir, 'approvals.json'), [], integrity, rel('approvals.json')),
      readJson(join(projectRoot, '.rstack', 'rstack.config.json'), null),
      readJson(join(projectRoot, '.rstack', 'budget.json'), null),
    ]);

    const rawTasks = Array.isArray(tasksRaw)
      ? tasksRaw
      : Array.isArray(tasksRaw?.tasks) ? tasksRaw.tasks : [];
    const tasks = await enrichTasks(projectRoot, runId, rawTasks);
    const events = readJsonlTracked(join(runDir, 'events.jsonl'), integrity, rel('events.jsonl'));
    const evidence = readJsonlTracked(join(runDir, 'evidence.jsonl'), integrity, rel('evidence.jsonl'));

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
      profile: projectProfile || (manifest?.profile ? { profile: manifest.profile, workflow: manifest.workflow } : (tasksRaw?.profile ? { profile: tasksRaw.profile, workflow: tasksRaw.workflow } : null)),
      workflow: manifest?.workflow || projectProfile?.workflow || tasksRaw?.workflow || null,
      budgetPolicy: tasksRaw?.budget_policy || budgetPolicy || null,
      metrics,
      tasks,
      events,
      evidence,
      approvals: Array.isArray(runApprovals) ? runApprovals : [],
      artifactIndex: await indexArtifacts(runDir),
      stageReports: await stageReportIndex(runDir),
      activityTimeline: buildActivityTimeline(events),
      timeline: deriveRunTimeline(events, rawTasks),
      totals: deriveRunTotals(events),
      stageElapsed: deriveStageElapsed(events, rawTasks),
      derivedStatus: deriveRunStatus(manifest, events),
      integrity,
      hasIntegrityErrors: integrity.length > 0,
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
