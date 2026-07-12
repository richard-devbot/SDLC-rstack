// owner: RStack developed by Richardson Gunde

export const styles = `
:root {
  --bg: #ffffff;
  --panel: #ffffff;
  --soft: #f6f7f9;
  --line: #e4e7ec;
  --line-strong: #d0d5dd;
  --text: #101828;
  --muted: #667085;
  --faint: #98a2b3;
  --blue: #1d4ed8;
  --green: #15803d;
  --amber: #b45309;
  --red: #b42318;
  --ink: #111827;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--text);
  background: var(--bg);
  font-size: 14px;
}
button, input, select { font: inherit; }
button { cursor: pointer; }
#shell { display: grid; grid-template-columns: 236px minmax(0, 1fr); min-height: 100vh; background: var(--bg); }
#sidebar {
  border-right: 1px solid var(--line);
  background: #fbfcfd;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.brand { padding: 18px 18px 16px; border-bottom: 1px solid var(--line); }
.brand-row { display: flex; align-items: center; gap: 10px; }
.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--ink);
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.brand-name { font-size: 15px; font-weight: 800; letter-spacing: .01em; }
.brand-sub { color: var(--muted); font-size: 11px; margin-top: 1px; }
.destination-nav { position: relative; flex: 1; padding: 14px 10px; overflow-y: auto; }
.destination-nav::before {
  content: '';
  position: absolute;
  top: 24px;
  bottom: 24px;
  left: 25px;
  width: 1px;
  background: var(--line);
}
.destination-group { position: relative; margin-bottom: 5px; }
.destination-link {
  position: relative;
  width: 100%;
  min-height: 52px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: #475467;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 12px;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  text-align: left;
  font-size: 13px;
  transition: color .16s ease, background .16s ease, border-color .16s ease, box-shadow .16s ease;
}
.destination-link:hover { background: #f1f3f6; color: var(--text); }
.destination-link.active {
  color: var(--blue);
  border-color: #dbe7ff;
  background: #eef4ff;
  box-shadow: inset 3px 0 0 var(--blue);
}
.destination-icon { position: relative; z-index: 1; width: 20px; height: 20px; padding: 2px; background: #fbfcfd; }
.destination-link.active .destination-icon { background: #eef4ff; }
.destination-copy { min-width: 0; display: grid; gap: 2px; }
.destination-label { font-weight: 760; line-height: 1.2; }
.destination-hint { color: var(--faint); font-size: 10px; line-height: 1.2; }
.destination-chevron { color: var(--faint); font-size: 18px; line-height: 1; transform: rotate(0); transition: transform .16s ease; }
.destination-link[aria-expanded="true"] .destination-chevron { transform: rotate(90deg); }
.secondary-nav { display: grid; gap: 2px; padding: 5px 0 5px 31px; }
.secondary-nav[hidden] { display: none; }
.secondary-link {
  width: 100%;
  min-height: 34px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  display: grid;
  grid-template-columns: 9px minmax(0, 1fr);
  gap: 7px;
  align-items: center;
  padding: 6px 8px;
  text-align: left;
  font-size: 11px;
  line-height: 1.25;
}
.secondary-link:hover { background: #f1f3f6; color: var(--text); }
.secondary-link.active { color: var(--ink); background: #fff; font-weight: 750; box-shadow: 0 0 0 1px var(--line); }
.secondary-marker { width: 5px; height: 5px; border-radius: 50%; border: 1px solid var(--faint); }
.secondary-link.active .secondary-marker { border-color: var(--blue); background: var(--blue); box-shadow: 0 0 0 3px rgba(29,78,216,.1); }
#mobile-nav-toggle, #mobile-navigation, #mobile-nav-overlay { display: none; }
#mobile-nav-toggle {
  width: 44px;
  height: 44px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fff;
  place-content: center;
  gap: 4px;
  padding: 0;
}
#mobile-nav-toggle span { display: block; width: 18px; height: 2px; border-radius: 2px; background: var(--ink); }
.mobile-nav-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px; border-bottom: 1px solid var(--line); }
.mobile-nav-head h2 { margin: 2px 0 0; font-size: 19px; }
.mobile-nav-kicker { color: var(--blue); font-size: 9px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
#mobile-nav-close { width: 44px; height: 44px; border: 1px solid var(--line); border-radius: 9px; background: #fff; color: var(--muted); font-size: 24px; }
.mobile-destination-nav { padding: 10px; overflow-y: auto; }
.badge {
  display: none;
  margin-left: auto;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  padding: 2px 6px;
  color: #fff;
  background: var(--red);
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  font-weight: 800;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.side-kpis {
  border-top: 1px solid var(--line);
  padding: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.side-kpi { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 9px; }
.side-v { font-size: 17px; font-weight: 800; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.side-l { margin-top: 2px; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; }
#main { min-width: 0; display: flex; flex-direction: column; min-height: 100vh; }
#topbar {
  height: 58px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  padding: 0 22px;
  gap: 14px;
  background: rgba(255,255,255,.96);
  position: sticky;
  top: 0;
  z-index: 10;
}
.tb-title { font-size: 16px; font-weight: 800; }
.tb-status {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 12px;
}
.status-dot, .ws-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); }
.status-live, .ws-live { background: var(--green); box-shadow: 0 0 0 4px rgba(21,128,61,.12); }
.status-connecting { background: var(--amber); box-shadow: 0 0 0 4px rgba(180,83,9,.12); }
.status-error { background: var(--red); box-shadow: 0 0 0 4px rgba(180,35,24,.12); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.tb-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.tb-chip {
  border: 1px solid var(--line);
  background: #fff;
  color: var(--muted);
  border-radius: 7px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
}
.tb-chip.warn { color: var(--amber); border-color: #f5d0a4; background: #fff9f0; }
.tb-chip.danger { color: var(--red); border-color: #fecdca; background: #fff5f5; }
#content { padding: 22px; overflow-y: auto; flex: 1; background: #fff; }
#err {
  display: none;
  border: 1px solid #fecdca;
  background: #fff5f5;
  color: var(--red);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.page { display: none; }
.page.active { display: block; }
.page-head { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 18px; }
.eyebrow { color: var(--blue); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 5px; }
.page-title { font-size: 24px; line-height: 1.12; font-weight: 850; margin: 0; letter-spacing: 0; }
.page-sub { color: var(--muted); margin-top: 7px; max-width: 780px; line-height: 1.45; }
.last-updated { color: var(--muted); font-size: 12px; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.command-brief {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: start;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcfd;
  padding: 18px;
  margin-bottom: 14px;
}
.command-kicker {
  color: var(--blue);
  font-size: 11px;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: .08em;
  margin-bottom: 6px;
}
.command-brief h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.18;
  letter-spacing: 0;
}
.command-brief p {
  margin: 8px 0 0;
  color: var(--muted);
  max-width: 880px;
  line-height: 1.45;
}
.command-status {
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fff;
  color: var(--muted);
  min-height: 32px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 850;
  white-space: nowrap;
}
.command-status.ok { color: var(--green); border-color: #bbf7d0; background: #f0fdf4; }
.command-status.active { color: var(--blue); border-color: #bfdbfe; background: #eff6ff; }
.command-status.warn { color: var(--amber); border-color: #fed7aa; background: #fff7ed; }
.mission-brief {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 290px;
  gap: 18px;
  align-items: stretch;
  border: 1px solid #c7d2fe;
  border-left: 4px solid var(--blue);
  border-radius: 12px;
  background: linear-gradient(135deg, #f8fbff 0%, #fff 60%);
  padding: 18px;
  margin-bottom: 14px;
  box-shadow: 0 18px 45px rgba(29,78,216,.06);
}
.mission-main h2 { margin: 0; font-size: 24px; line-height: 1.14; letter-spacing: -.02em; }
.mission-main p { margin: 8px 0 0; color: var(--muted); max-width: 900px; line-height: 1.45; }
.mission-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.mission-side { display: grid; gap: 10px; align-content: start; }
.mission-verdict { font-size: 24px; font-weight: 900; color: var(--ink); line-height: 1.05; }
.mission-next { color: var(--muted); line-height: 1.35; font-size: 12px; }
.executive-grid { display: grid; grid-template-columns: .75fr 1.5fr 1fr; gap: 12px; margin-bottom: 14px; }
.executive-card { border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 14px; min-height: 96px; }
.risk-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.risk-chip { border: 1px solid var(--line); border-radius: 8px; padding: 8px; background: #fbfcfd; display: grid; gap: 3px; }
.risk-chip b { font-size: 18px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.risk-chip span { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; font-weight: 800; }
.risk-chip.ok { border-color: #bbf7d0; background: #f0fdf4; }
.risk-chip.warn { border-color: #fed7aa; background: #fff7ed; }
.risk-chip.danger { border-color: #fecdca; background: #fff5f5; }
.heatmap { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.heat { border: 1px solid var(--line); border-radius: 10px; min-height: 116px; padding: 14px; display: grid; align-content: center; gap: 7px; text-align: center; }
.heat b { font-size: 32px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.heat span { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 800; }
.heat.high { background: #fff5f5; border-color: #fecdca; color: var(--red); }
.heat.med { background: #fff7ed; border-color: #fed7aa; color: var(--amber); }
.heat.low { background: #f0fdf4; border-color: #bbf7d0; color: var(--green); }
.kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
.command-kpi-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.kpi {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  padding: 15px;
  min-height: 108px;
}
.kpi-v { font-size: 27px; font-weight: 850; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.kpi-l { margin-top: 8px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; }
.kpi-s { margin-top: 3px; color: var(--faint); font-size: 12px; }
.kpi.blue .kpi-v { color: var(--blue); }
.kpi.green .kpi-v { color: var(--green); }
.kpi.amber .kpi-v { color: var(--amber); }
.kpi.red .kpi-v { color: var(--red); }
.command-grid {
  display: grid;
  grid-template-columns: minmax(320px, .72fr) minmax(0, 1.28fr);
  gap: 14px;
  align-items: stretch;
  margin-bottom: 14px;
}
.command-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
  margin-bottom: 14px;
}
.command-feed-panel { margin-top: 0; }
.attention-list { display: grid; gap: 9px; }
.attention-item {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  padding: 10px;
  min-height: 58px;
}
.attention-item.warn { border-color: #fed7aa; background: #fffaf2; }
.attention-item.danger { border-color: #fecdca; background: #fff7f7; }
.attention-item.info { border-color: #bfdbfe; background: #f8fbff; }
.attention-value {
  width: 38px;
  min-height: 38px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: #fff;
  border: 1px solid var(--line);
  font-size: 18px;
  font-weight: 850;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.attention-title { font-weight: 850; line-height: 1.25; }
.attention-detail { color: var(--muted); font-size: 12px; line-height: 1.35; margin-top: 2px; }
.command-stage-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(132px, 1fr));
  gap: 10px;
}
.stage-mini {
  min-width: 0;
  min-height: 158px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.stage-mini.pass { border-color: #bbf7d0; background: #fbfffc; }
.stage-mini.active { border-color: #bfdbfe; background: #f8fbff; }
.stage-mini.danger { border-color: #fecdca; background: #fff7f7; }
.stage-mini.ready { background: #fbfcfd; }
.stage-mini-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.stage-index {
  color: var(--faint);
  font-size: 11px;
  font-weight: 850;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.stage-mini-name {
  color: var(--text);
  font-size: 13px;
  line-height: 1.2;
  min-height: 32px;
  font-weight: 850;
}
.stage-mini-agent {
  color: var(--muted);
  font-size: 10px;
  line-height: 1.2;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stage-mini-artifact {
  color: var(--faint);
  font-size: 10px;
  line-height: 1.2;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stage-mini-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin-top: auto;
}
.stage-mini-metrics span {
  border: 1px solid #edf0f3;
  border-radius: 6px;
  background: #fff;
  color: var(--muted);
  padding: 5px 6px;
  font-size: 10px;
  white-space: nowrap;
}
.stage-mini-metrics b {
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.stage-mini-foot { display: flex; flex-wrap: wrap; gap: 5px; }
.command-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  border: 1px solid #edf0f3;
  border-radius: 8px;
  background: #fff;
  padding: 10px;
}
.command-row-side {
  display: grid;
  justify-items: end;
  gap: 7px;
  min-width: 92px;
}
.command-row-side .progress { width: 92px; }
.proof-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.proof-grid > div {
  border: 1px solid #edf0f3;
  border-radius: 8px;
  background: #fbfcfd;
  padding: 10px;
}
.proof-value {
  font-size: 22px;
  line-height: 1;
  font-weight: 850;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.proof-label {
  color: var(--muted);
  margin-top: 5px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .06em;
  font-weight: 800;
}
.proof-list { display: grid; gap: 8px; }
.proof-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  border-top: 1px solid #edf0f3;
  padding-top: 9px;
}
.layer-row-mini .side-v.mini {
  font-size: 18px;
  line-height: 1;
  color: var(--text);
}
.workflow-studio { display: grid; gap: 14px; }
.workflow-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, auto);
  gap: 18px;
  align-items: start;
  border: 1px solid var(--line);
  border-left: 3px solid var(--amber);
  border-radius: 8px;
  background: #fffdfa;
  padding: 18px;
}
.workflow-kicker {
  color: var(--amber);
  font-size: 11px;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: .1em;
  margin-bottom: 7px;
}
.workflow-hero h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.16;
  letter-spacing: 0;
}
.workflow-hero p {
  margin: 8px 0 0;
  max-width: 880px;
  color: var(--muted);
  line-height: 1.48;
}
.workflow-hud {
  display: grid;
  grid-template-columns: repeat(4, minmax(82px, 1fr));
  gap: 8px;
}
.workflow-hud > div {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  min-height: 74px;
  padding: 11px;
}
.workflow-hud span {
  display: block;
  color: var(--text);
  font-size: 22px;
  line-height: 1;
  font-weight: 850;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.workflow-hud label {
  display: block;
  margin-top: 8px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.2;
  text-transform: uppercase;
  letter-spacing: .07em;
  font-weight: 800;
}
.workflow-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcfd;
  padding: 10px 12px;
  color: var(--muted);
  font-size: 12px;
}
.workflow-legend span { display: inline-flex; align-items: center; gap: 7px; }
.legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.legend-dot.pass { background: var(--green); }
.legend-dot.running { background: var(--amber); }
.legend-dot.ready { background: var(--blue); }
.legend-dot.fail { background: var(--red); }
.workflow-map-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  gap: 14px;
  align-items: start;
}
.workflow-map-main {
  min-width: 0;
  display: grid;
  gap: 14px;
}
.workflow-rail {
  display: grid;
  grid-template-columns: repeat(15, minmax(46px, 1fr));
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
  background: #fff;
}
.rail-step {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcfd;
  min-height: 58px;
  padding: 6px 5px;
  color: var(--muted);
  text-align: left;
  display: grid;
  gap: 4px;
}
.rail-step span {
  color: var(--faint);
  font-size: 10px;
  font-weight: 850;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.rail-step b {
  color: var(--text);
  font-size: 10px;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rail-step.pass { border-color: #bbf7d0; background: #f8fffb; }
.rail-step.running { border-color: #fed7aa; background: #fffaf2; }
.rail-step.ready { border-color: #bfdbfe; background: #f8fbff; }
.rail-step.fail { border-color: #fecdca; background: #fff7f7; }
.rail-step.selected { outline: 2px solid rgba(180,83,9,.22); outline-offset: 2px; }
.workflow-stage-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(220px, 1fr));
  gap: 12px;
}
.workspace-stage-card {
  width: 100%;
  min-width: 0;
  min-height: 254px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  padding: 12px;
  color: var(--text);
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.workspace-stage-card:hover { border-color: var(--line-strong); background: #fbfcfd; }
.workspace-stage-card.selected {
  border-color: rgba(180,83,9,.55);
  box-shadow: 0 14px 34px rgba(180,83,9,.10);
}
.workspace-stage-card.pass { border-top: 3px solid var(--green); }
.workspace-stage-card.running { border-top: 3px solid var(--amber); }
.workspace-stage-card.ready { border-top: 3px solid var(--blue); }
.workspace-stage-card.fail { border-top: 3px solid var(--red); }
.workspace-stage-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}
.workspace-stage-id {
  color: var(--faint);
  font-size: 11px;
  font-weight: 850;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.workspace-agent {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
.agent-avatar {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--ink);
  color: #fff;
  font-size: 12px;
  font-weight: 850;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.agent-persona {
  font-weight: 850;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-role {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.25;
  margin-top: 2px;
}
.workspace-stage-title {
  font-size: 16px;
  font-weight: 850;
  line-height: 1.2;
}
.workspace-stage-business {
  color: var(--muted);
  line-height: 1.35;
}
.workspace-contract {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}
.workspace-contract span {
  min-width: 0;
  border: 1px solid #edf0f3;
  border-radius: 6px;
  background: #fbfcfd;
  padding: 5px 7px;
  color: var(--muted);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.stage-stack-bar {
  display: flex;
  height: 7px;
  border-radius: 999px;
  overflow: hidden;
  background: #edf0f3;
}
.stage-stack-bar i { display: block; min-width: 0; }
.stage-stack-bar .pass { background: var(--green); }
.stage-stack-bar .fail { background: var(--red); }
.stage-stack-bar .running { background: var(--amber); }
.stage-stack-bar .ready { background: #bfdbfe; }
.workspace-stage-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}
.workspace-stage-metrics span {
  border: 1px solid #edf0f3;
  border-radius: 6px;
  background: #fbfcfd;
  padding: 5px 4px;
  color: var(--muted);
  font-size: 10px;
  text-align: center;
  white-space: nowrap;
}
.workspace-stage-metrics b {
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.run-dot-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-height: 17px;
}
.run-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid #fff;
  box-shadow: 0 0 0 1px var(--line);
}
.run-dot.pass { background: var(--green); }
.run-dot.fail { background: var(--red); }
.run-dot.running { background: var(--amber); }
.run-dot.ready { background: var(--blue); opacity: .48; }
.run-more {
  color: var(--muted);
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.workspace-stage-foot { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
.workflow-inspector {
  position: sticky;
  top: 78px;
}
.inspector-card {
  border: 1px solid var(--line);
  border-left: 3px solid var(--amber);
  border-radius: 8px;
  background: #fff;
  padding: 16px;
}
.inspector-eyebrow {
  color: var(--amber);
  font-size: 10px;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: .12em;
  margin-bottom: 8px;
}
.inspector-title {
  font-size: 21px;
  font-weight: 850;
  line-height: 1.14;
}
.inspector-subtitle {
  color: var(--muted);
  margin-top: 4px;
  line-height: 1.35;
}
.inspector-card p {
  color: var(--text);
  margin: 14px 0;
  line-height: 1.5;
}
.inspector-io {
  display: grid;
  grid-template-columns: 1fr;
  gap: 7px;
  border: 1px solid #edf0f3;
  border-radius: 8px;
  background: #fbfcfd;
  padding: 10px;
}
.inspector-io div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.inspector-io span {
  color: var(--faint);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .07em;
  font-weight: 850;
}
.inspector-io b {
  color: var(--text);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.inspector-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0;
}
.inspector-stats div {
  border: 1px solid #edf0f3;
  border-radius: 8px;
  background: #fff;
  padding: 9px;
}
.inspector-stats b {
  display: block;
  font-size: 19px;
  line-height: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.inspector-stats span {
  display: block;
  color: var(--muted);
  font-size: 10px;
  margin-top: 6px;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.inspector-section-title {
  color: #344054;
  font-size: 11px;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: .08em;
  margin: 14px 0 8px;
}
.inspector-run-list {
  display: grid;
  gap: 8px;
  max-height: 460px;
  overflow-y: auto;
  padding-right: 2px;
}
.inspector-run {
  display: grid;
  gap: 7px;
  border: 1px solid #edf0f3;
  border-radius: 8px;
  background: #fbfcfd;
  padding: 10px;
}
.inspector-run-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.grid-2 { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(310px, .85fr); gap: 14px; align-items: start; }
.grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  overflow: hidden;
}
.panel-head {
  min-height: 42px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.panel-title { font-size: 12px; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; color: #344054; }
.panel-note { color: var(--muted); font-size: 12px; }
.panel-body { padding: 14px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th {
  color: var(--muted);
  background: #f9fafb;
  border-bottom: 1px solid var(--line);
  padding: 9px 11px;
  text-align: left;
  font-size: 11px;
  letter-spacing: .07em;
  text-transform: uppercase;
}
td { border-bottom: 1px solid #edf0f3; padding: 10px 11px; vertical-align: top; }
tr.clickable:hover td { background: #f8fbff; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.muted { color: var(--muted); }
.faint { color: var(--faint); }
.strong { font-weight: 800; }
.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  min-height: 20px;
  font-size: 10px;
  font-weight: 850;
  letter-spacing: .04em;
  text-transform: uppercase;
  border: 1px solid var(--line);
  color: var(--muted);
  background: #f9fafb;
  white-space: nowrap;
}
.pill.pass, .pill.done, .pill.ok { color: var(--green); border-color: #bbf7d0; background: #f0fdf4; }
.pill.fail, .pill.danger, .pill.critical { color: var(--red); border-color: #fecdca; background: #fff5f5; }
.pill.running, .pill.active, .pill.warn, .pill.blocked { color: var(--amber); border-color: #fed7aa; background: #fff7ed; }
.pill.info, .pill.ready, .pill.queued { color: var(--blue); border-color: #bfdbfe; background: #eff6ff; }
.feed-list, .stack-list { display: grid; gap: 8px; }
.feed-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 9px 0;
  border-bottom: 1px solid #f0f2f5;
}
.feed-row:last-child { border-bottom: 0; }
.feed-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 850;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--blue);
  background: #eff6ff;
}
.feed-icon.pass { color: var(--green); background: #f0fdf4; }
.feed-icon.fail, .feed-icon.blocked { color: var(--red); background: #fff5f5; }
.feed-icon.warn { color: var(--amber); background: #fff7ed; }
.feed-summary { font-weight: 650; line-height: 1.35; }
.feed-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 3px; color: var(--muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.feed-ts { color: var(--faint); font-size: 11px; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.stage-grid { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 10px; }
.stage-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  min-height: 106px;
  padding: 11px;
}
.stage-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 8px; }
.stage-top .pill { max-width: 112px; overflow: hidden; text-overflow: ellipsis; display: inline-block; }
.stage-id { color: var(--faint); font-size: 10px; font-weight: 850; }
.stage-name { font-size: 13px; font-weight: 850; line-height: 1.2; min-height: 32px; }
.mini-bars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 10px; }
.mini-bar { height: 5px; border-radius: 4px; background: #edf0f3; }
.mini-bar.pass { background: var(--green); }
.mini-bar.fail { background: var(--red); }
.mini-bar.running { background: var(--amber); }
.mini-bar.ready { background: #d0d5dd; }
.project-card, .agent-group, .approval-card, .alert-card, .layer-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 13px;
  background: #fff;
}
.project-card { display: grid; gap: 10px; }
.project-path { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.metric-row { display: flex; gap: 6px; flex-wrap: wrap; }
.agent-group { margin-bottom: 12px; }
.agent-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.agent-title { font-weight: 850; line-height: 1.25; }
.agent-items { display: grid; gap: 8px; }
.agent-item { border-top: 1px solid #edf0f3; padding-top: 8px; }
.agent-summary { color: #475467; line-height: 1.42; margin-top: 4px; }
.chips { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 7px; }
.chip {
  border: 1px solid var(--line);
  background: #f9fafb;
  border-radius: 6px;
  padding: 3px 7px;
  color: var(--muted);
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.progress { height: 6px; border-radius: 4px; background: #edf0f3; overflow: hidden; }
.progress-fill { height: 100%; background: var(--blue); border-radius: 4px; }
.approval-card.pending { border-left: 4px solid var(--amber); }
.approval-card.approved { border-left: 4px solid var(--green); opacity: .72; }
.approval-card.rejected { border-left: 4px solid var(--red); opacity: .72; }
.approval-actions { display: flex; gap: 8px; margin-top: 10px; }
.btn {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  padding: 6px 10px;
  font-weight: 800;
  font-size: 12px;
}
.btn.primary { background: var(--green); border-color: var(--green); color: #fff; }
.btn.danger { background: #fff5f5; border-color: #fecdca; color: var(--red); }
.alert-card.warn { border-left: 4px solid var(--amber); }
.alert-card.critical { border-left: 4px solid var(--red); }
.alert-card.info { border-left: 4px solid var(--blue); }
.trace-card { border: 1px solid var(--line); border-radius: 8px; padding: 13px; background: #fff; margin-bottom: 12px; }
.trace-flow { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.trace-step { border: 1px solid var(--line); border-radius: 7px; padding: 6px 8px; font-size: 12px; color: var(--muted); }
.trace-step.done { color: var(--green); background: #f0fdf4; border-color: #bbf7d0; }
.empty { padding: 34px 18px; text-align: center; color: var(--muted); }
.empty-title { font-weight: 850; color: #475467; margin-bottom: 5px; }
#drawer-overlay { display: none; position: fixed; inset: 0; background: rgba(15,23,42,.28); z-index: 50; }
#drawer-overlay.open { display: block; }
#drawer-panel {
  position: fixed;
  top: 0;
  right: -560px;
  bottom: 0;
  width: 540px;
  max-width: 92vw;
  background: #fff;
  border-left: 1px solid var(--line);
  box-shadow: -18px 0 40px rgba(15,23,42,.12);
  z-index: 51;
  transition: right .22s ease;
  display: flex;
  flex-direction: column;
}
#drawer-panel.open { right: 0; }
.drawer-head { padding: 16px; border-bottom: 1px solid var(--line); display: flex; gap: 12px; align-items: flex-start; }
.drawer-title { font-size: 16px; font-weight: 850; line-height: 1.25; }
.drawer-sub { color: var(--muted); font-size: 11px; margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.drawer-body { padding: 16px; overflow-y: auto; }
.drawer-close { margin-left: auto; border: 0; background: transparent; font-size: 20px; color: var(--muted); }
@media (max-width: 1400px) {
  .command-kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .command-grid { grid-template-columns: 1fr; }
  .workflow-map-layout { grid-template-columns: 1fr; }
  .workflow-inspector { position: static; }
  .workflow-stage-grid { grid-template-columns: repeat(2, minmax(220px, 1fr)); }
}
@media (max-width: 1100px) {
  #shell { grid-template-columns: 84px minmax(0, 1fr); }
  #sidebar { position: relative; z-index: 20; min-height: 100vh; border-right: 1px solid var(--line); border-bottom: 0; overflow: visible; }
  .brand { padding: 14px 12px; }
  .brand-row { justify-content: center; }
  .brand-row > div:not(.brand-mark):not(.ws-dot), .brand-row .ws-dot { display: none; }
  .destination-nav { padding: 10px 8px; overflow: visible; }
  .destination-nav::before { left: 41px; top: 20px; bottom: 20px; }
  .destination-link { min-height: 54px; grid-template-columns: 1fr; justify-items: center; padding: 8px; }
  .destination-icon { width: 22px; height: 22px; }
  .destination-copy {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    white-space: nowrap;
    border: 0;
  }
  .destination-chevron { display: none; }
  .destination-group .secondary-nav.active {
    position: absolute;
    top: 0;
    left: calc(100% + 10px);
    z-index: 35;
    width: 224px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(255,255,255,.98);
    box-shadow: 0 16px 38px rgba(16,24,40,.14);
  }
  .secondary-link { min-height: 40px; font-size: 12px; }
  .side-kpis { display: none; }
  .grid-2, .grid-3, .kpi-grid, .command-grid, .command-grid-3 { grid-template-columns: 1fr; }
  .stage-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .command-brief { grid-template-columns: 1fr; }
  .command-status { width: fit-content; }
  .command-stage-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .proof-item { grid-template-columns: 1fr; }
  .workflow-hero { grid-template-columns: 1fr; }
  .workflow-hud { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .workflow-rail { grid-template-columns: repeat(5, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  #shell { grid-template-columns: minmax(0, 1fr); }
  #sidebar { display: none; }
  #mobile-nav-toggle { display: grid; flex: 0 0 44px; }
  #mobile-nav-overlay {
    position: fixed;
    inset: 0;
    z-index: 69;
    background: rgba(15,23,42,.38);
    backdrop-filter: blur(2px);
  }
  #mobile-nav-overlay.open { display: block; }
  #mobile-navigation {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 70;
    width: min(320px, 88vw);
    max-width: 88vw;
    background: #fbfcfd;
    border-right: 1px solid var(--line);
    box-shadow: 18px 0 44px rgba(15,23,42,.18);
    transform: translateX(-102%);
    transition: transform .22s cubic-bezier(.22,1,.36,1);
    flex-direction: column;
  }
  #mobile-navigation.open { display: flex; transform: translateX(0); }
  body.mobile-nav-open { overflow: hidden; }
  .mobile-destination-nav { flex: 1; }
  .mobile-destination-nav .destination-link { min-height: 44px; grid-template-columns: 22px minmax(0, 1fr) 12px; justify-items: stretch; padding: 8px 10px; }
  .mobile-destination-nav .destination-copy { position: static; width: auto; height: auto; margin: 0; overflow: visible; clip: auto; white-space: normal; }
  .mobile-destination-nav .destination-chevron { display: block; }
  .mobile-destination-nav .secondary-nav.active { position: static; width: auto; padding: 5px 0 5px 31px; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
  .mobile-destination-nav .secondary-link { min-height: 44px; }
  #topbar { align-items: center; }
  .tb-title { min-width: 0; flex: 1; }
  .mission-brief { grid-template-columns: 1fr; }
  .executive-grid { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  #topbar { height: auto; min-height: 58px; flex-wrap: wrap; padding: 10px 14px; }
  #content { padding: 14px; }
  .page-head { flex-direction: column; }
  .last-updated { white-space: normal; }
  .command-stage-strip { grid-template-columns: 1fr; }
  .attention-item, .command-row { grid-template-columns: 1fr; }
  .command-row-side { justify-items: start; }
  .command-row-side .progress { width: 100%; }
  .workflow-stage-grid, .workflow-hud, .workflow-rail, .workspace-contract, .workspace-stage-metrics, .inspector-stats { grid-template-columns: 1fr; }
  .workspace-stage-card { min-height: 0; }
  .inspector-io div { grid-template-columns: 1fr; }
}

/* ── Run Analytics: Gantt timeline, stage duration bars, trends ───────────── */
.run-select {
  font: inherit; font-size: 12px; color: var(--text);
  border: 1px solid var(--line-strong); border-radius: 6px;
  padding: 4px 8px; background: var(--panel); max-width: 340px;
}
.gantt { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
.gantt-row { display: grid; grid-template-columns: 200px minmax(0, 1fr) 90px; gap: 10px; align-items: center; }
.gantt-label { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gantt-track { position: relative; height: 18px; background: var(--soft); border-radius: 4px; overflow: hidden; }
.gantt-bar { position: absolute; top: 2px; bottom: 2px; border-radius: 3px; min-width: 4px; }
.gantt-bar.pass { background: var(--green); }
.gantt-bar.fail { background: var(--red); }
.gantt-bar.running { background: var(--blue); animation: gantt-pulse 1.6s ease-in-out infinite; }
.gantt-dur { font-size: 11px; color: var(--muted); text-align: right; }
@keyframes gantt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }

.stage-bars { display: flex; flex-direction: column; gap: 6px; }
.stage-bar-row { display: grid; grid-template-columns: 180px minmax(0, 1fr) 110px; gap: 10px; align-items: center; }
.stage-bar-label { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stage-bar-track { height: 12px; background: var(--soft); border-radius: 4px; overflow: hidden; }
.stage-bar-fill { height: 100%; background: var(--blue); border-radius: 4px; }
.stage-bar-value { font-size: 11px; color: var(--muted); text-align: right; }

@media (max-width: 900px) {
  .gantt-row { grid-template-columns: 120px minmax(0, 1fr) 70px; }
  .stage-bar-row { grid-template-columns: 110px minmax(0, 1fr) 90px; }
}

/* ── Scope switcher + Team & Presence ─────────────────────────────────────── */
.tb-scope {
  display: grid;
  grid-template-columns: minmax(150px, 190px) minmax(170px, 230px) minmax(120px, 1fr);
  gap: 8px;
  align-items: end;
  min-width: 0;
  margin-left: 12px;
  padding-left: 12px;
  border-left: 3px solid #bfdbfe;
}
.scope-control { display: grid; gap: 3px; min-width: 0; }
.scope-label {
  color: var(--faint);
  font-size: 9px;
  font-weight: 850;
  letter-spacing: .09em;
  line-height: 1;
  text-transform: uppercase;
}
.tb-scope .run-select {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  max-width: none;
}
.scope-context {
  align-self: center;
  min-width: 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.presence-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: var(--faint); margin-right: 8px; vertical-align: middle;
}
.presence-dot.live { background: var(--green); animation: presence-pulse 1.8s ease-in-out infinite; }
@keyframes presence-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(21, 128, 61, 0.4); } 50% { box-shadow: 0 0 0 5px rgba(21, 128, 61, 0); } }
@media (max-width: 1200px) {
  #topbar { height: auto; min-height: 68px; flex-wrap: wrap; padding-top: 8px; padding-bottom: 8px; }
  .tb-scope { order: 4; width: 100%; margin-left: 0; }
}
@media (max-width: 640px) {
  .tb-scope {
    width: 100%;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    padding: 8px 0 0;
    border-left: 0;
    border-top: 3px solid #bfdbfe;
  }
  .scope-context { grid-column: 1 / -1; white-space: normal; }
}

/* ── Studio: Jarvis-style agent workspace (v8 palette: amber/green/blue) ──── */
.studio-orchestrator { margin-bottom: 16px; }
.studio-manager { display: flex; align-items: center; gap: 16px; padding: 6px 4px; }
.studio-manager-avatar {
  width: 46px; height: 46px; border-radius: 10px; background: var(--ink);
  display: flex; align-items: center; justify-content: center; flex: none;
}
.studio-visor {
  display: block; width: 26px; height: 7px; border-radius: 3px; background: #b45309;
  opacity: 0.5;
}
.studio-visor.live { background: #d97706; opacity: 1; animation: visor-breathe 2s ease-in-out infinite; box-shadow: 0 0 10px 2px rgba(217, 119, 6, 0.55); }
@keyframes visor-breathe { 0%, 100% { box-shadow: 0 0 10px 2px rgba(217, 119, 6, 0.55); } 50% { box-shadow: 0 0 16px 5px rgba(217, 119, 6, 0.25); } }
.studio-manager-text { min-width: 0; flex: 1; }
.studio-manager-name { font-weight: 800; font-size: 12px; letter-spacing: 0.12em; }
.studio-run-label { color: var(--muted); font-weight: 400; letter-spacing: 0; margin-left: 8px; font-size: 11px; }
.studio-narration { color: var(--muted); font-size: 12px; margin-top: 4px; min-height: 16px; }
.studio-hud { display: flex; gap: 18px; flex: none; }
.studio-hud div { text-align: right; }
.studio-hud span { display: block; font-weight: 800; font-size: 16px; }
.studio-hud label { font-size: 10px; color: var(--faint); letter-spacing: 0.08em; text-transform: uppercase; }

.studio-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.workstation {
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 12px; cursor: pointer; position: relative; min-height: 118px;
  border-top: 3px solid var(--line-strong);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.workstation:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(16, 24, 40, 0.08); }
.workstation.selected { outline: 2px solid var(--ink); }
.workstation .ws-head { display: flex; justify-content: space-between; align-items: center; }
.workstation .ws-id { font-size: 11px; color: var(--faint); font-weight: 700; }
.workstation .ws-status-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--line-strong); }
.workstation .ws-business { font-weight: 700; font-size: 13px; margin-top: 6px; }
.workstation .ws-persona { font-size: 10px; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; margin-top: 2px; }
.workstation .ws-badge { font-size: 10px; margin-top: 8px; letter-spacing: 0.08em; }
.workstation .ws-voice { font-size: 11px; color: var(--muted); margin-top: 6px; font-style: italic; line-height: 1.4; }

.workstation.running { border-top-color: #d97706; background: #fffbeb; }
.workstation.running .ws-status-dot { background: #d97706; animation: ws-breathe 1.6s ease-in-out infinite; }
.workstation.running .ws-badge { color: #b45309; }
@keyframes ws-breathe { 0%, 100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.5); } 50% { box-shadow: 0 0 0 6px rgba(217, 119, 6, 0); } }
.workstation.done { border-top-color: #16a34a; }
.workstation.done .ws-status-dot { background: #16a34a; }
.workstation.done .ws-badge { color: #15803d; }
.workstation.fail { border-top-color: #dc2626; background: #fef2f2; }
.workstation.fail .ws-status-dot { background: #dc2626; }
.workstation.fail .ws-badge { color: #b91c1c; }
.workstation.queued .ws-badge { color: #2563eb; }
.workstation.queued .ws-status-dot { background: #2563eb; opacity: 0.5; }

.studio-inspector { margin-top: 14px; }
.studio-inspector .panel-head { display: flex; justify-content: space-between; align-items: center; }

@media (max-width: 1100px) { .studio-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 700px) { .studio-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .studio-hud { display: none; } }

/* ── Artifact & evidence browser (run drawer) ─────────────────────────────── */
.artifact-group { margin-bottom: 10px; }
.artifact-stage { font-size: 10px; color: var(--faint); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
.artifact-link {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  width: 100%; text-align: left; font: inherit; font-size: 12px;
  padding: 7px 10px; margin-bottom: 4px; cursor: pointer;
  background: var(--soft); border: 1px solid var(--line); border-radius: 6px; color: var(--text);
}
.artifact-link:hover { border-color: var(--line-strong); background: #fff; }
.artifact-content {
  margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word; max-height: 60vh; overflow: auto;
}
.evidence-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 12px; }
.evidence-row:last-child { border-bottom: none; }

/* ── Human-readable artifact viewer (issue #89) ───────────────────────────── */
.ar-toolbar { display: flex; align-items: center; gap: 8px; margin: 12px 0 10px; flex-wrap: wrap; }
.ar-toolbar .ar-path { font-size: 12px; font-weight: 600; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ar-toolbar .ar-size { font-size: 11px; color: var(--faint); }
.ar-toolbar .ar-spacer { flex: 1; }
.ar-toolbar a.ar-dl { text-decoration: none; }
.ar-panel { margin: 0; }
.ar-md { font-size: 13px; line-height: 1.6; color: var(--ink); word-break: break-word; }
.ar-md .ar-h { margin: 16px 0 8px; line-height: 1.25; }
.ar-md .ar-h1 { font-size: 20px; } .ar-md .ar-h2 { font-size: 17px; } .ar-md .ar-h3 { font-size: 15px; }
.ar-md .ar-h4, .ar-md .ar-h5, .ar-md .ar-h6 { font-size: 13px; color: var(--muted); }
.ar-md .ar-p { margin: 8px 0; }
.ar-md .ar-list { margin: 8px 0 8px 18px; } .ar-md .ar-list li { margin: 3px 0; }
.ar-md .ar-quote { border-left: 3px solid var(--line-strong); margin: 8px 0; padding: 4px 12px; color: var(--muted); background: var(--soft); border-radius: 0 6px 6px 0; }
.ar-md .ar-hr { border: none; border-top: 1px solid var(--line); margin: 14px 0; }
.ar-md code { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: var(--soft); padding: 1px 5px; border-radius: 4px; }
.ar-md a { color: var(--blue); }
.ar-code { background: var(--soft); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; overflow: auto; max-height: 40vh; }
.ar-code code { background: none; padding: 0; font-size: 12px; line-height: 1.5; }
.ar-tablewrap { overflow-x: auto; margin: 10px 0; }
.ar-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.ar-table th, .ar-table td { border: 1px solid var(--line); padding: 5px 9px; text-align: left; vertical-align: top; }
.ar-table th { background: var(--soft); font-weight: 600; }
.ar-json { font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.6; }
.ar-json .ar-node { margin-left: 12px; }
.ar-json > .ar-node { margin-left: 0; }
.ar-json summary { cursor: pointer; padding: 1px 0; list-style: revert; }
.ar-json .ar-children { border-left: 1px solid var(--line); margin-left: 4px; padding-left: 8px; }
.ar-json .ar-row { margin-left: 12px; padding: 1px 0; }
.ar-key { color: var(--purple, #6d28d9); font-weight: 600; margin-right: 6px; }
.ar-meta { color: var(--faint); font-size: 11px; }
.ar-jsonl-count { display: block; margin-bottom: 6px; }
.ar-str { color: var(--ink); } .ar-number { color: var(--blue); } .ar-boolean { color: var(--amber); } .ar-null { color: var(--faint); font-style: italic; }
.ar-faint { color: var(--faint); }
.ar-clamp { display: inline-block; max-height: 1.6em; overflow: hidden; cursor: pointer; vertical-align: bottom; border: none; border-bottom: 1px dotted var(--line-strong); background: none; padding: 0; margin: 0; font: inherit; color: inherit; text-align: left; }
.ar-clamp:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
/* Keyboard a11y (#95): a visible focus ring on everything reachable by Tab. */
.destination-link:focus-visible, .secondary-link:focus-visible, #mobile-nav-toggle:focus-visible,
#mobile-nav-close:focus-visible, .nav-link:focus-visible, .tb-chip:focus-visible, .btn:focus-visible, .drawer-close:focus-visible,
.run-select:focus-visible, .artifact-link:focus-visible, .rail-step:focus-visible,
.workspace-stage-card:focus-visible, .workstation:focus-visible, .clickable:focus-visible {
  outline: 2px solid var(--blue); outline-offset: 2px;
}
.ar-clamp.ar-open { max-height: none; }
.ar-warn { background: var(--soft); border: 1px solid var(--amber); border-radius: 8px; padding: 8px 12px; font-size: 12px; margin-bottom: 8px; }

/* ── Run Report: infographic stage cards (issue #60) ──────────────────────── */
.report-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.report-kpi { background: var(--soft); border: 1px solid var(--line); border-top: 3px solid var(--line-strong); border-radius: 10px; padding: 12px 14px; }
.report-kpi.blue { border-top-color: var(--blue); } .report-kpi.green { border-top-color: var(--green); } .report-kpi.amber { border-top-color: var(--amber); }
.report-kpi-v { font-size: 22px; font-weight: 800; }
.report-kpi-l { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }

.report-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.stage-card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px;
  border-top: 3px solid var(--line-strong); opacity: 0; transform: translateY(8px);
  transition: opacity 0.4s ease, transform 0.4s ease, box-shadow 0.15s ease; }
.report-animate .stage-card, .studio-stage-card.report-animate { opacity: 1; transform: none; }
.stage-card:hover { box-shadow: 0 8px 22px rgba(16,24,40,0.09); transform: translateY(-2px); }
.stage-card.pass { border-top-color: var(--green); }
.stage-card.warn { border-top-color: var(--amber); }
.stage-card.fail { border-top-color: var(--red); }
.stage-card.idle { border-top-color: var(--line); opacity: 0.55; }
.stage-card-h { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.stage-card-icon { font-size: 20px; }
.stage-card-title { font-weight: 700; font-size: 14px; }
.stage-card-persona { font-size: 10px; color: var(--faint); }
.stage-card-status { margin-left: auto; font-size: 9px; font-weight: 700; letter-spacing: 0.06em; padding: 3px 7px; border-radius: 5px; }
.stage-card-status.pass { background: #ecfdf5; color: var(--green); }
.stage-card-status.warn { background: #fffbeb; color: var(--amber); }
.stage-card-status.fail { background: #fef2f2; color: var(--red); }

.stat-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.stat-chip { background: var(--soft); border-radius: 8px; padding: 8px 12px; min-width: 64px; }
.stat-n { display: block; font-size: 20px; font-weight: 800; line-height: 1; }
.stat-l { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }

.donut-wrap, .gauge-wrap { display: flex; align-items: center; gap: 14px; }
.donut-arc, .gauge-fill { transition: stroke-dasharray 0.9s cubic-bezier(0.22,1,0.36,1); }
.donut-center { font: 800 20px var(--font, sans-serif); fill: var(--text); }
.gauge-center { font: 800 16px sans-serif; fill: var(--text); }
.donut-legend { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--muted); }
.donut-legend i, .gauge-lab { display: inline-block; }
.donut-legend i { width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; }
.gauge-lab { font-size: 11px; color: var(--muted); }

.bars { display: flex; flex-direction: column; gap: 8px; }
.bar-row { display: grid; grid-template-columns: 52px 1fr 36px; align-items: center; gap: 8px; font-size: 12px; }
.bar-lab { color: var(--muted); }
.bar-track { height: 10px; background: var(--soft); border-radius: 5px; overflow: hidden; }
.bar-fill { height: 100%; width: 0; border-radius: 5px; transition: width 0.9s cubic-bezier(0.22,1,0.36,1); }
.report-animate .bar-fill { width: var(--w); }
.bar-fill.pass { background: var(--green); } .bar-fill.fail { background: var(--red); }
.bar-n { text-align: right; font-weight: 700; font-size: 12px; }

.flashcard { display: flex; align-items: baseline; gap: 8px; }
.flash-n { font-size: 32px; font-weight: 800; }
.flash-l { color: var(--muted); font-size: 13px; }

.gate { margin-top: 10px; font-size: 11px; font-weight: 700; display: flex; flex-direction: column; gap: 4px;
  padding: 8px 10px; border-radius: 8px; }
.gate.ok { background: #ecfdf5; color: var(--green); }
.gate.blocked { background: #fef2f2; color: var(--red); }
.gate-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor; margin-right: 6px; }
.gate.blocked .gate-dot { animation: gate-pulse 1.4s ease-in-out infinite; }
@keyframes gate-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.5); } 50% { box-shadow: 0 0 0 5px rgba(220,38,38,0); } }
.gate-reason { font-weight: 400; opacity: 0.85; }

.mini-list { margin-top: 10px; }
.mini-list-h { font-size: 10px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
.mini-list-i { font-size: 12px; color: var(--muted); padding: 3px 0; border-bottom: 1px dashed var(--line); }
.mini-list-i:last-child { border-bottom: none; }
.kv { display: flex; justify-content: space-between; font-size: 12px; padding: 4px 0; }
.kv-note { font-size: 11px; color: var(--muted); margin-top: 8px; font-style: italic; }

@media (max-width: 900px) { .report-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* [wave:quality] Requirements & Traceability, Security registry, Stephens report cards, dark-stage chips */
.cutover-block { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 8px; }
.req-note { font-size: 11px; color: var(--muted); }
.heat.crit { background: #fef2f2; border-color: #f87171; color: #991b1b; }
.heatmap.heatmap-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.stride-strip { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
@media (max-width: 900px) { .heatmap.heatmap-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.wont-have-item { font-size: 12px; color: var(--muted); padding: 6px 0; border-bottom: 1px dashed var(--line); }
.wont-have-item:last-child { border-bottom: none; }
.wont-have-item .mono { color: var(--faint); }
.run-stage-strip { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.run-stage-strip .chip { font-size: 10px; padding: 1px 6px; }

/* [wave:money] Cost & Budget / Run Analytics money panels (#92, #215) */
.stage-bar-fill.money { background: var(--amber); }
.stage-bar-fill.bench-seq { background: var(--muted); }
.stage-bar-fill.bench-par { background: var(--green); }
.bench-head { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.budget-row { padding: 8px 0; border-bottom: 1px dashed var(--line); }
.budget-row:last-child { border-bottom: none; }
.budget-row-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; margin-bottom: 6px; }
.budget-track { height: 12px; background: var(--soft); border-radius: 6px; overflow: hidden; }
.budget-fill { height: 100%; border-radius: 6px; }
.budget-fill.ok { background: var(--green); }
.budget-fill.near { background: var(--amber); }
.budget-fill.over { background: var(--red); }
.budget-note { font-size: 11px; margin-top: 4px; color: var(--muted); }
.budget-note.near { color: var(--amber); }
.budget-note.over { color: var(--red); font-weight: 700; }

/* [wave:command] Command Center next-action + exec rollup, Decision Log (#94/#156/#215) */
.next-action-panel, .exec-rollup-panel { margin-bottom: 16px; }
.next-action { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; }
.next-action-icon { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center;
  justify-content: center; font-size: 18px; font-weight: 800; flex-shrink: 0; }
.next-action-icon.ok { background: #f0fdf4; color: var(--green); }
.next-action-icon.warn { background: #fff7ed; color: var(--amber); }
.next-action-icon.danger { background: #fff5f5; color: var(--red); }
.next-action-icon.info { background: #eff6ff; color: var(--blue); }
.next-action-text { font-weight: 700; line-height: 1.4; }
.next-action-source { margin-top: 10px; font-size: 11px; color: var(--faint); font-style: italic; }
.next-action-source.stale { color: var(--amber, #b7791f); font-style: normal; font-weight: 600; }
.exec-rollup-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.exec-stat { border: 1px solid var(--line); background: #fff; border-radius: 10px; padding: 10px 12px; }
.exec-stat-v { font-size: 22px; font-weight: 800; line-height: 1.2; }
.exec-stat-l { margin-top: 2px; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; }
.exec-stat-s { margin-top: 3px; color: var(--muted); font-size: 11px; line-height: 1.35; }
.exec-stat-v.schema-badge { font-size: 13px; padding-top: 5px; }
.decision-log-row { display: grid; grid-template-columns: 110px 1fr auto; gap: 12px; align-items: start;
  padding: 10px 0; border-bottom: 1px dashed var(--line); }
.decision-log-row:last-child { border-bottom: none; }
.decision-log-when { color: var(--muted); font-size: 11px; padding-top: 2px; }
.decision-log-main .feed-meta { margin-top: 4px; }
@media (max-width: 900px) { .next-action, .decision-log-row { grid-template-columns: 1fr; } }
/* end [wave:command] */

/* [wave:ops] — ops panels: retry state, guardrail depth, context pressure, audit rejections */
.feed-icon.info { color: var(--blue); background: #eff6ff; }
.ops-meta { color: var(--amber); font-weight: 700; }
.ops-note { font-size: 11px; color: var(--muted); font-style: italic; margin-top: 8px; }
.ops-issues { margin: 6px 0 0; padding-left: 18px; font-size: 12px; color: var(--muted); }
.ops-issues li { padding: 2px 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.alert-card.fail { border-left: 4px solid var(--red); }
/* [/wave:ops] */

/* [wave:readiness] Source-backed verdicts and bounded operational motion */
.policy-project { border: 1px solid var(--line-strong); border-radius: 10px; overflow: hidden; background: #fff; }
.policy-project + .policy-project { margin-top: 12px; }
.policy-project-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 13px 14px; border-bottom: 1px solid var(--line); background: #fbfcfd; }
.policy-ledger { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.policy-lane { min-width: 0; padding: 16px; }
.policy-lane + .policy-lane { border-inline-start: 1px solid var(--line); }
.policy-current { box-shadow: inset 0 3px 0 var(--blue); }
.policy-limits { box-shadow: inset 0 3px 0 var(--amber); }
.policy-observed { box-shadow: inset 0 3px 0 var(--green); }
.policy-kicker { margin-bottom: 12px; color: var(--muted); font-size: 10px; font-weight: 850; letter-spacing: .09em; text-transform: uppercase; }
.policy-value { font-size: 18px; line-height: 1.2; font-weight: 850; }
.policy-workflow { margin-top: 5px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.policy-source { margin-top: 12px; color: var(--faint); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; overflow-wrap: anywhere; }
.policy-caps { display: grid; gap: 8px; }
.policy-cap { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.policy-cap:last-child { padding-bottom: 0; border-bottom: 0; }
.policy-cap small { color: var(--muted); font-size: 10px; text-align: right; }
.policy-cap.missing span { color: var(--faint); font-size: 18px; font-weight: 800; }
.policy-state-copy { margin-top: 9px; color: var(--muted); font-size: 12px; line-height: 1.45; }
.policy-issues { margin: 10px 0 0; padding-left: 18px; color: var(--red); font-size: 11px; line-height: 1.45; }
.policy-action { min-height: 44px; margin-top: 12px; padding: 8px 12px; border: 1px solid var(--line-strong); border-radius: 7px; background: #fff; color: var(--text); font-weight: 750; }
.policy-action:hover { border-color: var(--blue); color: var(--blue); }
.policy-action:focus-visible { outline: 3px solid rgba(29,78,216,.24); outline-offset: 2px; }
.policy-snapshot { padding: 13px; border: 1px solid var(--line); border-radius: 8px; }
.policy-snapshot.changed { border-inline-start: 4px solid var(--amber); }
.policy-snapshot-caps { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 10px; color: var(--muted); font-size: 12px; }
.policy-differences { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.policy-differences span { padding: 4px 7px; border-radius: 5px; background: #fff7ed; color: var(--amber); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
.configured-budget { border: 1px solid var(--line-strong); border-radius: 10px; overflow: hidden; }
.configured-budget + .configured-budget { margin-top: 12px; }
.configured-budget-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 13px 14px; border-bottom: 1px solid var(--line); background: #fbfcfd; }
.configured-budget-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(220px, .6fr); }
.configured-budget-grid > div { padding: 16px; }
.configured-budget-grid > div + div { border-inline-start: 1px solid var(--line); }
.policy-observation { display: flex; flex-direction: column; justify-content: center; gap: 5px; min-height: 100%; box-shadow: inset 0 3px 0 var(--green); }
.policy-observation strong { font-size: 20px; }
.policy-observation span { color: var(--muted); font-size: 12px; line-height: 1.45; }
.policy-observation.empty strong { color: var(--muted); font-size: 18px; }

@media (max-width: 700px) {
  .policy-project-head { display: grid; }
  .policy-ledger { grid-template-columns: 1fr; }
  .policy-lane + .policy-lane { border-inline-start: 0; border-top: 1px solid var(--line); }
  .configured-budget-grid { grid-template-columns: 1fr; }
  .configured-budget-grid > div + div { border-inline-start: 0; border-top: 1px solid var(--line); }
}

.command-status.danger { color: var(--red); border-color: #fecdca; background: #fff5f5; }
.command-status.neutral { color: #475467; border-color: var(--line-strong); background: #f8fafc; }
.readiness-signal { position: relative; animation: readiness-signal-pop .42s cubic-bezier(.22,1,.36,1) both; }
.readiness-signal.danger::before,
.readiness-signal.warn::before {
  content: '';
  position: absolute;
  inset: -3px;
  border: 2px solid currentColor;
  border-radius: inherit;
  opacity: 0;
  pointer-events: none;
  animation: readiness-alert-ring 1.35s ease-out 2;
}
.readiness-check { border-inline-start: 3px solid var(--line); padding-inline-start: 12px; }
.readiness-check.pass { border-inline-start-color: var(--green); }
.readiness-check.warning { border-inline-start-color: var(--amber); }
.readiness-check.fail { border-inline-start-color: var(--red); }
.readiness-blocker { animation: readiness-blocker-enter .36s cubic-bezier(.22,1,.36,1) both; }
.source-ref { color: var(--faint); font-size: 10px; line-height: 1.35; margin-top: 5px; overflow-wrap: anywhere; }

#signal-toast-region:empty { display: none; }
.signal-toast {
  position: fixed;
  top: 72px;
  right: 20px;
  z-index: 80;
  width: min(390px, calc(100vw - 28px));
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 11px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--line-strong);
  border-inline-start: 4px solid var(--blue);
  border-radius: 10px;
  background: rgba(255,255,255,.98);
  box-shadow: 0 18px 50px rgba(16,24,40,.16);
  opacity: 0;
  transform: translate3d(18px, -8px, 0);
  pointer-events: none;
}
.signal-toast.show { opacity: 1; transform: translate3d(0,0,0); animation: signal-toast-enter .45s cubic-bezier(.22,1,.36,1) both; }
.signal-toast.danger { border-inline-start-color: var(--red); }
.signal-toast.warn { border-inline-start-color: var(--amber); }
.signal-toast.info { border-inline-start-color: var(--blue); }
.signal-toast-mark { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 9px; border: 1px solid var(--line); background: var(--soft); font-weight: 900; }
.signal-toast.danger .signal-toast-mark { color: var(--red); background: #fff5f5; border-color: #fecdca; }
.signal-toast.warn .signal-toast-mark { color: var(--amber); background: #fff7ed; border-color: #fed7aa; }
.signal-toast.info .signal-toast-mark { color: var(--blue); background: #eff6ff; border-color: #bfdbfe; }
.signal-toast-title { font-weight: 850; line-height: 1.25; }
.signal-toast-detail { color: var(--muted); font-size: 12px; line-height: 1.4; margin-top: 3px; }

@keyframes readiness-signal-pop {
  0% { opacity: .25; transform: translateY(-5px) scale(.96); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes readiness-alert-ring {
  0% { opacity: .45; transform: scale(.96); }
  100% { opacity: 0; transform: scale(1.14); }
}
@keyframes readiness-blocker-enter {
  0% { opacity: 0; transform: translateX(10px); }
  100% { opacity: 1; transform: translateX(0); }
}
@keyframes signal-toast-enter {
  0% { opacity: 0; transform: translate3d(18px,-8px,0) scale(.98); }
  100% { opacity: 1; transform: translate3d(0,0,0) scale(1); }
}

@media (max-width: 640px) {
  .signal-toast { top: 106px; right: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
/* [/wave:readiness] */

/* [issue:279] Availability-aware Overview + Proof Rail */
.overview-decision-surface {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(210px, 280px);
  gap: 24px;
  padding: 26px;
  margin-bottom: 12px;
  border: 1px solid var(--line-strong);
  border-radius: 16px;
  background: linear-gradient(128deg, rgba(52,64,84,.055), rgba(255,255,255,.96) 42%, rgba(21,112,239,.055));
  box-shadow: 0 20px 60px rgba(16,24,40,.07);
}
.overview-eyebrow { color: var(--blue); font-size: 10px; font-weight: 850; letter-spacing: .14em; text-transform: uppercase; }
.overview-outcome-line { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 10px 0 12px; }
.overview-state { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; font-weight: 850; }
.overview-state.blocked { color: var(--red); background: #fff5f5; border-color: #fecdca; }
.overview-state.at_risk { color: var(--amber); background: #fff7ed; border-color: #fed7aa; }
.overview-state.ready { color: var(--green); background: #ecfdf3; border-color: #abefc6; }
.overview-state.unknown { color: var(--muted); background: var(--soft); }
.overview-goal { color: var(--muted); font-size: 12px; font-weight: 700; }
.overview-decision-surface h2 { max-width: 760px; margin: 0; font-size: clamp(25px, 3.3vw, 43px); line-height: 1.04; letter-spacing: -.035em; }
.overview-rationale { max-width: 760px; color: var(--muted); line-height: 1.55; }
.overview-next-action { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); }
.overview-next-action > div { display: grid; gap: 4px; }
.overview-next-label { color: var(--blue); font-size: 10px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
.overview-source { color: var(--faint); font-family: var(--mono); font-size: 10px; overflow-wrap: anywhere; }
.overview-ledger { display: grid; align-content: center; border-left: 1px solid var(--line); padding-left: 22px; }
.overview-ledger > div { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.overview-ledger span { color: var(--muted); font-size: 11px; }
.overview-ledger strong { text-align: right; font-size: 12px; }
.overview-freshness:not(:empty) { margin: 0 0 12px; padding: 11px 14px; border: 1px solid #fed7aa; border-radius: 10px; color: #9a3412; background: #fff7ed; font-size: 12px; }
.overview-proof { margin-bottom: 18px; padding: 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
.overview-section-head { display: flex; justify-content: space-between; gap: 18px; align-items: end; margin-bottom: 16px; }
.overview-section-head h3 { margin: 4px 0 0; font-size: 19px; }
.overview-proof-rail { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(180px, 1fr); gap: 10px; overflow-x: auto; margin: 0; padding: 2px 2px 10px; list-style: none; scroll-snap-type: x proximity; }
.overview-proof-step { position: relative; display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 9px; min-height: 154px; padding: 13px; border: 1px solid var(--line); border-top: 3px solid var(--line-strong); border-radius: 10px; background: var(--soft); scroll-snap-align: start; }
.overview-proof-step::after { content: ''; position: absolute; top: 26px; right: -11px; width: 11px; height: 1px; background: var(--line-strong); }
.overview-proof-step:last-child::after { display: none; }
.overview-proof-step:focus-visible { outline: 3px solid rgba(21,112,239,.32); outline-offset: 2px; }
.overview-proof-step.passed { border-top-color: var(--green); }
.overview-proof-step.failed, .overview-proof-step.blocked { border-top-color: var(--red); }
.overview-proof-step.in_progress { border-top-color: var(--blue); }
.overview-proof-mark { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--line-strong); border-radius: 50%; font-weight: 900; background: var(--panel); }
.overview-proof-copy { display: grid; align-content: start; gap: 5px; min-width: 0; }
.overview-proof-stage { min-height: 29px; color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.overview-proof-copy strong { font-size: 13px; text-transform: capitalize; }
.overview-proof-copy > span:not(.overview-proof-stage):not(.overview-source):not(.overview-proof-blocker) { color: var(--muted); font-size: 10px; }
.overview-proof-blocker { color: var(--red); font-size: 10px; font-weight: 750; }
.overview-proof-empty { display: grid; gap: 4px; min-height: 110px; place-content: center; text-align: center; color: var(--muted); }

@media (max-width: 640px) {
  .overview-decision-surface { grid-template-columns: 1fr; padding: 19px; }
  .overview-ledger { border-left: 0; border-top: 1px solid var(--line); padding: 8px 0 0; }
  .overview-next-action { grid-template-columns: 1fr; align-items: stretch; }
  .overview-next-action .tb-chip { width: 100%; justify-content: center; }
  .overview-section-head { align-items: start; }
  .overview-proof-rail { grid-auto-flow: row; grid-auto-columns: auto; grid-template-columns: 1fr; overflow-x: visible; scroll-snap-type: none; }
  .overview-proof-step { min-height: 0; }
  .overview-proof-step::after { top: auto; right: auto; bottom: -11px; left: 27px; width: 1px; height: 11px; }
}
/* [/issue:279] */
`;
