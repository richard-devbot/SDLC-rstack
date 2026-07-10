/**
 * Validate loop engineering documentation added in v1.9.0-rc.
 *
 * Covers:
 *  - .gitignore loop engineering patterns
 *  - CONTRIBUTING.md structure and required sections
 *  - .github/ISSUE_TEMPLATE/feature-request.md structure
 *  - docs/github-issues/ phase files (PHASE-0 through PHASE-5)
 *  - docs/github-issues/README.md index completeness
 *  - docs/github-issues/backend-loop-engineering-v1/ files
 *  - README.md roadmap lists only unshipped work and links live issues
 *  - CHANGELOG.md v1.9.0-rc and Unreleased entries
 *  - docs/AUDIT-CURRENT-STATE.md and docs/LOOP-ENGINEERING-UPGRADE-PLAN.md
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readRepoFile(relPath) {
  return readFile(path.join(REPO_ROOT, relPath), 'utf8');
}

function assertSectionPresent(text, section, filePath) {
  assert.ok(text.includes(section), `${filePath} must contain section: ${section}`);
}

// ---------------------------------------------------------------------------
// .gitignore — loop engineering runtime patterns
// ---------------------------------------------------------------------------

test('.gitignore contains loop engineering runtime patterns', async () => {
  const text = await readRepoFile('.gitignore');

  // New loop engineering runtime entries added in this PR
  assert.ok(text.includes('.rstack/worktrees/'), '.gitignore should ignore .rstack/worktrees/');
  assert.ok(text.includes('.rstack/runs/'), '.gitignore should ignore .rstack/runs/');
  assert.ok(text.includes('*.lock/'), '.gitignore should ignore *.lock/');
});

test('.gitignore contains hook/session noise patterns', async () => {
  const text = await readRepoFile('.gitignore');

  assert.ok(text.includes('logs/post_tool_use.json'), '.gitignore should ignore logs/post_tool_use.json');
  assert.ok(text.includes('logs/pre_tool_use.json'), '.gitignore should ignore logs/pre_tool_use.json');
  assert.ok(text.includes('logs/session_end.json'), '.gitignore should ignore logs/session_end.json');
  assert.ok(text.includes('logs/stop.json'), '.gitignore should ignore logs/stop.json');
  assert.ok(text.includes('logs/subagent_stop.json'), '.gitignore should ignore logs/subagent_stop.json');
  assert.ok(text.includes('outputs/team_state'), '.gitignore should ignore outputs/team_state');
});

test('.gitignore contains broad DS_Store pattern for subdirectories', async () => {
  const text = await readRepoFile('.gitignore');
  // New broad pattern to catch .DS_Store in any subdirectory
  assert.ok(text.includes('**/.DS_Store'), '.gitignore should have **/.DS_Store pattern');
});

test('.gitignore retains original required patterns', async () => {
  const text = await readRepoFile('.gitignore');

  // Pre-existing patterns that must not have been removed
  assert.ok(text.includes('node_modules/'), '.gitignore should still ignore node_modules/');
  assert.ok(text.includes('.rstack/'), '.gitignore should still ignore .rstack/');
  assert.ok(text.includes('*.log'), '.gitignore should still ignore *.log');
  assert.ok(text.includes('.env'), '.gitignore should still ignore .env');
  assert.ok(text.includes('.DS_Store'), '.gitignore should still ignore .DS_Store');
});

// ---------------------------------------------------------------------------
// CONTRIBUTING.md — required sections and CI checks
// ---------------------------------------------------------------------------

test('CONTRIBUTING.md exists', () => {
  assert.ok(existsSync(path.join(REPO_ROOT, 'CONTRIBUTING.md')), 'CONTRIBUTING.md should exist at repo root');
});

test('CONTRIBUTING.md contains all required top-level sections', async () => {
  const text = await readRepoFile('CONTRIBUTING.md');
  const requiredSections = [
    '## Quick start',
    '## Branching and merging rules',
    '## CI checks',
    '## Intellectual property rules',
    '## Adding or modifying agents',
    '## Adding tests',
    '## PR checklist',
    '## CodeRabbit review comments',
    '## Release process',
  ];
  for (const section of requiredSections) {
    assertSectionPresent(text, section, 'CONTRIBUTING.md');
  }
});

