import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dashboardHtml } from './ui.js';
import { studio3dHtml } from './ui/studio3d.js';
import { buildFullState, resolveDashboardApproval, toClientState } from './state/index.js';
import { sourceRoots } from './state/roots.js';
import { collectStageReports } from './state/stage-reports.js';
import {
  appendApprovalAudit,
  createRateLimiter,
  etagFor,
  ifNoneMatchSatisfied,
  logHttpRequest,
  stableStringify,
} from './hardening.js';

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
function approvalAuthError(req) {
  const expected = process.env.RSTACK_APPROVAL_TOKEN;
  if (!expected) {
    return { code: 403, msg: 'dashboard approvals are disabled — set RSTACK_APPROVAL_TOKEN to enable signed approvals, or approve via sdlc_approve' };
  }
  // CSRF: a cross-site form POST cannot set custom headers and would carry a
  // foreign Origin. Require the token header and a localhost (or absent) origin.
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return { code: 403, msg: 'cross-origin approval rejected' };
  }
  const token = req.headers['x-rstack-approval-token'];
  if (!token || token !== expected) {
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
      if (ok) await broadcastSnapshot();
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
  if (!runId || runId.includes('/') || runId.includes('..') || runId.includes('\\')) return null;
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
    sendJson(200, { run: runId, stages, deliverables });
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

const server = createServer(async (req, res) => {
  logHttpRequest(req, res);
  const url = new URL(req.url, `http://localhost:${PORT}`);

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
    try {
      const state = await buildFullState(PROJECT_ROOT);
      // Hash a projection with server eval-time timestamps stripped, so an
      // unchanged project yields a stable ETag and revalidation returns 304.
      sendJsonCacheable(req, res, 200, state, { hashInput: stableStringify(state) });
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

  if (url.pathname === '/studio3d') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(studio3dHtml(PORT));
    return;
  }

  if (url.pathname === '/api/artifact' && req.method === 'GET') {
    await handleArtifact(req, url, res);
    return;
  }

  if (url.pathname === '/api/run-report' && req.method === 'GET') {
    await handleRunReport(req, url, res);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(dashboardHtml(PORT));
});

server.on('upgrade', async (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
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
  const url = `http://localhost:${server.address().port}`;
  console.log('\n  RStack Business Hub - live observability for your team');
  console.log(`  Project : ${PROJECT_ROOT}`);
  console.log(`  Dashboard: ${url}\n`);
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
