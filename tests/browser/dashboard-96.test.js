/**
 * Dashboard regression suite, Phase 2 (#96): real-browser journeys, automated
 * accessibility scans, and responsive-viewport assertions — the layer Phase 1
 * (tests/dashboard-e2e-96.test.js, server/API/WS/semantic) cannot cover.
 *
 * Runs the REAL server on an ephemeral port against the canonical deterministic
 * fixtures and drives it with a real Chromium via playwright-core.
 *
 * Isolation: this file lives under tests/browser/ so the default `npm test`
 * glob (tests/*.test.js) never picks it up — the deterministic core suite stays
 * fast and browser-free. Run it with `npm run test:browser`. The browser binary
 * is installed separately (`npx playwright-core install chromium`, wired in CI);
 * if it is absent the whole suite SKIPS cleanly rather than failing.
 *
 * owner: RStack developed by Richardson Gunde
 */

/* global document, window, getComputedStyle */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  fixtureNoRunsProject, fixtureReadyRun, fixtureBlockedRun,
} from '../helpers/dashboard-fixtures.js';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(HERE, '..', '..', 'src', 'observability', 'dashboard', 'server.js');

// playwright-core is a runtime dependency; the Chromium binary is installed
// separately. Missing either → skip cleanly.
let chromium = null;
try { ({ chromium } = require('playwright-core')); } catch { /* dep absent */ }
let AXE_PATH = null;
try { AXE_PATH = require.resolve('axe-core/axe.min.js'); } catch { /* dep absent */ }

// The six product destinations of the #278 shell (page ids).
const DESTINATIONS = ['command', 'run-workspace', 'traceability', 'action-inbox', 'cost-budget', 'operations-center'];

// color-contrast is pre-existing design debt (dozens of nodes across the dark
// theme) tracked separately — the a11y gate fails on any OTHER serious/critical
// violation so genuine regressions are caught without blocking on that backlog.
const AXE_KNOWN_DEBT = new Set(['color-contrast']);
const AXE_BLOCKING_IMPACTS = new Set(['serious', 'critical']);

function startServer(root) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SERVER_PATH, '--port', '0', '--no-browser', '--project', root], {
      cwd: root,
      env: {
        ...process.env,
        RSTACK_APPROVAL_TOKEN: undefined,
        RSTACK_DASHBOARD_READ_TOKEN: undefined,
        RSTACK_TLS_CERT: undefined,
        RSTACK_TLS_KEY: undefined,
        RSTACK_BUSINESS_PORT: undefined,
        RSTACK_PROJECT_ROOT: undefined,
        RSTACK_NO_BROWSER: '1',
        RSTACK_REGISTRY_DIR: join(root, '.registry'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill('SIGKILL'); rejectPromise(new Error(`server did not boot\n${out}`)); }
    }, 15_000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/Dashboard: http:\/\/localhost:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ baseUrl: `http://127.0.0.1:${match[1]}`, stop: () => child.kill('SIGKILL') });
      }
    });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('exit', () => { if (!settled) { settled = true; clearTimeout(timer); rejectPromise(new Error(`server exited\n${out}`)); } });
  });
}

// One browser for the whole file; each test gets a fresh context/page + its own
// server so fixtures never bleed between tests.
let browser = null;
test.before(async () => {
  if (!chromium) return;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = null; }
});
test.after(async () => { if (browser) await browser.close(); });

