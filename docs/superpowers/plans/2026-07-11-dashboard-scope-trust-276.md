<!-- owner: RStack developed by Richardson Gunde -->

# Dashboard Scope, Identity, and Time Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make every dashboard view use a complete server-owned project/run scope, show canonical repository identity with worktree context, and render locale-aware timestamps with explicit timezone and ISO provenance.

**Architecture:** The dashboard state layer will resolve canonical project descriptors for every registered state root and assign collision-safe run scope keys. `/api/state` will accept a server-validated project or run scope and rebuild all derived collections and totals from the selected runs; the browser will request that projection rather than patching selected arrays locally. The global WebSocket remains the invalidation signal and catalog source, while a request sequence prevents stale scoped responses from replacing newer selections.

**Tech Stack:** Node.js ESM, built-in `node:fs`, `node:path`, `node:crypto`, HTTP server, plain browser JavaScript, CSS, Node test runner through `tsx`.

## Global Constraints

- Preserve the 21 existing page IDs and all deep links; shell consolidation belongs to #278.
- Scope-sensitive facts and aggregates must be computed by the server from selected records.
- Keep explicitly global connection health only when the UI labels it as global.
- A project selector must remain keyboard accessible at 390px and expose at least a 44px target.
- A run ID collision across source roots must never drop either run.
- Canonical repository name is primary; worktree name is secondary metadata.
- Invalid or missing saved scope resets to All projects and is announced through an ARIA live region.
- Every valid visible timestamp includes a locale-aware timezone label and a machine-readable full ISO value.
- Do not introduce demo/sample data or client-side authority.

---

### Task 1: Canonical project and collision-safe run identities

**Files:**
- Create: `src/observability/dashboard/state/identity.js`
- Modify: `src/observability/dashboard/state/rollup-index.js`
- Test: `tests/dashboard-scope-state.test.js`
- Test: `tests/dashboard-rollup-index.test.js`

**Interfaces:**
- Produces: `resolveProjectDescriptor(root): { id, name, root, repositoryRoot, worktreeName, isWorktree }`.
- Produces: `resolveProjectDescriptors(roots): ProjectDescriptor[]`.
- Produces: `runScopeKey(projectId, root, runId): string` and `decorateRunIdentity(runs, projects): Run[]`.
- Changes `getIndexedRuns` deduplication from bare `runId` to the source-root/run pair.

- [x] **Step 1: Write failing identity and collision tests**

```js
test('a linked worktree keeps the canonical repository name and exposes the worktree secondarily', () => {
  const descriptor = resolveProjectDescriptor(worktreeRoot);
  assert.equal(descriptor.name, 'product-repository');
  assert.equal(descriptor.repositoryRoot, repositoryRoot);
  assert.equal(descriptor.worktreeName, 'agent-scope-fix');
  assert.equal(descriptor.isWorktree, true);
});

test('the rollup keeps equal runIds from different roots', async () => {
  const { runs } = await getIndexedRuns([projectA, projectB]);
  assert.equal(runs.filter((run) => run.runId === 'run-shared').length, 2);
});
```

- [x] **Step 2: Run the focused tests and confirm RED**

Run: `npx tsx --test tests/dashboard-scope-state.test.js tests/dashboard-rollup-index.test.js`

Expected: FAIL because `identity.js` does not exist and bare `runId` deduplication returns one colliding run.

- [x] **Step 3: Implement filesystem-only repository/worktree resolution**

```js
export function resolveProjectDescriptor(root) {
  const canonicalRoot = resolve(root);
  const git = readGitLayout(canonicalRoot);
  const repositoryRoot = git.repositoryRoot ?? canonicalRoot;
  const isWorktree = repositoryRoot !== canonicalRoot;
  return {
    id: projectId(repositoryRoot),
    name: basename(repositoryRoot),
    root: canonicalRoot,
    repositoryRoot,
    worktreeName: isWorktree ? basename(canonicalRoot) : null,
    isWorktree,
  };
}
```

`readGitLayout` reads a `.git` directory directly, or follows a `.git` file plus its `commondir`; it does not spawn Git. `projectId` and `runScopeKey` use SHA-256 prefixes so paths are not used as browser storage keys.

- [x] **Step 4: Replace bare run deduplication with root/run deduplication**

```js
const key = `${run.projectRoot}\u0000${run.runId}`;
return seen.has(key) ? false : seen.add(key);
```

- [x] **Step 5: Re-run focused tests and confirm GREEN**

