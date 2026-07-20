import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// owner: RStack developed by Richardson Gunde

async function readJsonl(filePath) {
  const raw = await readFile(filePath, 'utf8').catch((err) => {
    if (err?.code === 'ENOENT') return '';
    throw err;
  });
  return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  const ms = Date.now() - Date.parse(isoDate);
  return Math.max(0, ms / 86400000);
}

import { readMemoryConfig, projectMemoryDir, verifyEpisodeSignature } from './index.js';

export async function runMemoryDiagnostics(projectRoot, _runId) {
  let memoryDir = projectRoot;
  let staleAfterDays = 90;
  let maxStoreSizeKb = 2048;

  if (projectRoot && (existsSync(join(projectRoot, 'package.json')) || existsSync(join(projectRoot, '.rstack')))) {
    const memoryConfig = await readMemoryConfig(projectRoot);
    memoryDir = projectMemoryDir(projectRoot, memoryConfig);
    staleAfterDays = memoryConfig.staleAfterDays ?? 90;
    maxStoreSizeKb = memoryConfig.maxStoreSizeKb ?? 2048;
  }

  const episodesPath = join(memoryDir, 'episodes.jsonl');
  const episodes = await readJsonl(episodesPath);

  // Store size
  let storeSizeKb = 0;
  if (existsSync(episodesPath)) {
    try {
      const s = await stat(episodesPath);
      storeSizeKb = Math.round(s.size / 1024);
    } catch { storeSizeKb = 0; }
  }

  const diagnostics = [];

  // Signature failures — episodes that exist in the file but fail BFT check
  const signatureFailures = [];
  const rawLines = existsSync(episodesPath)
    ? (await readFile(episodesPath, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean)
    : [];
  // #408: verify signature VALIDITY, not just presence. A present-but-invalid
  // signature is the fingerprint of key drift (RSTACK_SIGNING_KEY changed, or
  // the slug-derived fallback secret changed) — readEpisodes silently filters
  // those out of recall, so without this check "memory not loading" is
  // invisible. We surface a distinct invalid_signature diagnostic and count
  // how many episodes recall would silently drop.
  let invalidSignatureCount = 0;
  for (const line of rawLines) {
    try {
      const ep = JSON.parse(line);
      if (!ep.episode_id) continue;
      if (!ep.signature) {
        signatureFailures.push(ep.episode_id);
        diagnostics.push({ type: 'signature_failure', severity: 'warning', message: `Episode ${ep.episode_id} has no signature`, episode_id: ep.episode_id });
      } else if (!verifyEpisodeSignature(ep)) {
        invalidSignatureCount += 1;
        signatureFailures.push(ep.episode_id);
        diagnostics.push({ type: 'invalid_signature', severity: 'warning', message: `Episode ${ep.episode_id} signature does not verify under the active key — likely RSTACK_SIGNING_KEY drift or a project-slug change; recall silently excludes it`, episode_id: ep.episode_id });
      }
    } catch { /* skip malformed episode memory line */ }
  }
  if (invalidSignatureCount > 0) {
    diagnostics.push({ type: 'signing_key_drift', severity: 'error', message: `${invalidSignatureCount} episode(s) fail signature verification under the active key and are silently excluded from recall. If the signing key or project folder changed, prior memory is orphaned. Re-sign or restore the original RSTACK_SIGNING_KEY.`, episode_id: 'store' });
  }

  // Duplicate episode_ids
  const idCounts = {};
  for (const ep of episodes) {
    if (ep.episode_id) idCounts[ep.episode_id] = (idCounts[ep.episode_id] || 0) + 1;
  }
  const duplicateEpisodes = Object.entries(idCounts).filter(([, count]) => count > 1).map(([id]) => id);
  for (const id of duplicateEpisodes) {
    diagnostics.push({ type: 'duplicate_episode', severity: 'warning', message: `Episode ${id} written ${idCounts[id]} times`, episode_id: id });
  }

  // Stale episodes (access_count === 0 or undefined, older than staleAfterDays)
  const staleCandidates = episodes.filter((ep) => {
    const noAccess = !ep.access_count || ep.access_count === 0;
    const old = daysSince(ep.created_at) > staleAfterDays;
    return noAccess && old;
  }).map((ep) => ep.episode_id);
  for (const id of staleCandidates) {
    diagnostics.push({ type: 'stale_episode', severity: 'warning', message: `Episode ${id} has never been accessed and is older than ${staleAfterDays} days`, episode_id: id });
  }

  // Oversized store
  if (storeSizeKb > maxStoreSizeKb) {
    diagnostics.push({ type: 'oversized_store', severity: 'warning', message: `episodes.jsonl is ${storeSizeKb}KB (max recommended: ${maxStoreSizeKb}KB)`, episode_id: 'store' });
  }

  // Recall hit rate: read retrieval-events.jsonl
  const retrievalEvents = await readJsonl(join(memoryDir, 'retrieval-events.jsonl'));
  const totalRecallQueries = retrievalEvents.length;
  const hitsWithResults = retrievalEvents.filter((e) => e.results_count > 0).length;
  const recallHitRate = totalRecallQueries > 0 ? Math.round((hitsWithResults / totalRecallQueries) * 100) : null;

  return {
    episode_count: episodes.length,
    store_size_kb: storeSizeKb,
    signature_failures: signatureFailures,
    duplicate_episodes: duplicateEpisodes,
    stale_candidates: staleCandidates,
    recall_hit_rate: recallHitRate,
    total_recall_queries: totalRecallQueries,
    last_compaction: episodes.find((ep) => ep.type === 'compaction')?.compacted_at ?? null,
    diagnostics,
    healthy: diagnostics.filter((d) => d.severity === 'error').length === 0,
  };
}
