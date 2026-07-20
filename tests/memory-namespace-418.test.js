/**
 * Stable memory namespace (#418): the episodic store was keyed on the project
 * folder BASENAME, so renaming the folder orphaned all accumulated memory and
 * two checkouts named `api` collided. ensureStableMemoryNamespace mints a
 * .rstack/project-id and migrates the legacy slug store COPY-NOT-DELETE; from
 * then on projectMemoryDir resolves the id-keyed namespace, which survives a
 * folder rename.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  calculateEpisodeSignature,
  ensureStableMemoryNamespace,
  projectMemoryDir,
  projectMemoryKey,
  projectSlug,
} from '../src/memory/index.js';

function withEnv(overrides, fn) {
  const prev = {};
  for (const [key, value] of Object.entries(overrides)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('#418: migration copies the legacy slug store into the id namespace (copy-not-delete)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-ns-418-'));
  const memoryRoot = mkdtempSync(join(tmpdir(), 'rstack-ns-418-mem-'));
  await withEnv({ RSTACK_MEMORY_DIR: memoryRoot, RSTACK_STATE_DIR: undefined }, async () => {
    try {
      // Seed a legacy slug-keyed store with a signed episode + a learning.
      const legacyDir = join(memoryRoot, projectSlug(projectRoot), 'memory');
      mkdirSync(legacyDir, { recursive: true });
      const episode = { episode_id: 'ep-ns-1', project_slug: projectSlug(projectRoot), run_id: 'r1', task_id: '07-code', outcome: 'PASS', validator_status: 'PASS', created_at: new Date().toISOString() };
      episode.signature = calculateEpisodeSignature(episode);
      writeFileSync(join(legacyDir, 'episodes.jsonl'), `${JSON.stringify(episode)}\n`);
      writeFileSync(join(legacyDir, 'facts.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), learning: 'prefer pnpm', type: 'project_fact' })}\n`);

      // Before: no project-id → the key IS the slug.
      assert.equal(projectMemoryKey(projectRoot), projectSlug(projectRoot));

      const result = await ensureStableMemoryNamespace(projectRoot);
      assert.ok(result.key, 'a stable key is minted');
      assert.notEqual(result.key, projectSlug(projectRoot), 'the key is an id, not the slug');
      assert.equal(result.migrated, true);
      assert.equal(result.copied, 2, 'both store files were copied');

      // The id is persisted and now drives resolution.
      const idOnDisk = readFileSync(join(projectRoot, '.rstack', 'project-id'), 'utf8').trim();
      assert.equal(idOnDisk, result.key);
      const idDir = projectMemoryDir(projectRoot);
      assert.ok(idDir.includes(result.key), 'projectMemoryDir resolves the id namespace');

      // Copied bytes are identical (signatures never re-signed) and the
      // legacy store is left intact as a recovery point.
      assert.equal(readFileSync(join(idDir, 'episodes.jsonl'), 'utf8'), readFileSync(join(legacyDir, 'episodes.jsonl'), 'utf8'));
      assert.ok(existsSync(join(legacyDir, 'facts.jsonl')), 'legacy store is never deleted');

      // Idempotent: a second call copies nothing and never overwrites.
      writeFileSync(join(idDir, 'episodes.jsonl'), readFileSync(join(idDir, 'episodes.jsonl'), 'utf8') + `${JSON.stringify({ ...episode, episode_id: 'ep-ns-2' })}\n`);
      const again = await ensureStableMemoryNamespace(projectRoot);
      assert.equal(again.key, result.key);
      assert.equal(again.copied, 0, 'an already-populated id store is never overwritten');
      assert.match(readFileSync(join(idDir, 'episodes.jsonl'), 'utf8'), /ep-ns-2/, 'post-migration writes survive');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(memoryRoot, { recursive: true, force: true });
    }
  });
});

test('#418: the id namespace survives a project folder rename', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'rstack-ns-418-rename-'));
  const memoryRoot = mkdtempSync(join(tmpdir(), 'rstack-ns-418-rename-mem-'));
  await withEnv({ RSTACK_MEMORY_DIR: memoryRoot, RSTACK_STATE_DIR: undefined }, async () => {
    try {
      const oldRoot = join(parent, 'customer-portal-old');
      mkdirSync(join(oldRoot, '.rstack'), { recursive: true });
      const { key } = await ensureStableMemoryNamespace(oldRoot);
      const dirBefore = projectMemoryDir(oldRoot);

      // "Rename" the folder: same .rstack (and project-id), new basename.
      const newRoot = join(parent, 'customer-portal-renamed');
      mkdirSync(join(newRoot, '.rstack'), { recursive: true });
      writeFileSync(join(newRoot, '.rstack', 'project-id'), readFileSync(join(oldRoot, '.rstack', 'project-id')));

      assert.equal(projectMemoryKey(newRoot), key, 'the key rides the project-id, not the basename');
      assert.equal(projectMemoryDir(newRoot), dirBefore, 'the memory namespace is unchanged by the rename');
      assert.notEqual(projectSlug(newRoot), projectSlug(oldRoot), 'the slugs DID diverge — the id is what saved continuity');
    } finally {
      rmSync(parent, { recursive: true, force: true });
      rmSync(memoryRoot, { recursive: true, force: true });
    }
  });
});
