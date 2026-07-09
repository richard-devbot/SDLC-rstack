// owner: RStack developed by Richardson Gunde
//
// rstack-agents gate <name> (#256): OPT-IN quality-gate presets as host
// PreToolUse hooks. These are a SEPARATE, opinionated layer from the universal
// `rstack-agents guard` (#227) enforcement gate:
//
//   - `guard`  is ALWAYS-ON safety: destructive actions + the validator sandbox.
//   - `gate`   is OPT-IN discipline: spec-first / test-first / in-scope. Off by
//              default; a team wires the presets it wants via
//              `init --gates ...` or `.rstack/rstack.config.json` hooks.gates.
//
// The three presets, all reading a Claude Code PreToolUse tool-call JSON on
// stdin (same contract as guard — exit 0 allow, exit 2 block, stderr reason):
//
//   plan-gate  — editing a source file with NO recent spec (.spec.md changed in
//                the last N days) AND no active RStack run+plan → WARN (exit 0).
//                Non-blocking; nudges toward spec-first.
//   tdd-gate   — editing/writing PRODUCTION code (source extension, not itself a
//                test/config/migration/dto/infra/docs file) with NO corresponding
//                test file → BLOCK (exit 2). The ONLY gate that ever blocks.
//                Overridable via RSTACK_ALLOW_NO_TESTS=1 or an audited
//                `no-tests:<taskId>` / `guardrail-override:<taskId>` approval.
//   scope-guard— a modified file outside the active spec/plan's declared scope →
//                WARN (exit 0). Non-blocking; flags scope creep.
//
// Hard rules (tested):
//   - ONLY tdd-gate ever exits 2, and it is ALWAYS overridable (env or approval)
//     — never a dead-end.
//   - An unknown gate name, unclassifiable/malformed input, or ANY internal error
//     → ALLOW (exit 0). A gate that hard-errors on a hook call would get
//     uninstalled, which is worse than allowing.
//   - Fast + self-contained: bounded disk reads only, no network.

import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { resolveRunId, runDirectory } from '../core/harness/runs.js';
import { trustedApprovedArtifacts } from '../core/harness/approval-audit.js';

export const GATE_NAMES = Object.freeze(['plan-gate', 'tdd-gate', 'scope-guard']);

export const EXIT_ALLOW = 0;
export const EXIT_BLOCK = 2;

/** Env override for tdd-gate — mirrors guard's RSTACK_ALLOW_DESTRUCTIVE escape. */
export const TDD_OVERRIDE_ENV = 'RSTACK_ALLOW_NO_TESTS';

/** Env a host sets so tdd-gate can resolve an approval keyed on the active task. */
export const GATE_TASK_ENV = 'RSTACK_TASK_ID';

// Source-code extensions the gates care about (mirrors the reference .sh set).
const SOURCE_EXTENSIONS = new Set([
  'cs', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'rb', 'php',
  'java', 'kt', 'swift', 'dart', 'vb', 'cbl', 'scala', 'ex', 'exs', 'c', 'cc',
  'cpp', 'h', 'hpp', 'm', 'mm',
]);

// How recent a .spec.md must be to count as an "active" spec (plan-gate).
const SPEC_FRESH_DAYS = 14;
// How recent a .spec.md must be to be the "active" scope declaration (scope-guard).
const SCOPE_SPEC_FRESH_MINUTES = 60;
// Bounded directory walk depth so a gate never crawls a huge tree.
const MAX_WALK_DEPTH = 6;
// Directory names never worth walking (perf + noise).
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.rstack', 'vendor', '.next', 'out']);

/** Extract the write/edit target file path from a parsed tool call, or null. */
export function targetFilePath(toolName, input) {
  const name = String(toolName ?? '').toLowerCase();
  // Only Edit / MultiEdit / Write carry a file target we gate on.
  if (!(name === 'edit' || name === 'multiedit' || name === 'write')) return null;
  const path = input?.file_path ?? input?.filePath ?? input?.path;
  return typeof path === 'string' && path.trim() ? path.trim() : null;
}

