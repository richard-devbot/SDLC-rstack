import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANIFEST_SCHEMA_VERSION,
  PIPELINE_STATE_SCHEMA_VERSION,
  applyMigrations,
  migrateManifest,
} from '../src/core/harness/migrations.js';

test('unversioned (v1) manifests migrate forward to the current schema', () => {
  const legacy = {
    run_id: 'run-2026-06-01-legacy',
    goal: 'Legacy run without schema_version',
    status: 'DONE',
    created_at: '2026-06-01T00:00:00.000Z',
  };
  const migrated = migrateManifest(legacy);
  assert.equal(migrated.schema_version, MANIFEST_SCHEMA_VERSION);
  // Migration is non-destructive: every original field survives.
  assert.equal(migrated.run_id, legacy.run_id);
  assert.equal(migrated.goal, legacy.goal);
  assert.equal(migrated.status, legacy.status);
  // And the input object is not mutated.
  assert.equal(legacy.schema_version, undefined);
});

test('current-version documents pass through unchanged', () => {
  const current = { schema_version: MANIFEST_SCHEMA_VERSION, run_id: 'run-x', goal: 'g' };
  assert.deepEqual(migrateManifest(current), current);

  const pipeline = { schema_version: PIPELINE_STATE_SCHEMA_VERSION, run: { run_id: 'run-x' } };
  assert.deepEqual(applyMigrations('pipeline-state', pipeline), pipeline);
  // Unversioned pipeline state is treated as v1 (current) — no-op.
  assert.deepEqual(applyMigrations('pipeline-state', { run: {} }), { run: {} });
});

test('migration gaps and unknown kinds fail loudly instead of guessing', () => {
  assert.throws(() => applyMigrations('no-such-kind', { schema_version: 1 }), /Unknown migration kind/);
  // v1 has a registered path — migrating an unversioned manifest must not throw.
  assert.doesNotThrow(() => applyMigrations('manifest', { run_id: 'ok' }));
});

test('non-object values pass through untouched', () => {
  assert.equal(applyMigrations('manifest', null), null);
  assert.equal(applyMigrations('manifest', undefined), undefined);
});
