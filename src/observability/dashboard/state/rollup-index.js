/**
 * Incremental rollup index + run retention for the Business Hub.
 *
 * Problem: every 3-second poll re-parsed every run directory (events.jsonl,
 * tasks/*, artifacts/*) — O(total runs) forever. This module keeps a per-root
 * rollup at .rstack/index.json so list/trend views are served from the index
 * and only active (or explicitly scoped) runs pay the full-parse cost.
 *
 * Invalidation rule:
 *   - a run with completed_at in its index entry is NEVER re-parsed
 *     (not even stat'd) unless explicitly scoped;
 *   - a non-completed run is re-parsed only when its signature changes
 *     (mtime/size of manifest.json, events.jsonl, tasks.json, approvals.json
 *     + run dir mtime);
 *   - a missing or corrupt index.json self-heals with a full rebuild.
 *
 * Retention: RSTACK_RETENTION_DAYS (default 90, 0 = never) moves runs
 * completed beyond the window to .rstack/archive/<runId>. Move-only via
 * rename — nothing is ever deleted, and moving the directory back restores
 * the run on the next sync.
 *
 * The index file is written atomically (tmp + rename) and is purely a cache:
 * deleting it costs one full rebuild, never data.
 *
 * owner: RStack developed by Richardson Gunde
 */

import { join } from 'node:path';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { getRunsForRoot } from './runs.js';
import { safeJson } from './files.js';
import { persistedTokenTotals } from '../../metrics/derive.js';
import { compactPipelineRollup } from './pipeline-rollup.js';
import { readPipelineState, buildPipelineState } from '../../../core/harness/pipeline-state.js';

// v2 (#97): entries persist stage_reports so index-served (completed) runs
// keep their produced-stage list; the bump forces one self-healing rebuild.
// v3 (#264): entries persist run-level approvals — without them every
// index-served run rehydrated with approvals: [], so terminal-granted
// approvals were invisible on the Hub for all bridge-driven runs.
// v4 (#296): entries persist evidence, artifactIndex, timeline,
// activityTimeline, and requirements too — the same blind spot #264 fixed for
// approvals. Without them, index-served (completed) runs rehydrated all five
// empty, so Business Hub aggregates (evidence counts, artifact index, run
// timeline, requirement coverage, the drawer's activity timeline) silently
// undercounted every completed run. The bump forces one self-healing rebuild.
// v5: entries persist has_integrity_errors — found by the lite↔full parity
// guard the #296 review required: a completed run with damaged files lost its
// #82 "data damaged" badge the moment it was served from the index.
// v6 (#221): entries persist the compact pipeline_rollup so completed/index-
// served runs stop re-reading pipeline-state.json on every 3s poll — the read
// happens once at index time and is served from memory thereafter.
// v7 (#299 item 8): entries persist the TRUE evidence_count — the evidence
// list is capped at 100, and consumers deriving counts from `.length` of the
// capped array silently undercounted 100+-evidence runs to exactly 100 (the
// same no-silent-caps violation #296 fixed, one level up).
// v8 (#156/#215): entries persist the manifest schema_version (migration
// state in Diagnostics) and pick up the rollup's per-stage checkpoint status
// (restorable/reason) via the persisted pipeline_rollup — legacy entries
// rebuilt so index-served runs don't render an empty restore-point strip.
export const INDEX_VERSION = 8;
export const DEFAULT_RETENTION_DAYS = 90;

const STALL_MS = 30 * 60 * 1000;
// High-volume event types excluded from the per-run notable_events rollup.
const NOTABLE_EXCLUDE = new Set(['tool_call', 'tool_result', 'cost_recorded', 'context_recorded']);
const NOTABLE_CAP = 200;

function defaultIo() {
  return { readFile, readdir, stat, writeFile, rename, mkdir };
}

/** RSTACK_RETENTION_DAYS env → days; default 90; 0 = never archive. */
export function resolveRetentionDays(value = process.env.RSTACK_RETENTION_DAYS) {
  if (value === undefined || value === null || value === '') return DEFAULT_RETENTION_DAYS;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return DEFAULT_RETENTION_DAYS;
  return days;
}

/** Pure status derivation from an index entry — mirrors deriveRunStatus. */
export function statusFromEntry(entry, now = Date.now()) {
  if (entry?.completed_at) return 'done';
  if (!entry?.event_count) return 'idle';
  const lastMs = Date.parse(entry.last_event_ts ?? '');
  const stale = Number.isFinite(lastMs) && now - lastMs > STALL_MS;
  if (entry.last_event_type === 'session_shutdown') return stale ? 'stalled' : 'ended';
  return stale ? 'stalled' : 'active';
}

