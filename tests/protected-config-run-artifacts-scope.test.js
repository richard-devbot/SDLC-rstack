// owner: RStack developed by Richardson Gunde
//
// Found via a live manual Tau run: PROTECTED_CONFIG_PATTERN protects ALL of
// `.rstack/` with no carve-out, so every write into a run's own artifacts/
// tasks/specs directories — completely routine, every-single-task builder
// output — was classified protected-config-write, requiring its own
// destructive-action:<taskId> approval. An 8-task run needed 8 near-identical
// "approve me writing my own homework" approvals. This pins the carve-out
// (artifacts/, tasks/<id>/, specs/ stay unprotected) while keeping every
// genuinely governance-critical file inside a run directory, and everything
// under .rstack/ outside runs/, protected exactly as before.

import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyWritePath, DESTRUCTIVE_CATEGORIES } from '../src/core/harness/destructive-actions.js';

const RUN = '.rstack/runs/2026-07-17T08-03-27-459Z-build-requested-feature-for-cloned-repository-users-richardsongu';

const NOW_ALLOWED = [
  `${RUN}/artifacts/product-brief.md`,
  `${RUN}/artifacts/stages/00-environment/environment_report.json`,
  `${RUN}/artifacts/stages/12-security-threat-model/threat_model.json`,
  `${RUN}/artifacts/release-readiness.json`,
  `${RUN}/tasks/001-product-clarification/builder.json`,
  `${RUN}/tasks/003-architecture/validation.json`,
  `${RUN}/specs/some-spec.md`,
  // Windows path separator form.
  `${RUN.replace(/\//g, '\\')}\\artifacts\\product-brief.md`,
];

for (const path of NOW_ALLOWED) {
  test(`run artifact/task/spec write no longer protected: ${path}`, () => {
    assert.equal(classifyWritePath(path).destructive, false);
  });
}

const STILL_PROTECTED = [
  [`${RUN}/manifest.json`, 'run manifest (status/lifecycle)'],
  [`${RUN}/tasks.json`, 'task statuses (claim/retry/attempt-budget enforcement reads this)'],
  [`${RUN}/approvals.json`, 'the approval trail itself'],
  [`${RUN}/decisions.json`, 'decision queue resolution status'],
  [`${RUN}/events.jsonl`, 'append-only audit ledger'],
  [`${RUN}/evidence.jsonl`, 'append-only audit ledger'],
  [`${RUN}/pipeline-state.json`, 'rollup driving status/dashboard'],
  [`${RUN}/checkpoints/06-architecture-pre.json`, 'integrity-verified restore points'],
  ['.rstack/policy.json', 'governance policy'],
  ['.rstack/rstack.config.json', 'governance config'],
  ['.rstack/budget.json', 'budget policy'],
  ['.rstack/session.json', 'session pin'],
  ['.rstack/registry/known-projects.json', 'cross-run registry'],
  ['.rstack/memory/facts.jsonl', 'cross-run memory'],
  ['.rstack/validators/registry.json', 'validator profile registry'],
  // A path that merely CONTAINS "artifacts"/"tasks"/"specs" as a substring of
  // a differently-named file must not slip through the carve-out.
  [`${RUN}/tasks-summary.json`, 'not the tasks/ directory — must not match the carve-out'],
];

for (const [path, why] of STILL_PROTECTED) {
  test(`still protected (${why}): ${path}`, () => {
    const v = classifyWritePath(path);
    assert.equal(v.destructive, true, `expected protected: ${path}`);
    assert.equal(v.category, DESTRUCTIVE_CATEGORIES.PROTECTED_CONFIG_WRITE);
  });
}

// A path outside any run directory that merely contains the segment names
// used by the carve-out must not be treated as a run artifact.
test('a top-level .rstack file named like a carve-out segment stays protected', () => {
  assert.equal(classifyWritePath('.rstack/artifacts.json').destructive, true);
});
