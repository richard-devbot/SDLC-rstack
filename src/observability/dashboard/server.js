import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dashboardHtml } from './ui.js';
import { studio3dHtml } from './ui/studio3d.js';
import { buildFullState, resolveDashboardApproval, toClientState } from './state/index.js';
import { validateProjectConfigs } from '../../core/harness/config-validation.js';
import { sourceRoots } from './state/roots.js';
import { collectStageReports } from './state/stage-reports.js';
import {
  appendApprovalAudit,
  appendEnvWriteAudit,
  createRateLimiter,
  etagFor,
  ifNoneMatchSatisfied,
  logHttpRequest,
  stableStringify,
} from './hardening.js';
import {
  ENV_VALUE_MAX_BYTES,
  isEnvGitignored,
  isValidEnvKey,
  updateEnvKey,
} from '../../core/harness/env-file.js';
import { classifyDestructiveAction, destructiveApprovalArtifact } from '../../core/harness/destructive-actions.js';
import { consumeApprovedQueueArtifact, ensurePendingQueueApproval } from '../../core/tracker/approvals.js';
import { decide } from '../../core/harness/decisions.js';
import { latestRunId, runDirectory } from '../../core/harness/runs.js';
import {
  COCKPIT_ACTION_TYPES,
  COCKPIT_AUDIT_EVENTS,
  RESUME_MAX_STEPS,
  appendLedgerEntry,
  checkpointRestoreArtifact,
  claimIdempotencyKey,
  cockpitControlsEnabled,
  completeLedgerEntry,
  isCanonicalStageId,
  isKnownCockpitAction,
  isValidIdempotencyKey,
} from '../../core/harness/cockpit-actions.js';
import { runPipeline } from '../../commands/pipeline-run.js';
import { rollbackToCheckpoint, verifyStageCheckpoint } from '../../core/harness/checkpoints.js';
import { verifyRunAttestations } from '../../core/harness/attestations.js';
import { scanRunDrift } from '../../core/harness/drift.js';
import { withFileLock } from '../../core/harness/safe-write.js';
import { isSafeRunId } from '../../core/harness/approval-audit.js';

// owner: RStack developed by Richardson Gunde

function parseArgv(argv) {
  const out = { port: null, project: null, noBrowser: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) out.port = Number(argv[++i]);
    if (a === '--project' && argv[i + 1]) out.project = argv[++i];
    if (a === '--no-browser') out.noBrowser = true;
  }
  return out;
}

const CLI = parseArgv(process.argv.slice(2));
const PORT = CLI.port ?? Number(process.env.RSTACK_BUSINESS_PORT ?? 3008);
const PROJECT_ROOT = CLI.project
  ? resolve(CLI.project)
  : resolve(process.env.RSTACK_PROJECT_ROOT ?? process.cwd());
const NO_BROWSER = CLI.noBrowser || process.env.RSTACK_NO_BROWSER === '1';
const DASHBOARD_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(DASHBOARD_DIR, '../../..');

const STUDIO_STATIC = new Map([
  ['/studio3d/assets/app.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/app.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/model.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/model.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/transport.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/transport.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/dom.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/dom.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/topology.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/topology.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/geometry.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/geometry.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/scene.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/scene.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/reconciler.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/reconciler.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/transitions.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/transitions.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/behavior.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/behavior.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/robot-poses.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/robot-poses.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/robot.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/robot.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/office.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/office.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/animator.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/animator.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/overlays.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/overlays.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/styles.css', { path: join(DASHBOARD_DIR, 'ui/studio3d/styles.css'), type: 'text/css; charset=utf-8' }],
  ['/studio3d/vendor/three.module.js', { path: join(PACKAGE_ROOT, 'node_modules/three/build/three.module.js'), type: 'text/javascript; charset=utf-8', immutable: true }],
  ['/studio3d/vendor/three.core.js', { path: join(PACKAGE_ROOT, 'node_modules/three/build/three.core.js'), type: 'text/javascript; charset=utf-8', immutable: true }],
  ['/studio3d/vendor/controls/OrbitControls.js', { path: join(PACKAGE_ROOT, 'node_modules/three/examples/jsm/controls/OrbitControls.js'), type: 'text/javascript; charset=utf-8', immutable: true }],
]);

const clients = new Set();
let pollInterval = null;

function safeJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    // best effort only
  }
}

function wsHandshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return false;
  }
  const accept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return true;
}

function wsFrame(data) {
  const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsSend(socket, data) {
  try {
    socket.write(wsFrame(data));
  } catch {
    clients.delete(socket);
  }
}

function broadcast(msg) {
  for (const socket of clients) wsSend(socket, msg);
}

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    try {
      const state = await buildFullState(PROJECT_ROOT);
      broadcast(toClientState(state));
    } catch (err) {
      process.stderr.write(`[rstack-business] poll error: ${err?.message}\n`);
    }
  }, 3000);
}

async function broadcastSnapshot() {
  const state = await buildFullState(PROJECT_ROOT);
  broadcast(toClientState(state));
}

// Per-IP token bucket for POST endpoints: 10 requests per minute, then 429
// with a Retry-After. Applied before auth so a brute-force against the
// approval token is throttled too.
const postRateLimiter = createRateLimiter({ capacity: 10, windowMs: 60_000 });

// Append-only audit trail for every approval attempt — successful AND denied.
// Best-effort: an audit write failure is reported on stderr but never turns a
// valid approval into a 500.
function auditApprovalAttempt(req, { id, decision, resolvedBy, outcome, reason }) {
  const entry = {
    ts: new Date().toISOString(),
    id: id ?? null,
    decision,
    resolvedBy: resolvedBy ?? null,
    remote: req.socket?.remoteAddress ?? null,
    origin: req.headers?.origin ?? null,
    outcome,
    ...(reason ? { reason } : {}),
  };
  appendApprovalAudit(PROJECT_ROOT, entry).catch((err) => {
    process.stderr.write(`[rstack-business] approval audit write failed: ${err?.message}\n`);
  });
}

