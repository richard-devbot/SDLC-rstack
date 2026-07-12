// owner: RStack developed by Richardson Gunde
//
// Untrusted PR gate (#75): as RStack takes public contributions, changes from
// outside the maintainer trust boundary must not silently touch the paths
// that ship code to users — workflows, package metadata (lifecycle scripts
// run on `npm install`), the harness core, and `.rstack` policy. This module
// is the PURE evaluator: author trust + changed files + patches in, verdict +
// findings out. The GitHub Actions glue lives in
// scripts/untrusted-pr-gate.mjs and .github/workflows/rstack-untrusted-pr-gate.yml.
//
// Deliberately dependency-free (its own tiny glob matcher): the workflow runs
// it on pull_request_target with NO checkout of PR code and NO `npm ci` — the
// gate itself must not widen the supply-chain surface it guards.
//
// Verdict ladder: allow < needs-maintainer-review < block.
//   - trusted authors (OWNER/MEMBER/COLLABORATOR) pass untouched;
//   - protected-path changes and tripped content heuristics BLOCK;
//   - paths that are neither protected nor explicitly allowed fall back to
//     needs-maintainer-review (fail-closed for the unclassified middle).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const GATE_VERDICTS = Object.freeze(['allow', 'needs-maintainer-review', 'block']);
export const TRUSTED_ASSOCIATIONS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']);

export const DEFAULT_GATE_CONFIG = Object.freeze({
  trusted_associations: TRUSTED_ASSOCIATIONS,
  protected_paths: Object.freeze([
    '.github/**',
    'package.json',
    'package-lock.json',
    '.rstack/**',
    'bin/**',
    'scripts/**',
    'src/core/harness/**',
    'src/integrations/**',
    'src/security/**',
  ]),
  allowed_untrusted_paths: Object.freeze([
    'docs/**',
    'tests/**',
    'examples/**',
    '**/*.md',
  ]),
  content_heuristics: Object.freeze({
    package_json_lifecycle_scripts: 'block',
    new_github_action_uses: 'block',
    secret_like_values: 'block',
  }),
  fallback: 'needs-maintainer-review',
});

// Project override: .rstack/security/untrusted-pr-gate.json, shallow-merged
// over the defaults. A malformed file falls back to defaults (fail-closed —
// the defaults are the strict posture).
export function loadGateConfig(projectRoot = process.cwd()) {
  const configPath = join(projectRoot, '.rstack', 'security', 'untrusted-pr-gate.json');
  if (!existsSync(configPath)) return { ...DEFAULT_GATE_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_GATE_CONFIG };
    return {
      ...DEFAULT_GATE_CONFIG,
      ...parsed,
      content_heuristics: { ...DEFAULT_GATE_CONFIG.content_heuristics, ...(parsed.content_heuristics ?? {}) },
    };
  } catch {
    return { ...DEFAULT_GATE_CONFIG };
  }
}

// Minimal glob → RegExp: `**` crosses directories, `*` stays within one path
// segment, `?` is one non-separator character. Enough for the config grammar;
// no dependency.
export function globToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` may match nothing at all (so `**/*.md` matches `README.md`).
        if (pattern[i + 2] === '/') { source += '(?:.*/)?'; i += 2; } else { source += '.*'; i += 1; }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(path, patterns) {
  return (patterns ?? []).some((pattern) => globToRegExp(pattern).test(path));
}

function addedLines(patch) {
  if (typeof patch !== 'string') return [];
  return patch.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'));
}