Run: `npx tsx --test tests/dashboard-scope-state.test.js tests/dashboard-rollup-index.test.js`

Expected: PASS with both colliding runs present and canonical worktree identity asserted.

### Task 2: Server-owned scope catalog and complete scoped state

**Files:**
- Create: `src/observability/dashboard/state/scope.js`
- Modify: `src/observability/dashboard/state/index.js`
- Modify: `src/observability/dashboard/state/projects.js`
- Modify: `src/observability/dashboard/state/client-state.js`
- Test: `tests/dashboard-scope-state.test.js`

**Interfaces:**
- Consumes: project descriptors and decorated runs from Task 1.
- Produces: `buildScopeCatalog(projects, runs)` with project entries and collision-safe run entries.
- Produces: `resolveRequestedScope(catalog, request)` with `{ type, key, projectId, runKey, roots, runKeys, reset, reason }`.
- Extends `buildFullState(projectRoot, { scope })` so all builders receive only selected roots, runs, and approvals while `scopeCatalog` remains global.

- [x] **Step 1: Add the deterministic two-project leakage fixture and failing assertions**

```js
const scoped = await buildFullState(rootA, {
  sourceRoots: [rootA, rootB],
  scope: { projectId: projectAId },
});

assert.deepEqual(new Set(scoped.runs.map((run) => run.projectId)), new Set([projectAId]));
assert.equal(scoped.totalRuns, 1);
assert.equal(scoped.totalCost, 4.25);
assert.equal(scoped.alerts.every((item) => item.projectId === projectAId), true);
assert.equal(scoped.pendingApprovals.every((item) => item.projectId === projectAId), true);
assert.equal(scoped.blockedGates.every((item) => item.projectId === projectAId), true);
assert.equal(scoped.diagnostics.runCount, 1);
assert.equal(scoped.projectSummaries.every((item) => item.projectId === projectAId), true);
assert.equal(scoped.stageMatrix.every((stage) => stage.runs.every((row) => row.projectId === projectAId)), true);
```

- [x] **Step 2: Confirm RED against the current global-only builder**

Run: `npx tsx --test tests/dashboard-scope-state.test.js`

Expected: FAIL because `buildFullState` ignores `scope`, records lack `projectId`, and totals include project B.

- [x] **Step 3: Build and validate the catalog before deriving dashboard state**

```js
const projects = resolveProjectDescriptors(allRoots);
const allRuns = decorateRunIdentity(indexed.runs, projects);
const scopeCatalog = buildScopeCatalog(projects, allRuns);
const scope = resolveRequestedScope(scopeCatalog, options.scope);
const roots = allRoots.filter((root) => scope.roots.includes(root));
const runs = allRuns.filter((run) => scope.runKeys.includes(run.scopeKey));
const queueApprovals = allApprovals
  .map((approval) => decorateProjectRecord(approval, projects))
  .filter((approval) => scope.projectIds.includes(approval.projectId));
```

When no scope is requested, `roots`, `runs`, and approvals remain global. When the request is invalid, the returned state is global with `scope.reset === true` and a plain-language reason.

- [x] **Step 4: Rebuild every visible aggregate from selected inputs**

Use the selected `runs`, `roots`, and `queueApprovals` for totals, active/today counts, approvals, blockers, alerts, feed, frameworks, stage matrix, agent work/groups, project summaries, trace map, trends, people/presence, Business Flex, decisions, readiness, diagnostics, layers, and environment. Attach `projectId` and `runKey` to source-linked records before they reach `toClientState`.

- [x] **Step 5: Add a scope-field coverage assertion**

```js
assert.deepEqual(
  Object.keys(scoped).filter((key) => SCOPE_SENSITIVE_FIELDS.has(key)).sort(),
  [...SCOPE_SENSITIVE_FIELDS].sort(),
);
```

The exported registry is the review gate for any newly added scope-sensitive top-level field.

- [x] **Step 6: Re-run the scope tests and confirm GREEN**

Run: `npx tsx --test tests/dashboard-scope-state.test.js tests/dashboard-readiness-state.test.js tests/dashboard-business-flex-state.test.js`

Expected: PASS; the exact fixture proves no project-B blocker, approval, diagnostic, stage row, or aggregate appears in project A.

### Task 3: Scoped REST contract and WebSocket invalidation

**Files:**
- Modify: `src/observability/dashboard/server.js`
- Modify: `tests/dashboard-server-hardening.test.js`
- Test: `tests/dashboard-scope-server.test.js`