// A signed approval is required whenever RSTACK_APPROVAL_TOKEN is set: the
// dashboard cannot mint manager identity from an unauthenticated request body.
// Without the env token, approving from the browser is blocked entirely (the
// secure default for a multi-user company hub) — set the token to enable it.
// Token resolution supports rotation without a restart: with
// RSTACK_APPROVAL_TOKEN_FILE set, the file is re-read on every request, so
// replacing its contents rotates the credential immediately. The env token
// remains the simple single-user path. The token value is never logged.
function expectedApprovalToken() {
  const file = process.env.RSTACK_APPROVAL_TOKEN_FILE;
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim() || null;
    } catch {
      // Unreadable token file fails closed: approvals stay disabled.
      return null;
    }
  }
  return process.env.RSTACK_APPROVAL_TOKEN || null;
}

function tokenMatches(provided, expected) {
  const a = Buffer.from(String(provided ?? ''), 'utf8');
  const b = Buffer.from(String(expected ?? ''), 'utf8');
  // Length comparison leaks only length, not content; timingSafeEqual
  // requires equal-length buffers.
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Read-path authentication (#164): SDLC state (goals, costs, artifacts,
// security notes) is sensitive. Foreign browser Origins are ALWAYS rejected
// on read APIs and the WebSocket stream — CORS does not protect WS upgrades.
// Setting RSTACK_DASHBOARD_READ_TOKEN (or _FILE, re-read per request for
// rotation, same pattern as the approval token) additionally requires the
// token on every read via the x-rstack-read-token header or ?token= param.
function expectedReadToken() {
  const file = process.env.RSTACK_DASHBOARD_READ_TOKEN_FILE;
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim() || null;
    } catch {
      // Unreadable token file fails closed: reads stay locked.
      return 'unreadable-token-file-fails-closed';
    }
  }
  return process.env.RSTACK_DASHBOARD_READ_TOKEN || null;
}

function readAuthError(req, url) {
  const origin = req.headers.origin;
  if (origin && !LOCALHOST_ORIGIN.test(origin)) {
    return { code: 403, msg: 'cross-origin read rejected' };
  }
  const expected = expectedReadToken();
  if (expected) {
    const token = req.headers['x-rstack-read-token'] || url.searchParams.get('token');
    if (!token || !tokenMatches(token, expected)) {
      return { code: 401, msg: 'missing or invalid dashboard read token — set RSTACK_DASHBOARD_READ_TOKEN on the client' };
    }
  }
  return null;
}

function denyRead(res, authErr) {
  res.writeHead(authErr.code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: authErr.msg }));
}

function approvalAuthError(req) {
  const expected = expectedApprovalToken();
  if (!expected) {
    return { code: 403, msg: 'dashboard approvals are disabled — set RSTACK_APPROVAL_TOKEN (or RSTACK_APPROVAL_TOKEN_FILE) to enable signed approvals, or approve via sdlc_approve' };
  }
  // CSRF: a cross-site form POST cannot set custom headers and would carry a
  // foreign Origin. Require the token header and a localhost (or absent) origin.
  const origin = req.headers.origin;
  if (origin && !LOCALHOST_ORIGIN.test(origin)) {
    return { code: 403, msg: 'cross-origin approval rejected' };
  }
  const token = req.headers['x-rstack-approval-token'];
  if (!token || !tokenMatches(token, expected)) {
    return { code: 401, msg: 'missing or invalid approval token' };
  }
  return null;
}

async function handleApproval(req, res, decision) {
  const fail = (code, msg) => {
    if (!res.headersSent) {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg }));
    }
  };
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.includes('application/json')) {
    auditApprovalAttempt(req, { decision, outcome: 'denied', reason: 'Content-Type must be application/json' });
    return fail(415, 'Content-Type must be application/json');
  }
  const authErr = approvalAuthError(req);
  if (authErr) {
    auditApprovalAttempt(req, { decision, outcome: 'denied', reason: authErr.msg });
    return fail(authErr.code, authErr.msg);
  }

  let body = '';
  let tooLarge = false;
  req.on('error', () => fail(400, 'request stream error'));
  req.on('data', (chunk) => {
    if (tooLarge) return;
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > 64 * 1024) {
      // Reject oversized bodies on the spot but keep the socket alive so the
      // 413 and its audit entry actually reach the client. Destroying the
      // request here (the old behavior) raced the response into a connection
      // reset. Drain the rest of the stream instead.
      tooLarge = true;
      auditApprovalAttempt(req, { decision, outcome: 'denied', reason: 'request body too large' });
      fail(413, 'request body too large');
      req.resume();
    }
  });
  req.on('end', async () => {
    if (tooLarge) return;
    const parsed = safeJson(body) ?? {};
    const { id, resolvedBy } = parsed;
    try {
      if (!id) {
        auditApprovalAttempt(req, {
          decision,
          resolvedBy: typeof resolvedBy === 'string' ? resolvedBy : null,
          outcome: 'denied',
          reason: 'missing approval id',
        });
        return fail(400, 'missing approval id');
      }
      if (!resolvedBy || typeof resolvedBy !== 'string') {
        auditApprovalAttempt(req, { id, outcome: 'denied', decision, reason: 'resolvedBy (approver identity) is required' });
        return fail(400, 'resolvedBy (approver identity) is required');
      }
      // Actor evidence: token-verified, not just a body string.
      const ok = await resolveDashboardApproval(PROJECT_ROOT, id, decision, resolvedBy, {
        actor: { name: resolvedBy, via: 'dashboard', tokenVerified: true, ts: new Date().toISOString() },
      });
      auditApprovalAttempt(req, { id, decision, resolvedBy, outcome: ok ? 'success' : 'not-found' });
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
      // Fire-and-forget the refresh: the approval already succeeded and the 200
      // is sent, so a snapshot-build failure must not fall into the catch below
      // and append a false `error` audit entry for a completed approval.
      if (ok) {
        broadcastSnapshot().catch((broadcastErr) => {
          process.stderr.write(`[rstack-business] approval broadcast error: ${broadcastErr?.message}\n`);
        });
      }
    } catch (err) {
      process.stderr.write(`[rstack-business] approval error: ${err?.message}\n`);
      const status = Number(err?.statusCode) || 500;
      auditApprovalAttempt(req, {
        id,
        decision,
        resolvedBy: typeof resolvedBy === 'string' ? resolvedBy : null,
        outcome: status >= 400 && status < 500 ? 'denied' : 'error',
        reason: String(err?.message),
      });
      fail(status, String(err?.message));
    }
  });
}

