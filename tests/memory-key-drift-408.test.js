/**
 * Memory key-drift visibility (#408): readEpisodes silently filters episodes
 * whose HMAC signature does not verify under the active key. That silent drop
 * is the mechanism behind "memory stopped loading" after a signing-key change
 * or a project-folder rename (the slug-derived fallback secret changes).
 * runMemoryDiagnostics now verifies signature VALIDITY (not just presence) and
 * surfaces a signing_key_drift error so the loss is observable.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculateEpisodeSignature, projectMemoryDir } from '../src/memory/index.js';
import { runMemoryDiagnostics } from '../src/memory/diagnostics.js';

test('#408: diagnostics flag episodes that fail signature verification under the active key', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-keydrift-'));
  const memoryRoot = mkdtempSync(join(tmpdir(), 'rstack-keydrift-mem-'));
  const prevRoot = process.env.RSTACK_PROJECT_ROOT;
  const prevMem = process.env.RSTACK_MEMORY_DIR;
  const prevKey = process.env.RSTACK_SIGNING_KEY;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  process.env.RSTACK_MEMORY_DIR = memoryRoot;
  mkdirSync(join(projectRoot, '.rstack'), { recursive: true });

  try {
    // Sign an episode under key-a.
    process.env.RSTACK_SIGNING_KEY = 'key-a';
    const episode = {
      episode_id: 'ep-keydrift-1',
      project_slug: 'x',
      run_id: 'r1',
      task_id: '07-code',
      outcome: 'PASS',
      validator_status: 'PASS',
      created_at: new Date().toISOString(),
    };
    episode.signature = calculateEpisodeSignature(episode);

    const memoryDir = projectMemoryDir(projectRoot);
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'episodes.jsonl'), `${JSON.stringify(episode)}\n`);

    // The KEY ROTATES to key-b (or a rename changes the slug-derived fallback).
    process.env.RSTACK_SIGNING_KEY = 'key-b';
    const report = await runMemoryDiagnostics(projectRoot);

    assert.ok(
      report.diagnostics.some((d) => d.type === 'invalid_signature' && d.episode_id === 'ep-keydrift-1'),
      'the episode with a now-invalid signature is flagged',
    );
    const drift = report.diagnostics.find((d) => d.type === 'signing_key_drift');
    assert.ok(drift, 'a signing_key_drift summary diagnostic is emitted');
    assert.equal(drift.severity, 'error', 'key drift is an error — it silently orphans memory');
    assert.equal(report.healthy, false, 'a store with orphaned episodes is not healthy');

    // Under the ORIGINAL key, the same store verifies cleanly.
    process.env.RSTACK_SIGNING_KEY = 'key-a';
    const ok = await runMemoryDiagnostics(projectRoot);
    assert.ok(!ok.diagnostics.some((d) => d.type === 'signing_key_drift'), 'no drift under the correct key');
  } finally {
    if (prevRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT; else process.env.RSTACK_PROJECT_ROOT = prevRoot;
    if (prevMem === undefined) delete process.env.RSTACK_MEMORY_DIR; else process.env.RSTACK_MEMORY_DIR = prevMem;
    if (prevKey === undefined) delete process.env.RSTACK_SIGNING_KEY; else process.env.RSTACK_SIGNING_KEY = prevKey;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(memoryRoot, { recursive: true, force: true });
  }
});