// Wrap a browser test so it skips cleanly when the binary is unavailable, and
// always tears down its server + page.
function browserTest(name, seed, body) {
  test(name, async (t) => {
    if (!browser) { t.skip('Chromium not installed — run `npx playwright-core install chromium`'); return; }
    const root = mkdtempSync(join(tmpdir(), 'rstack-browser-96-'));
    let server = null;
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    try {
      await seed(root);
      server = await startServer(root);
      await body({ page, server, pageErrors, t });
    } finally {
      await context.close();
      if (server) server.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

async function gotoDashboard(page, server) {
  await page.goto(server.baseUrl, { waitUntil: 'networkidle' });
}

async function navigate(page, pageId) {
  // Click the VISIBLE nav button for this page. The markup carries the same
  // data-page in both the desktop sidebar and the (hidden) mobile panel, so a
  // bare selector can match the hidden one — pick the one that is actually
  // rendered, matching the real user path without selector ambiguity.
  const clicked = await page.evaluate((id) => {
    const buttons = [...document.querySelectorAll(`nav button[data-page="${id}"]`)];
    const target = buttons.find((b) => b.offsetParent !== null) || buttons[0];
    if (target) { target.click(); return true; }
    return false;
  }, pageId);
  assert.ok(clicked, `nav button for ${pageId} exists`);
  await page.waitForFunction((id) => {
    const el = document.getElementById('page-' + id);
    return el && !el.hidden && el.offsetParent !== null;
  }, pageId, { timeout: 5000 }).catch(() => { /* assertions below report the real state */ });
}

async function runAxe(page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  });
}

const seedRichProject = async (root) => { await fixtureReadyRun(root); await fixtureBlockedRun(root); };

browserTest('all six destinations render a visible heading + main landmark with zero page errors', seedRichProject, async ({ page, server, pageErrors }) => {
  await gotoDashboard(page, server);
  const mainCount = await page.locator('main, [role=main]').count();
  assert.ok(mainCount >= 1, 'a main landmark is present');
  for (const dest of DESTINATIONS) {
    await navigate(page, dest);
    const region = page.locator(`#page-${dest}`);
    assert.equal(await region.isVisible(), true, `${dest} region is visible after navigation`);
    const headings = await region.locator('h1, h2, h3').filter({ hasText: /\S/ }).count();
    assert.ok(headings >= 1, `${dest} shows at least one heading`);
  }
  assert.deepEqual(pageErrors, [], 'no uncaught page errors while navigating all destinations');
});

browserTest('no-data readiness never renders Ready or 100% in the browser DOM', fixtureNoRunsProject, async ({ page, server }) => {
  await gotoDashboard(page, server);
  // Overview is the default destination; read its rendered readiness text.
  const bodyText = await page.locator('body').innerText();
  assert.ok(!/\b100%\b/.test(bodyText), 'no 100% readiness on a project with no runs');
  // "Ready" must not appear as an outcome/state badge (Unknown is the honest state).
  const readyState = await page.locator('.overview-state, [id*="readiness"], [id*="state"]').filter({ hasText: /^\s*Ready\s*$/ }).count();
  assert.equal(readyState, 0, 'no Ready state badge with zero runs');
});

browserTest('accessibility: no serious/critical axe violations (excluding known color-contrast debt) on each destination', seedRichProject, async ({ page, server, t }) => {
  if (!AXE_PATH) { t.skip('axe-core not resolvable'); return; }
  await gotoDashboard(page, server);
  const offenders = {};
  for (const dest of DESTINATIONS) {
    await navigate(page, dest);
    const violations = (await runAxe(page)).filter((v) => AXE_BLOCKING_IMPACTS.has(v.impact) && !AXE_KNOWN_DEBT.has(v.id));
    if (violations.length) offenders[dest] = violations;
  }
  assert.deepEqual(offenders, {}, `serious/critical a11y violations found:\n${JSON.stringify(offenders, null, 2)}`);
});

browserTest('responsive: scope controls stay reachable and no critical horizontal overflow at 1440/1024/768/390', seedRichProject, async ({ page, server }) => {
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoDashboard(page, server);
    const metrics = await page.evaluate(() => {
      const vis = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const toggle = document.getElementById('mobile-nav-toggle');
      return {
        scopeProject: vis(document.getElementById('scope-project')),
        scopeRun: vis(document.getElementById('scope-run')),
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        mobileToggle: vis(toggle),
        sidebarNav: vis(document.querySelector('nav button[data-page]')),
      };
    });
    // Scope must never be hidden (the 2026-07-10 audit's "hides scope below 900px").
    assert.ok(metrics.scopeProject && metrics.scopeRun, `scope controls visible at ${width}px`);
    // No critical horizontal overflow (allow 1px rounding).
    assert.ok(metrics.scrollW <= metrics.clientW + 1, `no horizontal overflow at ${width}px (scrollW ${metrics.scrollW} <= clientW ${metrics.clientW})`);
    // Navigation must be reachable — sidebar buttons on desktop, the toggle on mobile.
    assert.ok(metrics.sidebarNav || metrics.mobileToggle, `navigation reachable at ${width}px`);
  }
});

browserTest('mobile navigation opens and closes by keyboard at 390px', seedRichProject, async ({ page, server }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await gotoDashboard(page, server);
  const panelHidden = () => page.evaluate(() => {
    const panel = document.getElementById('mobile-navigation');
    return !panel || panel.getAttribute('aria-hidden') === 'true';
  });
  assert.equal(await panelHidden(), true, 'nav panel starts hidden');
  // Open by keyboard: focus the toggle and press Enter.
  await page.focus('#mobile-nav-toggle');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('mobile-navigation')?.getAttribute('aria-hidden') === 'false', null, { timeout: 3000 });
  assert.equal(await panelHidden(), false, 'nav panel opens by keyboard');
  const dialogRole = await page.getAttribute('#mobile-navigation', 'role');
  assert.equal(dialogRole, 'dialog', 'mobile nav is a dialog');
  // Close with Escape.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('mobile-navigation')?.getAttribute('aria-hidden') === 'true', null, { timeout: 3000 });
  assert.equal(await panelHidden(), true, 'nav panel closes on Escape');
});