// Shared guarded-POST chain for the write endpoints (#238) — the EXACT same
// trust boundary as /api/approve: Content-Type enforced, approval token
// (fail closed when unset: the route is disabled with 403), CSRF origin
// check, 64KB body cap. The per-IP rate limiter already ran in the request
// handler before any POST route is reached. `audit(entry)` records every
// attempt — denied and successful; `onBody(parsed, fail)` runs only for an
// authenticated, size-checked, parsed body.
function handleGuardedPost(req, res, { audit, onBody }) {
  const fail = (code, msg, extra) => {
    if (!res.headersSent) {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg, ...(extra ?? {}) }));
    }
  };
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.includes('application/json')) {
    audit({ outcome: 'denied', reason: 'Content-Type must be application/json' });
    return fail(415, 'Content-Type must be application/json');
  }
  const authErr = approvalAuthError(req);
  if (authErr) {
    audit({ outcome: 'denied', reason: authErr.msg });
    return fail(authErr.code, authErr.msg);
  }

  let body = '';
  let tooLarge = false;
  req.on('error', () => fail(400, 'request stream error'));
  req.on('data', (chunk) => {
    if (tooLarge) return;
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > 64 * 1024) {
      tooLarge = true;
      audit({ outcome: 'denied', reason: 'request body too large' });
      fail(413, 'request body too large');
      req.resume();
    }
  });
  req.on('end', async () => {
    if (tooLarge) return;
    try {
      await onBody(safeJson(body) ?? {}, fail);
    } catch (err) {
      const status = Number(err?.statusCode) || 500;
      audit({ outcome: status >= 400 && status < 500 ? 'denied' : 'error', reason: String(err?.message) });
      fail(status, String(err?.message));
    }
  });
}

