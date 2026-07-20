import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMemoryDiagnostics } from '../src/memory/diagnostics.js';
import { calculateEpisodeSignature } from '../src/memory/index.js';

// owner: RStack developed by Richardson Gunde

// #408: diagnostics now verify signature VALIDITY, so fixtures that should be
// "healthy" must carry real HMACs (a bogus signature is correctly flagged as
// key drift). signed() stamps the signature the active key expects.
function signed(episode) {
  return { ...episode, signature: calculateEpisodeSignature(episode) };
}

test('runMemoryDiagnostics counts episodes and flags missing signatures', async () => {
  const memoryDir = mkdtempSync(join(tmpdir(), 'rstack-memdiag-'));
  try {
    const episodes = [
      signed({ episode_id: 'ep-1', created_at: new Date().toISOString(), access_count: 3 }),
      signed({ episode_id: 'ep-2', created_at: new Date().toISOString(), access_count: 1 }),
      { episode_id: 'ep-3', created_at: new Date().toISOString(), access_count: 1 },
    ];
    writeFileSync(join(memoryDir, 'episodes.jsonl'), episodes.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const result = await runMemoryDiagnostics(memoryDir);

    assert.equal(result.episode_count, 3, 'should count all three parseable episodes');
    assert.ok(result.signature_failures.length >= 1, 'should flag at least one missing signature');
    assert.ok(result.signature_failures.includes('ep-3'), 'ep-3 has no signature');
    assert.ok(Array.isArray(result.diagnostics), 'diagnostics must be an array');
    assert.equal(result.healthy, true, 'no error-severity diagnostics means healthy');
    assert.equal(result.recall_hit_rate, null, 'no retrieval events means null recall hit rate');
  } finally {
    rmSync(memoryDir, { recursive: true, force: true });
  }
});

test('runMemoryDiagnostics handles a missing memory dir gracefully', async () => {
  const memoryDir = join(tmpdir(), 'rstack-memdiag-nonexistent-' + Date.now());
  const result = await runMemoryDiagnostics(memoryDir);
  assert.equal(result.episode_count, 0);
  assert.equal(result.store_size_kb, 0);
  assert.deepEqual(result.signature_failures, []);
  assert.ok(Array.isArray(result.diagnostics));
});

test('runMemoryDiagnostics flags stale, duplicate, and oversized stores', async () => {
  const memoryDir = mkdtempSync(join(tmpdir(), 'rstack-memdiag-deep-'));
  try {
    const createdStale = new Date(Date.now() - 100 * 86400000).toISOString();
    const episodes = [
      signed({ episode_id: 'ep-dup', created_at: new Date().toISOString(), access_count: 1 }),
      signed({ episode_id: 'ep-dup', created_at: new Date().toISOString(), access_count: 1 }),
      signed({ episode_id: 'ep-stale', created_at: createdStale, access_count: 0 }),
    ];
    writeFileSync(join(memoryDir, 'episodes.jsonl'), episodes.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const result = await runMemoryDiagnostics(memoryDir);
    assert.deepEqual(result.duplicate_episodes, ['ep-dup']);
    assert.deepEqual(result.stale_candidates, ['ep-stale']);

    const staleDiag = result.diagnostics.find(d => d.type === 'stale_episode');
    assert.ok(staleDiag);
    assert.equal(staleDiag.severity, 'warning');

    const dupDiag = result.diagnostics.find(d => d.type === 'duplicate_episode');
    assert.ok(dupDiag);
    assert.equal(dupDiag.severity, 'warning');
  } finally {
    rmSync(memoryDir, { recursive: true, force: true });
  }
});
