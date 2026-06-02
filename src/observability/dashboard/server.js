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
    return fail(415, 'Content-Type must be application/json');
  }
  const authErr = approvalAuthError(req);
  if (authErr) return fail(authErr.code, authErr.msg);

  let body = '';
  let tooLarge = false;
  req.on('error', () => fail(400, 'request stream error'));
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 64 * 1024) { tooLarge = true; req.destroy(); }
  });
  req.on('end', async () => {
    if (tooLarge) return fail(413, 'request body too large');
    try {
      const parsed = safeJson(body) ?? {};
      const { id, resolvedBy } = parsed;
      if (!id) return fail(400, 'missing approval id');
      if (!resolvedBy || typeof resolvedBy !== 'string') return fail(400, 'resolvedBy (approver identity) is required');
      // Actor evidence: token-verified, not just a body string.
      const ok = await resolveDashboardApproval(PROJECT_ROOT, id, decision, resolvedBy, {
        actor: { name: resolvedBy, via: 'dashboard', tokenVerified: true, ts: new Date().toISOString() },
      });
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
      if (ok) await broadcastSnapshot();
    } catch (err) {
      process.stderr.write(`[rstack-business] approval error: ${err?.message}\n`);
      fail(Number(err?.statusCode) || 500, String(err?.message));
    }
  });
}

// Read one run artifact, strictly sandboxed: the run is located via the known
// project roots, the resolved path must stay inside that run directory, and
// only size-capped text artifacts are served.
const ARTIFACT_MAX_BYTES = 512 * 1024;
const ARTIFACT_EXTENSIONS = new Set(['.md', '.json', '.jsonl', '.txt', '.yml', '.yaml']);

async function handleArtifact(url, res) {
  const sendJson = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    const runId = url.searchParams.get('run') ?? '';
    const relPath = url.searchParams.get('path') ?? '';
    if (!runId || !relPath) return sendJson(400, { error: 'run and path are required' });
    if (runId.includes('/') || runId.includes('..')) return sendJson(400, { error: 'invalid run id' });

    const roots = await sourceRoots(PROJECT_ROOT, {});
    const runDir = roots
      .map((root) => join(root, '.rstack', 'runs', runId))
      .find((dir) => existsSync(dir));
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

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: PORT, ts: new Date().toISOString() }));
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    try {
      const state = await buildFullState(PROJECT_ROOT);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
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
    await handleArtifact(url, res);
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
  const url = `http://localhost:${PORT}`;
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
