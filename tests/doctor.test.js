// owner: RStack developed by Richardson Gunde
//
// Tests for `rstack-agents doctor` (#244) — the setup verifier. The hero check
// is exercised through the REAL guard CLI (spawned by doctor), so a PASS here
// is a PASS in production. Every case asserts doctor never crashes on a partial
// setup: problems are FAIL/WARN checks carrying a fix, not exceptions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

// Hermetic env: strip every RStack knob that could change guard/doctor behavior.
function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['RSTACK_ALLOW_DESTRUCTIVE', 'RSTACK_TASK_ID', 'RSTACK_AGENT_CONTEXT', 'RSTACK_VALIDATOR_CONTEXT', 'RSTACK_STATE_DIR', 'RSTACK_BUSINESS_PORT']) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function runDoctor(args, { cwd, env = {} } = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [BIN, 'doctor', ...args], {
      cwd: cwd ?? tmpdir(),
      env: cleanEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', rejectP);
    child.on('close', (code) => resolveP({
      code, stdout, stderr,
      json: (() => { try { return JSON.parse(stdout); } catch { return null; } })(),
    }));
  });
}

function checkByName(report, name) {
  return report.checks.find((c) => c.name === name);
}

// A minimal, valid .rstack/ so the state + config checks pass without running
// full init (which would register the project in the global registry).
function seedRstack(root) {
  const stateDir = join(root, '.rstack');
  mkdirSync(join(stateDir, 'runs'), { recursive: true });
  writeFileSync(join(stateDir, 'rstack.config.json'), JSON.stringify({ profile: 'business-flex' }, null, 2));
  return stateDir;
}

