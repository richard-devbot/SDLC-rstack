/**
 * Studio 3D — the rstack-workspace-v8 three.js scene fed by LIVE run data.
 *
 * Served at /studio3d by the Business Hub. Same /api/state + WebSocket as the
 * dashboard; the scene re-binds on every snapshot:
 *   - 15 agent workstations (desk, canvas-texture monitor, robot with glowing
 *     visor) — status as glow: breathing amber working / green done /
 *     blue queued / red needs review
 *   - Manager station front-center narrates the newest event
 *   - Click an agent → what they worked on, what they shipped, why waiting
 *
 * three.js is loaded from a pinned CDN import map (matching v8); if it cannot
 * load (offline), a graceful fallback panel points back to the 2D Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */

export function studio3dHtml(port) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RStack Studio 3D</title>
<style>
  :root {
    --accent: #D97706; --green: #16A34A; --blue: #2563EB; --red: #DC2626;
    --text: #18181B; --muted: #A1A1AA; --bg: #FAFAFA; --line: #E4E4E7;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: var(--bg);
    font-family: 'DM Sans', -apple-system, sans-serif; color: var(--text); }
  #scene { position: fixed; inset: 0; }
  .hud { position: fixed; z-index: 10; }
  #brand { top: 18px; left: 20px; }
  #brand .name { font-weight: 800; font-size: 18px; }
  #brand .sub { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); letter-spacing: 0.15em; text-transform: uppercase; }
  #brand a { font-size: 11px; color: var(--blue); text-decoration: none; }
  #stats { top: 18px; right: 20px; text-align: right; font-family: 'JetBrains Mono', monospace; }
  #stats .row { font-size: 11px; letter-spacing: 0.1em; margin-bottom: 4px; }
  #stats .label { color: var(--muted); }
  #stats .live { color: var(--accent); animation: pulse-text 2s ease-in-out infinite; }
  @keyframes pulse-text { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
  #run-picker { top: 18px; left: 50%; transform: translateX(-50%); }
  #run-picker select { font: inherit; font-size: 12px; padding: 6px 10px; border: 1px solid var(--line);
    border-radius: 8px; background: #fff; max-width: 480px; }
  #bubble { bottom: 26px; left: 50%; transform: translateX(-50%); max-width: 640px;
    background: rgba(255,255,255,0.94); border: 1px solid var(--line); border-left: 3px solid var(--accent);
    border-radius: 10px; padding: 12px 16px; box-shadow: 0 8px 30px rgba(16,24,40,0.10); }
  #bubble .who { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent);
    letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 4px; }
  #bubble .line { font-size: 13px; min-height: 18px; }
  #panel { top: 0; right: 0; bottom: 0; width: 380px; background: #fff; border-left: 1px solid var(--line);
    box-shadow: -12px 0 40px rgba(16,24,40,0.08); padding: 22px; overflow-y: auto;
    transform: translateX(100%); transition: transform 0.25s ease; }
  #panel.open { transform: translateX(0); }
  #panel .close { position: absolute; top: 14px; right: 14px; border: 1px solid var(--line); background: #fff;
    border-radius: 6px; width: 26px; height: 26px; cursor: pointer; }
  #panel .stage-id { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); letter-spacing: 0.15em; }
  #panel h2 { margin: 4px 0 2px; font-size: 20px; }
  #panel .persona { font-size: 12px; color: var(--muted); margin-bottom: 12px; }
  #panel .badge { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 10px;
    letter-spacing: 0.1em; padding: 4px 8px; border-radius: 6px; margin-bottom: 14px; }
  #panel h3 { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 16px 0 6px; }
  #panel .voice { font-style: italic; font-size: 13px; line-height: 1.5; border-left: 3px solid var(--line); padding-left: 10px; }
  #panel ul { margin: 4px 0; padding-left: 18px; font-size: 12px; }
  #panel li { margin-bottom: 3px; }
  #panel .mono { font-family: 'JetBrains Mono', monospace; font-size: 11px; }
  #panel .why { background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 10px; font-size: 12px; }
  #fallback { display: none; position: fixed; inset: 0; z-index: 50; background: var(--bg);
    align-items: center; justify-content: center; text-align: center; padding: 40px; }
  #fallback .card { max-width: 420px; border: 1px solid var(--line); border-left: 3px solid var(--accent);
    border-radius: 12px; padding: 28px; background: #fff; }
  .legend { bottom: 26px; left: 20px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin: 0 5px 0 12px; }
