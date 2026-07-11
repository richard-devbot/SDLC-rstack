/**
 * Tests for:
 *   - src/observability/dashboard/state/business-flex.js (buildBusinessFlexState)
 *   - src/observability/dashboard/state/client-state.js (toClientState additions)
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBusinessFlexState } from '../src/observability/dashboard/state/business-flex.js';
import { toClientState } from '../src/observability/dashboard/state/client-state.js';
import { readConfiguredPolicies } from '../src/observability/dashboard/state/configured-policy.js';
import { resolveProjectDescriptor } from '../src/observability/dashboard/state/identity.js';
import { buildFullState } from '../src/observability/dashboard/state/index.js';
import { libScript } from '../src/observability/dashboard/ui/lib.js';
import { businessFlexScript } from '../src/observability/dashboard/ui/pages/business-flex.js';
import { styles } from '../src/observability/dashboard/ui/styles.js';

async function policyRoot({ config, budget } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rstack-flex-policy-'));
  await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(join(root, '.rstack'), { recursive: true });
  if (config !== undefined) {
    await writeFile(join(root, '.rstack', 'rstack.config.json'),
      typeof config === 'string' ? config : JSON.stringify(config));
  }
  if (budget !== undefined) {
    await writeFile(join(root, '.rstack', 'budget.json'),
      typeof budget === 'string' ? budget : JSON.stringify(budget));
  }
  return root;
}

function businessFlexUi() {
  return new Function(
    `${libScript}\n${businessFlexScript}\nreturn { businessPolicyLedgerHtml, businessRunSnapshotsHtml };`,
  )();
}

function configuredFlexModel(overrides = {}) {
  return {
    configuredPolicy: {
      projects: [{
        projectId: 'project-flex',
        projectRoot: '/workspace/flex',
        projectName: 'customer-portal',
        worktreeName: null,
        availability: 'configured',
        profile: {
          availability: 'configured', id: 'business-flex', name: 'Business Flex Delivery',
          workflow: 'production-business-sdlc', enabledDomains: ['product', 'backend'],
          enabledAgents: [], enabledPlugins: [], dashboardPages: [],
          sourcePath: '.rstack/rstack.config.json', issues: [],
        },
        budget: {
          availability: 'configured', currency: 'USD', runBudgetUsd: 10,
          dailyBudgetUsd: 50, monthlyBudgetUsd: 500,
          sourcePath: '.rstack/budget.json', issues: [],
        },
        loadedAt: '2026-07-11T08:00:00.000Z',
      }],
    },
    observedConsumption: {
      availability: 'unavailable', runCount: 0, runsWithTelemetry: 0,
      totalCostUsd: null, metricsSources: { persisted: 0, events: 0 }, lastMeasuredAt: null,
    },
    runSnapshots: [],
    profiles: [],
    budget: {},
    routingSignals: [],
    ...overrides,
  };
}

test('Business Flex policy ledger shows configured profile and 10/50/500 before telemetry', () => {
  const html = businessFlexUi().businessPolicyLedgerHtml(configuredFlexModel());
  assert.match(html, /Configured operating policy/);
  assert.match(html, /Business Flex Delivery/);
  assert.match(html, /production-business-sdlc/);
  assert.match(html, /\$10\.00 \/ run/);
  assert.match(html, /\$50\.00 \/ day/);
  assert.match(html, /\$500\.00 \/ month/);
  assert.match(html, /No telemetry yet/);
  assert.match(html, /customer-portal/);
  assert.match(html, /\.rstack\/budget\.json/);
  assert.doesNotMatch(html, /Waiting for run|No RStack profile data/);
});

test('Business Flex policy ledger names invalid, unavailable, and missing states with recovery', () => {
  const api = businessFlexUi();
  const model = configuredFlexModel();
  const project = model.configuredPolicy.projects[0];
  project.availability = 'invalid';
  project.budget = {
    availability: 'invalid', runBudgetUsd: null, dailyBudgetUsd: null, monthlyBudgetUsd: null,
    sourcePath: '.rstack/budget.json', issues: [{ field: 'run_budget_usd', problem: 'must be non-negative' }],
  };
  const invalid = api.businessPolicyLedgerHtml(model);
  assert.match(invalid, /Invalid configuration/);
  assert.match(invalid, /run_budget_usd/);
  assert.match(invalid, /Open Diagnostics/);
  assert.match(invalid, /showPage\('diagnostics'\)/);
  assert.doesNotMatch(invalid, /\$0\.00 \/ run/);

  project.availability = 'inaccessible';
  project.profile.availability = 'inaccessible';
  project.budget.availability = 'inaccessible';
  assert.match(api.businessPolicyLedgerHtml(model), /Configuration unavailable/);

  project.availability = 'missing';
  project.profile.availability = 'missing';
  project.budget.availability = 'missing';
  assert.match(api.businessPolicyLedgerHtml(model), /Policy file missing/);
});

test('Business Flex historical snapshot makes policy drift explicit', () => {
  const model = configuredFlexModel({
    runSnapshots: [{
      runId: 'run-before-change', comparison: 'differs',
      profile: { id: 'business-flex', workflow: 'production-business-sdlc' },
      budget: { currency: 'USD', runBudgetUsd: 5, dailyBudgetUsd: 20, monthlyBudgetUsd: 100 },
      differences: [{ field: 'runBudgetUsd', snapshot: 5, current: 10 }],
    }],
  });
  const html = businessFlexUi().businessRunSnapshotsHtml(model);
  assert.match(html, /Policy changed since this run/);
  assert.match(html, /run-before-change/);
  assert.match(html, /Run cap/);
  assert.match(html, /\$5\.00/);
});

test('Business Flex policy ledger is responsive and keeps recovery controls touchable', () => {
  assert.match(styles, /\.policy-ledger\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(styles, /\.policy-action[^}]*min-height:\s*44px/s);
  assert.match(styles, /@media \(max-width:\s*700px\)[\s\S]*\.policy-ledger\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test('valid zero-run project exposes configured profile and enforced 10/50/500 caps', async () => {
  const root = await policyRoot({
    config: { profile: 'business-flex' },
    budget: { currency: 'USD', run_budget_usd: 10, daily_budget_usd: 50, monthly_budget_usd: 500 },
  });
  try {
    const descriptor = resolveProjectDescriptor(root);
    const result = await readConfiguredPolicies([root], [descriptor], { now: 1_752_214_400_000 });
    const project = result.projects[0];
    assert.equal(project.availability, 'configured');
    assert.equal(project.profile.id, 'business-flex');
    assert.equal(project.profile.name, 'Business Flex Delivery');
    assert.equal(project.profile.workflow, 'production-business-sdlc');
    assert.deepEqual(project.budget, {
      availability: 'configured',
      currency: 'USD',
      runBudgetUsd: 10,
      dailyBudgetUsd: 50,
      monthlyBudgetUsd: 500,
      sourcePath: '.rstack/budget.json',
      issues: [],
    });
    assert.equal(project.projectId, descriptor.id);
    assert.equal(project.loadedAt, new Date(1_752_214_400_000).toISOString());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('configured policy distinguishes missing and invalid files', async () => {
  const missingRoot = await policyRoot();
  const malformedRoot = await policyRoot({ config: '{ broken', budget: { run_budget_usd: -1 } });
  try {
    const missing = (await readConfiguredPolicies(
      [missingRoot], [resolveProjectDescriptor(missingRoot)],
    )).projects[0];
    assert.equal(missing.availability, 'missing');
    assert.equal(missing.profile.availability, 'missing');
    assert.equal(missing.budget.availability, 'missing');

    const invalid = (await readConfiguredPolicies(
      [malformedRoot], [resolveProjectDescriptor(malformedRoot)],
    )).projects[0];
    assert.equal(invalid.availability, 'invalid');
    assert.equal(invalid.profile.availability, 'invalid');
    assert.equal(invalid.budget.availability, 'invalid');
    assert.equal(invalid.budget.issues[0].field, 'run_budget_usd');
    assert.match(invalid.profile.issues[0].problem, /malformed JSON/);
  } finally {
    await rm(missingRoot, { recursive: true, force: true });
    await rm(malformedRoot, { recursive: true, force: true });
  }
});

test('configured policy reports inaccessible reads without presenting defaults as configured', async () => {
  const root = await policyRoot({ config: { profile: 'business-flex' }, budget: { run_budget_usd: 10 } });
  const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  try {
    const result = await readConfiguredPolicies(
      [root],
      [resolveProjectDescriptor(root)],
      { io: { readFile: async () => { throw denied; } } },
    );
    assert.equal(result.projects[0].availability, 'inaccessible');
    assert.equal(result.projects[0].profile.availability, 'inaccessible');
    assert.equal(result.projects[0].budget.availability, 'inaccessible');
    assert.equal(result.projects[0].budget.runBudgetUsd, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('configured policy preserves a zero-dollar cap as an armed policy value', async () => {
  const root = await policyRoot({
    config: { profile: 'lean-mvp' },
    budget: { run_budget_usd: 0, daily_budget_usd: 0, monthly_budget_usd: 0 },
  });
  try {
    const project = (await readConfiguredPolicies(
      [root], [resolveProjectDescriptor(root)],
    )).projects[0];
    assert.equal(project.budget.availability, 'configured');
    assert.equal(project.budget.runBudgetUsd, 0);
    assert.equal(project.budget.dailyBudgetUsd, 0);
    assert.equal(project.budget.monthlyBudgetUsd, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildFullState exposes configured Business Flex policy before the first run', async () => {
  const root = await policyRoot({
    config: { profile: 'business-flex' },
    budget: { run_budget_usd: 10, daily_budget_usd: 50, monthly_budget_usd: 500 },
  });
  try {
    const state = await buildFullState(root, { includeRegistry: false, now: 1_752_214_400_000 });
    assert.equal(state.totalRuns, 0);
    assert.equal(state.businessFlex.configuredPolicy.projects.length, 1);
    assert.equal(state.businessFlex.configuredPolicy.projects[0].profile.id, 'business-flex');
    assert.equal(state.businessFlex.configuredPolicy.projects[0].budget.runBudgetUsd, 10);
    assert.equal(state.businessFlex.observedConsumption.availability, 'unavailable');
    assert.equal(state.businessFlex.observedConsumption.totalCostUsd, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('historical run snapshot is marked when current policy differs', () => {
  const projectRoot = '/workspace/business-flex';
  const configuredPolicy = {
    projects: [{
      projectId: 'project-flex',
      projectRoot,
      profile: { availability: 'configured', id: 'business-flex', workflow: 'production-business-sdlc' },
      budget: {
        availability: 'configured', runBudgetUsd: 10,
        dailyBudgetUsd: 50, monthlyBudgetUsd: 500,
      },
    }],
  };
  const model = buildBusinessFlexState([{
    runId: 'run-before-change',
    scopeKey: 'run-key-before-change',
    projectId: 'project-flex',
    projectRoot,
    profile: { profile: 'business-flex', workflow: 'production-business-sdlc' },
    workflow: 'production-business-sdlc',
    budgetPolicy: { run_budget_usd: 5, daily_budget_usd: 20, monthly_budget_usd: 100 },
    tasks: [],
  }], configuredPolicy);
  assert.equal(model.runSnapshots[0].comparison, 'differs');
  assert.deepEqual(
    model.runSnapshots[0].differences.map((difference) => difference.field),
    ['runBudgetUsd', 'dailyBudgetUsd', 'monthlyBudgetUsd'],
  );
  assert.equal(model.observedConsumption.availability, 'unavailable');
});

test('observed consumption reports telemetry provenance without treating configured caps as spend', () => {
  const model = buildBusinessFlexState([{
    runId: 'run-measured',
    projectRoot: '/workspace/measured',
    totals: { cost_usd: 3.25, tokens: 400 },
    metrics: { cumulative_cost_usd: 3.25 },
    events: [],
    tasks: [],
  }], { projects: [] });
  assert.deepEqual(model.observedConsumption, {
    availability: 'available',
    runCount: 1,
    runsWithTelemetry: 1,
    totalCostUsd: 3.25,
    metricsSources: { persisted: 1, events: 0 },
    lastMeasuredAt: null,
  });
});

// ---------------------------------------------------------------------------
// buildBusinessFlexState — empty / null inputs
// ---------------------------------------------------------------------------

test('buildBusinessFlexState returns empty structure for empty array', () => {
  const result = buildBusinessFlexState([]);
  assert.deepEqual(result.profiles, []);
  assert.equal(result.budget.runBudgetTotal, 0);
  assert.equal(result.budget.estimatedTaskBudget, 0);
  assert.equal(result.budget.tasksWithBudget, 0);
  assert.deepEqual(result.routingSignals, []);
});

test('buildBusinessFlexState returns empty structure for null input', () => {
  const result = buildBusinessFlexState(null);
  assert.deepEqual(result.profiles, []);
  assert.equal(result.budget.runBudgetTotal, 0);
  assert.deepEqual(result.routingSignals, []);
});

test('buildBusinessFlexState returns empty structure for undefined input', () => {
  const result = buildBusinessFlexState(undefined);
  assert.deepEqual(result.profiles, []);
  assert.equal(result.budget.tasksWithBudget, 0);
});

// ---------------------------------------------------------------------------
// buildBusinessFlexState — profile aggregation
// ---------------------------------------------------------------------------

test('buildBusinessFlexState extracts profile from run.profile.profile', () => {
  const runs = [{
    runId: 'run-001',
    profile: {
      profile: 'business-flex',
      name: 'Business Flex Delivery',
      workflow: 'production-business-sdlc',
      enabled_domains: ['product', 'backend', 'qa'],
      enabled_agents: ['business-analyst', 'backend-architect'],
      enabled_plugins: ['backend-development', 'unit-testing'],
      dashboard_pages: ['command', 'business-flex'],
    },
    workflow: 'production-business-sdlc',
    budgetPolicy: { run_budget_usd: 10 },
    tasks: [],
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].profile, 'business-flex');
  assert.equal(result.profiles[0].name, 'Business Flex Delivery');
  assert.equal(result.profiles[0].workflow, 'production-business-sdlc');
  assert.equal(result.profiles[0].runs, 1);
  assert.deepEqual(result.profiles[0].enabledDomains, ['product', 'backend', 'qa']);
  assert.deepEqual(result.profiles[0].enabledAgents, ['business-analyst', 'backend-architect']);
  assert.deepEqual(result.profiles[0].enabledPlugins, ['backend-development', 'unit-testing']);
  assert.deepEqual(result.profiles[0].dashboardPages, ['command', 'business-flex']);
});

test('buildBusinessFlexState falls back to manifest.profile when run.profile is empty', () => {
  const runs = [{
    runId: 'run-002',
    profile: null,
    manifest: { profile: 'lean-mvp', workflow: 'lean-mvp-sdlc' },
    budgetPolicy: null,
    tasks: [],
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].profile, 'lean-mvp');
});

test('buildBusinessFlexState uses unprofiled for runs with no profile data', () => {
  const runs = [{
    runId: 'run-003',
    profile: {},
    manifest: {},
    tasks: [],
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.profiles[0].profile, 'unprofiled');
});

test('buildBusinessFlexState increments runs count for same profile across multiple runs', () => {
  const makeRun = (id) => ({
    runId: id,
    profile: {
      profile: 'business-flex',
      enabled_domains: ['product'],
      enabled_agents: [],
      enabled_plugins: [],
      dashboard_pages: [],
    },
    budgetPolicy: { run_budget_usd: 10 },
    tasks: [],
  });
  const result = buildBusinessFlexState([makeRun('run-1'), makeRun('run-2'), makeRun('run-3')]);
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].runs, 3);
});

test('buildBusinessFlexState aggregates domains from multiple runs into a set', () => {
  const runs = [
    {
      runId: 'run-a',
      profile: { profile: 'business-flex', enabled_domains: ['product', 'backend'], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
      budgetPolicy: null, tasks: [],
    },
    {
      runId: 'run-b',
      profile: { profile: 'business-flex', enabled_domains: ['backend', 'qa'], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
      budgetPolicy: null, tasks: [],
    },
  ];
  const result = buildBusinessFlexState(runs);
  const domains = result.profiles[0].enabledDomains;
  // Set deduplication: product, backend, qa (no duplicate backend)
  assert.ok(domains.includes('product'));
  assert.ok(domains.includes('backend'));
  assert.ok(domains.includes('qa'));
  assert.equal(domains.filter((d) => d === 'backend').length, 1);
});

test('buildBusinessFlexState groups separate profiles into separate entries', () => {
  const runs = [
    {
      runId: 'run-flex',
      profile: { profile: 'business-flex', enabled_domains: ['product'], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
      budgetPolicy: { run_budget_usd: 10 }, tasks: [],
    },
    {
      runId: 'run-lean',
      profile: { profile: 'lean-mvp', enabled_domains: ['backend'], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
      budgetPolicy: { run_budget_usd: 5 }, tasks: [],
    },
  ];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.profiles.length, 2);
  const profileIds = result.profiles.map((p) => p.profile);
  assert.ok(profileIds.includes('business-flex'));
  assert.ok(profileIds.includes('lean-mvp'));
});

// ---------------------------------------------------------------------------
// buildBusinessFlexState — budget aggregation
// ---------------------------------------------------------------------------

test('buildBusinessFlexState sums run budget totals across runs', () => {
  const runs = [
    {
      runId: 'run-1',
      profile: { profile: 'business-flex', enabled_domains: [], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
      budgetPolicy: { run_budget_usd: 10 },
      tasks: [],
    },
    {
      runId: 'run-2',
      profile: { profile: 'lean-mvp', enabled_domains: [], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
      budgetPolicy: { run_budget_usd: 5 },
      tasks: [],
    },
  ];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.budget.runBudgetTotal, 15);
});

test('buildBusinessFlexState sums task budget envelopes', () => {
  const runs = [{
    runId: 'run-budget',
    profile: { profile: 'business-flex', enabled_domains: [], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
    budgetPolicy: { run_budget_usd: 10 },
    tasks: [
      { id: 'task-1', budget_envelope: { currency: 'USD', estimated_ai_cost_usd: 2 } },
      { id: 'task-2', budget_envelope: { currency: 'USD', estimated_ai_cost_usd: 3.5 } },
      { id: 'task-3' }, // no budget_envelope
    ],
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.budget.tasksWithBudget, 2);
  assert.equal(result.budget.estimatedTaskBudget, 5.5);
});

test('buildBusinessFlexState handles missing budgetPolicy gracefully', () => {
  const runs = [{
    runId: 'run-no-budget',
    profile: { profile: 'business-flex', enabled_domains: [], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
    budgetPolicy: null,
    tasks: [],
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.budget.runBudgetTotal, 0);
});

// ---------------------------------------------------------------------------
// buildBusinessFlexState — routing signals
// ---------------------------------------------------------------------------

test('buildBusinessFlexState collects routing signals from tasks', () => {
  const runs = [{
    runId: 'run-routing',
    projectRoot: '/projects/my-app',
    profile: { profile: 'business-flex', enabled_domains: [], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
    budgetPolicy: null,
    tasks: [
      {
        id: '02-requirements',
        title: 'Requirements',
        profile: 'business-flex',
        routing: {
          selected_by: 'profile-domain-stage-affinity',
          explanation: ['profile:business-flex', 'stage-domains:product,docs'],
        },
        specialists: ['business-analyst', 'product-manager'],
        budget_envelope: { currency: 'USD', estimated_ai_cost_usd: 1 },
      },
    ],
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.routingSignals.length, 1);
  const signal = result.routingSignals[0];
  assert.equal(signal.runId, 'run-routing');
  assert.equal(signal.taskId, '02-requirements');
  assert.equal(signal.title, 'Requirements');
  assert.equal(signal.profile, 'business-flex');
  assert.equal(signal.selectedBy, 'profile-domain-stage-affinity');
  assert.ok(signal.explanation.includes('profile:business-flex'));
  assert.ok(signal.specialists.includes('business-analyst'));
  assert.ok(signal.budget !== null);
});

test('buildBusinessFlexState skips tasks without routing data', () => {
  const runs = [{
    runId: 'run-no-routing',
    profile: { profile: 'business-flex', enabled_domains: [], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
    budgetPolicy: null,
    tasks: [
      { id: 'task-no-routing', title: 'Plain task' }, // no routing field
    ],
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.routingSignals.length, 0);
});

test('buildBusinessFlexState caps routing signals at 80', () => {
  const tasks = Array.from({ length: 100 }, (_, i) => ({
    id: `task-${i}`,
    title: `Task ${i}`,
    routing: { selected_by: 'profile-domain-stage-affinity', explanation: [] },
  }));
  const runs = [{
    runId: 'run-many-tasks',
    profile: { profile: 'business-flex', enabled_domains: [], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
    budgetPolicy: null,
    tasks,
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.routingSignals.length, 80);
});

test('buildBusinessFlexState caps routing explanation at 8 items per task', () => {
  const longExplanation = Array.from({ length: 15 }, (_, i) => `explanation-item-${i}`);
  const runs = [{
    runId: 'run-long-explanation',
    profile: { profile: 'business-flex', enabled_domains: [], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
    budgetPolicy: null,
    tasks: [{
      id: 'task-01',
      title: 'Task',
      routing: { selected_by: 'routed', explanation: longExplanation },
    }],
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.routingSignals[0].explanation.length, 8);
});

test('buildBusinessFlexState caps specialists at 8 items per task', () => {
  const manySpecialists = Array.from({ length: 12 }, (_, i) => `specialist-${i}`);
  const runs = [{
    runId: 'run-many-specialists',
    profile: { profile: 'business-flex', enabled_domains: [], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
    budgetPolicy: null,
    tasks: [{
      id: 'task-01',
      routing: { selected_by: 'routed', explanation: [] },
      specialists: manySpecialists,
    }],
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.routingSignals[0].specialists.length, 8);
});

test('buildBusinessFlexState routing signal uses task.profile when available, otherwise profile entry id', () => {
  const runs = [{
    runId: 'run-profile-fallback',
    profile: { profile: 'business-flex', enabled_domains: [], enabled_agents: [], enabled_plugins: [], dashboard_pages: [] },
    budgetPolicy: null,
    tasks: [
      {
        id: 'task-with-profile',
        routing: { selected_by: 'routed', explanation: [] },
        profile: 'lean-mvp',  // task has its own profile
      },
      {
        id: 'task-no-profile',
        routing: { selected_by: 'routed', explanation: [] },
        // no profile field — should fall back to parent profileId
      },
    ],
  }];
  const result = buildBusinessFlexState(runs);
  assert.equal(result.routingSignals[0].profile, 'lean-mvp');
  assert.equal(result.routingSignals[1].profile, 'business-flex');
});

// ---------------------------------------------------------------------------
// toClientState — new fields added in this PR
// ---------------------------------------------------------------------------

test('toClientState passes through workflow, budgetPolicy, and profile on runs', () => {
  const state = {
    runs: [{
      manifest: { run_id: 'run-001', started_by: { name: 'Alice' } },
      events: [],
      evidence: [],
      workflow: 'production-business-sdlc',
      budgetPolicy: { currency: 'USD', run_budget_usd: 10 },
      profile: { profile: 'business-flex', name: 'Business Flex Delivery' },
      tasks: [],
    }],
  };
  const client = toClientState(state);
  const run = client.runs[0];
  assert.equal(run.workflow, 'production-business-sdlc');
  assert.deepEqual(run.budgetPolicy, { currency: 'USD', run_budget_usd: 10 });
  assert.equal(run.profile.profile, 'business-flex');
});

test('toClientState passes through routing and budget_envelope on tasks', () => {
  const routing = {
    selected_by: 'profile-domain-stage-affinity',
    explanation: ['profile:business-flex'],
  };
  const budgetEnvelope = { currency: 'USD', estimated_ai_cost_usd: 2 };
  const state = {
    runs: [{
      manifest: { run_id: 'run-002' },
      events: [],
      evidence: [],
      tasks: [{
        id: 'task-01',
        title: 'Build API',
        status: 'PENDING',
        routing,
        budget_envelope: budgetEnvelope,
      }],
    }],
  };
  const client = toClientState(state);
  const task = client.runs[0].tasks[0];
  assert.deepEqual(task.routing, routing);
  assert.deepEqual(task.budget_envelope, budgetEnvelope);
});

test('toClientState includes businessFlex in output', () => {
  const businessFlex = {
    profiles: [{ profile: 'business-flex', runs: 1, enabledDomains: ['product'] }],
    budget: { runBudgetTotal: 10, estimatedTaskBudget: 2, tasksWithBudget: 1 },
    routingSignals: [{ taskId: 'task-01', profile: 'business-flex' }],
  };
  const state = {
    runs: [],
    businessFlex,
  };
  const client = toClientState(state);
  assert.deepEqual(client.businessFlex, businessFlex);
});

test('toClientState provides empty businessFlex default when state.businessFlex is absent', () => {
  const state = { runs: [] };
  const client = toClientState(state);
  assert.deepEqual(client.businessFlex, { profiles: [], budget: {}, routingSignals: [] });
});

test('toClientState provides empty businessFlex default when state.businessFlex is null', () => {
  const state = { runs: [], businessFlex: null };
  const client = toClientState(state);
  assert.deepEqual(client.businessFlex, { profiles: [], budget: {}, routingSignals: [] });
});

test('toClientState strips events and evidence from runs but keeps workflow/profile/budgetPolicy', () => {
  const state = {
    runs: [{
      manifest: { run_id: 'run-strip' },
      events: [{ ts: '2026-01-01', type: 'run_started' }],
      evidence: [{ ts: '2026-01-01', kind: 'test', status: 'PASS' }],
      workflow: 'lean-mvp-sdlc',
      budgetPolicy: { run_budget_usd: 5 },
      profile: { profile: 'lean-mvp' },
      tasks: [],
    }],
  };
  const client = toClientState(state);
  const run = client.runs[0];
  // events and evidence should be stripped from top-level run fields
  assert.ok(!('events' in run));
  assert.ok(!('evidence' in run));
  // but evidence metadata is present
  assert.equal(run.evidenceCount, 1);
  // profile/workflow/budgetPolicy preserved
  assert.equal(run.workflow, 'lean-mvp-sdlc');
  assert.equal(run.profile.profile, 'lean-mvp');
});

test('toClientState handles runs with missing workflow/profile/budgetPolicy gracefully', () => {
  const state = {
    runs: [{
      manifest: { run_id: 'run-missing' },
      events: [],
      evidence: [],
      tasks: [],
      // workflow, budgetPolicy, profile intentionally omitted
    }],
  };
  const client = toClientState(state);
  const run = client.runs[0];
  assert.equal(run.workflow, undefined);
  assert.equal(run.budgetPolicy, undefined);
  assert.equal(run.profile, undefined);
});

test('toClientState handles tasks with no routing or budget_envelope', () => {
  const state = {
    runs: [{
      manifest: { run_id: 'run-plain-tasks' },
      events: [],
      evidence: [],
      tasks: [{
        id: 'plain-task',
        title: 'Plain',
        status: 'PENDING',
        // routing and budget_envelope intentionally absent
      }],
    }],
  };
  const client = toClientState(state);
  const task = client.runs[0].tasks[0];
  assert.equal(task.routing, undefined);
  assert.equal(task.budget_envelope, undefined);
});
