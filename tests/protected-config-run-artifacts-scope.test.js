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

// CodeRabbit review (PR #399, CRITICAL): the original carve-out only checked
// that "artifacts"/"tasks"/"specs" appeared where expected — it never
// verified the path stopped there. `.rstack/runs/<id>/tasks/../../policy.json`
// satisfies "runs/<id>/tasks/" and was wrongly carved out, even though it
// resolves straight through to a genuinely protected governance file. Pins
// that any ".." traversal segment anywhere in a .rstack path — whether in the
// run-id position or after the carved-out directory — forces fail-closed
// (stays protected) rather than trying to out-regex path normalization.
const TRAVERSAL_MUST_STAY_PROTECTED = [
  [`${RUN}/tasks/001-product-clarification/../../policy.json`, 'traversal out of a carved-out task dir back to a run-level governance file'],
  [`${RUN}/artifacts/../../../policy.json`, 'traversal out of artifacts/ back past the run root'],
  ['.rstack/runs/../artifacts/foo.json', 'traversal via a ".." run-id segment'],
  ['.rstack/runs/..', 'bare ".." as the entire run-id segment, nothing after'],
  [`${RUN}/specs/../tasks.json`, 'traversal out of specs/ to the protected run-level tasks.json'],
  // Windows separators must not open a traversal path the forward-slash check missed.
  [`${RUN.replace(/\//g, '\\')}\\tasks\\001-product-clarification\\..\\..\\policy.json`, 'Windows-separator traversal'],
];

for (const [path, why] of TRAVERSAL_MUST_STAY_PROTECTED) {
  test(`path traversal cannot bypass the carve-out (${why}): ${path}`, () => {
    const v = classifyWritePath(path);
    assert.equal(v.destructive, true, `expected protected (traversal bypass): ${path}`);
    assert.equal(v.category, DESTRUCTIVE_CATEGORIES.PROTECTED_CONFIG_WRITE);
  });
}

// A run-id that merely CONTAINS ".." as a substring without it being an
// actual parent-directory segment (e.g. a timestamp-derived slug) is not a
// real traversal and must still get the carve-out — the fix targets literal
// ".." path segments, not the substring "..".
test('a run-id containing ".." as a harmless substring (not a path segment) still gets the carve-out', () => {
  assert.equal(classifyWritePath('.rstack/runs/build-foo..bar-run/artifacts/out.json').destructive, false);
});