async function fileSig(io, filePath) {
  try {
    const info = await io.stat(filePath);
    return { mtime_ms: Math.round(info.mtimeMs), size: info.size };
  } catch {
    return null;
  }
}

/** Change signature for a run dir: manifest/events/tasks/approvals mtimes + dir mtime. */
async function runSignature(io, runDir) {
  // approvals.json is part of the signature (#264): sdlc_approve rewrites it
  // in place without touching manifest/events/tasks, and a content-only file
  // change does not bump the run dir mtime — without this entry a
  // terminal-granted approval never invalidated the cached index entry.
  // evidence.jsonl is part of the signature (#296): appendEvidenceEvent can
  // grow it without changing tasks.json, so a non-completed inactive run whose
  // evidence changed must re-parse to refresh the persisted evidence list.
  const [manifest, events, tasks, approvals, evidence, dir] = await Promise.all([
    fileSig(io, join(runDir, 'manifest.json')),
    fileSig(io, join(runDir, 'events.jsonl')),
    fileSig(io, join(runDir, 'tasks.json')),
    fileSig(io, join(runDir, 'approvals.json')),
    fileSig(io, join(runDir, 'evidence.jsonl')),
    fileSig(io, runDir),
  ]);
  return { manifest, events, tasks, approvals, evidence, dir: dir ? { mtime_ms: dir.mtime_ms } : null };
}

function sigEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Compact pipeline rollup for a fully-parsed run (#221). Mirrors
// attachPipelineRollups' read/build fallback so the persisted rollup is
// identical to the live one. Best-effort: any failure yields null.
async function computeRunPipelineRollup(run) {
  try {
    let state = await readPipelineState(run.projectRoot, run.runId);
    if (!state && !run.fromIndex) state = await buildPipelineState(run.projectRoot, run.runId);
    return state ? compactPipelineRollup(state, run.events ?? []) : null;
  } catch {
    return null;
  }
}

/** Build an index entry from an already fully-parsed run object. */
export function entryFromRun(run, sig = null) {
  const events = run.events ?? [];
  const last = events[events.length - 1] ?? null;
  const tasks = run.tasks ?? [];
  const stageStatuses = {};
  for (const task of tasks) {
    const stageId = task.stageId ?? task.stage_id ?? null;
    if (stageId) stageStatuses[stageId] = task.status ?? 'READY';
  }
  const metricCost = run.metrics?.cumulative_cost_usd ?? 0;
  // cumulative_tokens is an { input, output, total } object on runs written by
  // the incremental telemetry path (#83); tolerate the legacy bare number too.
  const metricTokens = persistedTokenTotals(run.metrics)?.total
    ?? (Number(run.metrics?.cumulative_tokens ?? run.metrics?.total_tokens ?? 0) || 0);
  return {
    runId: run.runId,
    status: run.derivedStatus ?? 'idle',
    started_at: run.manifest?.created_at ?? null,
    completed_at: run.manifest?.completed_at ?? null,
    goal: String(run.manifest?.goal ?? '').slice(0, 200),
    framework: run.manifest?.framework ?? run.manifest?.mode ?? 'unknown',
    // Manifest schema version (#82 migrations, surfaced per #156): v1 legacy
    // vs v2 must stay observable when the run is served from the index.
    schema_version: run.manifest?.schema_version ?? null,
    host: run.host ?? 'unknown',
    workflow: run.workflow ?? null,
    profile: run.profile?.profile ?? run.manifest?.profile ?? null,
    started_by: run.manifest?.started_by ?? null,
    has_plan: run.hasPlan ?? false,
    brief: (run.brief ?? '').slice(0, 300),
    // Which stages produced an artifact (#97) — without this, every
    // index-served run rendered as if no stage had reported.
    stage_reports: run.stageReports ?? [],
    // #82 data-integrity flag survives the index (v5): a damaged run must
    // keep its "data damaged" badge even when served from the cache.
    has_integrity_errors: run.hasIntegrityErrors ?? false,
    metrics: {
      cumulative_cost_usd: metricCost,
      cumulative_tokens: run.metrics?.cumulative_tokens ?? metricTokens,
      // Per-stage telemetry maps (#83/#135) survive into index-served lite
      // runs so Run Analytics keeps its data without a full re-parse.
      stage_cost_usd: run.metrics?.stage_cost_usd ?? {},
      stage_tokens: run.metrics?.stage_tokens ?? {},
    },
    totals: run.totals ?? null,
    cost_usd: run.totals?.cost_usd || metricCost || 0,
    tokens: run.totals?.tokens || metricTokens || 0,
    stage_elapsed: run.stageElapsed ?? {},
    stage_statuses: stageStatuses,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title ?? task.id,
      status: task.status ?? 'READY',
      stageId: task.stageId ?? task.stage_id ?? null,
      agent_name: task.agent_name ?? 'rstack-agent',
      risk_count: task.risk_count ?? 0,
      evidence_count: task.evidence_count ?? 0,
      validation_status: task.validation?.status ?? null,
    })),
    task_counts: {
      total: tasks.length,
      passed: tasks.filter((task) => task.status === 'PASS').length,
      failed: tasks.filter((task) => task.status === 'FAIL').length,
    },
    // Run-level approvals survive into index-served lite runs (#264) —
    // stored verbatim (they are small audit records) so every consumer sees
    // the same shape as a fully-parsed run. Capped like state.approvals.
    approvals: (run.approvals ?? []).slice(-100),
    // Compact pipeline rollup (#221): persisted so a completed/index-served run
    // is summarized from memory instead of a per-poll pipeline-state.json read.
    pipeline_rollup: run.pipelineRollup ?? null,
    // Evidence, artifacts, timelines, and requirements survive too (#296),
    // each capped to what the client-state projection actually consumes, so
    // index-served runs match a full parse instead of rendering empty.
    evidence: (run.evidence ?? []).slice(-100),
    // True total (#299 item 8) — the list above is capped; counts must not be.
    evidence_count: (run.evidence ?? []).length,
    artifactIndex: (run.artifactIndex ?? []).slice(0, 80),
    timeline: (run.timeline ?? []).slice(0, 120),
    activityTimeline: (run.activityTimeline ?? []).slice(0, 120),
    requirements: (run.requirements ?? []).slice(0, 20),
    event_count: events.length,
    last_event_ts: last?.ts ?? null,
    last_event_type: last?.type ?? null,
    notable_events: events.filter((ev) => ev?.type && !NOTABLE_EXCLUDE.has(ev.type)).slice(-NOTABLE_CAP),
    sig,
    indexed_at: new Date().toISOString(),
  };
}

