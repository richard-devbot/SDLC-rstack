/**
 * Agent Force Studio document shell.
 *
 * Operational semantics arrive through state.studio. The semantic DOM is
 * present before Three.js loads and remains the canonical interaction tree.
 *
 * owner: RStack developed by Richardson Gunde
 */
export function studio3dHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>Agent Force Studio · RStack</title>
  <link rel="stylesheet" href="/studio3d/assets/styles.css">
  <script type="importmap">{"imports":{"three":"/studio3d/vendor/three.module.js","three/addons/":"/studio3d/vendor/"}}</script>
</head>
<body>
  <main id="studio-app" data-renderer="semantic" data-connection="connecting" data-motion="full">
    <header class="studio-topbar">
      <a class="studio-brand" href="/" aria-label="Return to RStack Business Hub">
        <span class="studio-brand-mark" aria-hidden="true">R</span>
        <span><strong>Agent Force Studio</strong><small>RStack live delivery floor</small></span>
      </a>
      <div class="studio-scope">
        <label for="studio-run-select">Observed run</label>
        <select id="studio-run-select" aria-describedby="studio-scope-note">
          <option value="">Loading run scope…</option>
        </select>
        <span id="studio-scope-note" class="studio-muted">Server-scoped, read-only view</span>
      </div>
      <div class="studio-status-cluster">
        <output id="studio-connection" class="studio-connection" aria-live="polite">Connecting</output>
        <span id="studio-freshness" class="studio-freshness">Snapshot unavailable</span>
        <button id="studio-motion" class="studio-icon-button" type="button" aria-pressed="false">Reduce motion</button>
      </div>
    </header>

    <section class="studio-workspace" aria-label="Agent Force operational workspace">
      <div class="studio-scene-shell">
        <canvas id="studio-canvas" aria-hidden="true"></canvas>
        <div id="studio-overlays" class="studio-overlays" aria-hidden="true"></div>
        <div id="studio-renderer-banner" class="studio-renderer-banner" role="status" hidden></div>
        <div class="studio-camera-controls" aria-label="3D view controls">
          <button id="studio-overview" type="button">Overview</button>
          <button id="studio-semantic-toggle" type="button" aria-pressed="true">Semantic view</button>
        </div>
      </div>

      <section id="semantic-studio" class="semantic-studio" aria-labelledby="semantic-title">
        <div class="semantic-heading">
          <p class="studio-kicker">Live company map</p>
          <h1 id="semantic-title">Delivery operations</h1>
          <p id="studio-goal" class="studio-goal">Waiting for a scoped run.</p>
        </div>
        <section id="studio-orchestrator" aria-labelledby="orchestrator-title">
          <h2 id="orchestrator-title">Orchestrator HQ</h2>
          <div id="studio-orchestrator-body" class="studio-panel-empty">No orchestrator state observed.</div>
        </section>
        <section aria-labelledby="missions-title">
          <div class="section-title"><h2 id="missions-title">Mission bays</h2><span id="mission-count">0 / 8</span></div>
          <div id="studio-missions" class="mission-grid"></div>
        </section>
        <section aria-labelledby="sessions-title">
          <div class="section-title"><h2 id="sessions-title">Agent sessions</h2><span id="session-count">0 observed</span></div>
          <div id="studio-sessions" class="session-list"></div>
        </section>
        <div class="semantic-lower-grid">
          <section aria-labelledby="governance-title">
            <h2 id="governance-title">Governance deck</h2>
            <div id="studio-governance" class="studio-stack"></div>
          </section>
          <section aria-labelledby="evidence-title">
            <h2 id="evidence-title">Evidence vault</h2>
            <div id="studio-evidence" class="studio-stack"></div>
          </section>
        </div>
        <section id="studio-limitations-section" aria-labelledby="limitations-title" hidden>
          <h2 id="limitations-title">Data limitations</h2>
          <ul id="studio-limitations"></ul>
        </section>
      </section>

      <aside id="studio-inspector" class="studio-inspector" aria-labelledby="studio-inspector-title" hidden>
        <button id="studio-inspector-close" class="studio-inspector-close" type="button" aria-label="Close inspector">×</button>
        <p id="studio-inspector-kind" class="studio-kicker">Selection</p>
        <h2 id="studio-inspector-title" tabindex="-1">Nothing selected</h2>
        <div id="studio-inspector-body"></div>
      </aside>
    </section>

    <aside class="studio-timeline-shell" aria-labelledby="timeline-title">
      <div class="section-title"><h2 id="timeline-title">Lifecycle timeline</h2><span id="timeline-source">No source</span></div>
      <ol id="studio-timeline" class="studio-timeline"></ol>
    </aside>

    <div id="studio-announcer" class="sr-only" aria-live="polite" aria-atomic="true"></div>
    <section id="studio-fallback" class="studio-fallback" role="status" hidden>
      <h2>3D view unavailable</h2>
      <p>The semantic Studio remains live with the same run, agent, governance, and evidence data.</p>
    </section>
  </main>
  <noscript><p class="studio-noscript">Agent Force Studio needs JavaScript to receive live run state. The Business Hub remains available.</p></noscript>
  <script type="module" src="/studio3d/assets/app.js"></script>
</body>
</html>`;
}
