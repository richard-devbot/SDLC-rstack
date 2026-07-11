<!-- owner: RStack developed by Richardson Gunde -->

# Business Flex Policy Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the selected project’s validated Business Flex profile and file-backed run/day/month budget policy before the first run, while keeping current policy, historical run snapshots, and observed consumption visibly separate.

**Architecture:** A new server-side policy reader consumes already-scoped roots and project descriptors, reuses the harness validators, and returns explicit configured/missing/invalid/inaccessible records. `buildBusinessFlexState` combines those records with scoped run snapshots and telemetry; both Business Flex and Cost & Budget render that one contract. The browser never rereads config files or infers policy from runs.

**Tech Stack:** Node.js ESM, built-in filesystem APIs, existing harness config validators, plain browser JavaScript/CSS, Node test runner through `tsx`.

## Global Constraints

- Current configured policy, historical run snapshots, and observed consumption are separate facts.
- The dashboard uses `validateRstackConfig` and `validateBudgetConfig`; it does not create a second validation rule set.
- `evaluateLoopBudget` semantics are authoritative: only a finite non-negative `run_budget_usd` in `.rstack/budget.json` arms the loop brake.
- A configured cap never becomes consumption, and absent telemetry never becomes `$0.00`.
- “No cap configured” is reserved for a valid file that omits the named cap.
- Missing, invalid, and inaccessible policy states are explicit and link to Diagnostics.
- Every policy record includes source project and file provenance.
- Existing `businessFlex.profiles`, `businessFlex.budget`, and run snapshot fields remain compatible for other pages.
- All state remains scoped by the server-owned scope contract from #276.
- Do not introduce runtime demo or sample budgets.

---

### Task 1: Validated configured-policy reader

**Files:**
- Create: `src/observability/dashboard/state/configured-policy.js`
- Modify: `tests/dashboard-business-flex-state.test.js`

**Interfaces:**
- Consumes: `roots: string[]`, `projectDescriptors: ProjectDescriptor[]`, harness `validateRstackConfig(object)` and `validateBudgetConfig(object)`.
- Produces: `readConfiguredPolicies(roots, descriptors, { now, io? }): Promise<{ projects: ConfiguredProjectPolicy[] }>`.

- [x] **Step 1: Write the valid zero-run, missing, invalid, inaccessible, and zero-cap tests**

Add fixtures that call the real reader with temporary `.rstack` roots:

```js
test('valid zero-run project exposes configured profile and enforced 10/50/500 caps', async () => {
  const root = await policyRoot({
    config: { profile: 'business-flex' },
    budget: { currency: 'USD', run_budget_usd: 10, daily_budget_usd: 50, monthly_budget_usd: 500 },
  });
  const descriptor = resolveProjectDescriptor(root);
  const result = await readConfiguredPolicies([root], [descriptor], { now: 1_752_214_400_000 });
  assert.deepEqual(result.projects[0].budget, {
    availability: 'configured', currency: 'USD', runBudgetUsd: 10,
    dailyBudgetUsd: 50, monthlyBudgetUsd: 500,
    sourcePath: '.rstack/budget.json', issues: [],
  });
  assert.equal(result.projects[0].profile.id, 'business-flex');
  assert.equal(result.projects[0].profile.workflow, 'production-business-sdlc');
});
```

Add separate assertions for:

```js
assert.equal(missing.profile.availability, 'missing');
assert.equal(missing.budget.availability, 'missing');
assert.equal(malformed.budget.availability, 'invalid');
assert.equal(invalid.budget.issues[0].field, 'run_budget_usd');
assert.equal(inaccessible.budget.availability, 'inaccessible');
assert.equal(zeroCap.budget.runBudgetUsd, 0);
```

Use an injected `io.readFile` that throws `{ code: 'EACCES' }` for the inaccessible case so the test is portable.

- [x] **Step 2: Run the focused test and confirm RED**

Run: `npx tsx --test tests/dashboard-business-flex-state.test.js`

Expected: FAIL because `configured-policy.js` and `readConfiguredPolicies` do not exist.

- [x] **Step 3: Implement file classification and validated normalization**

Implement these boundaries:

```js
export async function readConfiguredPolicies(roots, descriptors, options = {}) {
  const now = new Date(options.now ?? Date.now()).toISOString();
  const io = options.io ?? { readFile };
  return {
    projects: await Promise.all((roots ?? []).map(async (root) => {
      const descriptor = descriptors.find((item) => item.root === root);
      const profile = await readProfilePolicy(root, io);
      const budget = await readBudgetPolicy(root, io);
      return {
        projectId: descriptor?.id ?? null,
        projectRoot: root,
        projectName: descriptor?.name ?? basename(root),
        worktreeName: descriptor?.worktreeName ?? null,
        availability: combinedAvailability(profile.availability, budget.availability),
        profile,
        budget,
        loadedAt: now,
      };
    })),
  };
}
```