/**
 * Parse a Claude Code PreToolUse (or Pi-style) tool-call payload into
 * { toolName, input }. Returns { ok:false } when there is nothing classifiable
 * (so the caller fails OPEN). Never throws.
 */
export function parseGateInput(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: false, toolName: null, input: null };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const toolName = typeof parsed.tool_name === 'string' ? parsed.tool_name
        : typeof parsed.toolName === 'string' ? parsed.toolName
          : typeof parsed.tool === 'string' ? parsed.tool : null;
      const input = parsed.tool_input && typeof parsed.tool_input === 'object' ? parsed.tool_input
        : parsed.input && typeof parsed.input === 'object' ? parsed.input : {};
      return { ok: true, toolName, input };
    }
    return { ok: false, toolName: null, input: null };
  } catch {
    return { ok: false, toolName: null, input: null };
  }
}

/** Is this path a source-code file we consider "code" (by extension)? */
export function isSourceFile(filePath) {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  return SOURCE_EXTENSIONS.has(ext);
}

/**
 * Is this a PRODUCTION source file tdd-gate should gate — i.e. a source file
 * that is NOT itself a test, config, migration, dto, infra, or docs file?
 * Ports the reference tdd-gate.sh skip patterns to precise, suffix-based JS
 * checks (substring matching caused false skips in the .sh; we avoid that).
 * Returns { production:boolean, reason:string }.
 */
export function classifyProductionCode(filePath) {
  if (!isSourceFile(filePath)) {
    return { production: false, reason: `not a source-code extension (${extname(filePath) || 'none'})` };
  }
  const name = basename(filePath);
  const lowerPath = filePath.toLowerCase();

  // --- test files (suffix-based, never substring) --------------------------
  // Covers: foo.test.ts, foo.spec.ts, foo.tests.js  (dot-separated)
  //         foo_test.go, bar_spec.rb                (underscore-separated)
  //         FooTest.cs, FooTests.java, BarSpec.kt   (CamelCase suffix)
  //         test_foo.py, spec_foo.rb                (prefix)
  if (/[._](?:test|tests|spec|specs)\.[^.]+$/i.test(name)  // .test./.spec./_test./_spec.
    || /(?:Test|Tests|Spec|Specs)\.[^.]+$/.test(name)      // CamelCase FooTest.cs
    || /\.cy\.[^.]+$/i.test(name)                          // Cypress foo.cy.ts
    || /^(?:test|spec)_/i.test(name)) {                    // test_foo.py / spec_foo.rb
    return { production: false, reason: 'test file (skip)' };
  }

  // --- config / infra / migration / dto / docs (skip) ----------------------
  if (/\.dto\.[^.]+$/i.test(name) || /dto\.[^.]+$/i.test(name) || /DTO/.test(name)) {
    return { production: false, reason: 'DTO file (skip)' };
  }
  // migration / migrate_0001 / CreateUsersMigration — both spellings.
  if (/migration/i.test(name) || /(?:^|[._-])migrate[._-]/i.test(name)) {
    return { production: false, reason: 'migration file (skip)' };
  }
  if (/\.config\.[^.]+$/i.test(name) || /\.d\.ts$/i.test(name)
    || /^tsconfig/i.test(name) || /^(?:program|startup)\./i.test(name)
    || /^appsettings/i.test(name)) {
    return { production: false, reason: 'config/type-declaration file (skip)' };
  }
  // Python packaging / package markers / test-config that carry no unit-testable
  // behavior, and Storybook stories (docs/examples). These have no matching test
  // by design — the docs promise they're skipped, so the code must too. (#259 review)
  if (/^__init__\.py$/i.test(name) || /^conftest\.py$/i.test(name)
    || /^setup\.py$/i.test(name) || /^pyproject\.toml$/i.test(name)
    || /^setup\.cfg$/i.test(name) || /\.stories\.[^.]+$/i.test(name)) {
    return { production: false, reason: 'package marker / story / test-config file (skip)' };
  }
  // Type-only / barrel modules carry no behavior to unit-test — skipping them
  // avoids the most common tdd-gate false blocks (a `types.ts` or an `index.ts`
  // re-export). A real logic file simply must not be named exactly these.
  if (/^index\.[^.]+$/i.test(name) || /^types\.[^.]+$/i.test(name) || /\.types\.[^.]+$/i.test(name)) {
    return { production: false, reason: 'barrel/type-only module (skip)' };
  }

  // --- path-based skips (test/spec/fixture/migration/config/script dirs) ----
  if (/(?:^|\/)(?:tests?|specs?|__tests__|fixtures?|mocks?|stubs?|fakes?|migrations?|seeds?|__mocks__)(?:\/|$)/i.test(lowerPath)) {
    return { production: false, reason: 'file under a test/fixture/migration directory (skip)' };
  }
  if (/(?:^|\/)(?:config|scripts?)(?:\/)/i.test(lowerPath)) {
    return { production: false, reason: 'file under a config/scripts directory (skip)' };
  }
  // Infra-as-code that happens to share a source extension is rare, but guard it.
  if (/(?:^|\/)(?:infra|infrastructure|deploy|deployments?)(?:\/)/i.test(lowerPath)) {
    return { production: false, reason: 'file under an infra/deploy directory (skip)' };
  }
  return { production: true, reason: 'production source file' };
}

