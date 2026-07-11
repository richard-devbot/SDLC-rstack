import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// owner: RStack developed by Richardson Gunde
//
// #324 (the #286 residual): init never overwrites an existing
// .claude/settings.json, so installs initialized before #286 keep the narrow
// 'Bash|Write|Edit' matcher — and Claude Code only fires a hook whose matcher
// names the tool, so the guard NEVER RUNS for MultiEdit/NotebookEdit there.
// The guard self-test probes the binary, not the host wiring, so it reports
// green on exactly those installs. doctor's wiring check now owns the gap.

const execFileAsync = promisify(execFile);
const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

async function doctorJson(root) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [BIN, 'doctor', '--framework', 'claude-code', '--project', root, '--json'], { cwd: root });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.code ?? 1, json: JSON.parse(error.stdout ?? '{}') };
  }
}

function checkByName(json, name) {
  return (json.checks ?? []).find((entry) => entry.name === name);
}

function seed(root, { guardMatcher, observeMatcher }) {
  mkdirSync(join(root, '.rstack', 'runs'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });
  const hooks = {
    PreToolUse: [{ ...(guardMatcher === undefined ? {} : { matcher: guardMatcher }), hooks: [{ type: 'command', command: 'npx --yes rstack-agents guard --context builder' }] }],
  };
  if (observeMatcher !== null) {
    hooks.PostToolUse = [{ matcher: observeMatcher, hooks: [{ type: 'command', command: 'npx --yes rstack-agents observe --source claude-code' }] }];
  }
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks }, null, 2));
}

test('doctor flags pre-#286 narrow matchers (#324)', async (t) => {
  await t.test('narrow guard matcher FAILs naming the missing tools and the exact fix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-narrow-'));
    try {
      seed(root, { guardMatcher: 'Bash|Write|Edit', observeMatcher: 'Bash|Write|Edit' });
      const { code, json } = await doctorJson(root);
      const breadth = checkByName(json, 'claude-code guard matcher breadth');
      assert.equal(breadth?.status, 'FAIL');
      assert.match(breadth.detail, /MultiEdit, NotebookEdit/);
      assert.match(breadth.fix, /Bash\|Write\|Edit\|MultiEdit\|NotebookEdit/, 'fix carries the exact corrected matcher');
      assert.equal(code, 1, 'an enforcement hole fails doctor');

      const observe = checkByName(json, 'claude-code observe matcher breadth');
      assert.equal(observe?.status, 'WARN', 'observe breadth is additive — WARN, never FAIL');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test('full-breadth matcher PASSes; order does not matter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-wide-'));
    try {
      seed(root, { guardMatcher: 'NotebookEdit|Edit|MultiEdit|Bash|Write', observeMatcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit' });
      const { json } = await doctorJson(root);
      assert.equal(checkByName(json, 'claude-code guard matcher breadth')?.status, 'PASS');
      assert.equal(checkByName(json, 'claude-code observe matcher breadth'), undefined, 'full observe breadth emits no check');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test('absent or wildcard matcher means ALL tools — full breadth, no gap', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstack-doctor-wild-'));
    try {
      seed(root, { guardMatcher: undefined, observeMatcher: null });
      const { json } = await doctorJson(root);
      assert.equal(checkByName(json, 'claude-code guard matcher breadth')?.status, 'PASS');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
