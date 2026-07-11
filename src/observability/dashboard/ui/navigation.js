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
