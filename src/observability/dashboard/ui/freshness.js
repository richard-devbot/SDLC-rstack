// owner: RStack developed by Richardson Gunde

// Data-freshness classification for the Business Hub topbar (issue #87).
// Shipped as a standalone <script> so classifyFreshness() is available to
// client.js. Kept as a pure function (no DOM, no clock of its own) so it can be
// unit-tested by evaluating this string in a sandbox.
//
// A mission-critical dashboard must never silently show stale data: the chip
// reflects both the WebSocket state and how long it has been since the last
// snapshot actually landed (whether via WS push or REST poll).
export const freshnessScript = `
function classifyFreshness(opts) {
  opts = opts || {};
  var staleMs = opts.staleMs == null ? 10000 : opts.staleMs;
  var disconnectMs = opts.disconnectMs == null ? 30000 : opts.disconnectMs;
  if (!opts.hasData) return 'loading';
  var age = opts.now - opts.lastSnapshotAt;
  // No fresh data in a long while: hard-disconnected, whatever the socket says.
  if (age > disconnectMs) return 'disconnected';
  // Socket is down but recent polls (or a recent push) keep data flowing.
  if (!opts.wsConnected) return 'reconnecting';
  // Socket is up but snapshots stopped arriving — the server poll stalled.
  if (age > staleMs) return 'stale';
  return 'live';
}

// Maps a freshness kind to the status-dot class the topbar already styles.
function freshnessDotClass(kind) {
  if (kind === 'live') return 'status-live';
  if (kind === 'disconnected') return 'status-error';
  return 'status-connecting';
}

// Human label for the chip. stamp is a short clock string (HH:MM:SS) or null.
function freshnessLabel(kind, stamp) {
  if (kind === 'loading') return 'Loading…';
  if (kind === 'live') return 'Live · updated ' + (stamp || '—');
  if (kind === 'stale') return 'Stale · data as of ' + (stamp || '—');
  if (kind === 'reconnecting') return 'Reconnecting · data as of ' + (stamp || '—');
  return 'Disconnected · data as of ' + (stamp || '—');
}
`;