`readPolicyFile` must distinguish `ENOENT`, `EACCES`/`EPERM`, JSON syntax/non-object errors, and valid objects. `readProfilePolicy` calls `validateRstackConfig`; `readBudgetPolicy` calls `validateBudgetConfig`. Merge valid profile overrides over `profileConfig(id)`, but never fill budget caps from profile defaults.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run: `npx tsx --test tests/dashboard-business-flex-state.test.js tests/config-validation.test.js tests/goal-loop.test.js`

Expected: PASS with the same invalid values rejected by both dashboard and harness validators.

- [x] **Step 5: Commit the reader**

```bash
git add src/observability/dashboard/state/configured-policy.js tests/dashboard-business-flex-state.test.js
git commit -m "fix(dashboard): read validated configured policy (#277)"
```

---

### Task 2: Business Flex policy, telemetry, and snapshot contract

**Files:**
- Modify: `src/observability/dashboard/state/business-flex.js`
- Modify: `src/observability/dashboard/state/index.js`
- Modify: `tests/dashboard-business-flex-state.test.js`
- Modify: `tests/dashboard-scope-state.test.js`

**Interfaces:**
- Consumes: `buildBusinessFlexState(runs, configuredPolicy)` and the Task 1 `{ projects }` contract.
- Produces: `configuredPolicy`, `observedConsumption`, `plannedEnvelopes`, and `runSnapshots` on `state.businessFlex`.

- [x] **Step 1: Write failing zero-run, telemetry, drift, and multi-project scope tests**

```js
test('buildFullState exposes configured policy before the first run', async () => {
  const state = await buildFullState(root, { includeRegistry: false });
  assert.equal(state.totalRuns, 0);
  assert.equal(state.businessFlex.configuredPolicy.projects[0].profile.id, 'business-flex');
  assert.equal(state.businessFlex.configuredPolicy.projects[0].budget.runBudgetUsd, 10);
  assert.equal(state.businessFlex.observedConsumption.availability, 'unavailable');
});

test('historical run snapshot is marked when current policy differs', () => {
  const model = buildBusinessFlexState([runWithPolicy(5)], currentPolicy(10));
  assert.equal(model.runSnapshots[0].comparison, 'differs');
  assert.deepEqual(model.runSnapshots[0].differences.map((d) => d.field), ['runBudgetUsd']);
});
```

Extend the two-project #276 fixture so project-A scope contains exactly project A’s policy record and no project-B path/cap.

- [x] **Step 2: Confirm RED**

Run: `npx tsx --test tests/dashboard-business-flex-state.test.js tests/dashboard-scope-state.test.js`

Expected: FAIL because `buildBusinessFlexState` accepts runs only and `buildFullState` never reads root policy.

- [x] **Step 3: Assemble the server-owned contract**

In `buildFullState`:

```js
const configuredPolicy = await readConfiguredPolicies(roots, scopedDescriptors, { now: options.now });
// ...
businessFlex: buildBusinessFlexState(runs, configuredPolicy),
```

In `business-flex.js`, keep legacy fields and add:

```js
return {
  configuredPolicy,
  observedConsumption: buildObservedConsumption(runs),
  plannedEnvelopes: { runBudgetTotal, estimatedTaskBudget, tasksWithBudget },
  runSnapshots: buildRunSnapshots(runs, configuredPolicy.projects),
  profiles: historicalProfiles,
  budget: { runBudgetTotal, estimatedTaskBudget, tasksWithBudget },
  routingSignals: routingSignals.slice(0, 80),
};
```

`buildObservedConsumption` reports `unavailable` when no run has persisted/event telemetry. `buildRunSnapshots` compares profile ID, workflow, and normalized run/day/month caps against the current project record.

- [x] **Step 4: Confirm GREEN and scope isolation**

Run: `npx tsx --test tests/dashboard-business-flex-state.test.js tests/dashboard-scope-state.test.js tests/dashboard-readiness-state.test.js`

Expected: PASS; project scope has one policy project, zero runs still has policy, and drift lists exact fields.

- [x] **Step 5: Commit the state contract**

```bash
git add src/observability/dashboard/state/business-flex.js src/observability/dashboard/state/index.js tests/dashboard-business-flex-state.test.js tests/dashboard-scope-state.test.js
git commit -m "fix(dashboard): separate policy from Business Flex telemetry (#277)"
```

---

### Task 3: Client projection uses the policy contract

