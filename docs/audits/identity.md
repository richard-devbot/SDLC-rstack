<!-- owner: RStack developed by Richardson Gunde -->

# RStack SDLC Production Audit Identity

**Audit date:** 2026-07-04  
**Scope:** SDLC-rstack production utilization readiness, advantages, disadvantages, loopholes, bugs, and DevSecOps best-practice comparison.  
**Audit basis:** Repository code/config/tests first; public best-practice references cross-checked through terminal `curl`/Python because Tau `web_search`/`web_fetch` tools failed in this session.

---

## 1. Web/tooling status

The built-in Tau web tools failed during the audit:

```text
Search failed: No module named 'lxml.etree'
Failed to fetch ... cannot import name 'etree' from 'lxml'
```

Direct local check showed the Tau venv can import `lxml.etree`, so the failure appears to be in the web-tool runtime/import path rather than in this repository.

A terminal workaround using `curl`/Python `urllib` successfully reached public references:

- OWASP DevSecOps Guideline
- CISA Secure by Design
- NIST SSDF SP 800-218
- SLSA requirements

External best-practice controls used for comparison:

- Threat modeling and secure design by default.
- SAST, SCA, IAST, DAST, IaC scanning, infrastructure scanning, and compliance checks.
- Protected software artifacts, provenance, and secure build/release processes.
- Vulnerability response and continuous improvement.
- Least privilege and authenticated access to sensitive state.
- Evidence, auditability, monitoring, rollback, and incident readiness.

---

## 2. Overall production readiness verdict

RStack SDLC is **production-oriented and architecturally strong**, but it is **not fully production-hardened yet**.

The codebase already has strong foundations:

- Canonical SDLC lifecycle and stage model.
- Large validated agent catalog.
- Approval gates.
- Dashboard observability.
- Atomic state writes for key files.
- CI security baseline.
- Secret scanning.
- Dependency audit script.
- Multi-framework integration.
- Profile-based governance and budget policies.

The main blockers for production use are:

1. Unauthenticated dashboard read APIs.
2. WebSocket state stream without Origin/token validation.
3. Predictable default memory signing key.
4. Evidence ledger appends not using the project locking/atomic-write pattern.
5. Publish workflow missing lint/security-audit parity with CI.
6. `npm test` currently failing due markdown owner-label validation in stabilization issue files.
7. README/test-count and readiness messaging stale compared with actual test results and planned roadmap gaps.
8. Planned loop-engineering capabilities are still incomplete or documented as planned.

---

## 3. Validation results

Commands run:

```bash
npm test
npm run validate
npm run lint
node scripts/security-audit.mjs
```

Results:

```text
npm test                         FAIL — 312 pass, 1 fail
npm run validate                 PASS — all 196 agents passed validation
npm run lint                     PASS
node scripts/security-audit.mjs  PASS — 0 blocking advisories
```

The failing test:

```text
all markdown and plugin manifests carry the RStack owner label
```

Files missing the owner label at test time:

```text
stabilization-issues/001-process-simplification.md
stabilization-issues/002-contract-schema-reduction.md
stabilization-issues/003-quick-start-guide.md
stabilization-issues/004-parallel-execution-benchmark.md
stabilization-issues/005-skill-catalog-maintenance.md
```

Relevant test code:

```text
tests/validate-references.test.js:36-47
```

The test walks all `.md` files outside `.git`, `.rstack`, and `node_modules`, requiring this string:

```text
RStack developed by Richardson Gunde
```

---

## 4. Advantages for production utilization

### 4.1 Strong governed SDLC process model

RStack defines a repeatable lifecycle:

```text
clarify → plan → spec → approve → build → validate → release-readiness → learn
```

The repository includes 15 canonical SDLC stage agents and core orchestrator/builder/validator roles.

Relevant code/assets:

```text
agents/sdlc/00-environment.md
agents/sdlc/01-transcript.md
agents/sdlc/02-requirements.md
agents/sdlc/03-documentation.md
agents/sdlc/04-planning.md
agents/sdlc/05-jira.md
agents/sdlc/06-architecture.md
agents/sdlc/07-code.md
agents/sdlc/08-testing.md
agents/sdlc/09-deployment.md
agents/sdlc/10-summary.md
agents/sdlc/11-feedback-loop.md
agents/sdlc/12-security-threat-model.md
agents/sdlc/13-compliance-checker.md
agents/sdlc/14-cost-estimation.md
src/core/harness/stages.js
```

