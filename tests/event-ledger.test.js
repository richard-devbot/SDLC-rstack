import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendRunEvent } from '../src/core/harness/event-ledger.js';

test('appendRunEvent serializes concurrent event-ledger writers without losing records (#445)', async (t) => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-event-ledger-'));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));

  const count = 64;
  await Promise.all(Array.from({ length: count }, (_, index) => appendRunEvent(runDir, {
    ts: new Date().toISOString(),
    type: index % 2 === 0 ? 'task_started' : 'cost_recorded',
    sequence: index,
    cost_usd: index / 100,
  })));

  const records = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(records.length, count, 'every concurrent append is a complete JSONL record');
  assert.deepEqual(new Set(records.map((record) => record.sequence)), new Set(Array.from({ length: count }, (_, index) => index)));
  assert.equal(records.filter((record) => record.type === 'task_started').length, count / 2, 'attempt events are preserved');
  assert.ok(Math.abs(records.filter((record) => record.type === 'cost_recorded').reduce((sum, record) => sum + record.cost_usd, 0) - 10.24) < 1e-10, 'cost events are preserved');
});
