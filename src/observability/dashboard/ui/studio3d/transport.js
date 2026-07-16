/**
 * Same-origin REST/WebSocket transport for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
/* global URLSearchParams */
const RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000];

export function webSocketUrl(locationLike) {
  const protocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = new URLSearchParams(locationLike.search ?? '').get('token');
  return `${protocol}//${locationLike.host}/${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function stateUrl(locationLike, runKey = null) {
  const query = new URLSearchParams();
  if (runKey) query.set('run', runKey);
  const token = new URLSearchParams(locationLike.search ?? '').get('token');
  if (token) query.set('token', token);
  const encoded = query.toString();
  return encoded ? `/api/state?${encoded}` : '/api/state';
}

export function createStudioTransport({
  onSnapshot,
  onConnection,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  WebSocketImpl = globalThis.WebSocket,
  location = globalThis.location,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  let socket = null;
  let stopped = false;
  let reconnectTimer = null;
  let staleTimer = null;
  let retryIndex = 0;
  let lastGeneratedAt = null;
  let lastReceiptAt = 0;

  const report = (state, detail = null) => onConnection?.({ state, detail });

  function accept(snapshot) {
    const generatedAt = snapshot?.studio?.generated_at ?? snapshot?.ts ?? null;
    if (generatedAt && generatedAt === lastGeneratedAt) return;
    lastGeneratedAt = generatedAt;
    lastReceiptAt = Date.now();
    onSnapshot?.(snapshot);
  }

  function armStaleCheck() {
    if (staleTimer) clearTimer(staleTimer);
    staleTimer = setTimer(() => {
      if (!stopped && lastReceiptAt && Date.now() - lastReceiptAt > 12_000) report('stale');
      armStaleCheck();
    }, 4_000);
  }

  async function fetchSnapshot(runKey = null) {
    if (!fetchImpl) throw new Error('Fetch is unavailable');
    const response = await fetchImpl(stateUrl(location, runKey), {
      headers: { Accept: 'application/json' },
      cache: 'no-cache',
    });
    if (!response.ok) throw new Error(`State request failed (${response.status})`);
    const snapshot = await response.json();
    accept(snapshot);
    return snapshot;
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = RETRY_DELAYS[Math.min(retryIndex, RETRY_DELAYS.length - 1)];
    retryIndex += 1;
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      connectSocket();
    }, delay);
  }

  function connectSocket() {
    if (stopped || !WebSocketImpl) {
      report('disconnected', WebSocketImpl ? null : 'WebSocket unavailable');
      return;
    }
    report('connecting');
    try {
      socket = new WebSocketImpl(webSocketUrl(location));
    } catch (error) {
      report('error', error?.message ?? String(error));
      scheduleReconnect();
      return;
    }
    socket.addEventListener('open', () => {
      retryIndex = 0;
      report('live');
    });
    socket.addEventListener('message', (event) => {
      try {
        accept(JSON.parse(event.data));
        report('live');
      } catch {
        report('error', 'Malformed snapshot received');
      }
    });
    socket.addEventListener('error', () => report('disconnected'));
    socket.addEventListener('close', () => {
      socket = null;
      report('disconnected');
      scheduleReconnect();
    });
  }

  return {
    async start() {
      stopped = false;
      report('connecting');
      armStaleCheck();
      try {
        await fetchSnapshot();
      } catch (error) {
        report('error', error?.message ?? String(error));
      }
      connectSocket();
    },
    async selectRun(runKey) {
      report('connecting', 'Changing run scope');
      return fetchSnapshot(runKey || null);
    },
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimer(reconnectTimer);
      if (staleTimer) clearTimer(staleTimer);
      reconnectTimer = null;
      staleTimer = null;
      if (socket) socket.close();
      socket = null;
    },
  };
}
