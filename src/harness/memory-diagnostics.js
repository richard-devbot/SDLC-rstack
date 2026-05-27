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

export async function runMemoryDiagnostics(memoryDir, options = {}) {
  const staleAfterDays = options.staleAfterDays ?? 90;
  const maxStoreSizeKb = options.maxStoreSizeKb ?? 2048;

  const episodesPath = join(memoryDir, 'episodes.jsonl');
  const episodes = await readJsonl(episodesPath);

  // Store size
  let storeSizeKb = 0;
  if (existsSync(episodesPath)) {
    try {
      const s = await stat(episodesPath);
      storeSizeKb = Math.round(s.size / 1024);
    } catch {}
  }

  const diagnostics = [];

  // Signature failures — episodes that exist in the file but fail BFT check
  const signatureFailures = [];
  const rawLines = existsSync(episodesPath)
    ? (await readFile(episodesPath, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean)
    : [];
  for (const line of rawLines) {
    try {
      const ep = JSON.parse(line);
      if (!ep.episode_id) continue;
      if (!ep.signature) {
        signatureFailures.push(ep.episode_id);
        diagnostics.push({ type: 'signature_failure', severity: 'warning', message: `Episode ${ep.episode_id} has no signature`, episode_id: ep.episode_id });
      }
      // Note: full crypto verify requires the project slug secret — we check presence only here
    } catch {}
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
    diagnostics.push({ type: 'stale_episode', severity: 'info', message: `Episode ${id} has never been accessed and is older than ${staleAfterDays} days`, episode_id: id });
  }

  // Oversized store
  if (storeSizeKb > maxStoreSizeKb) {
    diagnostics.push({ type: 'oversized_store', severity: 'warning', message: `episodes.jsonl is ${storeSizeKb}KB (max recommended: ${maxStoreSizeKb}KB)` });
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