**Files:**
- Modify: `src/observability/dashboard/state/client-state.js`
- Modify: `tests/dashboard-business-flex-state.test.js`
- Modify: `tests/dashboard-money-pages.test.js`

**Interfaces:**
- Consumes: `state.businessFlex.configuredPolicy.projects` from Task 2.
- Produces: client-safe policy records and per-run `loopBudgetUsd` derived from the server contract.

- [x] **Step 1: Write the failing no-reread and compatibility tests**

```js
test('toClientState wires run cap from configured policy without rereading the filesystem', () => {
  const state = stateWithPolicy({ root, runBudgetUsd: 10, run: fixtureRun({ projectRoot: root }) });
  const client = toClientState(state);
  assert.equal(client.runs[0].loopBudgetUsd, 10);
  assert.equal(client.loopBudgets[0].daily_budget_usd, 50);
});
```

Assert the client projection retains `availability`, `sourcePath`, `issues`, snapshot comparison, and observed-consumption provenance. Assert a missing/invalid budget maps `loopBudgetUsd` to `null`.

- [x] **Step 2: Confirm RED**

Run: `npx tsx --test tests/dashboard-business-flex-state.test.js tests/dashboard-money-pages.test.js`

Expected: FAIL because `toClientState` still calls `readLoopBudgetCaps(state.sourceRoots)` and collapses invalid/missing states.

- [x] **Step 3: Project caps from configured policy**

Build `capByRoot` and backward-compatible `loopBudgets` from configured project policy:

```js
const policyProjects = state.businessFlex?.configuredPolicy?.projects ?? [];
const configuredBudgets = policyProjects.filter((project) => project.budget?.availability === 'configured');
const capByRoot = Object.fromEntries(configuredBudgets.map((project) => [project.projectRoot, project.budget.runBudgetUsd]));
```

Use `Object.hasOwn(capByRoot, run.projectRoot)` so a configured zero cap survives. Keep `readLoopBudgetCaps` exported only for compatibility tests, but remove it from the snapshot path.

- [x] **Step 4: Confirm GREEN**

Run: `npx tsx --test tests/dashboard-business-flex-state.test.js tests/dashboard-money-pages.test.js tests/dashboard-client-state.test.js`

Expected: PASS; no client projection reads policy files and older `loopBudgets` consumers retain equivalent valid-cap data.

- [x] **Step 5: Commit the projection**

```bash
git add src/observability/dashboard/state/client-state.js tests/dashboard-business-flex-state.test.js tests/dashboard-money-pages.test.js
git commit -m "fix(dashboard): project configured budgets to the client (#277)"
```

---

### Task 4: Business Flex policy ledger UI

**Files:**
- Modify: `src/observability/dashboard/ui/pages/business-flex.js`
- Modify: `src/observability/dashboard/ui/styles.js`
- Modify: `tests/dashboard-business-flex-state.test.js`

**Interfaces:**
- Consumes: `businessFlexModel(s).configuredPolicy`, `.observedConsumption`, `.runSnapshots`, and `.routingSignals`.
- Produces: `businessPolicyLedgerHtml(model)`, `businessRunSnapshotsHtml(model)`, and updated `renderBusinessFlex(s)`.

- [x] **Step 1: Write rendered-state tests for configured/no-telemetry, invalid, inaccessible, missing, and drift**

Evaluate `businessFlexScript` in the established fake DOM and assert:

```js
assert.match(configuredHtml, /Business Flex Delivery/);
assert.match(configuredHtml, /production-business-sdlc/);
assert.match(configuredHtml, /\$10\.00 \/ run/);
assert.match(configuredHtml, /\$50\.00 \/ day/);
assert.match(configuredHtml, /\$500\.00 \/ month/);
assert.match(configuredHtml, /No telemetry yet/);
assert.doesNotMatch(configuredHtml, /Waiting for run|No RStack profile data/);
assert.match(invalidHtml, /Invalid configuration/);
assert.match(invalidHtml, /Open Diagnostics/);
assert.match(driftHtml, /Policy changed since this run/);
```

- [x] **Step 2: Confirm RED**

Run: `npx tsx --test tests/dashboard-business-flex-state.test.js`

Expected: FAIL because the current page derives headline, caps, and empty states from runs.

- [x] **Step 3: Implement the ledger and precise state copy**

Render one `policy-ledger` per configured project with three lanes:

```html
<section class="policy-ledger">
  <div class="policy-lane policy-current">Configured operating policy</div>
  <div class="policy-lane policy-limits">Enforced limits</div>
  <div class="policy-lane policy-observed">Observed consumption</div>
</section>
```

Use availability-specific copy from the design spec. Source lines include canonical project name plus `.rstack/rstack.config.json` or `.rstack/budget.json`. The Diagnostics action calls `navTo('diagnostics')`. Historical snapshots render below the current policy and never replace it.

