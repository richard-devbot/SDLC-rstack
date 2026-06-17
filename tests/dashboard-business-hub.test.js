import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFullState, resolveDashboardApproval } from '../src/observability/dashboard/state/index.js';
import { dashboardHtml } from '../src/observability/dashboard/ui.js';
import { plainLanguageSummary } from '../src/observability/alerts/engine.js';

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

test('Business Hub turns blocked gates into actionable pending approvals', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-business-state-'));
  try {
    const runId = '2026-05-31T10-00-00-demo';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(join(runDir, 'tasks', '02-requirements'), { recursive: true });

    await writeJson(join(runDir, 'manifest.json'), {
      run_id: runId,
      goal: 'Build business dashboard',
      created_at: '2026-05-31T10:00:00.000Z',
      framework: 'pi',
    });
    await writeJson(join(runDir, 'metrics.json'), { cumulative_cost_usd: 0.25 });
    await writeJson(join(runDir, 'tasks.json'), {
      profile: 'business-flex',
      workflow: 'production-business-sdlc',
      budget_policy: { currency: 'USD', run_budget_usd: 10 },
      tasks: [{
        id: '02-requirements',
        title: 'Requirements',
        status: 'PASS',
        profile: 'business-flex',
        routing: { selected_by: 'profile-domain-stage-affinity', explanation: ['profile:business-flex'] },
        budget_envelope: { currency: 'USD', estimated_ai_cost_usd: 1 },
      }],
    });
    await writeJson(join(runDir, 'tasks', '02-requirements', 'builder.json'), {
      agent: 'agent.requirements',
      status: 'PASS',
      summary: 'Captured dashboard requirements',
      memory_summary: { decisions: ['Use real .rstack data only'] },
      risks: [],
      tests_run: ['npm test'],
      files_modified: ['src/dashboard/server.js'],
    });
    await writeJson(join(runDir, 'tasks', '02-requirements', 'validation.json'), {
      status: 'PASS',
      checks: [{ name: 'requirements-evidence', status: 'PASS' }],
    });

    await writeFile(join(runDir, 'events.jsonl'), [
      {
        ts: '2026-05-31T10:01:00.000Z',
        type: 'approval_gate_blocked',
        task_id: '09-deployment',
        missing: ['deploy-approval.md'],
      },
      {
        ts: '2026-05-31T10:02:00.000Z',
        type: 'approval_gate',
        artifact: 'plan.md',
        status: 'APPROVED',
      },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n');

    await writeFile(join(projectRoot, '.rstack', 'approvals.jsonl'), [
      {
        id: 'queue-1',
        title: 'Approve production deploy',
        detail: 'Deploy business hub',
        status: 'pending',
        runId,
        ts: '2026-05-31T10:03:00.000Z',
      },
      {
        id: 'queue-2',
        title: 'Approve plan',
        detail: 'Plan already approved',
        status: 'approved',
        runId,
        ts: '2026-05-31T10:04:00.000Z',
      },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n');

    const state = await buildFullState(projectRoot, { includeRegistry: false });

    assert.ok(state.pendingApprovals.some((a) => a.id === 'queue-1'));
    assert.ok(state.pendingApprovals.some((a) => a.artifact === 'deploy-approval.md'));
    assert.equal(state.approvalStats.pending, 2);
    assert.equal(state.approvalStats.total, 3);
    assert.ok(
      state.feed.some((event) => event.type === 'approval_gate_blocked'),
      'blocked gate history should remain visible in the live feed',
    );
    assert.ok(
      state.blockedGates.some((event) => event.taskId === '09-deployment'),
      'blocked gates should move to guardrail/history data',
    );
    assert.equal(state.businessFlex.profiles[0].profile, 'business-flex');
    assert.equal(state.businessFlex.budget.runBudgetTotal, 10);
    assert.ok(state.businessFlex.routingSignals.some((signal) => signal.taskId === '02-requirements'));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('Business Hub approval resolution writes the run-level approval artifact', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-business-approve-'));
  try {
    const runId = '2026-05-31T11-00-00-demo';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(runDir, { recursive: true });

    await writeJson(join(runDir, 'manifest.json'), {
      run_id: runId,
      goal: 'Approval source of truth',
      created_at: '2026-05-31T11:00:00.000Z',
      framework: 'pi',
    });
    await writeJson(join(runDir, 'tasks.json'), { tasks: [] });
    await writeFile(join(runDir, 'events.jsonl'), JSON.stringify({
      ts: '2026-05-31T11:01:00.000Z',
      type: 'approval_gate_blocked',
      task_id: '004-implementation',
      missing: ['architecture.md'],
    }) + '\n');

    const state = await buildFullState(projectRoot, { includeRegistry: false });
    const approval = state.pendingApprovals.find((item) => item.artifact === 'architecture.md');
    assert.ok(approval, 'blocked gate becomes a pending dashboard approval');

    const ok = await resolveDashboardApproval(projectRoot, approval.id, 'approved', 'Manager Maya', { includeRegistry: false });
    assert.equal(ok, true);

    const runApprovals = JSON.parse(await readFile(join(runDir, 'approvals.json'), 'utf8'));
    assert.equal(runApprovals.at(-1).artifact, 'architecture.md');
    assert.equal(runApprovals.at(-1).status, 'APPROVED');
    assert.equal(runApprovals.at(-1).approver, 'Manager Maya');

    const after = await buildFullState(projectRoot, { includeRegistry: false });
    assert.ok(!after.pendingApprovals.some((item) => item.id === approval.id), 'resolved approval leaves the pending queue');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('Business Hub freshness chip reflects socket + snapshot age, never silently stale', () => {
  const html = dashboardHtml(3008);

  assert.match(html, /var WS_CONNECTED = false;/);
  assert.match(html, /WS_CONNECTED = true;/);
  // Freshness (issue #87) derives the label from socket state + snapshot age,
  // so an HTTP load can no longer overwrite a live socket's label.
  assert.match(html, /function classifyFreshness/);
  assert.match(html, /function updateFreshness/);
  assert.match(html, /FRESHNESS_TIMER = setInterval\(updateFreshness/);
  // A REST poll keeps data flowing (and the chip honest) while the socket is down.
  assert.match(html, /function startPolling/);
  assert.match(html, /id="conn-live"[^>]*aria-live/);
  // The old hard-coded "Loaded (connecting…)" override is gone.
  assert.doesNotMatch(html, /Loaded \(connecting/);
});

test('Business Hub freshness variables are declared in the client script', () => {
  const html = dashboardHtml(3008);
  // All module-level tracking variables introduced by issue #87 must be present.
  assert.match(html, /var LAST_SERVER_TS = null/);
  assert.match(html, /var LAST_SNAPSHOT_AT = 0/);
  assert.match(html, /var LAST_ETAG = null/);
  assert.match(html, /var POLL_TIMER = null/);
  assert.match(html, /var FRESHNESS_TIMER = null/);
  assert.match(html, /var LAST_CONN_KIND = null/);
});

test('Business Hub shortClock helper is emitted in the client script', () => {
  const html = dashboardHtml(3008);
  assert.match(html, /function shortClock\(value\)/);
  // Null guard: returns null for falsy input.
  assert.match(html, /if \(!value\) return null/);
  // Padding helper ensures HH:MM:SS format.
  assert.match(html, /function pad\(n\)/);
});

test('Business Hub fetchState sends conditional ETag request and handles 304', () => {
  const html = dashboardHtml(3008);
  // ETag is stored from the response and sent on subsequent requests.
  assert.match(html, /If-None-Match/);
  assert.match(html, /LAST_ETAG/);
  // A 304 confirms the snapshot is still current: refresh the clock, don't re-render.
  assert.match(html, /response\.status === 304/);
  assert.match(html, /LAST_SNAPSHOT_AT = Date\.now\(\)/);
});

test('Business Hub startPolling is idempotent (guard prevents duplicate intervals)', () => {
  const html = dashboardHtml(3008);
  // The guard `if (POLL_TIMER) return;` prevents stacking multiple intervals.
  assert.match(html, /if \(POLL_TIMER\) return/);
  assert.match(html, /POLL_TIMER = setInterval/);
});

test('Business Hub stopPolling clears and nulls the poll timer', () => {
  const html = dashboardHtml(3008);
  assert.match(html, /if \(!POLL_TIMER\) return/);
  assert.match(html, /clearInterval\(POLL_TIMER\)/);
  assert.match(html, /POLL_TIMER = null/);
});

test('Business Hub topbar status chip has accessibility title attribute', () => {
  const html = dashboardHtml(3008);
  assert.match(html, /class="tb-status"[^>]*title="Data freshness/);
});

test('Business Hub conn-live region has correct ARIA attributes and sr-only class', () => {
  const html = dashboardHtml(3008);
  // Must have role="status" and aria-live="polite" for screen-reader announcements.
  assert.match(html, /id="conn-live"[^>]*role="status"/);
  assert.match(html, /id="conn-live"[^>]*aria-live="polite"/);
  assert.match(html, /id="conn-live"[^>]*class="sr-only"/);
});

test('Business Hub styles include the sr-only utility class for visually-hidden ARIA live region', () => {
  const html = dashboardHtml(3008);
  assert.match(html, /\.sr-only\s*\{[^}]*position:\s*absolute/);
  assert.match(html, /clip:\s*rect\(0,0,0,0\)/);
});

test('Business Hub emits freshnessScript before clientScript so classifyFreshness is available on load', () => {
  const html = dashboardHtml(3008);
  const freshnessPos = html.indexOf('function classifyFreshness');
  const clientPos = html.indexOf('function updateFreshness');
  assert.ok(freshnessPos !== -1, 'classifyFreshness should be in the HTML');
  assert.ok(clientPos !== -1, 'updateFreshness should be in the HTML');
  assert.ok(freshnessPos < clientPos, 'freshnessScript must appear before clientScript');
});

test('Business Hub WS close/error handler starts polling instead of calling setConnectionStatus', () => {
  const html = dashboardHtml(3008);
  // The old approach called setConnectionStatus directly on close; the new approach
  // calls updateFreshness + startPolling.
  assert.match(html, /ws\.onclose = ws\.onerror = function/);
  assert.match(html, /startPolling\(\)/);
  // Hard-coded status strings that bypass the freshness system must be absent.
  assert.doesNotMatch(html, /setConnectionStatus\('connecting', 'Reconnecting/);
  assert.doesNotMatch(html, /setConnectionStatus\('error', 'Socket unavailable'\)/);
});

test('Business Hub renders malformed cost events without NaN in live activity', () => {
  assert.equal(plainLanguageSummary({ type: 'cost_recorded', usd: 'NaN' }), 'Cost recorded: $0.0000');
  assert.equal(plainLanguageSummary({ type: 'cost_recorded', cost: Number.NaN }), 'Cost recorded: $0.0000');
  assert.equal(plainLanguageSummary({ type: 'cost_recorded', usd: 0.25 }), 'Cost recorded: $0.2500');
});

test('Business Hub exposes the planned production observability screens', () => {
  const html = dashboardHtml(3008);
  const expectedPages = [
    'command',
    'business-flex',
    'workflow',
    'projects',
    'run-report',
    'run-analytics',
    'agent-work',
    'live-feed',
    'team',
    'approvals',
    'decisions',
    'release-readiness',
    'security',
    'compliance',
    'cost-budget',
    'alerts-guardrails',
    'traceability',
    'team-layers',
    'diagnostics',
  ];

  for (const page of expectedPages) {
    assert.match(html, new RegExp(`data-page="${page}"`));
    assert.match(html, new RegExp(`id="page-${page}"`));
  }
});

test('Business Hub navigation is organized around mission-critical SDLC functions', () => {
  const html = dashboardHtml(3008);
  for (const section of ['DELIVER', 'QUALITY', 'GOVERN', 'OPERATE']) {
    assert.match(html, new RegExp(`>${section}<`));
  }
  for (const label of ['Release Readiness', 'Security', 'Compliance', 'Cost & Budget', 'Decisions / Readiness']) {
    assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Command Center exposes an executive mission brief and decision-grade rollup', () => {
  const html = dashboardHtml(3008);
  const expectedSections = [
    'executive-mission-brief',
    'executive-readiness-verdict',
    'executive-next-action',
    'executive-risk-strip',
    'executive-governance-score',
  ];

  for (const section of expectedSections) {
    assert.match(html, new RegExp(`id="${section}"`));
  }

  assert.match(html, /function renderExecutiveMissionBrief\(s\)/);
});

test('Governance pages expose release readiness, security, compliance and cost shells', () => {
  const html = dashboardHtml(3008);
  const expectedSections = [
    'release-readiness-verdict',
    'release-readiness-checklist',
    'security-threat-heatmap',
    'security-threat-registry',
    'compliance-scorecards',
    'compliance-controls',
    'cost-budget-summary',
    'cost-budget-drivers',
  ];

  for (const section of expectedSections) {
    assert.match(html, new RegExp(`id="${section}"`));
  }
});

test('Business Flex page exposes profile, budget, and routing sections', () => {
  const html = dashboardHtml(3008);
  const expectedSections = [
    'business-flex-title',
    'business-flex-profiles',
    'business-flex-domains',
    'business-flex-budget',
    'business-flex-routing',
    'business-flex-profiles-list',
    'business-flex-budget-list',
    'business-flex-routing-list',
  ];

  for (const section of expectedSections) {
    assert.match(html, new RegExp(`id="${section}"`));
  }
  assert.match(html, /function renderBusinessFlex\(s\)/);
  assert.match(html, /function businessRoutingHtml\(item\)/);
});

test('Command Center exposes manager sections for real .rstack data', () => {
  const html = dashboardHtml(3008);
  const expectedSections = [
    'command-summary-title',
    'command-attention',
    'command-stage-strip',
    'command-projects',
    'command-agent-proof',
    'command-layers',
    'command-feed',
  ];

  for (const section of expectedSections) {
    assert.match(html, new RegExp(`id="${section}"`));
  }

  assert.match(html, /function stageMiniHtml\(stage\)/);
  assert.match(html, /pass<\/span>/);
  assert.match(html, /ready<\/span>/);
  assert.match(html, /stage\.artifact/);
  assert.match(html, /missing validations/);
});

test('Workflow Map exposes live agent-stage tracking controls', () => {
  const html = dashboardHtml(3008);
  const expectedSections = [
    'workflow-rail',
    'workflow-grid',
    'workflow-inspector',
    'workflow-runs',
    'workflow-active-stages',
    'workflow-validations',
  ];

  for (const section of expectedSections) {
    assert.match(html, new RegExp(`id="${section}"`));
  }

  assert.match(html, /WORKFLOW_STAGE_META/);
  assert.match(html, /function workflowStageCardHtml\(stage, index\)/);
  assert.match(html, /function openWorkflowStageButton\(btn\)/);
  assert.match(html, /stage\.artifact/);
});

test('dashboard CLI surface uses one Business Hub instead of a separate 3007 observer', async () => {
  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
  const observerBin = await readFile(join(process.cwd(), 'bin', 'rstack-observer.js'), 'utf8');

  assert.equal(packageJson.bin['rstack-business'], 'bin/rstack-business.js');
  assert.equal(packageJson.bin['rstack-observer'], 'bin/rstack-observer.js');
  assert.equal(packageJson.scripts.observer, 'node bin/rstack-observer.js');
  assert.equal(packageJson.scripts['observer:dev'], 'node --watch bin/rstack-business.js');
  assert.equal(packageJson.scripts['build:observer'], undefined);
  assert.doesNotMatch(JSON.stringify(packageJson.scripts), /3007/);
  assert.match(observerBin, /rstack-business\.js/);
  assert.doesNotMatch(observerBin, /3007|developer\.js/);
});
