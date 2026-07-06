/**
 * Ops surfaces for the July harness signals (#156 remainder + #215):
 *  - state/feed.js renders plain-English lines (+ structured data) for the
 *    new event vocabulary: checkpoints, context pressure, approval audit
 *    rejections, memory write decisions, metrics drift, retry decisions and
 *    goal evaluations — while unknown event types keep degrading gracefully;
 *  - pages/alerts-guardrails.js renders the Retry State / Guardrail Triggers /
 *    Context Pressure panels from fixture-shaped state;
 *  - pages/approvals.js renders the Audit Rejections panel (a rejected or
 *    forged approval record must be visible, never silent);
 *  - every panel has an honest empty state.
 *
 * The page renderers are real client code living inside template literals,
 * so these tests execute them against a minimal DOM stub instead of only
 * string-matching the source.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildActivityFeed } from '../src/observability/dashboard/state/feed.js';
import { libScript } from '../src/observability/dashboard/ui/lib.js';
import { liveFeedScript } from '../src/observability/dashboard/ui/pages/live-feed.js';
import { approvalsScript } from '../src/observability/dashboard/ui/pages/approvals.js';
import { alertsGuardrailsScript } from '../src/observability/dashboard/ui/pages/alerts-guardrails.js';

// Fixture-shaped events — field-for-field the shapes the harness emits
// (mirrors .rstack/runs/…-ui-fixture-july-signals/events.jsonl + HARNESS.md).
const JULY_EVENTS = [
  { type: 'stage_checkpoint_before_saved', stage_id: '06-architecture', task_id: '003-architecture', verified: true, ts: '2026-07-06T12:01:05.000Z' },
  { type: 'stage_checkpoint_after_saved', stage_id: '06-architecture', task_id: '003-architecture', verified: false, ts: '2026-07-06T12:10:05.000Z' },
  { type: 'context_pressure_warning', source: 'memory_summary', metric: 'chars', size: 61000, threshold: 40000, blocking: false, task_id: '004-implementation', ts: '2026-07-06T12:13:00.000Z' },
  { type: 'task_retry_scheduled', task_id: '005-testing', attempt: 1, max_attempts: 2, reason: 'validator requested another attempt', ts: '2026-07-06T12:31:00.000Z' },
  { type: 'retry_decision', task_id: '005-testing', stage_id: '08-testing', attempt: 2, max_attempts: 2, retry_recommendation: 'retry_builder', action: 'exhausted', next_status: 'BLOCKED', reason: 'attempt budget exhausted', issues: [], ts: '2026-07-06T12:35:00.000Z' },
  { type: 'guardrail_triggered', task_id: '005-testing', limit_name: 'maxTaskAttempts', current_value: 2, limit_value: 2, ts: '2026-07-06T12:35:01.000Z' },
  { type: 'approval_audit_failed', record_id: 'forged-1', artifact: 'guardrail-override:005-testing', status: 'APPROVED', issues: ['approval_actor_present: approver missing or empty'], reason: 'approval record failed the consistency audit — treated as absent, gated work stays gated', ts: '2026-07-06T12:36:00.000Z' },
  { type: 'episode_memory_written', task_id: '003-architecture', trusted: true, ts: '2026-07-06T12:37:00.000Z' },
  { type: 'episode_memory_skipped_untrusted', task_id: '005-testing', reason: 'validator status FAIL under validator-approved-only', write_policy: 'validator-approved-only', ts: '2026-07-06T12:38:00.000Z' },
  { type: 'metrics_write_failed', task_id: '004-implementation', operation: 'telemetry_increment', error: 'EACCES', ts: '2026-07-06T12:39:00.000Z' },
  { type: 'goal_evaluated', iteration: 1, max_iterations: 3, goal_id: 'ship-the-mvp', status: 'FAIL', score: 0.5, critical_count: 1, failing_stages: ['08-testing'], recommended_rerun_stages: ['07-code', '08-testing'], reason: 'test coverage below target', ts: '2026-07-06T12:40:00.000Z' },
  // Unknown event type: must not throw and must not fabricate a feed line.
  { type: 'mystery_signal_from_the_future', task_id: '005-testing', ts: '2026-07-06T12:41:00.000Z' },
];

const FIXTURE_RUN = {
  runId: 'run-july-signals',
  projectRoot: '/tmp/project',
  manifest: { goal: 'July signals fixture' },
  events: JULY_EVENTS,
};

function fixtureState() {
  return {
    runs: [{
      runId: 'run-july-signals',
      projectRoot: '/tmp/project',
      manifest: { goal: 'July signals fixture' },
      tasks: [
        { id: '003-architecture', status: 'PASS', stageId: '06-architecture' },
        { id: '004-implementation', status: 'IN_PROGRESS', stageId: '07-code' },
        { id: '005-testing', status: 'BLOCKED', stageId: '08-testing' },
      ],
      // No guardrail-override approval on file — the forged one was rejected.
      approvals: [{ artifact: 'plan.md', status: 'APPROVED', approver: 'Richardson', timestamp: '2026-07-06T12:05:00.000Z' }],
    }],
    feed: buildActivityFeed([FIXTURE_RUN]),
    alerts: [],
    blockedGates: [],
    approvals: [],
  };
}

// ── Minimal DOM stub: just enough for setText/setHTML/insertAdjacentHTML ────
function createDom(ids) {
  const els = new Map();
  const makeEl = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    insertAdjacentHTML(position, html) {
      this.innerHTML += html;
      // Register every id introduced by the injected markup so subsequent
      // setHTML/setText calls can resolve the new panel containers.
      for (const match of html.matchAll(/id="([^"]+)"/g)) {
        if (!els.has(match[1])) els.set(match[1], makeEl(match[1]));
      }
    },
  });
  for (const id of ids) els.set(id, makeEl(id));
  return {
    els,
    document: { getElementById: (id) => els.get(id) ?? null },
  };
}

const PAGE_IDS = [
  'page-alerts-guardrails', 'page-approvals',
  'alerts-count', 'blocked-count', 'alerts-list', 'blocked-list',
  'approvals-count', 'approvals-list', 'approvals-resolved',
  'live-feed-count', 'live-feed-list',
];

function loadRenderers(document) {
  const factory = new Function(
    'document', 'window', 'localStorage', 'sessionStorage', 'fetch',
    `${libScript}\n${liveFeedScript}\n${approvalsScript}\n${alertsGuardrailsScript}\n`
    + 'return { renderLiveFeed: renderLiveFeed, renderApprovals: renderApprovals, renderAlertsGuardrails: renderAlertsGuardrails, opsFeedRowHtml: opsFeedRowHtml };',
  );
  return factory(document, {}, {}, {}, () => { throw new Error('no network in tests'); });
}

// ── state/feed.js: new event vocabulary ─────────────────────────────────────

test('feed renders a line for every July signal event type, with honest wording', () => {
  const feed = buildActivityFeed([FIXTURE_RUN]);
  const byType = Object.fromEntries(feed.map((entry) => [entry.type, entry]));

  assert.match(byType.stage_checkpoint_before_saved.summary, /Checkpoint saved before 06-architecture \(verified restorable\)/);
  assert.match(byType.stage_checkpoint_after_saved.summary, /Checkpoint saved after 06-architecture \(NOT verified — restore may fail\)/);
  assert.match(byType.context_pressure_warning.summary, /Context pressure — memory_summary at 61,000 chars \(threshold 40,000\)/);
  // Detect-only honesty (#136): the warning must not claim pruning happened.
  assert.match(byType.context_pressure_warning.summary, /warning only, nothing was pruned/);
  assert.match(byType.approval_audit_failed.summary, /Approval record rejected by audit — guardrail-override:005-testing treated as absent; the gate stayed closed/);
  assert.match(byType.episode_memory_written.summary, /Episode memory written for 003-architecture \(trusted\)/);
  assert.match(byType.episode_memory_skipped_untrusted.summary, /Episode memory skipped for 005-testing — validator status FAIL under validator-approved-only \(policy: validator-approved-only\)/);
  assert.match(byType.metrics_write_failed.summary, /Metrics write failed \(telemetry_increment\) — persisted totals are behind the events/);
  assert.match(byType.retry_decision.summary, /Retry decision for 005-testing: exhausted → BLOCKED — attempt budget exhausted/);
  assert.match(byType.goal_evaluated.summary, /🎯 Goal ship-the-mvp evaluated: FAIL \(score 0\.5\) — test coverage below target/);
  assert.match(byType.task_retry_scheduled.summary, /Retry 1\/2 scheduled — 005-testing/);

  // Unknown types keep degrading exactly as before: dropped, never invented.
  assert.equal(byType.mystery_signal_from_the_future, undefined);
});

test('feed levels for the new vocabulary distinguish blocked, failed and warning states', () => {
  const feed = buildActivityFeed([FIXTURE_RUN]);
  const levels = Object.fromEntries(feed.map((entry) => [entry.type, entry.level]));
  assert.equal(levels.stage_checkpoint_before_saved, 'info');
  assert.equal(levels.stage_checkpoint_after_saved, 'warn'); // verified: false
  assert.equal(levels.context_pressure_warning, 'warn');
  assert.equal(levels.approval_audit_failed, 'fail');
  assert.equal(levels.episode_memory_written, 'info');
  assert.equal(levels.episode_memory_skipped_untrusted, 'warn');
  assert.equal(levels.metrics_write_failed, 'warn');
  assert.equal(levels.retry_decision, 'blocked'); // next_status: BLOCKED
  assert.equal(levels.goal_evaluated, 'warn'); // status: FAIL
});

test('goal_evaluated reads pass/fail from the real pipeline-loop status field', () => {
  // pipeline-loop.js emits { iteration, max_iterations, goal_id, status,
  // score, critical_count, failing_stages, recommended_rerun_stages, reason }.
  // status is the source of truth — PASS reads green, anything else warns.
  const feed = buildActivityFeed([{
    runId: 'run-goal', projectRoot: '/tmp/p', manifest: { goal: 'g' },
    events: [
      { type: 'goal_evaluated', iteration: 3, max_iterations: 3, goal_id: 'met-goal', status: 'PASS', score: 0.95, critical_count: 0, failing_stages: [], reason: 'all criteria met', ts: '2026-07-06T13:00:00.000Z' },
      { type: 'goal_evaluated', iteration: 1, max_iterations: 3, goal_id: 'early-goal', status: 'FAIL', score: 0.4, critical_count: 2, failing_stages: ['07-code'], reason: 'criteria unmet', ts: '2026-07-06T13:01:00.000Z' },
    ],
  }]);
  const met = feed.find((entry) => entry.summary.includes('met-goal'));
  assert.match(met.summary, /🎯 Goal met-goal evaluated: PASS \(score 0\.95\)/);
  assert.equal(met.level, 'pass');
  const early = feed.find((entry) => entry.summary.includes('early-goal'));
  assert.match(early.summary, /🎯 Goal early-goal evaluated: FAIL \(score 0\.4\)/);
  assert.equal(early.level, 'warn');
});

test('feed items carry structured data for the ops panels — only fields the event had', () => {
  const feed = buildActivityFeed([FIXTURE_RUN]);
  const byType = Object.fromEntries(feed.map((entry) => [entry.type, entry]));

  assert.deepEqual(byType.guardrail_triggered.data, {
    task_id: '005-testing', limit_name: 'maxTaskAttempts', current_value: 2, limit_value: 2,
  });
  assert.deepEqual(byType.approval_audit_failed.data.issues, ['approval_actor_present: approver missing or empty']);
  assert.equal(byType.approval_audit_failed.data.artifact, 'guardrail-override:005-testing');
  assert.equal(byType.context_pressure_warning.data.size, 61000);
  assert.equal(byType.context_pressure_warning.data.threshold, 40000);
  assert.equal(byType.context_pressure_warning.data.blocking, false);
  assert.equal(byType.task_retry_scheduled.data.attempt, 1);
  assert.equal(byType.task_retry_scheduled.data.max_attempts, 2);
  assert.equal(byType.stage_checkpoint_after_saved.data.verified, false);
  // Absent fields stay absent — nothing fabricated.
  assert.ok(!('stage_id' in byType.context_pressure_warning.data));
});

// ── Live Feed page: distinct glyphs, graceful fallback ──────────────────────

test('live feed renders type-specific glyphs for every new event type', () => {
  const { document, els } = createDom(PAGE_IDS);
  const { renderLiveFeed } = loadRenderers(document);
  renderLiveFeed(fixtureState());
  const html = els.get('live-feed-list').innerHTML;
  for (const glyph of ['CP', 'CX', 'AU', 'MB', 'MX', 'RT', 'GR', 'GL']) {
    assert.ok(html.includes(`>${glyph}<`), `live feed shows the ${glyph} glyph`);
  }
  // Structured meta chips render from real data.
  assert.match(html, /maxTaskAttempts: 2 of 2/);
  assert.match(html, /61000 vs 40000 chars/);
  assert.match(html, /1 audit issue\(s\)/);
  assert.match(html, /attempt 1\/2/);
});

test('live feed keeps rendering unknown feed item types through the shared row', () => {
  const { document, els } = createDom(PAGE_IDS);
  const { renderLiveFeed } = loadRenderers(document);
  const state = fixtureState();
  state.feed = [{ ts: '2026-07-06T14:00:00.000Z', summary: 'something new happened', type: 'brand_new_event', runId: 'run-july-signals', level: 'info' }];
  assert.doesNotThrow(() => renderLiveFeed(state));
  assert.match(els.get('live-feed-list').innerHTML, /something new happened/);
});

// ── Alerts & Guardrails page: retry state, guardrail depth, pressure ────────

test('retry state panel shows the blocked task with attempts, decision and reason', () => {
  const { document, els } = createDom(PAGE_IDS);
  const { renderAlertsGuardrails } = loadRenderers(document);
  renderAlertsGuardrails(fixtureState());

  const html = els.get('ops-retry-list').innerHTML;
  assert.match(html, /005-testing/);
  assert.match(html, /08-testing/);
  assert.match(html, /budget exhausted/); // action: exhausted wins as the latest state
  assert.match(html, /attempt 2\/2/); // the exhausted decision carries the final attempt count
  assert.match(html, /decision: exhausted → BLOCKED/);
  assert.match(html, /attempt budget exhausted/);
  assert.match(html, /task status: BLOCKED/);
  assert.equal(els.get('ops-retry-count').textContent, '1 task(s) in retry flow');
  // Healthy tasks stay out of the retry panel.
  assert.ok(!html.includes('003-architecture'));
});

test('retry panel distinguishes a validator block from budget exhaustion — no fabricated cause', () => {
  // Two BLOCKED tasks the harness reports with different retry_decision actions:
  //   005 exhausted its attempt budget (action: exhausted → "budget exhausted")
  //   006 was blocked by the validator (action: block → "validator blocked")
  // Both carry next_status BLOCKED; keying on next_status alone would mislabel
  // the validator block as budget exhaustion. The panel must not.
  const events = [
    { type: 'retry_decision', task_id: '005-testing', stage_id: '08-testing', attempt: 2, max_attempts: 2, retry_recommendation: 'retry_builder', action: 'exhausted', next_status: 'BLOCKED', reason: 'attempt budget exhausted', ts: '2026-07-06T12:35:00.000Z' },
    { type: 'retry_decision', task_id: '006-deploy', stage_id: '09-deployment', attempt: 1, max_attempts: 2, retry_recommendation: 'block', action: 'block', next_status: 'BLOCKED', reason: 'validator blocked — a human decision is required', ts: '2026-07-06T12:36:00.000Z' },
  ];
  const state = fixtureState();
  state.runs[0].tasks.push({ id: '006-deploy', status: 'BLOCKED', stageId: '09-deployment' });
  state.feed = buildActivityFeed([{ ...FIXTURE_RUN, events }]);

  const { document, els } = createDom(PAGE_IDS);
  loadRenderers(document).renderAlertsGuardrails(state);
  const html = els.get('ops-retry-list').innerHTML;

  const i5 = html.indexOf('005-testing');
  const i6 = html.indexOf('006-deploy');
  assert.ok(i5 !== -1 && i6 !== -1 && i5 < i6, 'both blocked tasks render, in task order');
  const exhaustedCard = html.slice(i5, i6);
  const validatorCard = html.slice(i6);
  assert.match(exhaustedCard, /budget exhausted/);
  assert.match(validatorCard, /validator blocked/);
  // The validator block is never dressed up as a budget-exhaustion cause.
  assert.ok(!validatorCard.includes('budget exhausted'), 'a validator block must not be labelled budget exhausted');
});

test('guardrail panel shows limit vs value and says plainly no override is on file', () => {
  const { document, els } = createDom(PAGE_IDS);
  const { renderAlertsGuardrails } = loadRenderers(document);
  renderAlertsGuardrails(fixtureState());

  const html = els.get('ops-guardrail-list').innerHTML;
  assert.match(html, /maxTaskAttempts/);
  assert.match(html, /value 2 hit limit 2/);
  assert.match(html, /task 005-testing/);
  assert.match(html, /No override on file — the task stays blocked until a guardrail-override:005-testing approval is granted\./);
});

test('guardrail panel reports an approved override and a consumed override honestly', () => {
  const { document: docApproved, els: elsApproved } = createDom(PAGE_IDS);
  const approvedState = fixtureState();
  approvedState.runs[0].approvals.push({ artifact: 'guardrail-override:005-testing', status: 'APPROVED', approver: 'Richardson', timestamp: '2026-07-06T12:50:00.000Z' });
  loadRenderers(docApproved).renderAlertsGuardrails(approvedState);
  assert.match(elsApproved.get('ops-guardrail-list').innerHTML, /Override approved by Richardson — the next claim gets exactly one attempt\./);

  const { document: docConsumed, els: elsConsumed } = createDom(PAGE_IDS);
  const consumedState = fixtureState();
  consumedState.feed = buildActivityFeed([{
    ...FIXTURE_RUN,
    events: [...JULY_EVENTS, { type: 'guardrail_overridden', task_id: '005-testing', artifact: 'guardrail-override:005-testing', ts: '2026-07-06T12:55:00.000Z' }],
  }]);
  loadRenderers(docConsumed).renderAlertsGuardrails(consumedState);
  assert.match(elsConsumed.get('ops-guardrail-list').innerHTML, /Override consumed — exactly one extra attempt was granted, then the gate re-armed\./);
});

test('context pressure panel lists source, size vs threshold, and the detect-only note', () => {
  const { document, els } = createDom(PAGE_IDS);
  const { renderAlertsGuardrails } = loadRenderers(document);
  renderAlertsGuardrails(fixtureState());

  const html = els.get('ops-pressure-list').innerHTML;
  assert.match(html, /memory_summary/);
  assert.match(html, /61000 vs threshold 40000 chars/);
  assert.match(html, /task 004-implementation/);
  assert.match(html, /Detect-only warning — nothing was pruned or truncated\./);
  assert.equal(els.get('ops-pressure-count').textContent, '1 warning(s)');
});

// ── Approvals page: audit rejections (tampering visibility) ─────────────────

test('audit rejections panel renders the rejected record with artifact, reason and issues', () => {
  const { document, els } = createDom(PAGE_IDS);
  const { renderApprovals } = loadRenderers(document);
  renderApprovals(fixtureState());

  // The static explainer ships with the injected panel markup on the page body.
  const panel = els.get('page-approvals').innerHTML;
  assert.match(panel, /failed the consistency audit and was treated as absent — the gate stayed closed/);

  const html = els.get('ops-audit-list').innerHTML;
  assert.match(html, /guardrail-override:005-testing/);
  assert.match(html, /approval_actor_present: approver missing or empty/);
  assert.match(html, /treated as absent, gated work stays gated/);
  assert.match(html, /record forged-1/);
  assert.match(html, /claimed status: APPROVED/);
  assert.match(html, /rejected/);
  assert.equal(els.get('ops-audit-count').textContent, '1 rejection(s)');
});

// ── Empty states: no data is stated, never faked ────────────────────────────

test('every ops panel holds an honest empty state when there is nothing to show', () => {
  const { document, els } = createDom(PAGE_IDS);
  const { renderLiveFeed, renderApprovals, renderAlertsGuardrails } = loadRenderers(document);
  const empty = { runs: [], feed: [], alerts: [], blockedGates: [], approvals: [] };

  renderLiveFeed(empty);
  renderApprovals(empty);
  renderAlertsGuardrails(empty);

  assert.match(els.get('live-feed-list').innerHTML, /No events yet/);
  assert.match(els.get('ops-retry-list').innerHTML, /No retry activity/);
  assert.match(els.get('ops-guardrail-list').innerHTML, /No guardrail triggers/);
  assert.match(els.get('ops-pressure-list').innerHTML, /No context pressure warnings/);
  assert.match(els.get('ops-audit-list').innerHTML, /No audit rejections/);
  assert.equal(els.get('ops-retry-count').textContent, '0 task(s) in retry flow');
});

test('panels self-mount exactly once across re-renders', () => {
  const { document, els } = createDom(PAGE_IDS);
  const { renderAlertsGuardrails, renderApprovals } = loadRenderers(document);
  const state = fixtureState();
  renderAlertsGuardrails(state);
  renderAlertsGuardrails(state);
  renderApprovals(state);
  renderApprovals(state);
  const alertsPage = els.get('page-alerts-guardrails').innerHTML;
  const approvalsPage = els.get('page-approvals').innerHTML;
  assert.equal(alertsPage.split('id="ops-retry-panel"').length, 2, 'retry panel injected once');
  assert.equal(approvalsPage.split('id="ops-audit-panel"').length, 2, 'audit panel injected once');
});
