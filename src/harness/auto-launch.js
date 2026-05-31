import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

// owner: RStack developed by Richardson Gunde

const __dirname = dirname(fileURLToPath(import.meta.url));

function isPortOpen(port) {
  return new Promise(resolve => {
    const sock = createConnection({ port, host: '127.0.0.1' }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(400, () => { sock.destroy(); resolve(false); });
  });
}

export async function autoLaunchBusinessHub(projectRoot, opts = {}) {
  if (process.env.RSTACK_NO_BUSINESS_HUB === '1') return;

  const port = Number(process.env.RSTACK_BUSINESS_PORT ?? 3008);
  const already = await isPortOpen(port);
  if (already) {
    // Already running — just print the URL so the user can click
    console.log(`  \x1b[2mRStack Business Hub: http://localhost:${port}\x1b[0m`);
    return;
  }

  const binPath = join(__dirname, '../../bin/rstack-business.js');
  const args = ['--no-browser'];
  if (projectRoot) args.push('--project', projectRoot);

  const child = spawn(process.execPath, [binPath, ...args], {
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, RSTACK_NO_BROWSER: '1', RSTACK_BUSINESS_PORT: String(port) },
  });
  child.unref();

  // Small delay to let the server bind, then open browser
  await new Promise(r => setTimeout(r, 700));
  const url = `http://localhost:${port}`;
  console.log(`  \x1b[33mRStack Business Hub launched: ${url}\x1b[0m`);

  if (!opts.noBrowser && process.env.RSTACK_NO_BROWSER !== '1') {
    const cmd = process.platform === 'win32' ? 'start'
      : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
      spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
    } catch { /* best-effort */ }
  }
}