Add responsive CSS so the ledger is three columns on wide screens and one column below 700px. Use existing typography/color variables, 1px provenance rules, 44px action targets, visible focus, and no new dependencies.

- [x] **Step 4: Confirm GREEN**

Run: `npx tsx --test tests/dashboard-business-flex-state.test.js tests/dashboard-client-modules.test.js`

Expected: PASS for all policy states and existing Business Flex routing/profile behavior.

- [x] **Step 5: Commit the Business Flex UI**

```bash
git add src/observability/dashboard/ui/pages/business-flex.js src/observability/dashboard/ui/styles.js tests/dashboard-business-flex-state.test.js
git commit -m "fix(dashboard): show the current Business Flex policy ledger (#277)"
```

---

### Task 5: Cost & Budget consumes current policy before runs

**Files:**
- Modify: `src/observability/dashboard/ui/pages/cost-budget.js`
- Modify: `tests/dashboard-money-pages.test.js`

**Interfaces:**
- Consumes: the same configured-policy and run-snapshot contract as Task 4.
- Produces: `configuredBudgetPolicyHtml(s)` above `budgetGovernanceHtml(s)` and truthful panel notes.

- [x] **Step 1: Write failing rendered tests for zero-run 10/50/500 policy and invalid policy**

```js
test('Cost & Budget shows configured 10/50/500 limits with zero runs', () => {
  const html = api.configuredBudgetPolicyHtml(configuredZeroRunState());
  assert.match(html, /\$10\.00/);
  assert.match(html, /\$50\.00/);
  assert.match(html, /\$500\.00/);
  assert.match(html, /No telemetry yet/);
  assert.doesNotMatch(html, /No run budget cap configured/);
});
```

Also assert invalid and inaccessible policy link to Diagnostics, and a valid budget object with `runBudgetUsd: null` is the only state that says “No run cap configured.”

- [x] **Step 2: Confirm RED**

Run: `npx tsx --test tests/dashboard-money-pages.test.js`

Expected: FAIL because `budgetGovernanceHtml` returns “No run budget cap configured” whenever no run carries `loopBudgetUsd`.

- [x] **Step 3: Render configured policy separately from run consumption**

Insert a “Current Enforced Policy” panel above the existing consumption bar. Use policy project records for caps/provenance and run snapshots for historical bars. Change the governance note from run-cap count to configured project state:

```js
setText('cost-budget-governance-note', configuredCount
  ? configuredCount + ' project policy record' + (configuredCount === 1 ? '' : 's')
  : 'policy unavailable');
```

When no runs exist, keep the policy panel populated and the consumption lane at “No telemetry yet.” Existing actual-spend and per-stage panels remain unchanged.

- [x] **Step 4: Confirm GREEN**

Run: `npx tsx --test tests/dashboard-money-pages.test.js tests/dashboard-business-flex-state.test.js tests/dashboard-quality-pages.test.js`

Expected: PASS with 10/50/500 rendered before any run and no regression in actual-spend provenance.

- [x] **Step 5: Commit the Cost & Budget UI**

```bash
git add src/observability/dashboard/ui/pages/cost-budget.js tests/dashboard-money-pages.test.js
git commit -m "fix(dashboard): show enforced budgets before telemetry (#277)"
```

---

### Task 6: Full verification, responsive evidence, and stacked PR

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-business-flex-policy-trust-277.md` only to mark completed checkboxes.

**Interfaces:**
- Verifies Tasks 1–5 without adding behavior.

- [ ] **Step 1: Run all automated gates**

```bash
npm run lint
npm run typecheck
npm test
npm run validate
node scripts/security-audit.mjs
git diff --check
```

Expected: every command exits 0 and the full suite reports zero failures.

- [ ] **Step 2: Run live configured/no-telemetry and invalid-policy fixtures**

Start the dashboard against temporary project roots. Confirm the configured fixture shows Business Flex plus 10/50/500 limits with zero runs, and the invalid fixture names the file/field without showing an enforced value.

- [ ] **Step 3: Capture desktop and 390px evidence**

Verify the three-lane ledger, mobile single-column order, 44px Diagnostics action, no horizontal overflow, keyboard focus, source provenance, and no console errors. Capture configured/no-telemetry and invalid states.

- [ ] **Step 4: Publish a stacked draft PR**

```bash
git push -u origin codex/ui-business-flex-277
```

Open the draft PR against `codex/ui-scope-276`; include “Closes #277,” the required zero-run/10-50-500 evidence, screenshots, validation commands, and merge order #312 → #317 → this PR. Keep #277 open until the PR is merged into the default branch.