**Interfaces:**
- Consumes: `buildFullState(PROJECT_ROOT, { scope: { projectId, runKey } })`.
- Extends: `GET /api/state?project=<projectId>` and `GET /api/state?run=<runKey>`.
- Preserves read-token authorization and per-projection ETags.

- [x] **Step 1: Write failing API tests**

```js
const response = await fetch(`${baseUrl}/api/state?project=${encodeURIComponent(projectAId)}`);
const body = await response.json();
assert.equal(body.scope.type, 'project');
assert.equal(body.scope.projectId, projectAId);
assert.equal(body.totalRuns, 1);
assert.equal(body.runs.every((run) => run.projectId === projectAId), true);
assert.ok(response.headers.get('etag'));
```

Also assert an invalid `project` returns the global projection with `scope.reset === true`, and that scoped requests still require the configured read token.

- [x] **Step 2: Confirm RED**

Run: `npx tsx --test tests/dashboard-scope-server.test.js tests/dashboard-read-auth.test.js`

Expected: FAIL because `/api/state` ignores scope query parameters.

- [x] **Step 3: Parse exactly one scope query and pass it to the state builder**

```js
const scope = url.searchParams.get('run')
  ? { runKey: url.searchParams.get('run') }
  : url.searchParams.get('project')
    ? { projectId: url.searchParams.get('project') }
    : null;
const state = await buildFullState(PROJECT_ROOT, { scope });
```

The existing `readAuthError`, `toClientState`, `stableStringify`, and `sendJsonCacheable` path remains unchanged so security and ETag behavior are identical for global and scoped snapshots.

- [x] **Step 4: Confirm GREEN and ETag isolation**

Run: `npx tsx --test tests/dashboard-scope-server.test.js tests/dashboard-server-hardening.test.js tests/dashboard-read-auth.test.js`

Expected: PASS; project A and project B receive distinct ETags and 304 revalidation works per scoped URL.

### Task 4: Browser scope orchestration and responsive context strip

**Files:**
- Modify: `src/observability/dashboard/ui/index.js`
- Modify: `src/observability/dashboard/ui/client.js`
- Modify: `src/observability/dashboard/ui/styles.js`
- Modify: `tests/dashboard-client-modules.test.js`
- Test: `tests/dashboard-scope-client.test.js`

**Interfaces:**
- Consumes: `scopeCatalog`, `scope`, and server-scoped snapshots.
- Produces: `scopeUrl()`, `requestScopedState()`, and `applyServerState()` browser functions.
- Removes: browser-side `applyScope` filtering and readiness-only scope selection.

- [x] **Step 1: Write failing client-contract tests**

```js
assert.doesNotMatch(bundle, /function applyScope\(/);
assert.match(bundle, /function requestScopedState\(/);
assert.match(bundle, /\/api\/state\?project=/);
assert.match(bundle, /SCOPE_REQUEST_SEQUENCE/);
assert.match(html, /id="scope-live" role="status" aria-live="polite"/);
assert.doesNotMatch(styles, /@media \(max-width: 900px\) \{ \.tb-scope \{ display: none; \} \}/);
```

The executable client test selects project A, resolves project B followed by project A out of order, and asserts the older response is discarded.

- [x] **Step 2: Confirm RED**

Run: `npx tsx --test tests/dashboard-scope-client.test.js tests/dashboard-client-modules.test.js`

Expected: FAIL because the browser currently shallow-copies and filters local arrays, and CSS hides scope below 900px.

- [x] **Step 3: Render selectors from the global catalog and fetch selected state**

```js
function setScopeProject(value) {
  SCOPE.project = value;
  SCOPE.run = '';
  persistScope();
  requestScopedState();
}

function handleGlobalSnapshot(snapshot) {
  SCOPE_CATALOG = snapshot.scopeCatalog;
  if (SCOPE.project || SCOPE.run) requestScopedState();
  else applyServerState(snapshot, { fromSnapshot: true });
}
```

Each request captures an incrementing sequence number. Only the latest sequence may call `applyServerState`. A reset response clears storage, announces the server reason, and renders the honest All projects state.

- [x] **Step 4: Keep scope visible at 390px**

```css
.tb-scope { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr); }
.tb-scope .run-select { min-height: 44px; }
@media (max-width: 640px) {
  .tb-scope { order: 4; width: 100%; grid-template-columns: 1fr 1fr; margin-left: 0; }
  .tb-scope .run-select { width: 100%; min-width: 0; }
}
```