test('CONTRIBUTING.md documents required CI commands', async () => {
  const text = await readRepoFile('CONTRIBUTING.md');

  // The CI table must document these commands
  assert.ok(text.includes('npm test'), 'CONTRIBUTING.md CI section must document npm test');
  assert.ok(text.includes('npm run validate'), 'CONTRIBUTING.md CI section must document npm run validate');
  assert.ok(text.includes('npm run lint'), 'CONTRIBUTING.md CI section must document npm run lint');
  assert.ok(text.includes('npm pack --dry-run'), 'CONTRIBUTING.md CI section must document npm pack --dry-run');
});

test('CONTRIBUTING.md documents agent name regex requirement', async () => {
  const text = await readRepoFile('CONTRIBUTING.md');
  // Agent names must match this specific regex pattern
  assert.ok(text.includes('^[a-z][a-z0-9-]*$'), 'CONTRIBUTING.md must document agent name regex ^[a-z][a-z0-9-]*$');
});

test('CONTRIBUTING.md IP section distinguishes allowed from not-allowed', async () => {
  const text = await readRepoFile('CONTRIBUTING.md');

  assert.ok(text.includes('**Allowed:**'), 'CONTRIBUTING.md IP section must have Allowed block');
  assert.ok(text.includes('**Not allowed:**'), 'CONTRIBUTING.md IP section must have Not allowed block');
});

test('CONTRIBUTING.md documents Trinity reference for IP transparency', async () => {
  const text = await readRepoFile('CONTRIBUTING.md');
  // Must acknowledge Trinity study for IP transparency
  assert.ok(text.includes('Trinity'), 'CONTRIBUTING.md must reference Trinity for IP transparency');
  assert.ok(
    text.includes('All SDLC-rstack code is original'),
    'CONTRIBUTING.md must assert original authorship',
  );
});

test('CONTRIBUTING.md carries RStack owner label', async () => {
  const text = await readRepoFile('CONTRIBUTING.md');
  assert.ok(
    text.includes('RStack developed by Richardson Gunde'),
    'CONTRIBUTING.md must carry the RStack owner label',
  );
});

test('CONTRIBUTING.md PR checklist includes credential and security checks', async () => {
  const text = await readRepoFile('CONTRIBUTING.md');
  assert.ok(
    text.includes('No credentials'),
    'CONTRIBUTING.md PR checklist must include a no-credentials check',
  );
});

// ---------------------------------------------------------------------------
// .github/ISSUE_TEMPLATE/feature-request.md — template structure
// ---------------------------------------------------------------------------

