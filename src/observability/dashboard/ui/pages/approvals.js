// owner: RStack developed by Richardson Gunde
//
// Approvals page module — renders into #page-approvals. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const approvalsScript = `
// ── page: approvals ────────────────────────────────────────────────
function renderApprovals(s) {
  var approvals = s.approvals || [];
  var pending = approvals.filter(function(item) { return !item.status || item.status === 'pending'; });
  var resolved = approvals.filter(function(item) { return item.status && item.status !== 'pending'; });
  setText('approvals-count', pending.length + ' pending');
  setHTML('approvals-list', pending.map(function(item) { return approvalHtml(item, true); }).join('') || emptyHtml('No pending approvals', 'Only queue-backed approvals appear here.'));
  setHTML('approvals-resolved', resolved.slice(0, 20).map(function(item) { return approvalHtml(item, false); }).join('') || emptyHtml('No resolved approvals', 'Approved and rejected queue entries appear here.'));
}

function approvalHtml(item, canAct) {
  var status = item.status || 'pending';
  // Guardrail overrides are one-shot credentials, not standing approvals —
  // say so on the card so the manager knows exactly what they are granting.
  var isOverride = String(item.artifact || '').indexOf('guardrail-override:') === 0;
  var overrideNote = isOverride
    ? '<div class="muted" style="margin-top:6px">🛡 One-shot override: approving grants exactly <span class="strong">one</span> more attempt for this task, then the override is consumed and further attempts block again.</div>'
    : '';
  return '<div class="approval-card ' + esc(status) + '"><div class="agent-head"><div><div class="strong">' + esc(item.title || item.type || 'Approval required') + '</div><div class="muted">' + esc(item.detail || item.reason || '') + '</div>' + overrideNote + '<div class="feed-meta"><span>' + esc(shortName(item.projectRoot)) + '</span><span>' + esc((item.runId || '').slice(-16)) + '</span><span>' + esc(fmtTime(item.ts)) + '</span></div></div>' + pill(status, status) + '</div>' +
    (canAct ? '<div class="approval-actions"><button class="btn primary" data-id="' + esc(item.id) + '" onclick="approveFromButton(this)">Approve</button><button class="btn danger" data-id="' + esc(item.id) + '" onclick="rejectFromButton(this)">Reject</button></div>' : '') +
    '</div>';
}

function approveFromButton(btn) {
  resolveApproval(btn.getAttribute('data-id'), 'approve');
}

function rejectFromButton(btn) {
  resolveApproval(btn.getAttribute('data-id'), 'reject');
}

function resolveApproval(id, action) {
  var resolvedBy = localStorage.getItem('rstack-approver-name') || '';
  if (!resolvedBy && typeof window.prompt === 'function') {
    resolvedBy = window.prompt('Manager name for this approval decision') || '';
    if (resolvedBy) localStorage.setItem('rstack-approver-name', resolvedBy);
  }
  // Approvals require the signed token (RSTACK_APPROVAL_TOKEN) so identity
  // can't be spoofed from a bare request. Stored locally after first entry.
  var token = sessionStorage.getItem('rstack-approval-token') || '';
  if (!token && typeof window.prompt === 'function') {
    token = window.prompt('Approval token (RSTACK_APPROVAL_TOKEN set on the hub)') || '';
    if (token) sessionStorage.setItem('rstack-approval-token', token);
  }
  fetch('/api/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': token },
    body: JSON.stringify({ id: id, resolvedBy: resolvedBy || 'dashboard' })
  }).then(function(response) {
    if (!response.ok) {
      return response.json().then(function(body) {
        throw new Error(body.error || ('HTTP ' + response.status));
      });
    }
    return fetchState();
  }).catch(function(err) { showErr('approval: ' + err.message); });
}

registerPage('approvals', {
  errLabel: 'approvals',
  sub: 'Human-in-loop actions from the approval queue only.',
  unscoped: true,
  render: renderApprovals
});
`;