/** Rehydrate a list/trend-grade run object from an index entry — zero fs. */
export function liteRunFromEntry(projectRoot, entry, now = Date.now()) {
  return {
    runId: entry.runId,
    projectRoot,
    fromIndex: true,
    manifest: {
      run_id: entry.runId,
      goal: entry.goal ?? '',
      created_at: entry.started_at ?? null,
      completed_at: entry.completed_at ?? null,
      framework: entry.framework ?? 'unknown',
      schema_version: entry.schema_version ?? null,
      started_by: entry.started_by ?? null,
      ...(entry.profile ? { profile: entry.profile } : {}),
      ...(entry.workflow ? { workflow: entry.workflow } : {}),
    },
    profile: entry.profile ? { profile: entry.profile, workflow: entry.workflow ?? null } : null,
    workflow: entry.workflow ?? null,
    budgetPolicy: null,
    metrics: entry.metrics ?? {},
    tasks: (entry.tasks ?? []).map((task) => ({
      ...task,
      validation: task.validation_status ? { status: task.validation_status, checks: [] } : null,
    })),
    events: entry.notable_events ?? [],
    approvals: entry.approvals ?? [],
    // #221: rehydrate the persisted rollup so attachPipelineRollups skips the
    // per-poll read for this run. null for legacy (< v6) entries until the
    // INDEX_VERSION bump rebuilds them; attachPipelineRollups treats a defined
    // value (incl. null) as "already attached" and does not re-read.
    pipelineRollup: entry.pipeline_rollup ?? null,
    // Persisted in the index entry as of v4 (#296) — index-served runs now
    // rehydrate these with real data instead of the empty arrays that made
    // Hub aggregates undercount every completed run. Legacy entries written
    // before v4 lack them; the INDEX_VERSION bump forces a rebuild, and the
    // `?? []` keeps a stale/partial entry safe until then.
    evidence: entry.evidence ?? [],
    evidenceCount: entry.evidence_count ?? (entry.evidence ?? []).length,
    artifactIndex: entry.artifactIndex ?? [],
    stageReports: entry.stage_reports ?? [],
    activityTimeline: entry.activityTimeline ?? [],
    timeline: entry.timeline ?? [],
    totals: entry.totals ?? null,
    stageElapsed: entry.stage_elapsed ?? {},
    stageStatuses: entry.stage_statuses ?? {},
    derivedStatus: statusFromEntry(entry, now),
    host: entry.host ?? 'unknown',
    brief: entry.brief ?? '',
    requirements: entry.requirements ?? [],
    hasPlan: entry.has_plan ?? false,
    hasIntegrityErrors: entry.has_integrity_errors ?? false,
    lastEventTs: entry.last_event_ts ?? null,
  };
}