</style>
<script type="importmap">
{ "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
} }
</script>
</head>
<body>
<div id="scene"></div>
<div class="hud" id="brand"><div class="name">rstack studio</div><div class="sub">live agent workspace</div><a href="/">← back to Business Hub</a></div>
<div class="hud" id="stats"></div>
<div class="hud" id="run-picker"><select id="run-select" onchange="window.__setRun(this.value)"></select></div>
<div class="hud" id="bubble"><div class="who">THE MANAGER</div><div class="line" id="bubble-line">Booting the studio…</div></div>
<div class="hud legend">status<i style="background:#D97706"></i>working<i style="background:#16A34A"></i>done<i style="background:#2563EB"></i>queued<i style="background:#DC2626"></i>review</div>
<aside class="hud" id="panel"><button class="close" onclick="document.getElementById('panel').classList.remove('open')">×</button><div id="panel-body"></div></aside>
<div id="fallback"><div class="card"><h2>3D studio unavailable</h2><p>three.js could not load (offline?). The <a href="/">2D Studio</a> shows the same live data.</p></div></div>

<script>
// Surface module-load failures as the fallback card.
window.addEventListener('error', function (event) {
  if (String(event.message || '').match(/three|import/i)) {
    document.getElementById('fallback').style.display = 'flex';
  }
}, true);
</script>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PORT = ${Number(port)};

// ── Stage personas (shared concept with the 2D Studio) ─────────────────────
const PERSONAS = {
  '00-environment': ['DevOps Engineer', 'Prepare the Workshop'],
  '01-transcript': ['Business Analyst', 'Listen to the Customer'],
  '02-requirements': ['Product Manager', 'Define What to Build'],
  '03-documentation': ['Technical Writer', 'Write It Down'],
  '04-planning': ['Delivery Manager', 'Plan the Work'],
  '05-jira': ['Scrum Master', 'Create the Tickets'],
  '06-architecture': ['Solution Architect', 'Design the System'],
  '07-code': ['Senior Developer', 'Build the Software'],
  '08-testing': ['QA Engineer', 'Prove It Works'],
  '09-deployment': ['Release Engineer', 'Ship It'],
  '10-summary': ['Program Manager', 'Report the Outcome'],
  '11-feedback-loop': ['Quality Coach', 'Close the Loop'],
  '12-security-threat-model': ['Security Engineer', 'Find the Threats'],
  '13-compliance-checker': ['Compliance Officer', 'Check the Rules'],
  '14-cost-estimation': ['FinOps Analyst', 'Count the Cost'],
};
const STAGE_ORDER = Object.keys(PERSONAS);
const STATUS_COLOR = { running: 0xD97706, done: 0x16A34A, queued: 0x2563EB, fail: 0xDC2626 };
const SCREEN_THEME = {
  running: { bg: '#FEF3C7', accent: '#D97706', badge: '● WORKING NOW' },
  done:    { bg: '#ECFDF5', accent: '#16A34A', badge: '✓ COMPLETE' },
  queued:  { bg: '#EFF6FF', accent: '#2563EB', badge: '○ QUEUED' },
  fail:    { bg: '#FEF2F2', accent: '#DC2626', badge: '✗ NEEDS REVIEW' },
};