const LIFECYCLE_SCRIPT = /"(preinstall|install|postinstall|prepare|prepack|postpack|prepublish|prepublishOnly|publish|postpublish)"\s*:/;
const ACTION_USES = /(^|\s)uses:\s*\S/;
const SECRET_LIKE = [
  /(api[_-]?key|secret|token|password|credential)["']?\s*[:=]\s*["'][^"']{8,}["']/i,
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(gh[pousr]|xox[baprs])-[A-Za-z0-9-]{10,}/, // GitHub / Slack token shapes
];

function heuristicAction(config, name) {
  const action = config.content_heuristics?.[name];
  return GATE_VERDICTS.includes(action) ? action : action === 'warn' ? 'needs-maintainer-review' : 'block';
}

// Pure gate evaluation. `files` is the GitHub "list PR files" shape:
// [{ filename, patch?, status? }]. Content heuristics run on the PATCH TEXT
// only — the PR head is never checked out.
export function evaluateUntrustedPr({ authorAssociation, files = [], config = DEFAULT_GATE_CONFIG } = {}) {
  const effective = { ...DEFAULT_GATE_CONFIG, ...config };
  const trusted = (effective.trusted_associations ?? TRUSTED_ASSOCIATIONS)
    .includes(String(authorAssociation ?? '').toUpperCase());
  const findings = [];

  if (!trusted) {
    for (const file of files) {
      const path = file?.filename;
      if (typeof path !== 'string' || !path) continue;
      const added = addedLines(file.patch);

      if ((path === 'package.json' || path.endsWith('/package.json'))
        && added.some((line) => LIFECYCLE_SCRIPT.test(line))
        && heuristicAction(effective, 'package_json_lifecycle_scripts') !== 'allow') {
        findings.push({
          action: heuristicAction(effective, 'package_json_lifecycle_scripts'),
          type: 'package-lifecycle-script',
          file: path,
          message: 'adds or modifies an npm lifecycle script — lifecycle scripts execute on install',
        });
      }
      if (/^\.github\/workflows\/.+\.(yml|yaml)$/.test(path)
        && added.some((line) => ACTION_USES.test(line))
        && heuristicAction(effective, 'new_github_action_uses') !== 'allow') {
        findings.push({
          action: heuristicAction(effective, 'new_github_action_uses'),
          type: 'new-github-action-uses',
          file: path,
          message: 'introduces a `uses:` action reference in a workflow — actions run with repository credentials',
        });
      }
      if (added.some((line) => SECRET_LIKE.some((regex) => regex.test(line)))
        && heuristicAction(effective, 'secret_like_values') !== 'allow') {
        findings.push({
          action: heuristicAction(effective, 'secret_like_values'),
          type: 'secret-like-value',
          file: path,
          message: 'adds a credential-shaped value — secrets never belong in the repository',
        });
      }

      if (matchesAny(path, effective.protected_paths)) {
        findings.push({
          action: 'block',
          type: 'protected-path',
          file: path,
          message: 'touches a protected path — maintainer review required before this can land',
        });
      } else if (!matchesAny(path, effective.allowed_untrusted_paths)) {
        findings.push({
          action: GATE_VERDICTS.includes(effective.fallback) ? effective.fallback : 'needs-maintainer-review',
          type: 'unclassified-path',
          file: path,
          message: 'is neither an allowed untrusted path nor a protected path — falls back to maintainer review',
        });
      }
    }
  }

  const rank = { allow: 0, 'needs-maintainer-review': 1, block: 2 };
  const verdict = findings.reduce((acc, item) => (rank[item.action] > rank[acc] ? item.action : acc), 'allow');
  return {
    trusted,
    author_association: String(authorAssociation ?? 'NONE').toUpperCase(),
    verdict,
    file_count: files.length,
    findings,
  };
}

// Markdown check summary for GITHUB_STEP_SUMMARY / PR comments.
export function renderGateSummary(result) {
  const lines = [
    '## Untrusted PR gate',
    '',
    `- Author association: \`${result.author_association}\` (${result.trusted ? 'trusted — gate not applied' : 'untrusted — gate applied'})`,
    `- Files changed: ${result.file_count}`,
    `- Verdict: **${result.verdict}**`,
  ];
  if (result.findings.length) {
    lines.push('', '| Action | Type | File | Why |', '| --- | --- | --- | --- |');
    for (const finding of result.findings) {
      lines.push(`| ${finding.action} | ${finding.type} | \`${finding.file}\` | ${finding.message} |`);
    }
  } else {
    lines.push('', 'No findings.');
  }
  lines.push('', '_Protected paths guard workflows, package metadata, the harness core, and `.rstack` policy from supply-chain risk (NIST SSDF / SLSA). Maintainers: review and re-run, or push the change yourself._');
  return lines.join('\n');
}
