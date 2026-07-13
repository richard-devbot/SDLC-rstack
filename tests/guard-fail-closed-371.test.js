// owner: RStack developed by Richardson Gunde
//
// #371: the enforcement guard must FAIL CLOSED when it cannot RUN, instead of
// letting "any exit != 2" read as allow. A governance guard that silently
// vanishes on an install hiccup / cold-npx miss / crash is a trust hole. These
// tests pin the policy (default block, opt-in allow) and that `doctor` surfaces
// how the guard resolves.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { guardFailOpen, guardUnavailableVerdict, GUARD_FAIL_OPEN_ENV } from '../src/commands/guard.js';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

test('guardFailOpen: default is fail-CLOSED (false); only "1" opts into fail-open', () => {
  assert.equal(guardFailOpen({}), false);
  assert.equal(guardFailOpen({ [GUARD_FAIL_OPEN_ENV]: '1' }), true);
  assert.equal(guardFailOpen({ [GUARD_FAIL_OPEN_ENV]: 'true' }), false, 'only the literal "1" flips it');
  assert.equal(guardFailOpen({ [GUARD_FAIL_OPEN_ENV]: '0' }), false);
});

test('guardUnavailableVerdict: default fails CLOSED (block, exit 2)', () => {
  const { verdict, exitCode } = guardUnavailableVerdict('module load error', {});
  assert.equal(verdict.decision, 'block');
  assert.equal(exitCode, 2);
  assert.equal(verdict.category, 'guard-unavailable');
  assert.match(verdict.reason, /failing closed/i);
  assert.match(verdict.reason, /module load error/);
});

test('guardUnavailableVerdict: RSTACK_GUARD_FAIL_OPEN=1 restores allow (exit 0), still labeled', () => {
  const { verdict, exitCode } = guardUnavailableVerdict('cold npx miss', { [GUARD_FAIL_OPEN_ENV]: '1' });
  assert.equal(verdict.decision, 'allow');
  assert.equal(exitCode, 0);
  assert.equal(verdict.category, 'guard-unavailable');
  assert.match(verdict.reason, /without enforcement/i);
});

// A guard-unavailable verdict must NEVER read as a clean allow: the category is
// always 'guard-unavailable' so a host/dashboard can tell "guard chose allow"
// from "guard could not run and we allowed anyway".
test('guardUnavailableVerdict is always distinguishable from a real allow decision', () => {
  const open = guardUnavailableVerdict('x', { [GUARD_FAIL_OPEN_ENV]: '1' }).verdict;
  const closed = guardUnavailableVerdict('x', {}).verdict;
  assert.equal(open.category, 'guard-unavailable');
  assert.equal(closed.category, 'guard-unavailable');
});

test('doctor surfaces a "guard resolution" check (how the guard resolves / needs network)', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'rstack-doctor-371-'));
  const json = await runDoctorJson(cwd);
  const guardRes = json.checks.find((c) => c.name === 'guard resolution');
  assert.ok(guardRes, 'doctor must report a guard resolution check');
  assert.ok(['PASS', 'WARN', 'FAIL'].includes(guardRes.status));
  // Whatever the environment, the check explains the fail-closed consequence or
  // the npx/network dependency — never silent.
  assert.ok(typeof guardRes.detail === 'string' && guardRes.detail.length > 0);
});

function runDoctorJson(cwd) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [BIN, 'doctor', '--json'], { cwd, env: { ...process.env } });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', rejectP);
    child.on('close', () => {
      try { resolveP(JSON.parse(out)); } catch (e) { rejectP(new Error(`doctor --json not parseable: ${e.message}\n${out.slice(0, 400)}`)); }
    });
  });
}
