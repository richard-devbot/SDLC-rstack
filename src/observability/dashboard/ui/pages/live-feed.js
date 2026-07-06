// owner: RStack developed by Richardson Gunde
//
// Live Feed page module — renders into #page-live-feed. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const liveFeedScript = `
// ── page: live-feed ────────────────────────────────────────────────
function renderLiveFeed(s) {
  var feed = s.feed || [];
  setText('live-feed-count', feed.length + ' events');
  setHTML('live-feed-list', feed.length ? feed.map(feedRowHtml).join('') : emptyHtml('No events yet', 'Live event data appears here.'));
}

registerPage('live-feed', {
  errLabel: 'live feed',
  sub: 'Real-time event stream from events.jsonl plus live WebSocket refreshes.',
  render: renderLiveFeed
});
`;