/**
 * Candidate test-file basenames for a production file `Foo.ext`. Mirrors the
 * reference's find patterns: FooTest.*, FooTests.*, Foo.test.*, Foo.spec.*,
 * Foo_test.*, test_Foo.*.
 */
export function testFileCandidates(fileName) {
  const ext = extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  return { stem };
}

/** Does `candidate` look like a test for production stem `stem`? Case-tolerant. */
export function matchesTestForStem(candidate, stem) {
  const lc = candidate.toLowerCase();
  const s = stem.toLowerCase();
  if (lc === `${s}test${extLower(candidate)}`
    || lc === `${s}tests${extLower(candidate)}`
    || lc === `${s}.test${extLower(candidate)}`
    || lc === `${s}.spec${extLower(candidate)}`
    || lc === `${s}_test${extLower(candidate)}`
    || lc === `${s}spec${extLower(candidate)}`
    || lc === `test_${s}${extLower(candidate)}`
    || lc === `spec_${s}${extLower(candidate)}`) {
    return true;
  }
  // Separator-normalized fallback (#259 review): the exact patterns miss tests
  // that name the SAME stem with a different separator — `get-user.spec.ts` for
  // `get_user`, `getUser.test.ts` for `get_user`. Strip separators + the
  // test/spec marker and compare for EQUALITY (not substring — `foobar.test` is
  // NOT a test for `foo`, and `user-profile.test` is a different module's test).
  // Min 3 chars avoids trivial equality. Bias stays conservative: only true
  // same-stem separator variants match.
  const norm = (x) => x.replace(/[^a-z0-9]/g, '');
  const isTestShaped = /(?:[._-](?:test|tests|spec|specs)\.|(?:test|tests|spec|specs)\.|^(?:test|spec)[._-]|\.cy\.)/i.test(lc);
  if (!isTestShaped) return false;
  const stemN = norm(s);
  if (stemN.length < 3) return false;
  const coreN = norm(
    lc.slice(0, lc.length - extLower(candidate).length)
      .replace(/(?:^|[._-])(?:test|tests|spec|specs)(?:[._-]|$)/gi, '')
      .replace(/\.cy$/i, ''),
  );
  return coreN === stemN;
}

function extLower(name) {
  return extname(name).toLowerCase();
}

/**
 * Search bounded directories for a test file matching production `stem`. Checks
 * the file's own directory + nearby test dirs first, then a bounded project-wide
 * walk. Returns the first matching absolute path or null. Never throws.
 */
export async function findTestFile(projectRoot, filePath, stem) {
  const fileDir = dirname(resolve(projectRoot, filePath));
  const nearby = [
    fileDir,
    join(fileDir, '__tests__'),
    join(fileDir, 'tests'),
    join(fileDir, 'test'),
    join(dirname(fileDir), 'test'),
    join(dirname(fileDir), 'tests'),
    join(dirname(fileDir), '__tests__'),
  ];
  for (const dir of nearby) {
    const hit = await scanDirForTest(dir, stem);
    if (hit) return hit;
  }
  // Bounded project-wide walk as a fallback.
  return walkForTest(resolve(projectRoot), stem, 0);
}