// Append the pinned env_key_written event to the LATEST run's events.jsonl.
// A project with no runs yet skips the event silently (documented: run event
// streams are run-scoped; the env-writes audit file is the run-independent
// record). Never carries the value — key, actor and value length only.
async function appendEnvWriteEvent(projectRoot, event) {
  const runId = await latestRunId(projectRoot);
  if (!runId) return null;
  const eventsPath = join(runDirectory(projectRoot, runId), 'events.jsonl');
  await withFileLock(eventsPath, async () => {
    await appendFile(eventsPath, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  });
  return runId;
}

// POST /api/env-write (#238): approval-gated .env writes, dogfooding the
// destructive-action gate. TWO-STEP by design — the plaintext value is never
// persisted anywhere before approval:
//   1. No trusted APPROVED queue record for destructive-action:env-write:<KEY>
//      → ensure a PENDING queue entry (renders on the Approvals page, where
//      manager policy + the token-verified actor stamp apply for free) and
//      return 409 approval_required. The value in this request is discarded.
//   2. With a trusted approval → the approval is atomically CONSUMED
//      (one-shot; a second write needs re-approval), the key is written via
//      the locked atomic .env writer, the audit line + run event record the
//      key/actor/length — never the value — and the snapshot re-broadcasts.
// A .env that is not gitignored refuses outright (409 gitignore_required).
async function handleEnvWrite(req, res) {
  let auditContext = {};
  const audit = (entry) => {
    appendEnvWriteAudit(PROJECT_ROOT, {
      ts: new Date().toISOString(),
      remote: req.socket?.remoteAddress ?? null,
      origin: req.headers?.origin ?? null,
      ...auditContext,
      ...entry,
    }).catch((err) => {
      process.stderr.write(`[rstack-business] env-write audit failed: ${err?.message}\n`);
    });
  };
  handleGuardedPost(req, res, {
    audit,
    onBody: async (parsed, fail) => {
      const { key, value, resolvedBy } = parsed;
      auditContext = {
        key: typeof key === 'string' ? key.slice(0, 200) : null,
        actor: typeof resolvedBy === 'string' ? resolvedBy.slice(0, 200) : null,
      };
      if (!isValidEnvKey(key)) {
        audit({ outcome: 'denied', reason: 'invalid env key' });
        return fail(400, 'invalid env key — expected ^[A-Z][A-Z0-9_]*$');
      }
      if (!resolvedBy || typeof resolvedBy !== 'string') {
        audit({ outcome: 'denied', reason: 'resolvedBy (requester identity) is required' });
        return fail(400, 'resolvedBy (requester identity) is required');
      }
      // Validate the value BEFORE any approval is consumed, so a malformed
      // request can never burn a one-shot approval.
      if (typeof value !== 'string') {
        audit({ outcome: 'denied', reason: 'value must be a string' });
        return fail(400, 'value (string) is required');
      }
      if (Buffer.byteLength(value, 'utf8') > ENV_VALUE_MAX_BYTES) {
        audit({ outcome: 'denied', reason: 'value too large', valueLength: value.length });
        return fail(400, `value exceeds ${ENV_VALUE_MAX_BYTES} bytes`);
      }

      // Gitignore gate: writing a secret into a file git would commit is a
      // leak, not a configuration step. Refuse until .env is ignored.
      if (!(await isEnvGitignored(PROJECT_ROOT))) {
        audit({ outcome: 'denied', reason: 'gitignore_required' });
        return fail(409, 'gitignore_required', {
          detail: '.env is not gitignored in this project — add ".env" to .gitignore before writing secrets through the hub',
        });
      }

      // Dogfood the central classifier: a .env write IS a secret-write. This
      // is an invariant, not an input check — if the classifier ever stops
      // flagging it, refuse loudly rather than write an ungated secret.
      const verdict = classifyDestructiveAction({ toolName: 'write', input: { file_path: '.env' } });
      if (!verdict.destructive) {
        audit({ outcome: 'error', reason: 'destructive classifier did not flag the .env write' });
        return fail(500, 'internal invariant failed: .env write did not classify as destructive');
      }

      const artifact = destructiveApprovalArtifact(`env-write:${key}`);
      // Atomic one-shot claim: only a queue record that passes the SAME
      // audit as every gate (trustedApprovedArtifacts — per-record
      // validation + replay/ordering history checks) can be consumed here.
      const approval = await consumeApprovedQueueArtifact(PROJECT_ROOT, artifact);
      if (!approval) {
        const pendingEntry = await ensurePendingQueueApproval(PROJECT_ROOT, {
          id: `env-write:${key}`,
          artifact,
          type: 'env_write',
          title: `Write .env key ${key}`,
          detail: `Business Hub requests approval to set ${key} in .env (${verdict.category}). The value is held client-side only until approved.`,
          requestedBy: resolvedBy,
          category: verdict.category,
        });
        audit({ outcome: 'approval-required', artifact });
        return fail(409, 'approval_required', {
          artifact,
          approval_id: pendingEntry.id,
          detail: `Approve '${artifact}' on the Approvals page, then submit the write again. The value was NOT stored.`,
        });
      }

      const result = await updateEnvKey(PROJECT_ROOT, key, value);
      audit({
        outcome: 'written',
        artifact,
        approvedBy: approval.resolvedBy ?? null,
        created: result.created,
        valueLength: value.length,
      });
      try {
        await appendEnvWriteEvent(PROJECT_ROOT, {
          type: 'env_key_written',
          key,
          actor: resolvedBy,
          masked_value_length: value.length,
        });
      } catch (err) {
        // The write succeeded; a run-event failure must not turn it into a 500.
        process.stderr.write(`[rstack-business] env-write event append failed: ${err?.message}\n`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // The value is never echoed back.
      res.end(JSON.stringify({ ok: true, key, written: true, created: result.created, approvedBy: approval.resolvedBy ?? null }));
      broadcastSnapshot().catch((err) => {
        process.stderr.write(`[rstack-business] env-write broadcast error: ${err?.message}\n`);
      });
    },
  });
}

// POST /api/decide (#238): resolve or waive a Decision Queue item from the
// hub, behind the same trust boundary as /api/approve. Routes through
// harness decisions.decide() — never a second implementation.
async function handleDecide(req, res) {
  const audit = (entry) => {
    appendApprovalAudit(PROJECT_ROOT, {
      ts: new Date().toISOString(),
      kind: 'decision',
      remote: req.socket?.remoteAddress ?? null,
      origin: req.headers?.origin ?? null,
      ...entry,
    }).catch((err) => {
      process.stderr.write(`[rstack-business] decision audit write failed: ${err?.message}\n`);
    });
  };
  handleGuardedPost(req, res, {
    audit,
    onBody: async (parsed, fail) => {
      const { runId, decisionId, status, resolution, resolvedBy } = parsed;
      const base = {
        id: typeof decisionId === 'string' ? decisionId.slice(0, 200) : null,
        decision: typeof status === 'string' ? status.slice(0, 40) : null,
        resolvedBy: typeof resolvedBy === 'string' ? resolvedBy.slice(0, 200) : null,
        runId: typeof runId === 'string' ? runId.slice(0, 200) : null,
      };
      if (!decisionId || typeof decisionId !== 'string') {
        audit({ ...base, outcome: 'denied', reason: 'missing decision id' });
        return fail(400, 'decisionId is required');
      }
      if (status !== 'resolved' && status !== 'waived') {
        audit({ ...base, outcome: 'denied', reason: 'status must be resolved or waived' });
        return fail(400, 'status must be resolved or waived');
      }
      if (!resolvedBy || typeof resolvedBy !== 'string') {
        audit({ ...base, outcome: 'denied', reason: 'resolvedBy (decider identity) is required' });
        return fail(400, 'resolvedBy (decider identity) is required');
      }
      // Locate the root owning the run (the hub watches several); an
      // explicit runId that exists nowhere is a 404, not a silent default.
      let targetRoot = PROJECT_ROOT;
      if (runId) {
        // #241: reuse the canonical run-id validator (approval-audit.js) rather
        // than an ad-hoc includes() check, so this write path and the gate-side
        // audit can never drift on what a "safe run id" is.
        if (!isSafeRunId(runId)) {
          audit({ ...base, outcome: 'denied', reason: 'unsafe run id' });
          return fail(400, 'unsafe run id');
        }
        const roots = await sourceRoots(PROJECT_ROOT, {});
        targetRoot = roots.find((root) => existsSync(join(root, '.rstack', 'runs', runId))) ?? null;
        if (!targetRoot) {
          audit({ ...base, outcome: 'not-found', reason: 'run not found' });
          return fail(404, 'run not found');
        }
      }
      try {
        const decision = await decide(targetRoot, runId || undefined, decisionId, {
          status,
          resolution: typeof resolution === 'string' ? resolution : '',
          resolvedBy,
        });
        audit({ ...base, outcome: 'success' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, decision }));
        // #241: the decision already succeeded and the 200 is sent — the live
        // WS refresh is BY DESIGN best-effort. A push failure is logged to
        // stderr and clients re-poll (/api/state every 3s); it must never turn a
        // completed decision into an error. Same contract as /api/env-write.
        broadcastSnapshot().catch((err) => {
          process.stderr.write(`[rstack-business] decision broadcast error: ${err?.message}\n`);
        });
      } catch (err) {
        const message = String(err?.message ?? err);
        const notFound = /not found|no rstack run/i.test(message);
        audit({ ...base, outcome: notFound ? 'not-found' : 'error', reason: message });
        fail(notFound ? 404 : 400, message);
      }
    },
  });
}

// ── Cockpit controls (#285) ──────────────────────────────────────────────
// Authenticated, audited, idempotent run/recovery actions. Same trust boundary
// as every write endpoint (handleGuardedPost: Content-Type + approval token +
// CSRF origin + 64KB cap + the per-IP rate limiter that already ran). OFF by
// default: the feature flag is checked per the TARGET run's project root before
// any work. See docs/security/cockpit-controls-threat-model.md.

const str200 = (value) => (typeof value === 'string' ? value.slice(0, 200) : null);

async function readTargetPolicy(root) {
  const raw = await readFile(join(root, '.rstack', 'policy.json'), 'utf8').catch(() => '');
  return safeJson(raw) ?? {};
}

// Locate the project root (among the roots the hub watches) that owns runId,
// via manifest.json presence — never trusting the body as a path.
async function resolveRunRoot(runId) {
  if (!isSafeRunId(runId)) return null;
  const roots = await sourceRoots(PROJECT_ROOT, {});
  return roots.find((root) => existsSync(join(root, '.rstack', 'runs', runId, 'manifest.json'))) ?? null;
}

// Append the immutable per-run audit event to the run timeline. Never carries
// a token or secret. Best-effort: the action already succeeded.
async function appendCockpitRunEvent(root, runId, event) {
  const eventsPath = join(runDirectory(root, runId), 'events.jsonl');
  await withFileLock(eventsPath, async () => {
    await appendFile(eventsPath, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  });
}

// resume-run: advance the run via the model-free runner, bounded, stopping at
// every human gate by construction (#124). Re-derives eligibility from ground
// truth — a run with no actionable model-free work is 409 not_eligible.
async function executeResumeRun(root, runId, resolvedBy) {
  const report = await runPipeline(root, { runId, maxSteps: RESUME_MAX_STEPS });
  const executed = report.steps.some((step) => step.action && step.action !== 'stop');
  // These stop reasons mean "nothing the operator can advance right now" — a
  // gate to resolve, or already complete. missing_contract is NOT here: that is
  // a real advance (the packet is prepared and awaits the operator's agent).
  const NOT_ELIGIBLE = new Set(['complete', 'no_actionable_work', 'pending_approval', 'blocked_retry_policy', 'ask_user', 'dry_run']);
  if (!executed && NOT_ELIGIBLE.has(report.stopped_on)) {
    return {
      status: 409,
      phase: 'failed',
      outcome: 'not_eligible',
      detail: `resume-run is not eligible: ${report.stopped_on}`,
      body: { ok: false, error: 'not_eligible', reason: report.stopped_on, detail: report.steps.at(-1)?.detail ?? null },
    };
  }
  const body = {
    ok: true,
    action: COCKPIT_ACTION_TYPES.RESUME_RUN,
    runId,
    outcome: 'accepted',
    stopped_on: report.stopped_on,
    steps: report.steps.map((step) => ({ step: step.step, action: step.action, task_id: step.task_id ?? null, detail: step.detail })),
    actor: resolvedBy,
  };
  return {
    status: 202,
    phase: 'completed',
    outcome: 'accepted',
    detail: `resume-run advanced ${report.steps.length} step(s); stopped_on ${report.stopped_on}`,
    body,
    runEvent: {
      type: COCKPIT_AUDIT_EVENTS[COCKPIT_ACTION_TYPES.RESUME_RUN],
      actor: resolvedBy,
      steps: report.steps.length,
      stopped_on: report.stopped_on,
      source: 'business-hub',
    },
  };
}

// restore-checkpoint: destructive two-step (mirrors /api/env-write). Deep-verify
// the checkpoint, require an approved one-shot artifact, then roll back.
async function executeRestoreCheckpoint(root, runId, stageId, resolvedBy) {
  if (!isCanonicalStageId(stageId)) {
    return {
      status: 400, phase: 'failed', outcome: 'invalid_stage',
      detail: `"${stageId}" is not a canonical SDLC stage id`,
      body: { ok: false, error: 'invalid_stage', detail: `"${stageId}" is not a canonical SDLC stage id` },
    };
  }
  const runDir = runDirectory(root, runId);
  // Ground truth, not the client's claim: deep sha-256 verification before any
  // approval is consumed, so a malformed request can never burn a one-shot.
  const verification = verifyStageCheckpoint(runDir, stageId, { deep: true });
  if (!verification.restorable) {
    return {
      status: 409, phase: 'failed', outcome: 'not_eligible',
      detail: `checkpoint for ${stageId} is not restorable (${verification.reason})`,
      body: { ok: false, error: 'not_eligible', reason: verification.reason, detail: verification.detail ?? null },
    };
  }
  const artifact = checkpointRestoreArtifact(runId, stageId);
  const approval = await consumeApprovedQueueArtifact(root, artifact);
  if (!approval) {
    const pending = await ensurePendingQueueApproval(root, {
      id: `checkpoint-restore:${runId}:${stageId}`,
      artifact,
      type: 'checkpoint_restore',
      title: `Restore ${stageId} checkpoint (run ${runId})`,
      detail: `Business Hub requests approval to restore the ${stageId} stage of run ${runId} from its last verified checkpoint. Destructive — overwrites current stage artifacts.`,
      requestedBy: resolvedBy,
      runId,
      taskId: stageId,
      category: 'checkpoint_restore',
    });
    return {
      status: 409, phase: 'failed', outcome: 'approval_required',
      detail: `approval required for ${artifact}`,
      body: { ok: false, error: 'approval_required', artifact, approval_id: pending.id, detail: `Approve '${artifact}' on the Approvals page, then submit the restore again.` },
    };
  }
  const result = await rollbackToCheckpoint(runDir, stageId);
  if (result.status !== 'SUCCESS') {
    // The one-shot approval was consumed but the restore failed (e.g. the
    // checkpoint was tampered between verify and rollback) — fail closed and
    // record it. A retry needs a fresh approval.
    return {
      status: 409, phase: 'failed', outcome: 'error',
      detail: `restore failed after approval: ${result.status}`,
      body: { ok: false, error: 'restore_failed', status: result.status, detail: result.detail ?? null },
    };
  }
  const body = {
    ok: true,
    action: COCKPIT_ACTION_TYPES.RESTORE_CHECKPOINT,
    runId, stageId,
    outcome: 'accepted',
    status: result.status,
    approvedBy: approval.resolvedBy ?? null,
    detail: result.detail,
  };
  return {
    status: 202, phase: 'completed', outcome: 'accepted',
    detail: `restored ${stageId} from checkpoint (approved by ${approval.resolvedBy ?? 'unknown'})`,
    body,
    runEvent: {
      type: COCKPIT_AUDIT_EVENTS[COCKPIT_ACTION_TYPES.RESTORE_CHECKPOINT],
      actor: resolvedBy,
      stage_id: stageId,
      approved_by: approval.resolvedBy ?? null,
      source: 'business-hub',
    },
  };
}

async function handleCockpitAction(req, res) {
  let auditCtx = {};
  const audit = (entry) => {
    appendLedgerEntry(PROJECT_ROOT, {
      remote: req.socket?.remoteAddress ?? null,
      origin: req.headers?.origin ?? null,
      ...auditCtx,
      ...entry,
    }).catch((err) => process.stderr.write(`[rstack-business] cockpit audit failed: ${err?.message}\n`));
  };
  handleGuardedPost(req, res, {
    // Denials from the shared chain (bad Content-Type, auth, oversized) audit here.
    audit: (entry) => audit({ phase: 'denied', ...entry }),
    onBody: async (parsed, fail) => {
      const { action, runId, stageId, idempotencyKey, resolvedBy } = parsed;
      auditCtx = { action: str200(action), runId: str200(runId), stageId: str200(stageId), actor: str200(resolvedBy) };

      if (!isKnownCockpitAction(action)) {
        audit({ phase: 'denied', outcome: 'error', reason: 'unknown action' });
        return fail(400, `unknown action — expected one of ${Object.values(COCKPIT_ACTION_TYPES).join(', ')}`);
      }
      if (!resolvedBy || typeof resolvedBy !== 'string') {
        audit({ phase: 'denied', outcome: 'error', reason: 'resolvedBy required' });
        return fail(400, 'resolvedBy (operator identity) is required');
      }
      if (!isValidIdempotencyKey(idempotencyKey)) {
        audit({ phase: 'denied', outcome: 'error', reason: 'invalid idempotencyKey' });
        return fail(400, 'idempotencyKey (8–128 chars of [A-Za-z0-9._:-]) is required');
      }
      if (!isSafeRunId(runId)) {
        audit({ phase: 'denied', outcome: 'error', reason: 'unsafe run id' });
        return fail(400, 'unsafe or missing run id');
      }
      const targetRoot = await resolveRunRoot(runId);
      if (!targetRoot) {
        audit({ phase: 'denied', outcome: 'not_found', reason: 'run not found' });
        return fail(404, 'run not found');
      }
      // Feature flag, authoritative per target root (never inferred from the
      // client): OFF → 403 before any work.
      if (!cockpitControlsEnabled(await readTargetPolicy(targetRoot), process.env)) {
        audit({ phase: 'denied', outcome: 'forbidden', reason: 'cockpit controls disabled' });
        return fail(403, 'cockpit controls are disabled — set RSTACK_COCKPIT_CONTROLS=1 or policy cockpit_controls.enabled');
      }
      if (action === COCKPIT_ACTION_TYPES.RESTORE_CHECKPOINT && !stageId) {
        audit({ phase: 'denied', outcome: 'error', reason: 'stageId required' });
        return fail(400, 'stageId is required for restore-checkpoint');
      }

      const meta = { action, runId, stageId: stageId ?? null, actor: resolvedBy, remote: req.socket?.remoteAddress ?? null, origin: req.headers?.origin ?? null };
      // Idempotency: claim the key atomically. A completed key replays its
      // stored result; an in-flight key is a duplicate (409).
      const claim = await claimIdempotencyKey(targetRoot, idempotencyKey, meta);
      if (claim.status === 'completed') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...(claim.result ?? {}), replayed: true }));
        return;
      }
      if (claim.status === 'in_progress') {
        audit({ phase: 'denied', outcome: 'in_progress', reason: 'duplicate in-flight request' });
        return fail(409, 'a request with this idempotencyKey is already in progress');
      }

      const outcome = action === COCKPIT_ACTION_TYPES.RESUME_RUN
        ? await executeResumeRun(targetRoot, runId, resolvedBy)
        : await executeRestoreCheckpoint(targetRoot, runId, stageId, resolvedBy);

      await completeLedgerEntry(targetRoot, idempotencyKey, {
        phase: outcome.phase,
        meta,
        outcome: outcome.outcome,
        detail: outcome.detail,
        result: outcome.phase === 'completed' ? outcome.body : undefined,
      });
      if (outcome.runEvent) {
        await appendCockpitRunEvent(targetRoot, runId, outcome.runEvent).catch((err) => {
          process.stderr.write(`[rstack-business] cockpit run event failed: ${err?.message}\n`);
        });
      }
      res.writeHead(outcome.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(outcome.body));
      if (outcome.phase === 'completed') {
        broadcastSnapshot().catch((err) => process.stderr.write(`[rstack-business] cockpit broadcast error: ${err?.message}\n`));
      }
    },
  });
}