The project option label is the canonical repository name; a worktree suffix appears only as secondary option text and in the context detail.

- [x] **Step 5: Confirm GREEN**

Run: `npx tsx --test tests/dashboard-scope-client.test.js tests/dashboard-client-modules.test.js tests/dashboard-readiness-state.test.js`

Expected: PASS with no browser-side partial filter and accessible mobile scope controls.

### Task 5: Locale-aware, provenance-bearing timestamps

**Files:**
- Modify: `src/observability/dashboard/ui/lib.js`
- Modify: `src/observability/dashboard/ui/client.js`
- Modify: `src/observability/dashboard/ui/drawer.js`
- Modify: timestamp-consuming files under `src/observability/dashboard/ui/pages/`
- Test: `tests/dashboard-scope-client.test.js`

**Interfaces:**
- Produces: `timeModel(value)` returning `{ valid, iso, label }`.
- Produces: `timeHtml(value)` returning a `<time datetime="..." title="...">...</time>` element for valid input and an honest invalid/missing fallback otherwise.
- Keeps: `fmtTime(value)` as the plain-text localized label for text-only DOM updates.

- [x] **Step 1: Write failing formatter tests**

```js
const model = timeModel('2026-07-11T10:30:00.000Z');
assert.equal(model.valid, true);
assert.equal(model.iso, '2026-07-11T10:30:00.000Z');
assert.match(model.label, /(GMT|UTC|IST|[+-]\d{1,2}:?\d{2})/);
assert.match(timeHtml('2026-07-11T10:30:00.000Z'), /<time datetime="2026-07-11T10:30:00.000Z" title="2026-07-11T10:30:00.000Z">/);
assert.equal(fmtTime('not-a-time'), 'Invalid time');
```

- [x] **Step 2: Confirm RED**

Run: `npx tsx --test tests/dashboard-scope-client.test.js`

Expected: FAIL because `fmtTime` currently slices strings and has no timezone or ISO provenance.

- [x] **Step 3: Implement one formatter and replace all visible timestamp call sites**

```js
function timeModel(value) {
  if (!value) return { valid: false, iso: '', label: 'Time unavailable' };
  var date = new Date(value);
  if (isNaN(date.getTime())) return { valid: false, iso: '', label: 'Invalid time' };
  var iso = date.toISOString();
  var label = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
  return { valid: true, iso: iso, label: label };
}
```

Use `timeHtml` in feed, approval, alert, environment, decision, presence, and drawer markup. For page-updated plain text, call `fmtTime` and set the element `title` to the snapshot ISO value.

- [x] **Step 4: Confirm GREEN**

Run: `npx tsx --test tests/dashboard-scope-client.test.js tests/dashboard-client-modules.test.js tests/dashboard-money-pages.test.js tests/dashboard-quality-pages.test.js`

Expected: PASS with explicit timezone labels, ISO `datetime`/`title`, and honest invalid/missing states.

### Task 6: Full verification and evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-dashboard-scope-trust-276.md` only to mark completed checkboxes.

**Interfaces:**
- Verifies all interfaces from Tasks 1–5 without adding behavior.

- [x] **Step 1: Run static and full automated verification**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run validate
node scripts/security-audit.mjs
git diff --check
```

Expected: all commands exit 0; the full suite reports 0 failures.

- [x] **Step 2: Run the live dashboard against deterministic two-project data**

Verify All projects, project A, project B, and a colliding run ID. Confirm project A shows no project-B alerts, approvals, gates, diagnostics, stage rows, totals, decisions, presence, or environment data.

- [x] **Step 3: Capture responsive evidence**

At 1440px and 390px, verify canonical repository name, secondary worktree label, visible scope/freshness controls, 44px targets, no horizontal overflow, timezone-bearing timestamps, stale-scope reset announcement, and keyboard operation.

- [x] **Step 4: Commit implementation and publish a stacked draft PR**

```bash
git add docs/superpowers/plans/2026-07-11-dashboard-scope-trust-276.md src/observability/dashboard tests
git commit -m "fix(dashboard): make project and run scope trustworthy (#276)"
git push -u origin codex/ui-scope-276
```

Open the draft PR against `codex/ui-readiness-93` so reviewers see only #276; retarget to `main` after #312 merges. Include exact two-project leakage assertions and desktop/390px screenshots in the PR evidence.