async function scanDirForTest(dir, stem) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && matchesTestForStem(entry.name, stem)) return join(dir, entry.name);
  }
  return null;
}

async function walkForTest(dir, stem, depth) {
  if (depth > MAX_WALK_DEPTH) return null;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const subdirs = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      if (matchesTestForStem(entry.name, stem)) return join(dir, entry.name);
    } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
      subdirs.push(join(dir, entry.name));
    }
  }
  for (const sub of subdirs) {
    const hit = await walkForTest(sub, stem, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Does the project have an active RStack run WITH a plan.md? Best-effort. */
async function hasActiveRunPlan(projectRoot, runId, env) {
  try {
    const selected = await resolveRunId(projectRoot, runId ?? env.RSTACK_RUN_ID);
    return existsSync(join(runDirectory(projectRoot, selected), 'plan.md'));
  } catch {
    return false;
  }
}

/** Find a .spec.md modified within `days` days, bounded walk. Best-effort. */
async function findRecentSpec(projectRoot, maxAgeMs, now = Date.now()) {
  let newest = null; // { path, mtimeMs }
  async function walk(dir, depth) {
    if (depth > MAX_WALK_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.spec.md')) {
        try {
          const st = await stat(full);
          if (now - st.mtimeMs <= maxAgeMs && (!newest || st.mtimeMs > newest.mtimeMs)) {
            newest = { path: full, mtimeMs: st.mtimeMs };
          }
        } catch { /* ignore unreadable */ }
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(resolve(projectRoot), 0);
  return newest;
}

/**
 * Extract declared file paths from a spec's "Files to create/modify" section.
 * Ports scope-guard.sh's extraction (English + Spanish headers), bounded.
 * Returns an array of declared path fragments (lowercased for suffix matching).
 */
export function extractDeclaredFiles(specText) {
  const lines = String(specText ?? '').split(/\r?\n/);
  const declared = new Set();
  let inSection = false;
  const headerRe = /files?\s+to\s+(create|modify|change|touch)|ficheros|archivos/i;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      // A new heading — enter the section if it names files, else leave it.
      inSection = headerRe.test(line);
      continue;
    }
    if (headerRe.test(line)) inSection = true;
    if (!inSection) continue;
    // Match path-like tokens: a/b/c.ext (require a slash OR a known extension).
    const matches = line.match(/[A-Za-z0-9_./@-]+\.[A-Za-z0-9]{1,8}/g) ?? [];
    for (const m of matches) declared.add(m.toLowerCase());
  }
  return [...declared];
}

/** Is `filePath` in scope per the declared list? Suffix/exact match, path-normalized. */
export function isInDeclaredScope(filePath, declared) {
  const fp = filePath.replace(/\\/g, '/').toLowerCase();
  const base = basename(fp);
  for (const decl of declared) {
    const d = decl.replace(/\\/g, '/');
    if (fp === d || fp.endsWith(`/${d}`) || base === basename(d)) return true;
  }
  return false;
}

// Files/paths that are always legitimate outside a spec's scope (scope-guard).
function isAlwaysInScope(filePath) {
  const base = basename(filePath).toLowerCase();
  const lp = filePath.toLowerCase();
  if (/\.spec\.md$/.test(base) || /\.(md|json|ya?ml|lock)$/.test(base)) return true;
  if (base === '.gitignore' || base === 'dockerfile' || base.startsWith('docker-compose') || base === 'package.json') return true;
  if (/(?:^|\/)(?:tests?|__tests__)(?:\/)/.test(lp)) return true;
  // test files by name
  const prod = classifyProductionCode(filePath);
  if (!prod.production && isSourceFile(filePath)) return true;
  return false;
}

// --- gate evaluators --------------------------------------------------------

/**
 * Run a single gate. Returns { decision:'allow'|'block', exitCode, reason,
 * gate, warnings[] } and NEVER throws. Only tdd-gate can return a 'block'.
 */
export async function runGate(gateName, {
  stdinText = '', project, runId, task, env = process.env, cwd = process.cwd(),
} = {}) {
  const gate = String(gateName ?? '').trim().toLowerCase();
  const warnings = [];
  const allow = (reason) => ({ decision: 'allow', exitCode: EXIT_ALLOW, reason, gate, warnings });
  const block = (reason) => ({ decision: 'block', exitCode: EXIT_BLOCK, reason, gate, warnings });

  // Unknown gate name → allow (never crash / dead-end).
  if (!GATE_NAMES.includes(gate)) {
    warnings.push(`unknown gate '${gateName}' — allowing (known gates: ${GATE_NAMES.join(', ')})`);
    return allow('unknown gate name');
  }

  const parsed = parseGateInput(stdinText);
  if (!parsed.ok) {
    warnings.push('no classifiable tool call on stdin — allowing');
    return allow('unclassifiable input');
  }

  const filePath = targetFilePath(parsed.toolName, parsed.input);
  // No file target (e.g. Bash) → these gates don't apply. Allow.
  if (!filePath) return allow(`gate ${gate} does not apply to '${parsed.toolName ?? 'unknown'}'`);

  const projectRoot = resolve(project ?? env.RSTACK_PROJECT_ROOT ?? cwd);

  try {
    if (gate === 'tdd-gate') return await evalTddGate({ filePath, projectRoot, runId, task, env, allow, block, warnings });
    if (gate === 'plan-gate') return await evalPlanGate({ filePath, projectRoot, runId, env, allow, warnings });
    if (gate === 'scope-guard') return await evalScopeGuard({ filePath, projectRoot, allow, warnings });
  } catch (error) {
    // ANY internal failure → allow (a gate must never dead-end a session).
    warnings.push(`gate ${gate} internal error (allowing): ${error?.message ?? error}`);
    return allow(`internal error (allowed): ${error?.message ?? error}`);
  }
  return allow('no-op');
}

async function evalTddGate({ filePath, projectRoot, runId, task, env, allow, block, warnings }) {
  const cls = classifyProductionCode(filePath);
  if (!cls.production) return allow(`tdd-gate: ${cls.reason}`);

  const { stem } = testFileCandidates(basename(filePath));
  const found = await findTestFile(projectRoot, filePath, stem);
  if (found) return allow(`tdd-gate: test present (${basename(found)})`);

  // No test → this WOULD block. Check overrides FIRST (never a dead-end).
  if (env[TDD_OVERRIDE_ENV] === '1') {
    warnings.push(`${TDD_OVERRIDE_ENV}=1 override — allowing production edit without a test`);
    return allow(`tdd-gate: ${TDD_OVERRIDE_ENV}=1 override`);
  }

  // Approval override: an audited `no-tests:<taskId>` (or guardrail-override) record.
  const taskId = task ?? env[GATE_TASK_ENV];
  if (taskId) {
    const approved = await tddApprovalGranted(projectRoot, runId ?? env.RSTACK_RUN_ID, taskId);
    if (approved) {
      warnings.push(`approved '${approved}' override — allowing production edit without a test`);
      return allow(`tdd-gate: approved override (${approved})`);
    }
  }

  const stemName = basename(filePath);
  const ext = extname(filePath).replace(/^\./, '');
  return block(
    `TDD GATE: no test found for '${stemName}'. Write the test FIRST, then the implementation. `
    + `Create e.g. ${stem}.test.${ext} or ${stem}Test.${ext} (or test_${stem}.${ext}). `
    + `To override for this call: set ${TDD_OVERRIDE_ENV}=1, or approve 'no-tests:${taskId ?? '<taskId>'}' `
    + `(set ${GATE_TASK_ENV} / pass --task) via sdlc_approve or the Business Hub.`,
  );
}

/** True (returns the approved artifact name) if a tdd override approval exists. */
async function tddApprovalGranted(projectRoot, runId, taskId) {
  try {
    const selected = await resolveRunId(projectRoot, runId);
    let approvals = [];
    try {
      const parsed = JSON.parse(await readFile(join(runDirectory(projectRoot, selected), 'approvals.json'), 'utf8'));
      if (Array.isArray(parsed)) approvals = parsed;
    } catch {
      return null;
    }
    // Accept either a purpose-built `no-tests:<taskId>` approval or the generic
    // one-shot `guardrail-override:<taskId>` — both audited through the SAME
    // trust path as #133 (trustedApprovedArtifacts: run-bound, replay-rejected,
    // append-only ordering, malformed-latest poisons the artifact).
    const trusted = trustedApprovedArtifacts(approvals, { expectedRunId: selected });
    for (const artifact of [`no-tests:${taskId}`, `guardrail-override:${taskId}`]) {
      if (trusted.has(artifact)) return artifact;
    }
    return null;
  } catch {
    return null;
  }
}

async function evalPlanGate({ filePath, projectRoot, runId, env, allow, warnings }) {
  if (!isSourceFile(filePath)) return allow(`plan-gate: not a source file (${extname(filePath) || 'none'})`);

  const recentSpec = await findRecentSpec(projectRoot, SPEC_FRESH_DAYS * 24 * 60 * 60 * 1000);
  if (recentSpec) return allow(`plan-gate: recent spec present (${basename(recentSpec.path)})`);

  const activePlan = await hasActiveRunPlan(projectRoot, runId, env);
  if (activePlan) return allow('plan-gate: active RStack run+plan present');

  // Non-blocking warning (exit 0).
  warnings.push(
    `PLAN GATE: editing '${basename(filePath)}' with no recent spec (.spec.md modified in the last ${SPEC_FRESH_DAYS} days) `
    + 'and no active RStack run+plan. Consider writing a spec / starting a governed run before implementing. '
    + '(Warning only — does not block.)',
  );
  return allow('plan-gate: warned (no recent spec / no active plan)');
}

async function evalScopeGuard({ filePath, projectRoot, allow, warnings }) {
  const activeSpec = await findRecentSpec(projectRoot, SCOPE_SPEC_FRESH_MINUTES * 60 * 1000);
  if (!activeSpec) return allow('scope-guard: no active spec (<60m) to verify scope against');

  let declared;
  try {
    declared = extractDeclaredFiles(await readFile(activeSpec.path, 'utf8'));
  } catch {
    return allow('scope-guard: active spec unreadable');
  }
  if (declared.length === 0) return allow('scope-guard: active spec declares no files');

  if (isAlwaysInScope(filePath) || isInDeclaredScope(filePath, declared)) {
    return allow('scope-guard: file is in scope');
  }

  // Out of scope → non-blocking warning (exit 0).
  warnings.push(
    `SCOPE GUARD: '${filePath}' is modified OUTSIDE the scope declared by the active spec `
    + `(${basename(activeSpec.path)}). Review whether this change is intentional or scope creep. `
    + '(Warning only — does not block.)',
  );
  return allow('scope-guard: warned (out of declared scope)');
}

/** Read the hook payload from stdin (capped); empty string when stdin is a TTY. */
const MAX_STDIN_BYTES = 1_000_000;
export async function readStdinText(stream = process.stdin) {
  if (stream.isTTY) return '';
  let data = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) {
    data += chunk;
    if (data.length >= MAX_STDIN_BYTES) return data.slice(0, MAX_STDIN_BYTES);
  }
  return data;
}

/**
 * CLI wrapper: prints a single-line verdict JSON on stdout, warnings + a block
 * reason on stderr, returns the exit code. NEVER throws.
 */
export async function runGateCommand(gateName, opts = {}, { stdinText = '', env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const result = await runGate(gateName, {
    stdinText, project: opts.project, runId: opts.runId, task: opts.task, env, cwd,
  });
  for (const warning of result.warnings) stderr.write(`[rstack gate:${result.gate || gateName}] ${warning}\n`);
  stdout.write(`${JSON.stringify({ decision: result.decision, gate: result.gate, reason: result.reason })}\n`);
  if (result.exitCode === EXIT_BLOCK) stderr.write(`[rstack gate:${result.gate}] BLOCKED: ${result.reason}\n`);
  return result.exitCode;
}