// Send a JSON response with a strong content-hash ETag on 200s, answering a
// matching If-None-Match with an empty 304 instead of the full body.
// `hashInput` lets callers hash a stable projection of the body (e.g. the
// state without its per-request timestamp) so 304s are actually reachable.
function sendJsonCacheable(req, res, status, body, { hashInput } = {}) {
  const payload = JSON.stringify(body);
  if (status !== 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(payload);
    return;
  }
  const etag = etagFor(hashInput ?? payload);
  if (ifNoneMatchSatisfied(req.headers['if-none-match'], etag)) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', ETag: etag });
  res.end(payload);
}

// Read one run artifact, strictly sandboxed: the run is located via the known
// project roots, the resolved path must stay inside that run directory, and
// only size-capped text artifacts are served.
const ARTIFACT_MAX_BYTES = 512 * 1024;
const ARTIFACT_EXTENSIONS = new Set(['.md', '.json', '.jsonl', '.txt', '.yml', '.yaml']);

// Locate a run directory by id across the known project roots, rejecting any
// id that could traverse the filesystem. Returns null if not found / unsafe.
async function resolveRunDir(runId) {
  // #241: canonical run-id validation (approval-audit.js), not an ad-hoc check.
  if (!isSafeRunId(runId)) return null;
  const roots = await sourceRoots(PROJECT_ROOT, {});
  return roots
    .map((root) => join(root, '.rstack', 'runs', runId))
    .find((dir) => existsSync(dir)) ?? null;
}