// ── State ───────────────────────────────────────────────────────────────────
let STATE = null;
let RUN_ID = (location.hash.match(/[#&]run=([^&]+)/) || [])[1] ? decodeURIComponent(location.hash.match(/[#&]run=([^&]+)/)[1]) : null;
let MODEL = {};            // stage → { status, task, why }
const stations = {};       // stage → { robot, visor, dot, screen, screenCtx, hitbox }
let manager = null;
let packets = [];

window.__setRun = function (runId) {
  RUN_ID = runId || null;
  history.replaceState(null, '', runId ? '#run=' + encodeURIComponent(runId) : location.pathname);
  if (STATE) bindState(STATE);
};

function currentRun() {
  const runs = (STATE && STATE.runs) || [];
  if (!runs.length) return null;
  return runs.find((run) => run.runId === RUN_ID) ||
    runs.find((run) => run.derivedStatus === 'active') || runs[0];
}

function buildModel(run) {
  const model = {};
  STAGE_ORDER.forEach((stageId) => { model[stageId] = { status: 'queued', task: null, why: 'No task routed to this stage in this run.' }; });
  const gates = ((STATE && STATE.blockedGates) || []).filter((gate) => gate.runId === run.runId);
  (run.tasks || []).forEach((task) => {
    let stageIds = (task.stage_artifacts || []).map((artifact) => artifact.stage_id);
    if (!stageIds.length && task.stageId) stageIds = [task.stageId];
    stageIds.forEach((stageId) => {
      if (!model[stageId]) return;
      const entry = model[stageId];
      const status = String(task.status || '').toUpperCase();
      const mapped = status === 'PASS' ? 'done' : status === 'IN_PROGRESS' ? 'running' : status === 'FAIL' ? 'fail' : 'queued';
      const rank = { running: 3, fail: 2, done: 1, queued: 0 };
      if (rank[mapped] < rank[entry.status]) return;
      entry.status = mapped;
      entry.task = task;
      if (mapped === 'queued') {
        const gate = gates.find((g) => (g.detail || '').includes(task.id) || g.taskId === task.id);
        entry.why = gate
          ? 'Waiting for approval — ' + (gate.missing ? gate.missing.join(', ') : gate.detail)
          : 'Queued — waiting for upstream stages on the conveyor.';
      } else if (mapped === 'fail') {
        entry.why = 'Validation failed — rerouted to the builder for corrections.';
      } else {
        entry.why = '';
      }
    });
  });
  Object.keys(run.stageElapsed || {}).forEach((stageId) => {
    if (model[stageId] && model[stageId].status === 'queued') { model[stageId].status = 'done'; model[stageId].why = ''; }
  });
  return model;
}

// ── Scene ───────────────────────────────────────────────────────────────────
const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xFAFAFA);
scene.fog = new THREE.Fog(0xFAFAFA, 30, 70);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 12, 22);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.maxPolarAngle = Math.PI / 2.1;
controls.minDistance = 6; controls.maxDistance = 45;
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(8, 16, 10); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const warm = new THREE.SpotLight(0xFFD9A0, 0.8, 30, Math.PI / 5, 0.5);
warm.position.set(0, 12, 8); scene.add(warm);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0xF4F4F5 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// Conveyor line
const conveyor = new THREE.Mesh(new THREE.BoxGeometry(34, 0.12, 1.1), new THREE.MeshStandardMaterial({ color: 0x27272A }));
conveyor.position.set(0, 0.06, 0); scene.add(conveyor);
for (let i = 0; i < 6; i++) {
  const packet = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.45), new THREE.MeshStandardMaterial({ color: 0xD97706, emissive: 0xD97706, emissiveIntensity: 0.4 }));
  packet.position.set(-17 + i * 6, 0.3, 0); scene.add(packet); packets.push(packet);
}

function makeScreenTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 320;
  return { canvas, ctx: canvas.getContext('2d'), texture: new THREE.CanvasTexture(canvas) };
}

function drawScreen(ctx, texture, stageId, status) {
  const [persona, business] = PERSONAS[stageId];
  const theme = SCREEN_THEME[status] || SCREEN_THEME.queued;
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = theme.accent; ctx.fillRect(0, 0, 512, 8);
  ctx.fillStyle = '#18181B';
  ctx.font = '800 40px DM Sans, sans-serif';
  ctx.fillText(business, 24, 92, 464);
  ctx.fillStyle = '#52525B';
  ctx.font = '600 26px DM Sans, sans-serif';
  ctx.fillText(persona, 24, 140, 464);
  ctx.font = '700 24px JetBrains Mono, monospace';
  ctx.fillStyle = theme.accent;
  ctx.fillText(theme.badge, 24, 250);
  ctx.fillStyle = '#A1A1AA';
  ctx.font = '400 22px JetBrains Mono, monospace';
  ctx.fillText(stageId, 24, 292);
  texture.needsUpdate = true;
}

