// owner: RStack developed by Richardson Gunde
//
// Single home for schema versioning across run-state files (#82, #151).
// Readers tolerate missing versions (treated as version 1) and migrate
// forward step by step; every future format change registers one
// {from -> from+1} function here instead of scattering remaps.

export const MANIFEST_SCHEMA_VERSION = 2;
export const PIPELINE_STATE_SCHEMA_VERSION = 1;

// kind -> { fromVersion: (value) => nextValue }
const MIGRATIONS = {
  manifest: {
    // v1 (unversioned) -> v2: stamp the version field. Older manifests carry
    // the same shape; the field itself is the migration.
    1: (manifest) => ({ ...manifest, schema_version: 2 }),
  },
  'pipeline-state': {
    // v1 is current — registered so the bump path exists and is tested.
  },
};

const CURRENT_VERSIONS = {
  manifest: MANIFEST_SCHEMA_VERSION,
  'pipeline-state': PIPELINE_STATE_SCHEMA_VERSION,
};

export function applyMigrations(kind, value) {
  if (!value || typeof value !== 'object') return value;
  const migrations = MIGRATIONS[kind];
  const current = CURRENT_VERSIONS[kind];
  if (!migrations || !current) throw new Error(`Unknown migration kind: ${kind}`);

  let migrated = value;
  let version = Number(migrated.schema_version) || 1;
  while (version < current) {
    const step = migrations[version];
    if (!step) {
      throw new Error(`No ${kind} migration registered for schema_version ${version} -> ${version + 1}`);
    }
    migrated = step(migrated);
    version = Number(migrated.schema_version) || version + 1;
  }
  return migrated;
}

export function migrateManifest(manifest) {
  return applyMigrations('manifest', manifest);
}
