// owner: RStack developed by Richardson Gunde
//
// GitHub Actions glue for the untrusted PR gate (#75). Runs on
// pull_request_target with the BASE checkout only — the PR head is never
// checked out, and content heuristics run on patch text fetched from the
// GitHub API. Dependency-free on purpose (no `npm ci` before this executes):
// the gate must not widen the supply-chain surface it guards.
//
// Exit codes: 0 = allow or needs-maintainer-review (the label + summary carry
// the signal); 1 = block (protected path / tripped heuristic by an untrusted
// author) or an evaluation failure (fail-closed).

import { appendFileSync, readFileSync } from 'node:fs';
import { evaluateUntrustedPr, loadGateConfig, renderGateSummary } from '../src/security/untrusted-pr-gate.js';

const REVIEW_LABEL = 'needs-maintainer-review';

async function githubApi(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status} ${await response.text()}`);
  return response.json();
}

async function listChangedFiles(apiBase, repo, prNumber) {
  const files = [];
  for (let page = 1; page <= 30; page++) { // 30 pages × 100 = 3000-file guard
    const batch = await githubApi(`${apiBase}/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return files;
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (!pr) throw new Error('not a pull_request event — nothing to gate');
  const repo = process.env.GITHUB_REPOSITORY;
  const apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';

  const files = await listChangedFiles(apiBase, repo, pr.number);
  const result = evaluateUntrustedPr({
    authorAssociation: pr.author_association,
    files,
    config: loadGateConfig(process.cwd()),
  });

  const summary = renderGateSummary(result);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);

  if (result.verdict === 'needs-maintainer-review') {
    try {
      await githubApi(`${apiBase}/repos/${repo}/issues/${pr.number}/labels`, {
        method: 'POST',
        body: { labels: [REVIEW_LABEL] },
      });
    } catch (error) {
      console.error(`label application failed (non-fatal): ${error.message}`);
    }
  }

  process.exitCode = result.verdict === 'block' ? 1 : 0;
}

main().catch((error) => {
  // Fail closed: an evaluation error must not wave a PR through.
  console.error(`untrusted-pr-gate failed: ${error.message}`);
  process.exitCode = 1;
});