function makeRobot(scale, visorColor) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32 * scale, 0.5 * scale, 6, 12), bodyMat);
  body.position.y = 0.75 * scale; body.castShadow = true; group.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5 * scale, 0.4 * scale, 0.45 * scale), bodyMat);
  head.position.y = 1.35 * scale; head.castShadow = true; group.add(head);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.36 * scale, 0.12 * scale, 0.05 * scale),
    new THREE.MeshStandardMaterial({ color: visorColor, emissive: visorColor, emissiveIntensity: 0.6 }));
  visor.position.set(0, 1.36 * scale, 0.24 * scale); group.add(visor);
  const armGeo = new THREE.BoxGeometry(0.1 * scale, 0.5 * scale, 0.1 * scale);
  const armL = new THREE.Mesh(armGeo, bodyMat); armL.position.set(-0.42 * scale, 0.85 * scale, 0); group.add(armL);
  const armR = new THREE.Mesh(armGeo, bodyMat); armR.position.set(0.42 * scale, 0.85 * scale, 0); group.add(armR);
  group.userData = { visor, armL, armR };
  return group;
}

function makeStation(stageId, index) {
  const group = new THREE.Group();
  const x = -15.4 + index * 2.2;
  const z = index % 2 === 0 ? 2.6 : -2.6;
  group.position.set(x, 0, z);

  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.9), new THREE.MeshStandardMaterial({ color: 0xFFFFFF }));
  desk.position.y = 0.78; desk.castShadow = true; group.add(desk);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.04, 0.04), new THREE.MeshStandardMaterial({ color: 0xD97706 }));
  edge.position.set(0, 0.81, 0.45); group.add(edge);
  ['L', 'R'].forEach((side, i) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.78, 0.06), new THREE.MeshStandardMaterial({ color: 0xD4D4D8 }));
    leg.position.set(i === 0 ? -0.75 : 0.75, 0.39, 0); group.add(leg);
  });

  const screenAssets = makeScreenTexture();
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.82, 0.06),
    new THREE.MeshStandardMaterial({ map: screenAssets.texture }));
  monitor.position.set(0, 1.45, -0.18);
  if (z < 0) { group.rotation.y = Math.PI; }
  group.add(monitor);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.9, 0.04), new THREE.MeshStandardMaterial({ color: 0x27272A }));
  bezel.position.set(0, 1.45, -0.21); group.add(bezel);

  const robot = makeRobot(0.85, STATUS_COLOR.queued);
  robot.position.set(0, 0, 0.55); group.add(robot);

  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12),
    new THREE.MeshStandardMaterial({ color: STATUS_COLOR.queued, emissive: STATUS_COLOR.queued, emissiveIntensity: 0.8 }));
  dot.position.set(0, 2.35, 0.4); group.add(dot);

  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(2, 2.8, 1.6), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = 1.3; hitbox.userData = { stageId }; group.add(hitbox);

  scene.add(group);
  stations[stageId] = { group, robot, dot, ...screenAssets, hitbox, status: 'queued' };
  drawScreen(screenAssets.ctx, screenAssets.texture, stageId, 'queued');
}

STAGE_ORDER.forEach(makeStation);

// Manager station — front center with pulsing ring
(function makeManager() {
  const group = new THREE.Group();
  group.position.set(0, 0, 7.5);
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 32), new THREE.MeshStandardMaterial({ color: 0xFFFFFF }));
  platform.position.y = 0.06; group.add(platform);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.04, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0xD97706, emissive: 0xD97706, emissiveIntensity: 0.7 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; group.add(ring);
  const robot = makeRobot(1.1, 0xD97706);
  robot.rotation.y = Math.PI; group.add(robot);
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3, 3.4), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = 1.4; hitbox.userData = { manager: true }; group.add(hitbox);
  scene.add(group);
  manager = { group, robot, ring, hitbox };
})();

