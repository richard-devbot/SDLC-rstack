// owner: RStack developed by Richardson Gunde
//
// Server hardening primitives for the Business Hub dashboard (issue #86).
// Zero-dependency by design: hand-rolled token bucket, node:crypto ETags,
// append-only JSONL audit trail, opt-in request logging.

import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// --- Per-IP token-bucket rate limiter -------------------------------------
//
// Classic token bucket: each key (client IP) owns a bucket of `capacity`
// tokens that refills continuously at `capacity / windowMs` tokens per ms.
// A request spends one token; an empty bucket means 429 with a Retry-After
// telling the client when the next token lands.
const MAX_TRACKED_BUCKETS = 10_000;

export function createRateLimiter({ capacity = 10, windowMs = 60_000, now = Date.now } = {}) {
  const refillPerMs = capacity / windowMs;
  const buckets = new Map();

  function sweep(t) {
    // Drop buckets that have fully refilled — they carry no state a brand-new
    // bucket would not have. Keeps memory bounded under address churn.
    for (const [key, bucket] of buckets) {
      if ((t - bucket.last) * refillPerMs >= capacity) buckets.delete(key);
    }
  }

  return {
    check(key) {
      const t = now();
      if (buckets.size >= MAX_TRACKED_BUCKETS) sweep(t);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: capacity, last: t };
        buckets.set(key, bucket);
      }
      bucket.tokens = Math.min(capacity, bucket.tokens + (t - bucket.last) * refillPerMs);
      bucket.last = t;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true, retryAfterSec: 0 };
      }
      const retryAfterSec = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
      return { allowed: false, retryAfterSec };
    },
  };
}

// --- Append-only approval audit log ----------------------------------------
//
// Every approval attempt — successful or denied — lands as one JSONL line in
// .rstack/approvals-audit.jsonl. The file is only ever appended to.
export function approvalAuditPath(projectRoot) {
  return join(projectRoot, '.rstack', 'approvals-audit.jsonl');
}

export async function appendApprovalAudit(projectRoot, entry) {
  await mkdir(join(projectRoot, '.rstack'), { recursive: true });
  await appendFile(approvalAuditPath(projectRoot), JSON.stringify(entry) + '\n', { flag: 'a' });
}

// --- ETag / 304 support -----------------------------------------------------
export function etagFor(payload) {
  return '"' + createHash('sha256').update(payload).digest('base64url') + '"';
}

// State builders restamp evaluation timestamps ("now") on every rebuild — the
// top-level `ts`, each alert's `ts`, the decision-readiness `generated_at`, and
// any future per-page stamp. Hashing those would make every poll a fresh ETag
// and 304s would never fire. Recursively drop any key that is a server
// eval-time stamp so the ETag tracks real data changes only. This is safe for
// cache correctness: a meaningful data change is never *only* a timestamp —
// it always moves a status, count, or id that survives this strip.
const VOLATILE_TS_KEY = /^(ts|generated_at|generatedAt|evaluated_at|evaluatedAt|computed_at|computedAt)$/;

export function stableStringify(value) {
  return JSON.stringify(stripVolatileTimestamps(value));
}

function stripVolatileTimestamps(value) {
  if (Array.isArray(value)) return value.map(stripVolatileTimestamps);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (VOLATILE_TS_KEY.test(key)) continue;
      out[key] = stripVolatileTimestamps(val);
    }
    return out;
  }
  return value;
}

export function ifNoneMatchSatisfied(headerValue, etag) {
  if (!headerValue) return false;
  const header = String(headerValue).trim();
  if (header === '*') return true;
  return header
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .includes(etag);
}

// --- Opt-in request logging (RSTACK_HTTP_LOG=1) -----------------------------
export function logHttpRequest(req, res, { env = process.env, write = (line) => process.stdout.write(line) } = {}) {
  if (env.RSTACK_HTTP_LOG !== '1') return;
  const start = Date.now();
  const remote = req.socket?.remoteAddress ?? '-';
  res.on('finish', () => {
    write(`[rstack-http] ${new Date().toISOString()} ${remote} ${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms\n`);
  });
}
