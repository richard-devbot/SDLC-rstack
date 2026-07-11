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

  function enforceCap(t) {
    if (buckets.size < MAX_TRACKED_BUCKETS) return;
    sweep(t);
    // If every tracked bucket is still active (a flood from many live
    // addresses), evict the least-recently-seen one so the map can never grow
    // past the cap. Evicting the oldest only resets that address's window — a
    // bounded, fair degradation under a deliberate flood.
    while (buckets.size >= MAX_TRACKED_BUCKETS) {
      let oldestKey;
      let oldest = Infinity;
      for (const [key, bucket] of buckets) {
        if (bucket.last < oldest) { oldest = bucket.last; oldestKey = key; }
      }
      buckets.delete(oldestKey);
    }
  }

  return {
    check(key) {
      const t = now();
      if (!buckets.has(key)) enforceCap(t);
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

// The server fire-and-forgets these writes, so serialize them through a tail
// promise: each append waits for the previous one to finish, guaranteeing the
// JSONL line order matches the order appendApprovalAudit was called in — even
// under concurrent approval attempts. A failed write never wedges the queue.
let auditTail = Promise.resolve();

export function appendApprovalAudit(projectRoot, entry) {
  auditTail = auditTail.then(async () => {
    await mkdir(join(projectRoot, '.rstack'), { recursive: true });
    await appendFile(approvalAuditPath(projectRoot), JSON.stringify(entry) + '\n', { flag: 'a' });
  }, async () => {
    // Previous write rejected; reset the chain and still attempt this entry.
    await mkdir(join(projectRoot, '.rstack'), { recursive: true });
    await appendFile(approvalAuditPath(projectRoot), JSON.stringify(entry) + '\n', { flag: 'a' });
  });
  return auditTail;
}

// --- Append-only env-write audit log (#238) ---------------------------------
//
// Every /api/env-write attempt — approved, approval-required, or denied —
// lands as one JSONL line in .rstack/env-writes-audit.jsonl. Entries carry
// the key name, actor, outcome and the VALUE LENGTH only: the plaintext
// value never reaches this file (or any other persisted surface).
export function envWriteAuditPath(projectRoot) {
  return join(projectRoot, '.rstack', 'env-writes-audit.jsonl');
}

let envAuditTail = Promise.resolve();

export function appendEnvWriteAudit(projectRoot, entry) {
  envAuditTail = envAuditTail.then(async () => {
    await mkdir(join(projectRoot, '.rstack'), { recursive: true });
    await appendFile(envWriteAuditPath(projectRoot), JSON.stringify(entry) + '\n', { flag: 'a' });
  }, async () => {
    await mkdir(join(projectRoot, '.rstack'), { recursive: true });
    await appendFile(envWriteAuditPath(projectRoot), JSON.stringify(entry) + '\n', { flag: 'a' });
  });
  return envAuditTail;
}

// --- ETag / 304 support -----------------------------------------------------
export function etagFor(payload) {
  return '"' + createHash('sha256').update(payload).digest('base64url') + '"';
}

// State builders restamp evaluation timestamps ("now") on every rebuild — the
// top-level `ts`, each alert's `ts`, the decision-readiness `generated_at`, and
// any future per-page stamp. They also emit dashboard-internal telemetry about
// HOW the snapshot was assembled (rollup-index age and cold/warm parse
// counters) that flips as the index warms but says nothing about the run data
// itself. Hashing any of these would make every poll a fresh ETag and 304s
// would never fire. Recursively drop these keys so the ETag tracks real,
// client-facing data changes only. Safe for cache correctness: a meaningful
// data change is never *only* a timestamp or an index-internal counter — it
// always moves a status, count, or id that survives this strip.
const VOLATILE_KEY = /^(ts|generated_at|generatedAt|evaluated_at|evaluatedAt|computed_at|computedAt|loadedAt|freshnessMs|fullyParsedRuns|indexServedRuns)$/;

export function stableStringify(value) {
  return JSON.stringify(stripVolatileKeys(value));
}

function stripVolatileKeys(value) {
  if (Array.isArray(value)) return value.map(stripVolatileKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (VOLATILE_KEY.test(key)) continue;
      out[key] = stripVolatileKeys(val);
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