test('doctor', async (t) => {
  await t.test('a .rstack dir passes the env + guard self-test and JSON shape is well-formed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-ok-'));
    seedRstack(root);
    // Point the run at a framework whose wiring cannot pass here so we assert on
    // the checks we control; the guard self-test PASS is the hero assertion.
    const { code, json } = await runDoctor(['--framework', 'custom', '--project', root, '--json'], { cwd: root });

    assert.ok(json, 'doctor --json emitted parseable JSON');
    // Shape.
    assert.equal(json.framework, 'custom');
    assert.ok(Array.isArray(json.checks));
    assert.ok(json.summary && typeof json.summary.pass === 'number' && typeof json.summary.fail === 'number' && typeof json.summary.warn === 'number');
    assert.ok(typeof json.exitCode === 'number');
    for (const c of json.checks) {
      assert.ok(typeof c.name === 'string' && c.name.length > 0);
      assert.ok(['PASS', 'FAIL', 'WARN'].includes(c.status));
      assert.ok(typeof c.detail === 'string');
      assert.ok(Object.prototype.hasOwnProperty.call(c, 'fix'));
    }

    // Env checks pass.
    assert.equal(checkByName(json, 'node version').status, 'PASS');
    assert.equal(checkByName(json, '.rstack present').status, 'PASS');
    assert.equal(checkByName(json, 'config validation').status, 'PASS');

    // Hero check: the real guard blocked a destructive call and allowed a safe
    // one — enforcement is live.
    const guard = checkByName(json, 'guard self-test (enforcement live)');
    assert.equal(guard.status, 'PASS', `guard self-test should PASS; got: ${guard.detail}`);

    // Exit code reflects the summary: 1 iff any FAIL.
    assert.equal(code === 1, json.summary.fail > 0);

    rmSync(root, { recursive: true, force: true });
  });

  await t.test('missing .rstack yields the init FAIL with the exact fix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-noinit-'));
    const { code, json } = await runDoctor(['--framework', 'custom', '--project', root, '--json'], { cwd: root });

    const dirCheck = checkByName(json, '.rstack present');
    assert.equal(dirCheck.status, 'FAIL');
    assert.equal(dirCheck.fix, 'rstack-agents init');
    assert.ok(json.summary.fail >= 1);
    assert.equal(code, 1, 'any FAIL means exit 1');

    rmSync(root, { recursive: true, force: true });
  });

  await t.test('claude-code missing PreToolUse hook FAILs with a paste-in snippet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-cc-'));
    seedRstack(root);
    // .claude/ exists but no settings.json — the wiring check must FAIL loudly.
    mkdirSync(join(root, '.claude'), { recursive: true });
    const { json } = await runDoctor(['--framework', 'claude-code', '--project', root, '--json'], { cwd: root });

    const hook = checkByName(json, 'claude-code PreToolUse guard hook');
    assert.equal(hook.status, 'FAIL');
    assert.ok(hook.fix.includes('rstack-agents guard'), 'fix names the guard hook');
    assert.ok(hook.fix.includes('PreToolUse'), 'fix names the PreToolUse snippet');

    // Observability (#251): with no settings.json, the observe check is absent
    // (the guard-hook FAIL short-circuits the wiring probe). No crash is the bar.
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('claude-code with only a guard hook: guard PASSes, observe WARNs (additive)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-ccok-'));
    seedRstack(root);
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'npx --yes rstack-agents guard --context builder' }] }] },
    }));
    const { json } = await runDoctor(['--framework', 'claude-code', '--project', root, '--json'], { cwd: root });

    assert.equal(checkByName(json, 'claude-code PreToolUse guard hook').status, 'PASS');
    // Observe hook missing → WARN (never FAIL — observability is additive).
    const observe = checkByName(json, 'claude-code observability hook');
    assert.equal(observe.status, 'WARN');
    assert.ok(observe.fix.includes('rstack-agents observe'), 'fix names the observe hook');
    assert.ok(observe.fix.includes('PostToolUse'), 'fix names the PostToolUse snippet');
    // Context + notification hooks also missing → WARN (additive too). (#255)
    const context = checkByName(json, 'claude-code context hook');
    assert.equal(context.status, 'WARN');
    assert.ok(context.fix.includes('rstack-agents context'), 'fix names the context hook');
    const notify = checkByName(json, 'claude-code notification hook');
    assert.equal(notify.status, 'WARN');
    assert.ok(notify.fix.includes('notify-hook') || notify.fix.includes('init'), 'fix names the notify hook / init');

    rmSync(root, { recursive: true, force: true });
  });

  await t.test('claude-code full hook set (#255): guard PASS + observe/context/notification PASS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-full-'));
    seedRstack(root);
    mkdirSync(join(root, '.claude'), { recursive: true });
    // The exact shape init installs.
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
      statusLine: { type: 'command', command: 'npx --yes rstack-agents statusline --source claude-code' },
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'npx -y rstack-agents hub' }] },
          { hooks: [{ type: 'command', command: 'npx --yes rstack-agents context --source claude-code' }] },
        ],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'npx --yes rstack-agents context --source claude-code' }] }],
        PreToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'npx --yes rstack-agents guard --context builder' }] }],
        PostToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'npx --yes rstack-agents observe --source claude-code' }] }],
        Notification: [{ hooks: [{ type: 'command', command: 'npx --yes rstack-agents notify-hook --source claude-code' }] }],
      },
    }));
    const { json } = await runDoctor(['--framework', 'claude-code', '--project', root, '--json'], { cwd: root });
    assert.equal(checkByName(json, 'claude-code PreToolUse guard hook').status, 'PASS');
    assert.equal(checkByName(json, 'claude-code observability hook').status, 'PASS');
    assert.equal(checkByName(json, 'claude-code context hook').status, 'PASS');
    assert.equal(checkByName(json, 'claude-code notification hook').status, 'PASS');
    // Status line (#257): wired → informational PASS naming the statusline command.
    const statusline = checkByName(json, 'claude-code status line');
    assert.equal(statusline.status, 'PASS');
    assert.match(statusline.detail, /statusLine|rstack-agents statusline/);
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('status line (#257): missing statusLine key is still PASS (optional, display-only)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-nostatusline-'));
    seedRstack(root);
    mkdirSync(join(root, '.claude'), { recursive: true });
    // Guard wired, but NO statusLine key.
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'npx --yes rstack-agents guard --context builder' }] }],
      },
    }));
    const { json, code } = await runDoctor(['--framework', 'claude-code', '--project', root, '--json'], { cwd: root });
    const statusline = checkByName(json, 'claude-code status line');
    assert.equal(statusline.status, 'PASS', 'status line is informational — never FAIL/WARN');
    assert.match(statusline.detail, /no statusLine|init --framework claude-code/i);
    assert.notEqual(code, 1, 'a missing status line never fails doctor');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('quality gates (#256): doctor reports wired gates (PASS, informational)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-gates-'));
    seedRstack(root);
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'npx --yes rstack-agents guard --context builder' }] },
          { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'npx --yes rstack-agents gate tdd-gate' }] },
        ],
      },
    }));
    const { json, code } = await runDoctor(['--framework', 'claude-code', '--project', root, '--json'], { cwd: root });
    const gates = checkByName(json, 'claude-code quality gates');
    assert.equal(gates.status, 'PASS', 'gates check is informational PASS, never FAIL');
    assert.match(gates.detail, /tdd-gate/);
    // Gates are opt-in — their absence must never fail doctor.
    assert.notEqual(code, 1, 'wired gates do not fail doctor');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('quality gates (#256): no gates wired is still PASS (opt-in)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-nogates-'));
    seedRstack(root);
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'npx --yes rstack-agents guard --context builder' }] }],
      },
    }));
    const { json } = await runDoctor(['--framework', 'claude-code', '--project', root, '--json'], { cwd: root });
    const gates = checkByName(json, 'claude-code quality gates');
    assert.equal(gates.status, 'PASS');
    assert.match(gates.detail, /no opt-in quality gates|--gates/i);
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('claude-code with guard + observe hooks: both PASS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-ccobs-'));
    seedRstack(root);
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'npx --yes rstack-agents guard --context builder' }] }],
        PostToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'npx --yes rstack-agents observe --source claude-code' }] }],
      },
    }));
    const { json } = await runDoctor(['--framework', 'claude-code', '--project', root, '--json'], { cwd: root });

    assert.equal(checkByName(json, 'claude-code PreToolUse guard hook').status, 'PASS');
    assert.equal(checkByName(json, 'claude-code observability hook').status, 'PASS');

    rmSync(root, { recursive: true, force: true });
  });

  await t.test('claude-code plugin/marketplace presence (#388): package-shipped manifests PASS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-plugin-'));
    seedRstack(root);
    const { json } = await runDoctor(['--framework', 'claude-code', '--project', root, '--json'], { cwd: root });

    assert.equal(checkByName(json, 'claude-code marketplace manifest').status, 'PASS');
    assert.equal(checkByName(json, 'claude-code sdlc-rstack plugin').status, 'PASS');
    assert.equal(checkByName(json, 'claude-code marketplace lists sdlc-rstack').status, 'PASS');

    rmSync(root, { recursive: true, force: true });
  });

  await t.test('tau adapter (shipped) PASSes and never crashes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-tau-'));
    seedRstack(root);
    const { json } = await runDoctor(['--framework', 'tau', '--project', root, '--json'], { cwd: root });

    assert.ok(json, 'doctor produced parseable JSON (did not crash) for the tau framework');
    // Tau ships as a first-class adapter (#243), so presence resolves to PASS.
    const adapter = checkByName(json, 'tau adapter present');
    assert.equal(adapter.status, 'PASS');
    assert.ok(adapter.detail.includes('tau'), 'detail names the tau adapter path');
    // The shared bridge resolves too.
    assert.equal(checkByName(json, 'bridge reachable').status, 'PASS');
    // Observability (#251): the shipped tau adapter emits observe events.
    assert.equal(checkByName(json, 'tau observability hook').status, 'PASS');
    // Context injection (#255): the shipped tau adapter injects context on before_agent_start.
    assert.equal(checkByName(json, 'tau context hook').status, 'PASS');

    rmSync(root, { recursive: true, force: true });
  });

  await t.test('self-dependency fixture triggers the tripwire WARN with a fix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-selfdep-'));
    seedRstack(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'rstack-agents',
      version: '9.9.9',
      dependencies: { 'rstack-agents': '^2.0.0' },
    }));
    // cwd must be the fixture — the tripwire reads cwd's package.json.
    const { json } = await runDoctor(['--framework', 'custom', '--project', root, '--json'], { cwd: root });

    const tripwire = checkByName(json, 'self-dependency tripwire');
    assert.equal(tripwire.status, 'WARN');
    assert.ok(/self-dependency/i.test(tripwire.detail));
    assert.ok(tripwire.fix && tripwire.fix.length > 0, 'tripwire carries a fix');
    // A WARN alone must NOT fail the run (unless another check FAILs).

    rmSync(root, { recursive: true, force: true });
  });

  await t.test('an unknown --framework is rejected cleanly (exit 1, no stack trace)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-badfw-'));
    seedRstack(root);
    const { code, stderr, stdout } = await runDoctor(['--framework', 'nope', '--project', root], { cwd: root });
    assert.equal(code, 1);
    assert.ok(/Unknown framework/.test(stderr + stdout));
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('WARN alone does not fail: a fully wired setup with only WARNs exits 0', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-warnonly-'));
    seedRstack(root);
    // custom framework: only requirement is the guard binary (always present in
    // this repo checkout). No package.json in cwd → tripwire PASS. The only
    // likely WARN is "package resolvable" (rstack-agents not installed in the
    // scratch dir). Assert: if there are zero FAILs, exit is 0.
    const { code, json } = await runDoctor(['--framework', 'custom', '--project', root, '--json'], { cwd: root });
    if (json.summary.fail === 0) {
      assert.equal(code, 0, 'no FAIL checks → exit 0 even with WARNs');
    }
    rmSync(root, { recursive: true, force: true });
  });
});