Production value:

- Makes AI-driven delivery more repeatable.
- Creates explicit lifecycle checkpoints.
- Helps teams enforce stage-level accountability.

---

### 4.2 Human approval and governance controls

Approval write actions are protected when using the dashboard.

Relevant code:

```text
src/observability/dashboard/server.js:150-169
```

Key behavior:

```js
const expected = process.env.RSTACK_APPROVAL_TOKEN;
if (!expected) {
  return { code: 403, msg: 'dashboard approvals are disabled — set RSTACK_APPROVAL_TOKEN to enable signed approvals, or approve via sdlc_approve' };
}

const origin = req.headers.origin;
if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
  return { code: 403, msg: 'cross-origin approval rejected' };
}

const token = req.headers['x-rstack-approval-token'];
if (!token || token !== expected) {
  return { code: 401, msg: 'missing or invalid approval token' };
}
```

Production value:

- Prevents unauthenticated browser approval/rejection actions.
- Requires a configured approval token for dashboard approvals.
- Rejects foreign-origin approval attempts.

---

### 4.3 POST rate limiting exists

POST routes are throttled with a per-IP token bucket.

Relevant code:

```text
src/observability/dashboard/server.js:126-129
src/observability/dashboard/server.js:349-367
```

Key behavior:

```js
const postRateLimiter = createRateLimiter({ capacity: 10, windowMs: 60_000 });

if (req.method === 'POST') {
  const verdict = postRateLimiter.check(req.socket?.remoteAddress ?? 'unknown');
  if (!verdict.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(verdict.retryAfterSec),
    });
    res.end(JSON.stringify({ ok: false, error: 'rate limit exceeded — retry later' }));
    return;
  }
}
```

Production value:

- Reduces brute-force risk against approval tokens.
- Reduces accidental or malicious POST spam.

---

### 4.4 Dashboard binds to localhost

The Business Hub server listens on `127.0.0.1`, not all interfaces.

Relevant code:

```text
src/observability/dashboard/server.js:434-443
```

Key behavior:

```js
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${server.address().port}`;
});
```

Production value:

- Safer default than binding to `0.0.0.0`.
- Prevents direct LAN exposure by default.

Residual risk:

- Localhost-only does not protect against local processes or browser-to-localhost attack paths.
- Read APIs and WebSocket stream still need authentication for production use.

---

### 4.5 Atomic writes and advisory locking for key state

The harness includes crash-safe writes and lockfiles.

Relevant code:

```text
src/core/harness/safe-write.js:33-56
src/core/harness/safe-write.js:85-108
src/core/harness/run-state.js:39-72
```

Key behavior:

```js
export async function writeFileAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${tmpSeq++}`;
  ...
  await rename(tmp, file);
}
```

```js
export async function withFileLock(file, fn) {
  const lockPath = `${file}.lock`;
  await mkdir(dirname(file), { recursive: true });
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, 'wx');
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      if (!(await breakStaleLock(lockPath))) await sleep(LOCK_RETRY_DELAY_MS);
      continue;
    }
    try {
      return await fn();
    } finally {
      await rm(lockPath, { force: true }).catch(() => {});
    }
  }
}
```

Production value:

- Protects against torn writes.
- Reduces lost updates in concurrent runs.
- Supports more reliable dashboard and pipeline state.

---

### 4.6 CI security baseline exists

CI performs tests, dependency security audit, and secret scanning.

Relevant config:

```text
.github/workflows/ci.yml:27-37
.github/workflows/ci.yml:57-66
scripts/security-audit.mjs:28-77
```

Key CI behavior:

```yaml
- name: Run tests
  run: npm test

- name: Validate packaged agents
  run: npm run validate

- name: Audit dependencies
  run: node scripts/security-audit.mjs

- name: Secret scan with gitleaks
  uses: gitleaks/gitleaks-action@v2
```

Security audit behavior:

```js
const BLOCKING = new Set(['high', 'critical']);
...
if (blocking.length) {
  console.error('\nBlocking high/critical advisories in our dependency tree:');
  process.exit(1);
}
```

Production value:

- Aligns with OWASP/NIST expectations for dependency and secret scanning.
- Blocks high/critical advisories in controlled dependency paths.

---

### 4.7 Broad automated test coverage

The current test run executed 313 tests:

```text
312 pass
1 fail
```

Coverage areas observed from test output include:

