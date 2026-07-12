// owner: RStack developed by Richardson Gunde

import { URLSearchParams } from 'node:url';

function child(id, label, hidden = false) {
  return Object.freeze({ id, label, icon: '', hidden });
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
  destination('runs', 'Runs', 'runs', 'run-workspace', [
    child('run-workspace', 'Run Workspace'),
    child('projects', 'Projects & Runs', true),
    child('workflow', 'Workflow Map', true),
    child('run-analytics', 'Run Analytics', true),
    child('studio', 'Studio', true),
    child('agent-work', 'Agent Work', true),
  ]),
  destination('evidence', 'Evidence', 'evidence', 'release-readiness', [
    child('release-readiness', 'Release Readiness'),
    child('traceability', 'Requirements & Traceability'),
    child('run-report', 'Run Report'),
    child('security', 'Security'),
    child('compliance', 'Compliance'),
  ]),
  destination('decisions', 'Decisions', 'decisions', 'action-inbox', [
    child('action-inbox', 'Action Inbox'),
    child('approvals', 'Approvals', true),
    child('decisions', 'Decisions / Readiness', true),
    child('alerts-guardrails', 'Alerts & Guardrails', true),
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

export function parseDashboardRoute({ hash = '', search = '' } = {}) {
  const route = { page: '', run: '', section: '' };
  const query = new URLSearchParams(String(search).replace(/^\?/, ''));
  route.page = query.get('page') || '';

  const rawHash = String(hash).replace(/^#/, '');
  if (!rawHash) return route;
  if (!rawHash.includes('=') && !rawHash.includes('&')) {
    try {
      route.page = decodeURIComponent(rawHash);
    } catch {
      route.page = rawHash;
    }
    return route;
  }

  const hashParams = new URLSearchParams(rawHash);
  route.page = hashParams.get('page') || route.page;
  route.run = hashParams.get('run') || '';
  route.section = hashParams.get('section') || '';
  return route;
}

export function formatDashboardHash({ pageId = '', runKey = '', section = '' } = {}) {
  const params = new URLSearchParams();
  if (pageId) params.set('page', pageId);
  if (runKey) params.set('run', runKey);
  if (section) params.set('section', section);
  const value = params.toString();
  return value ? `#${value}` : '';
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
    const visibleChildren = item.children.filter((entry) => !entry.hidden);
    const active = item.id === destinations[0].id;
    const childId = `${surface}-destination-${item.id}-children`;
    return `<div class="destination-group${active ? ' active' : ''}" data-destination-group="${item.id}">` +
      `<button class="destination-link${active ? ' active' : ''}" type="button" title="${item.label}" data-primary-destination="${item.id}" aria-expanded="${active}" aria-controls="${childId}">` +
        destinationIcon(item.icon) +
        `<span class="destination-copy"><span class="destination-label">${item.label}</span><span class="destination-hint">${visibleChildren.length === 1 ? (item.id === 'overview' ? 'Your delivery outcome' : visibleChildren[0].label) : `${visibleChildren.length} views`}</span></span>` +
        '<span class="destination-chevron" aria-hidden="true">›</span>' +
      '</button>' +
      `<div class="secondary-nav${active ? ' active' : ''}" id="${childId}"${active ? '' : ' hidden'}>` +
        visibleChildren.map((entry) => {
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

const destinationDefaults = Object.freeze(Object.fromEntries(
  destinations.map((item) => [item.id, item.defaultPage]),
));

export const navigationScript = `
// ── six-destination responsive navigation (issue #278) ───────────
var PAGE_TO_DESTINATION = ${JSON.stringify(pageToDestination)};
var DESTINATION_DEFAULTS = ${JSON.stringify(destinationDefaults)};
var DEFAULT_PAGE = ${JSON.stringify(destinations[0].defaultPage)};
var ACTIVE_PAGE = DEFAULT_PAGE;
var ACTIVE_DESTINATION = PAGE_TO_DESTINATION[DEFAULT_PAGE];
var RUN_WORKSPACE_SECTIONS = ['summary', 'work', 'timeline', 'artifacts', 'metrics'];
var ACTIVE_RUN_SECTION = 'summary';
var MOBILE_NAV_RETURN_FOCUS = null;
var NAVIGATION_INITIALIZED = false;

${parseDashboardRoute.toString()}
${formatDashboardHash.toString()}

function readDashboardRoute() {
  return parseDashboardRoute({ hash: location.hash || '', search: location.search || '' });
}

function writeDashboardRoute(pageId, runKey, section, mode) {
  if (section === 'push' || section === 'replace') { mode = section; section = ''; }
  var hash = formatDashboardHash({ pageId: pageId || '', runKey: runKey || '', section: section || '' });
  var next = location.pathname + (location.search || '') + hash;
  if (mode === 'push') history.pushState(null, '', next);
  else history.replaceState(null, '', next);
}

function syncNavigationState(pageId) {
  var destinationId = PAGE_TO_DESTINATION[pageId] || PAGE_TO_DESTINATION[DEFAULT_PAGE];
  ACTIVE_PAGE = PAGE_TO_DESTINATION[pageId] ? pageId : DEFAULT_PAGE;
  ACTIVE_DESTINATION = destinationId;

  document.querySelectorAll('[data-destination-group]').forEach(function(group) {
    var active = group.getAttribute('data-destination-group') === destinationId;
    group.classList.toggle('active', active);
    var destinationButton = group.querySelector('[data-primary-destination]');
    var secondary = group.querySelector('.secondary-nav');
    if (destinationButton) {
      destinationButton.classList.toggle('active', active);
      destinationButton.setAttribute('aria-expanded', active ? 'true' : 'false');
    }
    if (secondary) {
      secondary.classList.toggle('active', active);
      secondary.hidden = !active;
    }
  });

  document.querySelectorAll('.secondary-link').forEach(function(button) {
    var active = button.getAttribute('data-page') === ACTIVE_PAGE;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  document.querySelectorAll('.page').forEach(function(page) {
    page.classList.toggle('active', page.id === 'page-' + ACTIVE_PAGE);
  });
  setText('page-title', PAGE_LABELS[ACTIVE_PAGE] || ACTIVE_PAGE);
}

function showPage(pageId, opts) {
  var options = opts || {};
  var resolvedPage = PAGE_TO_DESTINATION[pageId] ? pageId : DEFAULT_PAGE;
  if (resolvedPage === 'run-workspace') {
    ACTIVE_RUN_SECTION = RUN_WORKSPACE_SECTIONS.indexOf(options.section) >= 0 ? options.section : (ACTIVE_PAGE === 'run-workspace' ? ACTIVE_RUN_SECTION : 'summary');
  }
  syncNavigationState(resolvedPage);
  if (options.history !== false) writeDashboardRoute(ACTIVE_PAGE, SCOPE.run, ACTIVE_PAGE === 'run-workspace' ? ACTIVE_RUN_SECTION : '', 'push');
  if (options.closeMobile !== false) closeMobileNavigation();
  resetDashboardScroll();
}

function showRunWorkspaceSection(section, opts) {
  showPage('run-workspace', { section: section, history: !(opts && opts.history === false), closeMobile: false });
  if (typeof renderRunWorkspaceSection === 'function') renderRunWorkspaceSection();
}

function showDestination(destinationId, opts) {
  var pageId = DESTINATION_DEFAULTS[destinationId] || DEFAULT_PAGE;
  showPage(pageId, opts);
}

function mobileNavigationIsOpen() {
  var panel = document.getElementById('mobile-navigation');
  return !!(panel && panel.classList.contains('open'));
}

function openMobileNavigation() {
  var panel = document.getElementById('mobile-navigation');
  var overlay = document.getElementById('mobile-nav-overlay');
  var toggle = document.getElementById('mobile-nav-toggle');
  if (!panel || !overlay || !toggle) return;
  MOBILE_NAV_RETURN_FOCUS = document.activeElement || toggle;
  panel.classList.add('open');
  overlay.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  overlay.setAttribute('aria-hidden', 'false');
  toggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('mobile-nav-open');
  var first = panel.querySelector('[data-primary-destination]');
  if (first) first.focus();
}

function closeMobileNavigation(opts) {
  var options = opts || {};
  var panel = document.getElementById('mobile-navigation');
  var overlay = document.getElementById('mobile-nav-overlay');
  var toggle = document.getElementById('mobile-nav-toggle');
  if (!panel || !overlay || !toggle) return;
  if (!panel.classList.contains('open')) return;
  var returnFocus = MOBILE_NAV_RETURN_FOCUS;
  panel.classList.remove('open');
  overlay.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('aria-hidden', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('mobile-nav-open');
  MOBILE_NAV_RETURN_FOCUS = null;
  if (options.returnFocus !== false && returnFocus && typeof returnFocus.focus === 'function') {
    returnFocus.focus();
  }
}

function mobileNavigationFocusable(panel) {
  return Array.prototype.slice.call(panel.querySelectorAll('button:not([disabled]), [href], select:not([disabled])'))
    .filter(function(element) { return !element.closest('[hidden]'); });
}

function handleMobileNavigationKeydown(event) {
  var panel = document.getElementById('mobile-navigation');
  if (!panel || !panel.classList.contains('open')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMobileNavigation();
    return;
  }
  if (event.key === 'Tab') {
    var focusable = mobileNavigationFocusable(panel);
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function restoreScopeFromRoute(runKey) {
  if (typeof SCOPE === 'undefined' || runKey === SCOPE.run) return;
  if (!runKey) {
    SCOPE.run = '';
    legacyRunId = '';
    persistScope();
    requestScopedState();
    return;
  }
  var selected = (SCOPE_CATALOG.runs || []).find(function(run) {
    return run.key === runKey || run.runId === runKey;
  });
  if (selected) {
    SCOPE.run = selected.key;
    SCOPE.project = selected.projectId;
    legacyRunId = '';
  } else {
    SCOPE.run = '';
    SCOPE.project = '';
    legacyRunId = runKey;
  }
  persistScope();
  requestScopedState();
}

function initDashboardNavigation() {
  if (NAVIGATION_INITIALIZED) return;
  NAVIGATION_INITIALIZED = true;
  document.querySelectorAll('[data-primary-destination]').forEach(function(button) {
    button.addEventListener('click', function() {
      showDestination(button.getAttribute('data-primary-destination'));
    });
  });
  document.querySelectorAll('.secondary-link').forEach(function(button) {
    button.addEventListener('click', function() {
      showPage(button.getAttribute('data-page'));
    });
  });
  var toggle = document.getElementById('mobile-nav-toggle');
  var close = document.getElementById('mobile-nav-close');
  var overlay = document.getElementById('mobile-nav-overlay');
  var panel = document.getElementById('mobile-navigation');
  if (toggle) toggle.addEventListener('click', openMobileNavigation);
  if (close) close.addEventListener('click', closeMobileNavigation);
  if (overlay) overlay.addEventListener('click', closeMobileNavigation);
  if (panel) panel.addEventListener('keydown', handleMobileNavigationKeydown);
  window.addEventListener('popstate', function() {
    var route = readDashboardRoute();
    showPage(route.page || DEFAULT_PAGE, { history: false, closeMobile: false, section: route.section });
    restoreScopeFromRoute(route.run);
    if (typeof renderRunWorkspaceSection === 'function') renderRunWorkspaceSection();
  });
  var initialRoute = readDashboardRoute();
  showPage(initialRoute.page || DEFAULT_PAGE, { history: false, closeMobile: false, section: initialRoute.section });
}
`;