// ── Live data binding ───────────────────────────────────────────────────────
function bindState(state) {
  STATE = state;
  const runs = state.runs || [];
  const select = document.getElementById('run-select');
  const run = currentRun();
  select.innerHTML = runs.map((item) => {
    const label = ((item.manifest && item.manifest.goal) || item.runId).slice(0, 70);
    return '<option value="' + item.runId + '"' + (run && item.runId === run.runId ? ' selected' : '') + '>' + label + '</option>';
  }).join('');
  if (!run) return;

  MODEL = buildModel(run);
  STAGE_ORDER.forEach((stageId) => {
    const station = stations[stageId];
    const entry = MODEL[stageId];
    if (station.status !== entry.status) {
      station.status = entry.status;
      drawScreen(station.ctx, station.texture, stageId, entry.status);
      const color = STATUS_COLOR[entry.status];
      station.dot.material.color.setHex(color);
      station.dot.material.emissive.setHex(color);
      station.robot.userData.visor.material.color.setHex(color);
      station.robot.userData.visor.material.emissive.setHex(color);
    }
  });

  const totals = run.totals || {};
  const isActive = run.derivedStatus === 'active';
  document.getElementById('stats').innerHTML =
    '<div class="row"><span class="label">STUDIO:</span> <span class="' + (isActive ? 'live' : '') + '">' + (isActive ? 'BUILDING' : 'IDLE') + '</span></div>' +
    '<div class="row"><span class="label">RUN BY:</span> ' + (run.startedBy || 'unattributed') + '</div>' +
    '<div class="row"><span class="label">ELAPSED:</span> ' + fmtDur(totals.duration_ms) + '</div>' +
    '<div class="row"><span class="label">PASSED:</span> ' + (totals.tasks_passed || 0) + ' · QUALITY: ' +
      (totals.quality_avg != null ? Math.round(totals.quality_avg * 100) + '%' : '—') + '</div>';

  const latest = (state.feed || []).find((item) => item.runId === run.runId);
  typeBubble(latest ? latest.summary : 'Studio ready. ' + ((run.manifest && run.manifest.goal) || '').slice(0, 90));
}

let bubbleText = '', bubbleShown = 0, bubbleTimer = null;
function typeBubble(text) {
  if (text === bubbleText) return;
  bubbleText = text; bubbleShown = 0;
  clearInterval(bubbleTimer);
  bubbleTimer = setInterval(() => {
    bubbleShown += 2;
    const el = document.getElementById('bubble-line');
    el.textContent = bubbleText.slice(0, bubbleShown) + (bubbleShown < bubbleText.length ? '▌' : '');
    if (bubbleShown >= bubbleText.length) clearInterval(bubbleTimer);
  }, 24);
}

function fmtDur(ms) {
  ms = Number(ms) || 0;
  if (ms < 1000) return ms + 'ms';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return sec + 's';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ' + (sec % 60) + 's';
  return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

// ── Click → agent report panel ──────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (event) => {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const targets = STAGE_ORDER.map((stageId) => stations[stageId].hitbox).concat(manager ? [manager.hitbox] : []);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return;
  if (hit.object.userData.manager) return openManagerPanel();
  openAgentPanel(hit.object.userData.stageId);
});

function openAgentPanel(stageId) {
  const [persona, business] = PERSONAS[stageId];
  const entry = MODEL[stageId] || { status: 'queued', task: null, why: '' };
  const theme = SCREEN_THEME[entry.status] || SCREEN_THEME.queued;
  const task = entry.task;
  let html =
    '<div class="stage-id">' + esc(stageId) + '</div>' +
    '<h2>' + esc(business) + '</h2>' +
    '<div class="persona">' + esc(persona) + '</div>' +
    '<span class="badge" style="background:' + theme.bg + ';color:' + theme.accent + '">' + theme.badge + '</span>';
  if (task) {
    const builder = task.builder || {};
    if (builder.work_done || builder.summary) {
      html += '<h3>What I worked on</h3><div class="voice">“' + esc(builder.work_done || builder.summary) + '”</div>';
    }
    const shipped = (builder.files_modified || []);
    const artifacts = (task.stage_artifacts || []).map((artifact) => artifact.artifact).filter(Boolean);
    if (shipped.length || artifacts.length) {
      html += '<h3>What I shipped</h3><ul>' +
        shipped.map((file) => '<li class="mono">' + esc(file) + '</li>').join('') +
        artifacts.map((name) => '<li class="mono">' + esc(name) + '</li>').join('') + '</ul>';
    }
    if (task.validation) {
      html += '<h3>Validation</h3><div class="mono">' + task.validation.pass_checks + '/' + task.validation.total_checks + ' checks passed</div>';
      if ((task.validation.failed_checks || []).length) {
        html += '<ul>' + task.validation.failed_checks.map((name) => '<li class="mono" style="color:var(--red)">' + esc(name) + '</li>').join('') + '</ul>';
      }
    }
  }
  if (entry.why) html += '<h3>Why waiting</h3><div class="why">' + esc(entry.why) + '</div>';
  if (!task && !entry.why) html += '<h3>Status</h3><div class="persona">Finished — artifacts recorded for this stage.</div>';
  document.getElementById('panel-body').innerHTML = html;
  document.getElementById('panel').classList.add('open');
}

