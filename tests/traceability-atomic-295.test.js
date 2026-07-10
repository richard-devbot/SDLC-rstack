import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

// owner: RStack developed by Richardson Gunde
//
// #295: addTrace did an unlocked read-modify-write of traceability.json and,
// on a corrupt/unparseable read, silently reset the trace to {mappings:[]}
// and overwrote the file — wiping the whole run's audit history. The fix locks
// the RMW, writes atomically, and FAILS CLOSED on a corrupt/odd-shaped read
// (skip the mapping, keep the file) instead of clobbering it.

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) { this.tools[tool.name] = tool; },
  registerCommand(cmd, opts) { this.commands[cmd] = opts; },
};

function readTrace(runDir) {
  return JSON.parse(readFileSync(join(runDir, 'traceability.json'), 'utf8'));
}

test('#295 traceability.json is atomic and never wiped on a corrupt read', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-trace-295-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  // Silence the intentional fail-closed console.error so the run stays clean.
  const originalError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalError;
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Traceability atomicity regression' });
  const runId = start.details.run_id;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);

  // sdlc_plan writes spec_created mappings — the trace now holds real history.
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
  const afterPlan = readTrace(runDir);
  assert.ok(Array.isArray(afterPlan.mappings) && afterPlan.mappings.length > 0, 'plan must seed traceability mappings');
  const seeded = afterPlan.mappings.length;

  await t.test('a healthy write appends (does not truncate) and stays valid JSON', async () => {
    await mockPi.tools.sdlc_approve.execute('3', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
    const afterApprove = readTrace(runDir);
    assert.ok(afterApprove.mappings.length > seeded, 'approval must append a mapping');
    assert.ok(afterApprove.mappings.some((m) => m.type === 'approval'), 'approval mapping must be present');
  });

  await t.test('a corrupt traceability.json is NOT overwritten with an empty trace', async () => {
    const path = join(runDir, 'traceability.json');
    const corrupt = '{ this is not valid json — a torn write or hand edit ';
    writeFileSync(path, corrupt);

    // Triggers addTrace again (approval mapping). Pre-fix this reset the file to
    // {run_id, mappings:[<one>]}; post-fix it must fail closed and keep the file.
    await mockPi.tools.sdlc_approve.execute('4', { run_id: runId, artifact: 'requirements.json', status: 'APPROVED' });

    const raw = readFileSync(path, 'utf8');
    assert.equal(raw, corrupt, 'corrupt traceability.json must be left intact, never wiped to an empty trace');
  });

  await t.test('once the file is valid again, tracing resumes and appends', async () => {
    const path = join(runDir, 'traceability.json');
    writeFileSync(path, JSON.stringify({ run_id: runId, mappings: [{ ts: 't', type: 'restored' }] }, null, 2));
    await mockPi.tools.sdlc_approve.execute('5', { run_id: runId, artifact: 'architecture.md', status: 'APPROVED' });
    const restored = readTrace(runDir);
    assert.ok(restored.mappings.length >= 2, 'tracing resumes and appends after recovery');
    assert.ok(restored.mappings.some((m) => m.type === 'restored'), 'prior (restored) mappings are preserved');
  });
});
