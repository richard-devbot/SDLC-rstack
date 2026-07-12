// owner: RStack developed by Richardson Gunde
//
// Operations projection (#284): one server-owned view answering "is the data
// fresh, is the runtime healthy, what recovery exists, and what remediation
// is safe" — without scanning six telemetry pages. Every section derives
// from projections that already exist (actions/#281, environment/#238,
// pipelineRollup checkpoints+retries+context_pressure, presence, feed);
// this module NEVER invents a competing formula or count.
//
// Truth semantics (the #273 program rules, enforced here):
//   - `status` is 'ok' | 'warn' | 'blocked' | 'unknown'; a silent producer is
//     'unknown', never 'ok' — health is not green merely because nothing
//     reported.
//   - `availability` says whether the underlying producer supplied data at
//     all, so pages can render "unavailable" as its own state, distinct from
//     healthy or failed.
//   - Transport (WS vs REST fallback, snapshot age) is CLIENT-local truth —
//     the server contributes only `snapshot.generatedAt`; the page merges the
//     browser's own WS_CONNECTED/classifyFreshness state. A server cannot
//     honestly report a browser's connection.

const CLOSED_ACTION_STATUSES = new Set(['approved', 'rejected', 'resolved', 'consumed', 'waived', 'closed']);

function worst(statuses) {
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.includes('warn')) return 'warn';
  if (statuses.includes('unknown')) return 'unknown';
  return 'ok';
}

// Section 2 — actionable health. Counts reconcile with the Action Inbox by
// construction: they are computed FROM the inbox records, never alongside.
function healthSection(actions) {
  if (!Array.isArray(actions)) {
    return { availability: 'unavailable', status: 'unknown', open: 0, blocking: 0, source: 'action-inbox' };
  }
  const open = actions.filter((action) => !CLOSED_ACTION_STATUSES.has(String(action.status ?? '').toLowerCase()));
  const blocking = open.filter((action) => action.blocking === true);
  return {
    availability: 'available',
    status: blocking.length ? 'blocked' : open.length ? 'warn' : 'ok',
    open: open.length,
    blocking: blocking.length,
    top: open.slice(0, 5).map((action) => ({
      id: action.id,
      title: action.title ?? action.kind ?? 'Action required',
      severity: action.severity ?? null,
      blocking: action.blocking === true,
    })),
    source: 'action-inbox',
  };
}

// Section 3 — integrations & environment, from the #238 environment state
// plus per-root config validation (#151).
function integrationsSection(environment, configIssues) {
  const issues = Array.isArray(configIssues) ? configIssues : [];
  if (!environment || typeof environment !== 'object') {
    return { availability: 'unavailable', status: 'unknown', configIssues: issues.length };
  }
  const report = environment.report ?? null;
  const integrations = environment.integrations ?? null;
  const setupNeeds = Array.isArray(report?.setup_needs) ? report.setup_needs : [];
  const status = issues.length || setupNeeds.length ? 'warn'
    : (report || integrations) ? 'ok' : 'unknown';
  return {
    availability: report || integrations ? 'available' : 'unavailable',
    status,
    hasEnvironmentReport: Boolean(report),
    hasIntegrationsConfig: Boolean(integrations),
    setupNeeds: setupNeeds.length,
    configIssues: issues.length,
    source: '.rstack/environment_report.json + integrations.json + config validation',
  };
}

// Section 4 — recovery, per run, from the compact rollup's disk-verified
// checkpoint block (#132/#203/#215: checkpoints.stages carries {id,
// restorable, reason}) and the #123 retry rollup. Never inferred from events.
function recoverySection(runs) {
  const items = [];
  let sawRollup = false;
  for (const run of runs ?? []) {
    const rollup = run.pipelineRollup;
    if (!rollup) continue;
    sawRollup = true;
    const stages = rollup.checkpoints?.stages ?? [];
    const restorable = stages.filter((stage) => stage.restorable === true);
    const corrupt = stages.filter((stage) => String(stage.reason ?? '').startsWith('corrupt'));
    const retries = rollup.retries ?? {};
    if (!stages.length && !(retries.total > 0) && !(rollup.checkpoints?.reverted > 0)) continue;
    items.push({
      runId: run.runId,
      projectRoot: run.projectRoot ?? null,
      restorable: restorable.map((stage) => stage.id),
      corrupt: corrupt.map((stage) => stage.id),
      reverted: rollup.checkpoints?.reverted ?? 0,
      retries: {
        scheduled: retries.scheduled ?? 0,
        exhausted: retries.exhausted ?? 0,
        human_required: retries.human_required ?? 0,
      },
      source: `.rstack/runs/${run.runId}/pipeline-state.json`,
    });
  }
  const anyCorrupt = items.some((item) => item.corrupt.length > 0);
  const anyExhausted = items.some((item) => item.retries.exhausted > 0 || item.retries.human_required > 0);
  return {
    availability: sawRollup ? 'available' : 'unavailable',
    status: !sawRollup ? 'unknown' : anyCorrupt || anyExhausted ? 'warn' : 'ok',
    runs: items,
  };
}

// Section 5 — context & memory health: the #136 context-pressure rollup, the
// #137 write-policy skip events, and metrics drift (#83's metrics_write_failed
// means persisted totals were superseded by event recompute).
function contextMemorySection(runs, feed) {
  let sawRollup = false;
  let warnings = 0;
  const bySource = {};
  for (const run of runs ?? []) {
    const pressure = run.pipelineRollup?.context_pressure;
    if (!pressure) continue;
    sawRollup = true;
    warnings += pressure.total ?? 0;
    for (const [source, count] of Object.entries(pressure.by_source ?? {})) {
      bySource[source] = (bySource[source] ?? 0) + count;
    }
  }
  const feedItems = Array.isArray(feed) ? feed : [];
  const memorySkips = feedItems.filter((item) => item.type === 'episode_memory_skipped_untrusted').length;
  const metricsDrift = feedItems.filter((item) => item.type === 'metrics_write_failed').length;
  return {
    availability: sawRollup ? 'available' : 'unavailable',
    status: !sawRollup ? 'unknown' : warnings || memorySkips || metricsDrift ? 'warn' : 'ok',
    contextPressureWarnings: warnings,
    bySource,
    memoryWritesSkipped: memorySkips,
    metricsDriftEvents: metricsDrift,
    source: 'pipelineRollup.context_pressure + run events',
  };
}

// Section 6 — agents & team, from the existing presence projection.
function agentsSection(presence) {
  if (!Array.isArray(presence)) return { availability: 'unavailable', status: 'unknown', active: 0 };
  return {
    availability: 'available',
    // Presence is informational — an empty team is not a health problem.
    status: 'ok',
    active: presence.length,
    items: presence.slice(0, 12),
  };
}

export function buildOperationsProjection(state) {
  const sections = {
    health: healthSection(state.actions),
    integrations: integrationsSection(state.environment, state.configIssues ?? state.diagnostics?.configIssues),
    recovery: recoverySection(state.runs),
    contextMemory: contextMemorySection(state.runs, state.feed),
    agents: agentsSection(state.presence),
    // Section 7 — the raw feed stays a full page; Operations links it as
    // secondary detail and carries only the pointer count.
    feed: { availability: Array.isArray(state.feed) ? 'available' : 'unavailable', recent: (state.feed ?? []).length },
  };
  return {
    // Section 1 (transport) is completed client-side; the server contributes
    // the snapshot stamp the browser measures its freshness against.
    snapshot: { generatedAt: state.ts ?? null },
    status: worst(Object.values(sections).map((section) => section.status ?? 'ok')),
    sections,
  };
}