- Approval security.
- Dashboard hardening.
- Pipeline state.
- Rollup index.
- Memory and signatures.
- Harness contracts.
- Evidence events.
- Operator bridge.
- People layer approvals.
- Profiles and budget policies.
- Package asset validation.

Production value:

- Strong regression safety net once the failing test is fixed.

---

### 4.8 Multi-framework integration

RStack supports multiple host frameworks and a custom bridge model.

Relevant code/config:

```text
package.json:58-68
src/integrations/init.js:22-48
src/integrations/init.js:130-232
bin/rstack-operator-bridge.ts
extensions/rstack-sdlc.ts
extensions/rstack_sdlc.py
```

Production value:

- Flexible adoption across Pi, Claude Code, Operator, and custom harnesses.
- Useful for teams with mixed agent tooling.

---

### 4.9 Profile-based governance and budgets

Profiles exist for different governance levels:

- `lean-mvp`
- `business-flex`
- `enterprise-webapp`

Relevant code:

```text
src/core/profiles.js
src/integrations/init.js:137-151
```

Production value:

- Allows governance depth to scale by risk level.
- Budget policy exists as a first-class setup artifact.

---

## 5. Disadvantages and production risks

### 5.1 Planned loop-engineering capabilities are incomplete

The README roadmap still marks key production loop capabilities as planned:

```text
README.md:381-386
```

Planned items:

- Harness ↔ Loop Runner Bridge.
- Pipeline State & Restart Recovery.
- Per-Agent Retry + Maker/Checker Validation.
- Goal Condition + True Pipeline Loop.
- Cost Tracking & Observability.
- Parallel Safety & Worktree Isolation.

Production impact:

- Resume/retry/goal-loop behavior may not be complete enough for autonomous production control.
- Worktree isolation for code agents is still not fully implemented per roadmap.
- Cost tracking may be observable but not fully enforceable.

---

### 5.2 Test suite currently fails

`npm test` fails due missing owner labels in stabilization issue files.

Production impact:

- Release should not proceed until test suite is green.
- CI confidence is reduced.

Affected files:

```text
stabilization-issues/001-process-simplification.md
stabilization-issues/002-contract-schema-reduction.md
stabilization-issues/003-quick-start-guide.md
stabilization-issues/004-parallel-execution-benchmark.md
stabilization-issues/005-skill-catalog-maintenance.md
```

---

### 5.3 README/test-count and readiness messaging are stale

README states an older verified branch state:

```text
README.md:439-445
```

It reports:

```text
npm test # 244 pass, 0 fail
```

Actual run showed:

```text
npm test # 312 pass, 1 fail, 313 tests total
```

Production impact:

- Documentation overstates current verified status.
- Release consumers may receive inaccurate readiness information.

---

### 5.4 Dashboard read APIs are unauthenticated

GET routes for state, artifacts, and run reports do not require a token.

Relevant code:

```text
src/observability/dashboard/server.js:375-415
```

Routes:

```js
if (url.pathname === '/api/state' && req.method === 'GET') {
  const state = await buildFullState(PROJECT_ROOT);
  sendJsonCacheable(req, res, 200, state, { hashInput: stableStringify(state) });
}
```

```js
if (url.pathname === '/api/artifact' && req.method === 'GET') {
  await handleArtifact(req, url, res);
}
```

```js
if (url.pathname === '/api/run-report' && req.method === 'GET') {
  await handleRunReport(req, url, res);
}
```

Production impact:

- Local processes or browser paths can read SDLC state.
- Potential leakage of goals, traces, artifact content, decisions, costs, security notes, and project metadata.

Recommended fix:

- Add optional/production-required `RSTACK_DASHBOARD_READ_TOKEN`.
- Enforce it on `/api/state`, `/api/artifact`, `/api/run-report`, and WebSocket snapshots.

Severity: **Critical / High for production**.

---

### 5.5 WebSocket stream has no Origin or token validation

The WebSocket upgrade path accepts connections after handshake without checking Origin or read authorization.

Relevant code:

```text
src/observability/dashboard/server.js:418-431
```

Current behavior:

```js
server.on('upgrade', async (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  if (!wsHandshake(req, socket)) return;

  clients.add(socket);
  ...
  const state = await buildFullState(PROJECT_ROOT);
  wsSend(socket, toClientState(state));
  startPolling();
});
```

Production impact:

- HTTP CORS restrictions do not protect WebSocket upgrades.
- Malicious browser pages may attempt browser-to-localhost WebSocket reads unless the server rejects foreign origins.

Recommended fix:

```js
function websocketAuthError(req) {
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return 'cross-origin websocket rejected';
  }

  const expected = process.env.RSTACK_DASHBOARD_READ_TOKEN;
  if (expected) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const token = req.headers['x-rstack-read-token'] || url.searchParams.get('token');
    if (token !== expected) return 'missing or invalid dashboard read token';
  }

  return null;
}
```

Severity: **High**.

---

### 5.6 Memory signatures use predictable fallback secret

Relevant code:

```text
src/memory/index.js:329-331
```

Current behavior:

```js
function getSigningSecret(projectSlug) {
  return process.env.RSTACK_SIGNING_KEY || `rstack-bft-secret-${projectSlug}`;
}
```

Production impact:

- If `RSTACK_SIGNING_KEY` is not set, memory signatures are derived from a predictable project slug.
- This undermines integrity claims for signed memory records.

Recommended fix:

- In production or `enterprise-webapp` mode, require `RSTACK_SIGNING_KEY`.
- For dev mode, mark signatures as development/non-authoritative.
- Avoid presenting fallback-signed memory as strong integrity evidence.

Severity: **High**.

---

### 5.7 Evidence ledger append does not use locking/atomic pattern

Relevant code:

```text
src/core/harness/evidence.js:30-40
```

Current behavior:

```js
export async function appendEvidenceEvent(runDir, event) {
  const result = validateEvidenceEvent(event);
  if (!result.ok) {
    const missing = result.issues.map((issue) => issue.name.replace('evidence_has_', '')).join(', ');
    throw new Error(`Invalid evidence event: ${missing}`);
  }

  const eventPath = join(runDir, 'evidence.jsonl');
  await mkdir(dirname(eventPath), { recursive: true });
  await appendFile(eventPath, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  return eventPath;
}
```

Production impact:

- Parallel agents could append at the same time.
- Although small append writes are often safe on many systems, this does not match the repository’s stronger `withFileLock`/atomic-write standard.
- Audit evidence should be conservative and robust.

Recommended fix:

- Use `withFileLock(eventPath, ...)` around append.
- Consider fsync for high-integrity audit logs.
- Centralize JSONL ledger append behavior.

Severity: **Medium**.

---

### 5.8 Publish workflow lacks lint and security audit gates

Publish workflow currently runs tests, validation, package dry run, and publish.

Relevant config:

```text
.github/workflows/publish.yml:29-39
```

Current behavior:

```yaml
- name: Run tests
  run: npm test

- name: Validate agents
  run: npm run validate

- name: Verify package contents
  run: npm pack --dry-run

- name: Publish to npm
  run: npm publish --access public
```

Missing before publish:

```bash
npm run lint
node scripts/security-audit.mjs
```

Production impact:

- NPM publish path is weaker than CI.
- A tag publish could skip lint and dependency security baseline.

Recommended fix:

- Add lint and security audit before `npm publish`.
- Consider SBOM/provenance/signing in release workflow.

Severity: **Medium / High for release process**.

---

### 5.9 Approval token is stored in browser localStorage

Observed code reference from scan:

```text
src/observability/dashboard/ui/client.js:1815-1822
```

Behavior:

- Approval token is read from and stored in `localStorage`.

Production impact:

- Acceptable for local-only developer tooling.
- Riskier for shared browsers, long-lived profiles, or any XSS bug in dashboard UI.

Recommended fix:

- Prefer `sessionStorage` or prompt-per-approval in production mode.
- Consider short-lived approval tokens.

Severity: **Medium**.

---

### 5.10 Cost tracking exists but is not fully enforceable yet

Observed evidence:

- Cost/tokens are represented in metrics and tests.
- README roadmap still lists cost tracking and observability as planned.
- Prior audit document notes cost fields exist but may not be consistently populated by agents.

Relevant code/examples:

```text
src/core/harness/run-state.js:45-69
src/core/harness/pipeline-state.js:203-204
src/observability/metrics/derive.js
README.md:385
```

Production impact:

- Production budget governance needs enforcement, not only reporting.
- Agent/tool cost events must be consistently emitted and budget caps must block or require approval.

Severity: **Medium**.

---

### 5.11 Worktree isolation / parallel safety incomplete

README roadmap still lists parallel safety and worktree isolation as planned.

