// owner: RStack developed by Richardson Gunde

function child(id, label) {
  return Object.freeze({ id, label, icon: '' });
}

function destination(id, label, icon, defaultPage, children) {
  return Object.freeze({
    id,
    label,
    icon,
    defaultPage,
    children: Object.freeze(children),
    // Issue #281 owns the normalized, scoped Action Inbox count. Keep the
    // shell honest until that single source is available.
    badgeSource: null,
  });
}

export const destinations = Object.freeze([
  destination('overview', 'Overview', 'overview', 'command', [
    child('command', 'Command Center'),
  ]),
  destination('runs', 'Runs', 'runs', 'projects', [
    child('projects', 'Projects & Runs'),
    child('workflow', 'Workflow Map'),
    child('run-analytics', 'Run Analytics'),
    child('studio', 'Studio'),
    child('agent-work', 'Agent Work'),
  ]),
  destination('evidence', 'Evidence', 'evidence', 'release-readiness', [
    child('release-readiness', 'Release Readiness'),
    child('traceability', 'Requirements & Traceability'),
    child('run-report', 'Run Report'),
    child('security', 'Security'),
    child('compliance', 'Compliance'),
  ]),
  destination('decisions', 'Decisions', 'decisions', 'approvals', [
    child('approvals', 'Approvals'),
    child('decisions', 'Decisions / Readiness'),
    child('alerts-guardrails', 'Alerts & Guardrails'),
  ]),
  destination('spend', 'Spend', 'spend', 'business-flex', [
    child('business-flex', 'Business Flex'),
    child('cost-budget', 'Cost & Budget'),
  ]),
  destination('operations', 'Operations', 'operations', 'live-feed', [
    child('live-feed', 'Live Feed'),
    child('team', 'Team & Presence'),
    child('team-layers', 'Team & Layers'),
    child('environment', 'Environment & Integrations'),
    child('diagnostics', 'Diagnostics'),
  ]),
]);

export const pages = Object.freeze(destinations.flatMap((item) =>
  item.children.map((entry) => Object.freeze([
    entry.id,
    entry.icon,
    entry.label,
    item.label,
  ])),
));

export const pageToDestination = Object.freeze(Object.fromEntries(
  destinations.flatMap((item) => item.children.map((entry) => [entry.id, item.id])),
));

export function destinationForPage(pageId) {
  const destinationId = pageToDestination[pageId] || destinations[0].id;
  return destinations.find((item) => item.id === destinationId) || destinations[0];
}

const iconPaths = Object.freeze({
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  runs: '<path d="M8 5v14l11-7z"/><path d="M3 4v16"/>',
  evidence: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-5"/>',
  decisions: '<path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"/><path d="M12 7v5"/><path d="M12 16h.01"/>',
  spend: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  operations: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="18" r="2"/>',
});

function destinationIcon(icon) {
  return `<svg class="destination-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[icon]}</svg>`;
}

function navigationGroups(surface) {
  return destinations.map((item) => {
    const active = item.id === destinations[0].id;
    const childId = `${surface}-destination-${item.id}-children`;
    return `<div class="destination-group${active ? ' active' : ''}" data-destination-group="${item.id}">` +
      `<button class="destination-link${active ? ' active' : ''}" type="button" data-primary-destination="${item.id}" aria-expanded="${active}" aria-controls="${childId}">` +
        destinationIcon(item.icon) +
        `<span class="destination-copy"><span class="destination-label">${item.label}</span><span class="destination-hint">${item.children.length === 1 ? 'Your delivery outcome' : `${item.children.length} views`}</span></span>` +
        '<span class="destination-chevron" aria-hidden="true">›</span>' +
      '</button>' +
      `<div class="secondary-nav${active ? ' active' : ''}" id="${childId}"${active ? '' : ' hidden'}>` +
        item.children.map((entry) => {
          const current = entry.id === 'command';
          return `<button class="secondary-link${current ? ' active' : ''}" type="button" data-page="${entry.id}" data-parent-destination="${item.id}"${current ? ' aria-current="page"' : ''}>` +
            `<span class="secondary-marker" aria-hidden="true"></span><span>${entry.label}</span>` +
          '</button>';
        }).join('') +
      '</div>' +
    '</div>';
  }).join('');
}

export function desktopNavigationMarkup() {
  return `<nav id="primary-navigation" class="destination-nav" aria-label="Business Hub destinations">${navigationGroups('desktop')}</nav>`;
}

export function mobileNavigationMarkup() {
  return '<div id="mobile-nav-overlay" aria-hidden="true"></div>' +
    '<aside id="mobile-navigation" role="dialog" aria-modal="true" aria-labelledby="mobile-nav-title" aria-hidden="true">' +
      '<header class="mobile-nav-head"><div><div class="mobile-nav-kicker">RStack Business Hub</div><h2 id="mobile-nav-title">Navigate</h2></div><button id="mobile-nav-close" type="button" aria-label="Close navigation">×</button></header>' +
      `<nav class="mobile-destination-nav" aria-label="Business Hub mobile destinations">${navigationGroups('mobile')}</nav>` +
    '</aside>';
}