async function handleRunReport(req, url, res) {
  const sendJson = (status, body) => sendJsonCacheable(req, res, status, body);
  try {
    const runId = url.searchParams.get('run') ?? '';
    if (!runId) return sendJson(400, { error: 'run is required' });
    const runDir = await resolveRunDir(runId);
    if (!runDir) return sendJson(404, { error: 'run not found' });
    const { stages, deliverables } = await collectStageReports(runDir);
    // #73: attestation verification for the run report — on-demand (page
    // load, not the poll loop), best-effort: a verification crash must never
    // take the report down with it.
    let attestations = null;
    try {
      const projectRoot = dirname(dirname(dirname(runDir))); // <root>/.rstack/runs/<id>
      const verified = await verifyRunAttestations(projectRoot, runId);
      attestations = {
        total: verified.total,
        valid: verified.valid,
        missing: verified.missing.length,
        ok: verified.ok,
        findings: verified.findings.map((finding) => ({
          file: finding.file,
          valid: finding.valid,
          task_id: finding.task_id,
          predicate_type: finding.predicate_type,
          created_at: finding.created_at,
          signature_type: finding.signature_type,
          issues: finding.issues.slice(0, 3),
        })),
      };
    } catch { /* no attestation data — the report renders without the section */ }
    sendJson(200, { run: runId, stages, deliverables, attestations });
  } catch (err) {
    sendJson(500, { error: String(err?.message) });
  }
}

