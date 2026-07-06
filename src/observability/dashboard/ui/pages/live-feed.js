// owner: RStack developed by Richardson Gunde
//
// Live Feed page module — renders into #page-live-feed. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const liveFeedScript = `
// ── page: live-feed ────────────────────────────────────────────────
// July harness vocabulary (#215) gets distinct glyphs so the audit story
// reads at a glance: checkpoints (CP), context pressure (CX), approval audit
// (AU), memory writes (MB), metrics drift (MX), retries (RT), guardrails
// (GR), goal loop (GL). Anything not listed falls back to the shared
// level-based feed row — unknown event types keep degrading gracefully.
var OPS_FEED_ICONS = {
  stage_checkpoint_before_saved: 'CP',
  stage_checkpoint_after_saved: 'CP',
  context_pressure_warning: 'CX',
  approval_audit_failed: 'AU',
  episode_memory_written: 'MB',
  episode_memory_skipped_untrusted: 'MB',
  metrics_write_failed: 'MX',
  retry_decision: 'RT',
  task_retry_scheduled: 'RT',
  task_retry_exhausted: 'RT',
  task_human_context_required: 'RT',
  guardrail_triggered: 'GR',
  guardrail_overridden: 'GR',
  goal_evaluated: 'GL'
};

// One compact detail chip per event type, read from the structured data the
// server feed attaches (state/feed.js). Empty string when the event carried
// no detail — nothing is fabricated.
function opsFeedMeta(item) {
  var d = item.data || {};
  switch (item.type) {
    case 'guardrail_triggered':
      if (!d.limit_name) return '';
      return d.limit_name + (d.current_value != null && d.limit_value != null ? ': ' + d.current_value + ' of ' + d.limit_value : '');
    case 'context_pressure_warning':
      if (d.size == null || d.threshold == null) return '';
      return d.size + ' vs ' + d.threshold + (d.metric ? ' ' + d.metric : '');
    case 'stage_checkpoint_before_saved':
    case 'stage_checkpoint_after_saved':
      return d.verified === true ? 'verified' : d.verified === false ? 'unverified' : '';
    case 'approval_audit_failed':
      return (d.issues || []).length ? (d.issues || []).length + ' audit issue(s)' : '';
    case 'retry_decision':
      return d.decision || '';
    case 'task_retry_scheduled':
    case 'task_retry_exhausted':
    case 'task_human_context_required':
      return d.attempt != null && d.max_attempts != null ? 'attempt ' + d.attempt + '/' + d.max_attempts : '';
    case 'episode_memory_written':
      return d.trusted === true ? 'trusted' : d.trusted === false ? 'untrusted' : '';
    case 'episode_memory_skipped_untrusted':
      return d.write_policy || '';
    case 'goal_evaluated':
      return d.criteria_total != null ? (d.criteria_met != null ? d.criteria_met : '?') + '/' + d.criteria_total + ' criteria' : '';
    default:
      return '';
  }
}

function opsFeedRowHtml(item) {
  var icon = OPS_FEED_ICONS[item.type];
  if (!icon) return feedRowHtml(item);
  var level = item.level || 'info';
  var extra = opsFeedMeta(item);
  return '<div class="feed-row"><div class="feed-icon ' + esc(level) + '">' + esc(icon) + '</div><div><div class="feed-summary">' + esc(item.summary || '') + '</div><div class="feed-meta">' + (item.runId ? '<span>' + esc(item.runId.slice(-14)) + '</span>' : '') + (item.projectRoot ? '<span>' + esc(shortName(item.projectRoot)) + '</span>' : '') + (item.type ? '<span>' + esc(item.type) + '</span>' : '') + (extra ? '<span class="ops-meta">' + esc(extra) + '</span>' : '') + '</div></div><div class="feed-ts">' + esc(fmtTime(item.ts)) + '</div></div>';
}

function renderLiveFeed(s) {
  var feed = s.feed || [];
  setText('live-feed-count', feed.length + ' events');
  setHTML('live-feed-list', feed.length ? feed.map(opsFeedRowHtml).join('') : emptyHtml('No events yet', 'Live event data appears here.'));
}

registerPage('live-feed', {
  errLabel: 'live feed',
  sub: 'Real-time event stream from events.jsonl plus live WebSocket refreshes.',
  render: renderLiveFeed
});
`;
