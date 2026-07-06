// owner: RStack developed by Richardson Gunde
//
// Team & Layers page module — renders into #page-team-layers. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const teamLayersScript = `
// ── page: team-layers ────────────────────────────────────────────────
function renderTeamLayers(s) {
  var layers = s.layers || [];
  var frameworks = s.frameworks || {};
  setHTML('layers-grid', layers.map(function(layer) {
    return '<div class="layer-card"><div class="agent-head"><div><div class="strong">' + esc(layer.name) + '</div><div class="muted">' + esc(layer.detail) + '</div></div>' + pill(layer.health, layer.health) + '</div><div class="kpi-v" style="font-size:22px">' + esc(layer.count) + '</div></div>';
  }).join('') || emptyHtml('No layer data', 'Layer health appears here.'));
  setHTML('framework-table', Object.keys(frameworks).map(function(name) {
    var item = frameworks[name];
    return '<tr><td class="strong">' + esc(name) + '</td><td>' + item.runs + '</td><td style="color:var(--green);font-weight:800">' + item.pass + '</td><td style="color:var(--red);font-weight:800">' + item.fail + '</td><td class="mono muted">$' + Number(item.cost || 0).toFixed(4) + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="empty">No framework data</td></tr>');
}

registerPage('team-layers', {
  errLabel: 'team layers',
  sub: 'Stack layers and framework health across harness, tracker, alerts, hooks, memory and observers.',
  render: renderTeamLayers
});
`;