// #74: on-demand traceability drift scan for one run (page load, not the
// poll loop) — same sandboxed run resolution as the run report.
async function handleDrift(req, url, res) {
  const sendJson = (status, body) => sendJsonCacheable(req, res, status, body);
  try {
    const runId = url.searchParams.get('run') ?? '';
    if (!runId) return sendJson(400, { error: 'run is required' });
    const runDir = await resolveRunDir(runId);
    if (!runDir) return sendJson(404, { error: 'run not found' });
    const projectRoot = dirname(dirname(dirname(runDir))); // <root>/.rstack/runs/<id>
    sendJson(200, await scanRunDrift(projectRoot, runId));
  } catch (err) {
    sendJson(500, { error: String(err?.message) });
  }
}

async function handleArtifact(req, url, res) {
  const sendJson = (status, body) => sendJsonCacheable(req, res, status, body);
  try {
    const runId = url.searchParams.get('run') ?? '';
    const relPath = url.searchParams.get('path') ?? '';
    if (!runId || !relPath) return sendJson(400, { error: 'run and path are required' });
    const runDir = await resolveRunDir(runId);
    if (!runDir) return sendJson(404, { error: 'run not found' });

    const target = resolve(runDir, relPath);
    if (target !== runDir && !target.startsWith(runDir + sep)) return sendJson(403, { error: 'path escapes the run directory' });
    const extension = target.slice(target.lastIndexOf('.')).toLowerCase();
    if (!ARTIFACT_EXTENSIONS.has(extension)) return sendJson(415, { error: 'only text artifacts are served' });
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) return sendJson(404, { error: 'artifact not found' });
    if (info.size > ARTIFACT_MAX_BYTES) return sendJson(413, { error: `artifact exceeds ${ARTIFACT_MAX_BYTES} bytes` });

    const content = await readFile(target, 'utf8');
    sendJson(200, { run: runId, path: relPath, size: info.size, content });
  } catch (err) {
    sendJson(500, { error: String(err?.message) });
  }
}

// TLS is opt-in (#150): set RSTACK_TLS_CERT and RSTACK_TLS_KEY (PEM file
// paths) to serve HTTPS — needed when the hub sits on a shared network where
// the approval token must not travel in cleartext. Localhost HTTP stays the
// default. A half-configured pair fails loudly instead of silently serving
// HTTP with the operator believing TLS is on.
function resolveTlsOptions() {
  const certPath = process.env.RSTACK_TLS_CERT;
  const keyPath = process.env.RSTACK_TLS_KEY;
  if (!certPath && !keyPath) return null;
  if (!certPath || !keyPath) {
    throw new Error('TLS misconfigured: both RSTACK_TLS_CERT and RSTACK_TLS_KEY must be set (PEM file paths).');
  }
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}

const TLS_OPTIONS = resolveTlsOptions();
const SCHEME = TLS_OPTIONS ? 'https' : 'http';