test('feature-request.md GitHub template exists', () => {
  assert.ok(
    existsSync(path.join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', 'feature-request.md')),
    '.github/ISSUE_TEMPLATE/feature-request.md should exist',
  );
});

test('feature-request.md has valid GitHub issue template frontmatter', async () => {
  const text = await readRepoFile('.github/ISSUE_TEMPLATE/feature-request.md');
  // Must start with YAML frontmatter block
  assert.ok(text.startsWith('---'), 'feature-request.md must start with frontmatter ---');
  assert.ok(text.includes('name: Feature request'), 'frontmatter must have name field');
  assert.ok(text.includes('about:'), 'frontmatter must have about field');
  assert.ok(text.includes('title:'), 'frontmatter must have title field');
  assert.ok(text.includes('labels:'), 'frontmatter must have labels field');
});

test('feature-request.md labels include enhancement and feature', async () => {
  const text = await readRepoFile('.github/ISSUE_TEMPLATE/feature-request.md');
  assert.ok(text.includes('"enhancement"'), 'template labels must include "enhancement"');
  assert.ok(text.includes('"feature"'), 'template labels must include "feature"');
});

test('feature-request.md has all required body sections', async () => {
  const text = await readRepoFile('.github/ISSUE_TEMPLATE/feature-request.md');
  const requiredSections = [
    '## Summary',
    '## Motivation',
    '## Proposed implementation',
    '## Acceptance criteria',
    '## CI checks that must pass',
    '## Out of scope',
    '## Design notes / prior art',
  ];
  for (const section of requiredSections) {
    assertSectionPresent(text, section, '.github/ISSUE_TEMPLATE/feature-request.md');
  }
});

test('feature-request.md CI checks reference npm test and npm run validate', async () => {
  const text = await readRepoFile('.github/ISSUE_TEMPLATE/feature-request.md');
  assert.ok(
    text.includes('npm test'),
    'feature-request.md CI checks must include npm test',
  );
  assert.ok(
    text.includes('npm run validate'),
    'feature-request.md CI checks must include npm run validate',
  );
});

test('feature-request.md carries RStack owner label in frontmatter', async () => {
  const text = await readRepoFile('.github/ISSUE_TEMPLATE/feature-request.md');
  assert.ok(
    text.includes('RStack developed by Richardson Gunde'),
    'feature-request.md must carry the RStack owner label',
  );
});

// ---------------------------------------------------------------------------
// docs/github-issues/ — phase files (PHASE-0 through PHASE-5)
// ---------------------------------------------------------------------------

const PHASE_FILES = [
  'docs/github-issues/PHASE-0-harness-bridge.md',
  'docs/github-issues/PHASE-1-pipeline-state.md',
  'docs/github-issues/PHASE-2-retry-validation.md',
  'docs/github-issues/PHASE-3-goal-loop.md',
  'docs/github-issues/PHASE-4-cost-observability.md',
  'docs/github-issues/PHASE-5-parallel-safety.md',
];

test('all 6 phase spec files exist in docs/github-issues/', () => {
  for (const relPath of PHASE_FILES) {
    assert.ok(
      existsSync(path.join(REPO_ROOT, relPath)),
      `${relPath} should exist`,
    );
  }
});

test('each phase spec file carries the RStack owner label', async () => {
  for (const relPath of PHASE_FILES) {
    const text = await readRepoFile(relPath);
    assert.ok(
      text.includes('RStack developed by Richardson Gunde'),
      `${relPath} must carry the RStack owner label`,
    );
  }
});

test('each phase spec file has a Definition of Done section', async () => {
  for (const relPath of PHASE_FILES) {
    const text = await readRepoFile(relPath);
    assert.ok(
      text.includes('Definition of Done'),
      `${relPath} must have a Definition of Done section`,
    );
  }
});

test('each phase spec file has acceptance criteria checkboxes', async () => {
  for (const relPath of PHASE_FILES) {
    const text = await readRepoFile(relPath);
    assert.ok(
      text.includes('- [ ]'),
      `${relPath} must have acceptance criteria checkboxes (- [ ])`,
    );
  }
});

test('each phase spec file mentions npm test in acceptance criteria', async () => {
  for (const relPath of PHASE_FILES) {
    const text = await readRepoFile(relPath);
    assert.ok(
      text.includes('npm test'),
      `${relPath} must reference npm test in acceptance criteria`,
    );
  }
});

test('PHASE-0 file addresses the harness bridge gap', async () => {
  const text = await readRepoFile('docs/github-issues/PHASE-0-harness-bridge.md');
  assert.ok(text.includes('builder.json'), 'PHASE-0 must mention builder.json contract');
  assert.ok(text.includes('validation.json'), 'PHASE-0 must mention validation.json contract');
  assert.ok(text.includes('src/core/harness'), 'PHASE-0 must reference the existing harness layer');
});

test('PHASE-1 file addresses pipeline state and restart recovery', async () => {
  const text = await readRepoFile('docs/github-issues/PHASE-1-pipeline-state.md');
  assert.ok(text.includes('pipeline-state.json'), 'PHASE-1 must mention pipeline-state.json');
  assert.ok(text.includes('pipeline.yaml'), 'PHASE-1 must mention pipeline.yaml');
  assert.ok(text.includes('DONE'), 'PHASE-1 must document stage status values including DONE');
});

test('PHASE-2 file addresses retry logic and maker/checker validation', async () => {
  const text = await readRepoFile('docs/github-issues/PHASE-2-retry-validation.md');
  assert.ok(text.includes('retry-wrapper'), 'PHASE-2 must mention retry-wrapper');
  assert.ok(text.includes('agents/validators'), 'PHASE-2 must mention agents/validators/ directory');
  assert.ok(text.includes('haiku'), 'PHASE-2 validators must use haiku model');
});

test('PHASE-3 file addresses goal condition and pipeline loop', async () => {
  const text = await readRepoFile('docs/github-issues/PHASE-3-goal-loop.md');
  assert.ok(text.includes('sdlc-goal.sh'), 'PHASE-3 must mention sdlc-goal.sh');
  assert.ok(text.includes('consistency_score'), 'PHASE-3 must reference consistency_score goal metric');
  assert.ok(
    text.includes('max_pipeline_iterations') || text.includes('max_iterations'),
    'PHASE-3 must mention iteration limit',
  );
});

test('PHASE-4 file addresses cost tracking and observability', async () => {
  const text = await readRepoFile('docs/github-issues/PHASE-4-cost-observability.md');
  assert.ok(text.includes('OPERATING-STANDARD.md'), 'PHASE-4 must reference OPERATING-STANDARD.md');
  assert.ok(text.includes('cost_usd') || text.includes('cost_usd'), 'PHASE-4 must mention cost_usd field');
  assert.ok(text.includes('context_pct'), 'PHASE-4 must mention context_pct field');
});

test('PHASE-5 file addresses parallel safety and worktree isolation', async () => {
  const text = await readRepoFile('docs/github-issues/PHASE-5-parallel-safety.md');
  assert.ok(text.includes('worktree'), 'PHASE-5 must mention git worktree');
  assert.ok(text.includes('07'), 'PHASE-5 must reference Agent 07 (code generation)');
});

// ---------------------------------------------------------------------------
// docs/github-issues/README.md — index completeness
// ---------------------------------------------------------------------------

test('docs/github-issues/README.md exists', () => {
  assert.ok(
    existsSync(path.join(REPO_ROOT, 'docs', 'github-issues', 'README.md')),
    'docs/github-issues/README.md should exist',
  );
});

test('docs/github-issues/README.md indexes all 7 epics', async () => {
  const text = await readRepoFile('docs/github-issues/README.md');
  // Table in README lists epics 0-6
  for (let epic = 0; epic <= 6; epic++) {
    assert.ok(
      text.includes(`| ${epic} |`) || text.includes(`Epic ${epic}`),
      `docs/github-issues/README.md must reference Epic ${epic}`,
    );
  }
});

test('docs/github-issues/README.md lists all backend-loop-engineering-v1 epic files', async () => {
  const text = await readRepoFile('docs/github-issues/README.md');
  const expectedFiles = [
    '00-epic-control-plane-inventory.md',
    '01-epic-harness-state-spine.md',
    '02-epic-builder-validator-contracts.md',
    '03-epic-retry-recovery-loop.md',
    '04-epic-goal-loop.md',
    '05-epic-guardrails-approvals-checkpoints.md',
    '06-epic-cost-context-memory.md',
  ];
  for (const fileName of expectedFiles) {
    assert.ok(
      text.includes(fileName),
      `docs/github-issues/README.md should reference ${fileName}`,
    );
  }
});

test('all files listed in docs/github-issues/README.md actually exist', async () => {
  const text = await readRepoFile('docs/github-issues/README.md');
  // Extract markdown file references of the form `backend-loop-engineering-v1/XX-*.md`
  const fileRefs = [...text.matchAll(/backend-loop-engineering-v1\/[\w-]+\.md/g)].map((m) => m[0]);
  assert.ok(fileRefs.length > 0, 'README.md should contain file references');

  const missing = [];
  for (const ref of fileRefs) {
    const fullPath = path.join(REPO_ROOT, 'docs', 'github-issues', ref);
    if (!existsSync(fullPath)) missing.push(ref);
  }
  assert.deepEqual(missing, [], 'All files referenced in README.md should exist on disk');
});

// ---------------------------------------------------------------------------
// docs/github-issues/backend-loop-engineering-v1/ — epic and issue files
// ---------------------------------------------------------------------------

test('backend-loop-engineering-v1 directory contains expected epic files', () => {
  const dir = path.join(REPO_ROOT, 'docs', 'github-issues', 'backend-loop-engineering-v1');
  const epicFiles = [
    '00-epic-control-plane-inventory.md',
    '01-epic-harness-state-spine.md',
    '02-epic-builder-validator-contracts.md',
  ];
  for (const fileName of epicFiles) {
    assert.ok(existsSync(path.join(dir, fileName)), `${fileName} should exist in backend-loop-engineering-v1/`);
  }
});

test('backend-loop-engineering-v1 epic files have required sections', async () => {
  const dir = 'docs/github-issues/backend-loop-engineering-v1';
  const epicFiles = [
    '00-epic-control-plane-inventory.md',
    '01-epic-harness-state-spine.md',
    '02-epic-builder-validator-contracts.md',
  ];
  const requiredSections = ['## Summary', '## Motivation', '## Acceptance Criteria'];
  for (const fileName of epicFiles) {
    const text = await readRepoFile(`${dir}/${fileName}`);
    for (const section of requiredSections) {
      assertSectionPresent(text, section, `${dir}/${fileName}`);
    }
  }
});

test('backend-loop-engineering-v1 issue files have RStack owner label', async () => {
  const dirPath = path.join(REPO_ROOT, 'docs', 'github-issues', 'backend-loop-engineering-v1');
  const entries = await readdir(dirPath);
  const mdFiles = entries.filter((f) => f.endsWith('.md'));

  assert.ok(mdFiles.length >= 20, `Expected at least 20 issue files, got ${mdFiles.length}`);

  const missing = [];
  for (const fileName of mdFiles) {
    const text = await readFile(path.join(dirPath, fileName), 'utf8');
    if (!text.includes('RStack developed by Richardson Gunde')) {
      missing.push(fileName);
    }
  }
  assert.deepEqual(missing, [], 'All backend-loop-engineering-v1 files must carry the RStack owner label');
});

// ---------------------------------------------------------------------------
// README.md — roadmap table and link resolution
// ---------------------------------------------------------------------------

test('README.md roadmap lists only unshipped work — no phase spec links', async () => {
  const text = await readRepoFile('README.md');

  // The v1.9 loop-engineering phases (0-4) shipped; the README roadmap must
  // not present them as planned work anymore.
  assert.ok(
    !/docs\/github-issues\/PHASE-\d+/.test(text),
    'README.md roadmap must not link shipped phase spec files as planned work',
  );
  assert.ok(!text.includes('🗺 planned'), 'README.md must not mark shipped phases as planned');
  assert.ok(
    text.includes('### Shipped in 1.9 / 2.0'),
    'README.md must carry a Shipped in 1.9 / 2.0 note for the delivered phases',
  );
  assert.ok(
    text.includes('docs/HARNESS.md'),
    'README.md shipped note must point at docs/HARNESS.md as the authoritative reference',
  );
});

test('README.md roadmap references the live tracking issues', async () => {
  const text = await readRepoFile('README.md');
  // Remaining roadmap items are tracked as GitHub issues, not local spec files.
  for (const issue of ['208', '71', '228', '229']) {
    assert.ok(
      text.includes(`SDLC-rstack/issues/${issue}`),
      `README.md roadmap should link issue #${issue}`,
    );
  }
});

test('README.md references CONTRIBUTING.md in the roadmap section', async () => {
  const text = await readRepoFile('README.md');
  assert.ok(
    text.includes('CONTRIBUTING.md'),
    'README.md should reference CONTRIBUTING.md for contributors',
  );
});

test('docs/LOOP-ENGINEERING-UPGRADE-PLAN.md still exists as the historical design record', async () => {
  // The README shipped note points at docs/HARNESS.md instead, but the
  // original design document must stay on disk for provenance.
  assert.ok(
    existsSync(path.join(REPO_ROOT, 'docs', 'LOOP-ENGINEERING-UPGRADE-PLAN.md')),
    'docs/LOOP-ENGINEERING-UPGRADE-PLAN.md must exist',
  );
});

test('README.md contains Current limitations and Roadmap subsections', async () => {
  const text = await readRepoFile('README.md');
  assert.ok(text.includes('### Current limitations'), 'README.md must have Current limitations subsection');
  assert.ok(
    text.includes('### Roadmap'),
    'README.md must have Roadmap subsection',
  );
});

// ---------------------------------------------------------------------------
// CHANGELOG.md — v1.9.0-rc and Unreleased entries
// ---------------------------------------------------------------------------

test('CHANGELOG.md has [Unreleased] v2.1 planning section', async () => {
  const text = await readRepoFile('CHANGELOG.md');
  assert.ok(
    text.includes('[Unreleased]') && text.includes('v2.1 planning'),
    'CHANGELOG.md must have an [Unreleased] — v2.1 planning section',
  );
});

test('CHANGELOG.md has [2.0.0] release entry documenting the enforced governed loop', async () => {
  const text = await readRepoFile('CHANGELOG.md');
  assert.match(
    text,
    /\[2\.0\.0\] - \d{4}-\d{2}-\d{2}/,
    'CHANGELOG.md [2.0.0] must have ISO date format YYYY-MM-DD',
  );
  const features = [
    'rstack-agents guard',   // Universal enforcement guard
    'PreToolUse',            // Claude Code hook adapter
    'wire-your-own-harness', // Guided recipe for other frameworks
    'pipeline loop',         // Goal-conditioned loop
    'checkpoint',            // Critical-stage restore points
    'adopt',                 // Brownfield adoption
  ];
  for (const feature of features) {
    assert.ok(
      text.includes(feature),
      `CHANGELOG.md [2.0.0] entry should mention ${feature}`,
    );
  }
});

test('CHANGELOG.md has [1.9.0-rc] release entry with correct date format', async () => {
  const text = await readRepoFile('CHANGELOG.md');
  assert.ok(
    text.includes('[1.9.0-rc]'),
    'CHANGELOG.md must have a [1.9.0-rc] entry',
  );
  // Must have a date with the release
  assert.match(
    text,
    /\[1\.9\.0-rc\] - \d{4}-\d{2}-\d{2}/,
    'CHANGELOG.md [1.9.0-rc] must have ISO date format YYYY-MM-DD',
  );
});

test('CHANGELOG.md [1.9.0-rc] has Added, Fixed, and Security subsections', async () => {
  const text = await readRepoFile('CHANGELOG.md');
  // All three subsections must appear after the [1.9.0-rc] entry
  const rcIndex = text.indexOf('[1.9.0-rc]');
  assert.ok(rcIndex !== -1, 'CHANGELOG.md must have [1.9.0-rc] entry');
  const rcSection = text.slice(rcIndex, rcIndex + 3000);
  assert.ok(rcSection.includes('### Added'), '[1.9.0-rc] must have ### Added subsection');
  assert.ok(rcSection.includes('### Fixed'), '[1.9.0-rc] must have ### Fixed subsection');
  assert.ok(rcSection.includes('### Security'), '[1.9.0-rc] must have ### Security subsection');
});

test('CHANGELOG.md [1.9.0-rc] Added section references key PRs', async () => {
  const text = await readRepoFile('CHANGELOG.md');
  const rcIndex = text.indexOf('[1.9.0-rc]');
  const rcSection = text.slice(rcIndex, rcIndex + 4000);
  // Bootstrap templates, artifact viewer, and atomic writes are key additions
  assert.ok(rcSection.includes('Bootstrap templates') || rcSection.includes('bootstrap'), 'CHANGELOG must mention bootstrap templates');
  assert.ok(rcSection.includes('atomic') || rcSection.includes('Atomic'), 'CHANGELOG must mention atomic writes');
});

test('CHANGELOG.md carries the RStack owner label', async () => {
  const text = await readRepoFile('CHANGELOG.md');
  assert.ok(
    text.includes('RStack developed by Richardson Gunde'),
    'CHANGELOG.md must carry the RStack owner label',
  );
});

// ---------------------------------------------------------------------------
// docs/AUDIT-CURRENT-STATE.md
// ---------------------------------------------------------------------------

test('docs/AUDIT-CURRENT-STATE.md exists', () => {
  assert.ok(
    existsSync(path.join(REPO_ROOT, 'docs', 'AUDIT-CURRENT-STATE.md')),
    'docs/AUDIT-CURRENT-STATE.md should exist',
  );
});

test('docs/AUDIT-CURRENT-STATE.md has required audit sections', async () => {
  const text = await readRepoFile('docs/AUDIT-CURRENT-STATE.md');
  const requiredSections = [
    '## 1.',   // Repository vitals
    '## 2.',   // Agent inventory
    '## 3.',   // JS Harness
    '## 4.',   // Test suite
  ];
  for (const section of requiredSections) {
    assertSectionPresent(text, section, 'docs/AUDIT-CURRENT-STATE.md');
  }
});

test('docs/AUDIT-CURRENT-STATE.md documents the harness gap as Phase 0 prerequisite', async () => {
  const text = await readRepoFile('docs/AUDIT-CURRENT-STATE.md');
  assert.ok(
    text.includes('builder.json') && text.includes('validation.json'),
    'Audit must document the missing builder.json / validation.json contract gap',
  );
  assert.ok(
    text.includes('Phase 0'),
    'Audit must reference Phase 0 as the harness bridge prerequisite',
  );
});

test('docs/AUDIT-CURRENT-STATE.md carries RStack owner label', async () => {
  const text = await readRepoFile('docs/AUDIT-CURRENT-STATE.md');
  assert.ok(
    text.includes('RStack developed by Richardson Gunde'),
    'docs/AUDIT-CURRENT-STATE.md must carry the RStack owner label',
  );
});

// ---------------------------------------------------------------------------
// docs/LOOP-ENGINEERING-UPGRADE-PLAN.md
// ---------------------------------------------------------------------------

test('docs/LOOP-ENGINEERING-UPGRADE-PLAN.md exists', () => {
  assert.ok(
    existsSync(path.join(REPO_ROOT, 'docs', 'LOOP-ENGINEERING-UPGRADE-PLAN.md')),
    'docs/LOOP-ENGINEERING-UPGRADE-PLAN.md should exist',
  );
});

test('docs/LOOP-ENGINEERING-UPGRADE-PLAN.md has the Trinity vs SDLC-rstack comparison', async () => {
  const text = await readRepoFile('docs/LOOP-ENGINEERING-UPGRADE-PLAN.md');
  assert.ok(text.includes('Trinity'), 'Upgrade plan must compare with Trinity patterns');
  assert.ok(
    text.includes('Part 1') || text.includes('## Part 1'),
    'Upgrade plan must have Part 1 (what Trinity does that SDLC-rstack lacks)',
  );
  assert.ok(
    text.includes('Part 2') || text.includes('## Part 2'),
    'Upgrade plan must have Part 2 (what SDLC-rstack does better)',
  );
});

test('docs/LOOP-ENGINEERING-UPGRADE-PLAN.md covers all 5 sprint topics', async () => {
  const text = await readRepoFile('docs/LOOP-ENGINEERING-UPGRADE-PLAN.md');
  assert.ok(
    text.includes('Sprint 1') || text.includes('pipeline-state'),
    'Upgrade plan must cover Sprint 1 (Pipeline State)',
  );
  assert.ok(
    text.includes('Sprint 2') || text.includes('retry-wrapper'),
    'Upgrade plan must cover Sprint 2 (Retry Wrapper + Validation)',
  );
  assert.ok(
    text.includes('Sprint 3') || text.includes('sdlc-goal'),
    'Upgrade plan must cover Sprint 3 (Goal Checker)',
  );
  assert.ok(
    text.includes('Sprint 4') || text.includes('Cost'),
    'Upgrade plan must cover Sprint 4 (Cost Tracking)',
  );
  assert.ok(
    text.includes('Sprint 5') || text.includes('lock'),
    'Upgrade plan must cover Sprint 5 (Locking)',
  );
});

test('docs/LOOP-ENGINEERING-UPGRADE-PLAN.md explicitly says not to copy Trinity platform', async () => {
  const text = await readRepoFile('docs/LOOP-ENGINEERING-UPGRADE-PLAN.md');
  // Must have a section on what NOT to copy
  assert.ok(
    text.includes('NOT to Copy') || text.includes('not to copy') || text.includes('NOT copy'),
    'Upgrade plan must include a section on what not to copy from Trinity',
  );
});

test('docs/LOOP-ENGINEERING-UPGRADE-PLAN.md carries RStack owner label', async () => {
  const text = await readRepoFile('docs/LOOP-ENGINEERING-UPGRADE-PLAN.md');
  assert.ok(
    text.includes('RStack developed by Richardson Gunde'),
    'docs/LOOP-ENGINEERING-UPGRADE-PLAN.md must carry the RStack owner label',
  );
});

// ---------------------------------------------------------------------------
// docs/github-issues/TRINITY-COMPARISON.md — consistency check
// ---------------------------------------------------------------------------

test('docs/github-issues/TRINITY-COMPARISON.md exists and carries owner label', async () => {
  const filePath = 'docs/github-issues/TRINITY-COMPARISON.md';
  assert.ok(existsSync(path.join(REPO_ROOT, filePath)), `${filePath} should exist`);
  const text = await readRepoFile(filePath);
  assert.ok(
    text.includes('RStack developed by Richardson Gunde'),
    `${filePath} must carry the RStack owner label`,
  );
});

test('docs/github-issues/TRINITY-COMPARISON.md has a TL;DR comparison table', async () => {
  const text = await readRepoFile('docs/github-issues/TRINITY-COMPARISON.md');
  assert.ok(
    text.includes('TL;DR') || text.includes('Dimension'),
    'TRINITY-COMPARISON.md must have a TL;DR or comparison table',
  );
  // Should cover key dimensions
  assert.ok(text.includes('Retry') || text.includes('retry'), 'Comparison must cover Retry dimension');
  assert.ok(text.includes('Goal') || text.includes('goal'), 'Comparison must cover Goal loop dimension');
});

// ---------------------------------------------------------------------------
// Boundary and regression tests
// ---------------------------------------------------------------------------

test('.gitignore loop patterns do not accidentally ignore tracked source files', async () => {
  const text = await readRepoFile('.gitignore');

  // These new patterns must be specific enough that they don't block source files
  // *.lock/ ends with / so it only matches directories named *.lock, not .lock files
  assert.ok(
    text.includes('*.lock/'),
    '*.lock/ pattern should target lock directories (trailing slash)',
  );
  // Verify the pattern won't accidentally block package-lock.json (it shouldn't, it targets dirs)
  assert.ok(
    !text.includes('package-lock.json'),
    '.gitignore should not explicitly ignore package-lock.json',
  );
});

test('all phase file Estimated effort comments are present', async () => {
  // Each phase spec should document estimated effort to help contributors scope work
  for (const relPath of PHASE_FILES) {
    const text = await readRepoFile(relPath);
    assert.ok(
      text.includes('Estimated effort') || text.includes('effort'),
      `${relPath} should document estimated effort`,
    );
  }
});

test('README.md tracks remaining roadmap work on GitHub, not local issue specs', async () => {
  // The shipped phases' local spec files stay in docs/github-issues/ for
  // provenance, but the README roadmap now links the live issue tracker.
  const text = await readRepoFile('README.md');
  assert.ok(
    !text.includes('docs/github-issues/'),
    'README.md should not point contributors at the shipped local issue specs',
  );
  assert.ok(
    text.includes('SDLC-rstack/issues/'),
    'README.md roadmap must link the live GitHub issue tracker',
  );
});

test('CHANGELOG.md [Unreleased] section links to docs/github-issues/ for issue specs', async () => {
  const text = await readRepoFile('CHANGELOG.md');
  const unreleasedIndex = text.indexOf('[Unreleased]');
  const unreleasedSection = text.slice(unreleasedIndex, unreleasedIndex + 600);
  assert.ok(
    unreleasedSection.includes('docs/github-issues/'),
    'CHANGELOG.md [Unreleased] section must link to docs/github-issues/ for issue specs',
  );
});