function indexPathFor(projectRoot) {
  return join(projectRoot, '.rstack', 'index.json');
}

async function loadIndex(io, projectRoot) {
  const raw = await io.readFile(indexPathFor(projectRoot), 'utf8').catch(() => null);
  const parsed = raw === null ? null : safeJson(raw);
  // Missing or corrupt index self-heals via a full rebuild.
  if (!parsed || parsed.version !== INDEX_VERSION || typeof parsed.runs !== 'object' || parsed.runs === null) {
    return null;
  }
  return parsed;
}

async function writeIndexAtomic(io, projectRoot, index) {
  const stateDir = join(projectRoot, '.rstack');
  const finalPath = indexPathFor(projectRoot);
  const tmpPath = join(stateDir, `.index.json.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await io.mkdir(stateDir, { recursive: true });
    await io.writeFile(tmpPath, JSON.stringify(index, null, 2));
    await io.rename(tmpPath, finalPath);
  } catch {
    // The index is a cache — a failed write (read-only fs, race) never breaks
    // the dashboard; the next sync rebuilds whatever was lost.
  }
}

/**
 * Move runs completed beyond the retention window to .rstack/archive/.
 * Move-only (rename) — never deletes, and a failed move leaves the run
 * exactly where it was. Returns the run ids archived in this pass.
 */
async function archiveExpiredRuns(io, projectRoot, runsById, { retentionDays, now }) {
  if (!retentionDays) return [];
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const archiveDir = join(projectRoot, '.rstack', 'archive');
  const runsDir = join(projectRoot, '.rstack', 'runs');
  const archived = [];
  for (const [runId, entry] of Object.entries(runsById)) {
    const completedMs = Date.parse(entry?.completed_at ?? '');
    if (!Number.isFinite(completedMs) || completedMs > cutoff) continue;
    try {
      await io.mkdir(archiveDir, { recursive: true });
      await io.rename(join(runsDir, runId), join(archiveDir, runId));
      delete runsById[runId];
      archived.push(runId);
    } catch {
      // Could not move (target exists, permissions) — keep the run in place.
    }
  }
  return archived;
}

async function countArchivedRuns(io, projectRoot) {
  try {
    return (await io.readdir(join(projectRoot, '.rstack', 'archive'))).length;
  } catch {
    return 0;
  }
}

/**
 * Sync one root: classify runs hot/cold via the index, fully parse only hot
 * runs, refresh their entries, apply retention, persist the index if dirty.
 * Returns { runs, meta }.
 */
export async function syncRootRuns(projectRoot, options = {}) {
  const io = { ...defaultIo(), ...(options.io ?? {}) };
  const now = options.now ?? Date.now();
  const retentionDays = options.retentionDays ?? resolveRetentionDays();
  const scope = options.scopeRunIds instanceof Set ? options.scopeRunIds : new Set(options.scopeRunIds ?? []);
  const runsDir = join(projectRoot, '.rstack', 'runs');

  const previous = await loadIndex(io, projectRoot);
  const prevRuns = previous?.runs ?? {};
  let runIds = [];
  try { runIds = await io.readdir(runsDir); } catch { /* no runs dir */ }

  let dirty = previous === null && runIds.length > 0;
  const hot = new Set();
  const sigByRunId = {};
  const nextRuns = {};

  await Promise.all(runIds.map(async (runId) => {
    const prev = prevRuns[runId];
    const scoped = scope.has(runId);
    // Completed runs are never re-parsed — not even stat'd — unless scoped.
    if (prev?.completed_at && !scoped) {
      nextRuns[runId] = prev;
      return;
    }
    const sig = await runSignature(io, join(runsDir, runId));
    sigByRunId[runId] = sig;
    if (prev && !scoped && sigEqual(prev.sig, sig)) {
      const status = statusFromEntry(prev, now);
      if (status !== 'active') {
        // Unchanged and not live — serve from the index; persist status drift.
        if (prev.status !== status) dirty = true;
        nextRuns[runId] = prev.status === status ? prev : { ...prev, status };
        return;
      }
    }
    hot.add(runId);
  }));

  // Entries for runs whose directory disappeared (deleted or hand-archived).
  if (Object.keys(prevRuns).some((runId) => !nextRuns[runId] && !hot.has(runId))) dirty = true;

  const parsedRuns = hot.size > 0 ? await getRunsForRoot(projectRoot, { only: hot }) : [];
  for (const run of parsedRuns) {
    // #221: compute the compact pipeline rollup ONCE here, at index time, and
    // attach it to the run so entryFromRun persists it. Hot runs are the few
    // active/changed ones (cold runs never reach getRunsForRoot), so this is
    // the same work attachPipelineRollups did per-poll — but now completed
    // runs keep it in the index and never re-read pipeline-state.json again.
    run.pipelineRollup = await computeRunPipelineRollup(run);
    nextRuns[run.runId] = entryFromRun(run, sigByRunId[run.runId] ?? null);
    dirty = true;
  }

  const archivedNow = await archiveExpiredRuns(io, projectRoot, nextRuns, { retentionDays, now });
  if (archivedNow.length > 0) dirty = true;
  const archivedSet = new Set(archivedNow);

  const index = {
    version: INDEX_VERSION,
    updated_at: dirty ? new Date(now).toISOString() : previous?.updated_at ?? new Date(now).toISOString(),
    runs: nextRuns,
  };
  if (dirty || (previous === null && runIds.length > 0)) {
    await writeIndexAtomic(io, projectRoot, index);
  }

  const liteRuns = Object.values(nextRuns)
    .filter((entry) => !hot.has(entry.runId))
    .map((entry) => liteRunFromEntry(projectRoot, entry, now));
  const runs = [...parsedRuns.filter((run) => !archivedSet.has(run.runId)), ...liteRuns];

  return {
    runs,
    meta: {
      projectRoot,
      updatedAt: index.updated_at,
      indexedRuns: Object.keys(nextRuns).length,
      fullyParsedRuns: parsedRuns.length,
      indexServedRuns: liteRuns.length,
      archivedRuns: await countArchivedRuns(io, projectRoot),
      retentionDays,
    },
  };
}

function sumMeta(rootMeta, key) {
  return rootMeta.reduce((total, meta) => total + (meta[key] ?? 0), 0);
}

/** Aggregate per-root sync metadata for the diagnostics screen. */
export function summarizeIndexMeta(rootMeta = [], now = Date.now()) {
  const updatedAt = rootMeta.map((meta) => meta.updatedAt).filter(Boolean).sort().pop() ?? null;
  const updatedMs = Date.parse(updatedAt ?? '');
  return {
    updatedAt,
    freshnessMs: Number.isFinite(updatedMs) ? Math.max(0, now - updatedMs) : null,
    indexedRuns: sumMeta(rootMeta, 'indexedRuns'),
    fullyParsedRuns: sumMeta(rootMeta, 'fullyParsedRuns'),
    indexServedRuns: sumMeta(rootMeta, 'indexServedRuns'),
    archivedRuns: sumMeta(rootMeta, 'archivedRuns'),
    retentionDays: rootMeta[0]?.retentionDays ?? resolveRetentionDays(),
    roots: rootMeta,
  };
}

/**
 * Index-backed replacement for getAllRuns: full parse for active/scoped runs,
 * index-served lite runs for everything else, deduped across roots.
 */
export async function getIndexedRuns(roots, options = {}) {
  const now = options.now ?? Date.now();
  const perRoot = await Promise.all((roots ?? []).map((root) => syncRootRuns(root, { ...options, now })));
  const seen = new Set();
  const runs = perRoot.flatMap((result) => result.runs)
    // A run id is only unique inside its state root. Different projects — or
    // two worktrees of one repository — may legitimately use the same id.
    .filter((run) => {
      const key = `${run.projectRoot}\u0000${run.runId}`;
      return seen.has(key) ? false : seen.add(key);
    })
    .sort((a, b) => b.runId.localeCompare(a.runId));
  return { runs, indexMeta: summarizeIndexMeta(perRoot.map((result) => result.meta), now) };
}