const requestHandler = async (req, res) => {
  logHttpRequest(req, res);
  const url = new URL(req.url, `${SCHEME}://localhost:${PORT}`);

  // CORS: only reflect localhost origins — a wildcard would let any website
  // a browser visits silently read the full SDLC state from this port.
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Throttle all POSTs per client IP before any routing or auth work, so the
  // approval token cannot be brute-forced and write endpoints cannot be spammed.
  if (req.method === 'POST') {
    const verdict = postRateLimiter.check(req.socket?.remoteAddress ?? 'unknown');
    if (!verdict.allowed) {
      if (url.pathname === '/api/approve' || url.pathname === '/api/reject') {
        auditApprovalAttempt(req, {
          decision: url.pathname === '/api/approve' ? 'approved' : 'rejected',
          outcome: 'rate-limited',
        });
      }
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(verdict.retryAfterSec),
      });
      res.end(JSON.stringify({ ok: false, error: 'rate limit exceeded — retry later' }));
      return;
    }
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: PORT, ts: new Date().toISOString() }));
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const authErr = readAuthError(req, url);
    if (authErr) return denyRead(res, authErr);
    try {
      // Scope values are opaque ids emitted by the server-owned catalog.
      // buildFullState validates them and resets invalid/stale selections to
      // an honest global snapshot; the browser never supplies filesystem paths.
      const scope = url.searchParams.get('run')
        ? { runKey: url.searchParams.get('run') }
        : url.searchParams.get('project')
          ? { projectId: url.searchParams.get('project') }
          : null;
      const state = await buildFullState(PROJECT_ROOT, { scope });
      // [wave:money] Serve the SAME projection the WebSocket path sends. The
      // raw state leaked here before, so REST-served clients (first paint +
      // WS-down fallback) missed projection-only fields — evidenceRecent,
      // stageCost/stageTokens, tokenTotals, metricsSource, loopBudgets — and
      // hauled the full event/evidence streams over the wire.
      const clientState = toClientState(state);
      // Hash a projection with server eval-time timestamps stripped, so an
      // unchanged project yields a stable ETag and revalidation returns 304.
      sendJsonCacheable(req, res, 200, clientState, { hashInput: stableStringify(clientState) });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err?.message) }));
    }
    return;
  }

  if (url.pathname === '/api/approve' && req.method === 'POST') {
    await handleApproval(req, res, 'approved');
    return;
  }

  if (url.pathname === '/api/reject' && req.method === 'POST') {
    await handleApproval(req, res, 'rejected');
    return;
  }

  if (url.pathname === '/api/env-write' && req.method === 'POST') {
    await handleEnvWrite(req, res);
    return;
  }

  if (url.pathname === '/api/decide' && req.method === 'POST') {
    await handleDecide(req, res);
    return;
  }

  if (url.pathname === '/api/action' && req.method === 'POST') {
    await handleCockpitAction(req, res);
    return;
  }

  if (req.method === 'GET' && STUDIO_STATIC.has(url.pathname)) {
    const asset = STUDIO_STATIC.get(url.pathname);
    try {
      const body = await readFile(asset.path);
      res.writeHead(200, {
        'Content-Type': asset.type,
        'Cache-Control': asset.immutable
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Studio asset not found');
    }
    return;
  }

  if (url.pathname.startsWith('/studio3d/assets/') || url.pathname.startsWith('/studio3d/vendor/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Studio asset not found');
    return;
  }

  if (url.pathname === '/studio3d') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(studio3dHtml(PORT));
    return;
  }

  if (url.pathname === '/api/artifact' && req.method === 'GET') {
    const authErr = readAuthError(req, url);
    if (authErr) return denyRead(res, authErr);
    await handleArtifact(req, url, res);
    return;
  }

  if (url.pathname === '/api/drift' && req.method === 'GET') {
    const authErr = readAuthError(req, url);
    if (authErr) return denyRead(res, authErr);
    await handleDrift(req, url, res);
    return;
  }

  if (url.pathname === '/api/run-report' && req.method === 'GET') {
    const authErr = readAuthError(req, url);
    if (authErr) return denyRead(res, authErr);
    await handleRunReport(req, url, res);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(dashboardHtml(PORT));
};

const server = TLS_OPTIONS ? createTlsServer(TLS_OPTIONS, requestHandler) : createServer(requestHandler);

server.on('upgrade', async (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  // CORS does not apply to WebSocket upgrades — enforce the read policy here:
  // foreign browser Origins are always rejected, and a configured read token
  // is required (?token= — browsers cannot set custom headers on WS).
  const wsAuthErr = readAuthError(req, new URL(req.url, `${SCHEME}://localhost:${PORT}`));
  if (wsAuthErr) {
    socket.write(`HTTP/1.1 ${wsAuthErr.code === 403 ? '403 Forbidden' : '401 Unauthorized'}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
    return;
  }
  if (!wsHandshake(req, socket)) return;

  clients.add(socket);
  socket.on('error', () => clients.delete(socket));
  socket.on('close', () => clients.delete(socket));

  const state = await buildFullState(PROJECT_ROOT);
  wsSend(socket, toClientState(state));
  startPolling();
});

server.listen(PORT, '127.0.0.1', () => {
  // Report the bound port, not the requested one — `--port 0` asks the OS for
  // an ephemeral port (used by the test harness).
  const url = `${SCHEME}://localhost:${server.address().port}`;
  console.log('\n  RStack Business Hub - live observability for your team');
  console.log(`  Project : ${PROJECT_ROOT}`);
  console.log(`  Dashboard: ${url}\n`);
  // Loud once at startup (#151): invalid config values must never be a
  // silent default — Diagnostics shows them live; this makes them visible
  // in the terminal the moment the hub starts.
  validateProjectConfigs(PROJECT_ROOT, { warn: true }).catch(() => {});
  if (!NO_BROWSER) openBrowser(url);
  startPolling();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`  Port ${PORT} in use. Set RSTACK_BUSINESS_PORT=<other> and retry.`);
  } else {
    console.error('  Server error:', err.message);
  }
  process.exit(1);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