Relevant reference:

```text
README.md:386
```

Production impact:

- Parallel code-writing agents may conflict in a shared working tree.
- Production-grade parallelism should isolate high-impact code agents in worktrees or sandboxes.

Severity: **Medium**.

---

### 5.12 `.DS_Store` files are present

Directory listing showed `.DS_Store` files in several places, including repo root and subdirectories.

Examples:

```text
.DS_Store
agents/.DS_Store
docs/.DS_Store
node_modules/.DS_Store
src/.DS_Store
```

Production impact:

- Low risk, but noisy.
- Should not be tracked or packaged.

Severity: **Low**.

---

## 6. Best-practice comparison

### 6.1 Where RStack aligns well

Against OWASP DevSecOps, CISA Secure by Design, NIST SSDF, and SLSA-style expectations, RStack aligns well in these areas:

- Defined SDLC lifecycle.
- Human approval gates.
- Evidence and audit trail concepts.
- Local dashboard and observability.
- Dependency audit script.
- Secret scanning in CI.
- Tests and validation command.
- Atomic state writes for selected state files.
- Multi-framework integration.
- Profile-based security/compliance emphasis.
- Budget and routing awareness.

### 6.2 Where RStack falls short

Production hardening gaps compared with best practice:

- Sensitive dashboard reads are not authenticated.
- WebSocket state stream lacks Origin/token validation.
- Default memory signing secret is predictable.
- Publish workflow is weaker than CI security baseline.
- Evidence JSONL append is not locked/atomic like key state files.
- Cost controls are not yet clearly enforced end-to-end.
- Retry/resume/goal-loop/worktree-isolation capabilities are still planned or incomplete.
- Documentation/readiness statements are stale relative to current validation results.
- Formal release provenance/SBOM/signing is not present in the observed workflows.

---

## 7. Consolidated severity list

### Critical / release-blocking

1. `npm test` fails due missing owner labels in five stabilization issue files.
2. Dashboard state/artifact/report read APIs are unauthenticated for production-sensitive data.

### High

3. WebSocket snapshot stream lacks Origin/token validation.
4. Memory signatures use predictable fallback secret when `RSTACK_SIGNING_KEY` is absent.
5. Publish workflow lacks security-audit/lint parity with CI.

### Medium

6. Evidence JSONL append does not use project lock/atomic pattern.
7. Approval token is stored in browser localStorage.
8. Cost tracking appears not fully enforceable end-to-end yet.
9. Parallel worktree isolation is still planned/incomplete.
10. README readiness/test-count information is stale.

### Low

11. `.DS_Store` files are present.
12. Built-in Tau web tools failed in this session; terminal workaround succeeded.

---

## 8. Recommended production hardening checklist

1. Fix missing owner labels in stabilization issue files and rerun `npm test`.
2. Add `RSTACK_DASHBOARD_READ_TOKEN` and require it for dashboard read APIs in production mode.
3. Add WebSocket Origin validation and optional/required read-token validation.
4. Require `RSTACK_SIGNING_KEY` for production/enterprise mode memory signatures.
5. Add `npm run lint` and `node scripts/security-audit.mjs` to publish workflow.
6. Use `withFileLock` or equivalent for evidence JSONL append.
7. Replace approval-token `localStorage` with safer production behavior, such as session-only storage or prompt-per-approval.
8. Complete or explicitly scope Phase 0-5 loop-engineering roadmap items.
9. Enforce budget gates, not just cost reporting.
10. Add release provenance/SBOM/signing where practical.
11. Remove `.DS_Store` files from tracked/package surfaces.
12. Update README with current test counts and honest RC/production-hardening status.

---

## 9. Code/config reference index

```text
.github/workflows/ci.yml
.github/workflows/publish.yml
README.md
scripts/security-audit.mjs
src/core/harness/evidence.js
src/core/harness/run-state.js
src/core/harness/safe-write.js
src/core/harness/stages.js
src/core/profiles.js
src/integrations/init.js
src/memory/index.js
src/observability/dashboard/server.js
src/observability/dashboard/ui/client.js
tests/validate-references.test.js
```

---

## 10. Final note

The project should be described as **production-oriented / release-candidate** until the critical and high findings are fixed. Once dashboard read protection, WebSocket validation, signing-key enforcement, release workflow parity, evidence-ledger locking, and the failing test are addressed, RStack will be much closer to production-grade SDLC governance.