function openManagerPanel() {
  const run = currentRun();
  if (!run) return;
  const totals = run.totals || {};
  const approvals = run.approvals || [];
  const html =
    '<div class="stage-id">THE MANAGER</div>' +
    '<h2>Run briefing</h2>' +
    '<div class="persona">' + esc((run.manifest && run.manifest.goal) || run.runId) + '</div>' +
    '<h3>Who</h3><div class="mono">started by ' + esc(run.startedBy || 'unattributed') + '</div>' +
    '<h3>Numbers</h3><ul>' +
      '<li>Elapsed: ' + fmtDur(totals.duration_ms) + '</li>' +
      '<li>Tasks: ' + (totals.tasks_passed || 0) + ' passed / ' + (totals.tasks_failed || 0) + ' failed</li>' +
      '<li>Tool calls: ' + (totals.tool_calls || 0) + '</li>' +
      '<li>Quality: ' + (totals.quality_avg != null ? Math.round(totals.quality_avg * 100) + '%' : '—') + '</li></ul>' +
    '<h3>Approvals</h3>' +
    (approvals.length
      ? '<ul>' + approvals.slice(0, 8).map((approval) => '<li class="mono">' + esc(approval.artifact) + ' — ' + esc(approval.status) + ' by ' + esc(approval.approver) + '</li>').join('') + '</ul>'
      : '<div class="persona">No approvals recorded for this run.</div>') +
    '<h3>Open in dashboard</h3><div><a href="/#run=' + encodeURIComponent(run.runId) + '" class="mono">Business Hub → this run</a></div>';
  document.getElementById('panel-body').innerHTML = html;
  document.getElementById('panel').classList.add('open');
}

// ── Animation loop ──────────────────────────────────────────────────────────
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const anyRunning = STAGE_ORDER.some((stageId) => (MODEL[stageId] || {}).status === 'running');

  STAGE_ORDER.forEach((stageId, index) => {
    const station = stations[stageId];
    const status = station.status;
    const speed = status === 'running' ? 6 : 2;
    const { visor, armL, armR } = station.robot.userData;
    armL.rotation.x = Math.sin(t * speed + index) * 0.4;
    armR.rotation.x = Math.sin(t * speed + index + Math.PI) * 0.4;
    station.robot.position.y = Math.sin(t * 1.5 + index) * 0.02;
    visor.material.emissiveIntensity = status === 'running' ? 0.8 + Math.sin(t * 4) * 0.3 : status === 'done' ? 0.6 : 0.35;
    station.dot.material.emissiveIntensity = status === 'running' ? 0.9 + Math.sin(t * 4 + index) * 0.3 : 0.55;
    station.dot.position.y = 2.35 + Math.sin(t * 2 + index) * 0.05;
  });

  if (manager) {
    const { armL, armR, visor } = manager.robot.userData;
    armL.rotation.x = Math.sin(t * 2.5) * 0.3;
    armR.rotation.x = Math.sin(t * 2.5 + Math.PI) * 0.3;
    visor.material.emissiveIntensity = 0.8 + Math.sin(t * 2) * 0.3;
    const pulse = 1 + Math.sin(t * 2) * 0.04;
    manager.ring.scale.set(pulse, pulse, 1);
  }

  packets.forEach((packet, index) => {
    if (anyRunning) {
      packet.position.x += 0.02;
      if (packet.position.x > 17) packet.position.x = -17;
    }
    packet.visible = anyRunning;
    packet.rotation.y = t + index;
  });

  controls.update();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ── Live state: HTTP first, then WebSocket ──────────────────────────────────
fetch('/api/state').then((response) => response.json()).then(bindState)
  .catch(() => typeBubble('Could not load run data — is the Business Hub healthy?'));
(function connectWS() {
  let socket;
  try { socket = new WebSocket('ws://localhost:' + PORT); } catch { return; }
  socket.onmessage = (event) => { try { bindState(JSON.parse(event.data)); } catch { /* keep last good state */ } };
  socket.onclose = socket.onerror = () => setTimeout(connectWS, 3000);
})();
</script>
</body>
</html>`;
}
