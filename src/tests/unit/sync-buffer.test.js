/**
 * Regression tests for the screen-sync data-loss and stale-row fixes.
 *
 * Bug: while a screen sync was in flight (session.syncing === true),
 * onSSHData silently DROPPED every live ssh-data frame. Output that the
 * server broadcast between serializing its terminal state and the client
 * finishing the sync write was lost forever. Line-diff TUI renderers
 * (OpenCode, Bubble Tea, ...) never rewrite rows they consider
 * unchanged, so those holes stayed visible as stale/black rows until a
 * manual window/font resize forced a full repaint (the "alternating
 * black lines" bug).
 *
 * Fix: buffer live frames in session.syncBuffer during the sync window
 * and replay them right after the serialized state is written. Also:
 *  - the sync handler cancels/discards stale pre-sync chunks (they are
 *    already contained in the serialized state),
 *  - _flushWriteChunks defers while syncing (no interleaving),
 *  - the settle refresh has a 2s max-wait that forces a full renderer
 *    dimension recompute even during non-stop output floods.
 */

const path = require('path');
const fs = require('fs');

// Controllable RAF implementation injected into the class's closure scope.
// (app.js calls bare requestAnimationFrame, which resolves through the
// new Function scope — not through the client instance.)
let currentRAF = null;
const scopeRAF = {
  requestAnimationFrame: (cb) => currentRAF ? currentRAF.requestAnimationFrame(cb) : 0,
  cancelAnimationFrame: (id) => { if (currentRAF) currentRAF.cancelAnimationFrame(id); },
};

function loadClientClass() {
  const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'app.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const mockWindow = { innerWidth: 1280, addEventListener: () => {}, removeEventListener: () => {}, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }), matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) };
  const mockDocument = { addEventListener: () => {}, removeEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } }, documentElement: { setAttribute: () => {}, getAttribute: () => null, classList: { add: () => {}, remove: () => {} }, style: { setProperty: () => {}, removeProperty: () => {} } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, style: {} }) };
  const scope = {
    window: mockWindow, document: mockDocument,
    localStorage: { _s: {}, getItem(k) { return (k in this._s) ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } },
    navigator: { clipboard: { writeText: () => Promise.resolve(true) }, userAgent: 'node' },
    io: function () { return { on: () => {}, emit: () => {}, connected: true, disconnect: () => {}, connect: () => {} }; },
    requestAnimationFrame: scopeRAF.requestAnimationFrame,
    cancelAnimationFrame: scopeRAF.cancelAnimationFrame,
    setTimeout: (...a) => global.setTimeout(...a), clearTimeout: (...a) => global.clearTimeout(...a), setInterval: (...a) => global.setInterval(...a), clearInterval: (...a) => global.clearInterval(...a),
    console,
    Terminal: undefined, FitAddon: undefined, WebLinksAddon: undefined, SearchAddon: undefined, SerializeAddon: undefined, WebglAddon: undefined, Unicode11Addon: undefined, ImageAddon: undefined,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextDecoder,
    Worker: function () {},
    visualViewport: null,
    performance: { now: () => Date.now() }
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(scope), source + '\nreturn SSHIFTClient;');
  const Cls = factory(...Object.values(scope));
  Cls.prototype.init = function () { /* test stub — skip DOM-heavy init */ };
  return Cls;
}

function makeClient(Cls, raf) {
  currentRAF = raf;
  const client = new Cls();
  client.socket = { on: () => {}, emit: () => {}, connected: true, disconnect: () => {}, connect: () => {} };
  client.sticky = false;
  client.isSyncingTabs = false;
  client.isMobile = false;
  client.sessions = new Map();
  client._initReady = true;
  client._raf = raf;
  return client;
}

// A controllable requestAnimationFrame implementation: callbacks are
// queued and only run when the test pumps them.
function makeRAF() {
  let nextId = 1;
  const pending = new Map();
  return {
    requestAnimationFrame: (cb) => { const id = nextId++; pending.set(id, cb); return id; },
    cancelAnimationFrame: (id) => { pending.delete(id); },
    pump: () => { const cbs = [...pending.values()]; pending.clear(); cbs.forEach(cb => cb()); },
    pendingCount: () => pending.size,
  };
}

function makeSession() {
  const written = [];
  let pendingWriteCb = null;
  const terminal = {
    rows: 24,
    cols: 80,
    buffer: { active: { length: 24, viewportY: 0 } },
    options: { scrollback: 1000 },
    reset: () => {},
    // The real xterm write() completes asynchronously; keep the
    // completion callback pending so tests can control the timing.
    write: (data, cb) => { written.push(data); if (cb) pendingWriteCb = cb; },
    completePendingWrite: () => { const cb = pendingWriteCb; pendingWriteCb = null; if (cb) cb(); },
    refresh: () => {},
    scrollToBottom: () => {},
    resize: () => {},
    focus: () => {},
    _core: {
      _charSizeService: { measure: () => {} },
      _renderService: { handleResize: () => {}, dimensions: { css: { cell: { width: 8, height: 20 } } } },
      coreMouseService: { activeProtocol: 'NONE' }
    }
  };
  const session = {
    id: 'ssh-test',
    terminal,
    written,
    connected: true,
    isController: true,
    syncing: false,
    writeChunks: [],
    syncBuffer: [],
    webglAddon: null,
  };
  return { session, written, terminal };
}

describe('Screen-sync live-data buffering (stale black-line regression)', () => {
  let Cls;

  beforeAll(() => {
    Cls = loadClientClass();
  });

  test('onSSHData buffers live frames while syncing instead of dropping them', () => {
    const raf = makeRAF();
    const client = makeClient(Cls, raf);
    client.requestAnimationFrame = raf.requestAnimationFrame;
    client.cancelAnimationFrame = raf.cancelAnimationFrame;
    const { session, written } = makeSession();
    client.sessions.set('ssh-test', session);

    session.syncing = true;
    client.onSSHData({ sessionId: 'ssh-test', data: 'live-frame-1' });
    client.onSSHData({ sessionId: 'ssh-test', data: 'live-frame-2' });

    // Nothing written to the terminal during the sync window, and —
    // crucially — nothing DROPPED either.
    expect(written).toEqual([]);
    expect(session.syncBuffer).toEqual(['live-frame-1', 'live-frame-2']);
  });

  test('ssh-screen-sync discards stale chunks, then replays buffered live data after the state write', () => {
    const raf = makeRAF();
    const client = makeClient(Cls, raf);
    const socketHandlers = new Map();
    client.socket.on = (event, handler) => socketHandlers.set(event, handler);
    client.socket.connected = true;
    client.setupSocketListeners();
    client.requestAnimationFrame = raf.requestAnimationFrame;
    client.cancelAnimationFrame = raf.cancelAnimationFrame;
    const { session, written, terminal } = makeSession();
    client.sessions.set('ssh-test', session);

    // Pre-sync: a pending un-flushed chunk (contained in the serialized
    // state the server is about to send) plus a scheduled RAF.
    session.writeChunks = ['stale-pre-sync-chunk'];
    session.writeRAF = raf.requestAnimationFrame(() => {});

    // Kick off the sync (mirrors the server's ssh-screen-sync event).
    // The state write is "in flight" — our stub keeps its completion
    // callback pending, exactly like the real async xterm write().
    socketHandlers.get('ssh-screen-sync')({
      sessionId: 'ssh-test',
      state: 'SERIALIZED-STATE',
      partial: true
    });

    // Sync in progress: syncing flag set, stale chunk discarded, RAF canceled.
    expect(session.syncing).toBe(true);
    expect(session.writeChunks).toEqual([]);
    expect(raf.pendingCount()).toBe(0);
    expect(written).toEqual(['SERIALIZED-STATE']);

    // Live data arrives while the state write is still in flight.
    client.onSSHData({ sessionId: 'ssh-test', data: 'live-continuation' });
    expect(session.syncBuffer).toEqual(['live-continuation']);
    expect(written).toEqual(['SERIALIZED-STATE']); // not interleaved yet

    // The state write completes — the live continuation is replayed
    // right after the serialized state, in stream order.
    terminal.completePendingWrite();
    expect(session.syncing).toBe(false);
    expect(session.syncBuffer).toEqual([]);
    expect(session.writeChunks).toEqual(['live-continuation']);
    expect(raf.pendingCount()).toBe(1);

    // Pump the frame: the live data is appended AFTER the state.
    raf.pump();
    expect(written).toEqual(['SERIALIZED-STATE', 'live-continuation']);
  });

  test('_flushWriteChunks defers while syncing (no interleaving into the fresh state)', () => {
    const raf = makeRAF();
    const client = makeClient(Cls, raf);
    client.requestAnimationFrame = raf.requestAnimationFrame;
    client.cancelAnimationFrame = raf.cancelAnimationFrame;
    const { session, written } = makeSession();
    client.sessions.set('ssh-test', session);

    session.writeChunks = ['chunk-1'];
    session.syncing = true;
    session.writeRAF = raf.requestAnimationFrame(() => client._flushWriteChunks('ssh-test'));

    raf.pump();
    // Not written, not dropped — re-scheduled for after the sync.
    expect(written).toEqual([]);
    expect(session.writeChunks).toEqual(['chunk-1']);
    expect(raf.pendingCount()).toBe(1);

    // Sync completes → pump again → flushed.
    session.syncing = false;
    raf.pump();
    expect(written).toEqual(['chunk-1']);
  });

  test('ssh-joined with noTerminalState drains buffered live data (stale-row regression)', () => {
    const raf = makeRAF();
    const client = makeClient(Cls, raf);
    const socketHandlers = new Map();
    client.socket.on = (event, handler) => socketHandlers.set(event, handler);
    client.socket.connected = true;
    client.setupSocketListeners();
    const { session, written } = makeSession();
    session.syncing = true; // rejoin path set this before emitting ssh-join
    session.syncTimeout = setTimeout(() => {}, 99999);
    client.sessions.set('ssh-test', session);

    // Live output arrives while waiting for the join round-trip.
    client.onSSHData({ sessionId: 'ssh-test', data: 'live-frame' });
    expect(session.syncBuffer).toEqual(['live-frame']);

    // Server replies: fresh session, no serialized state to apply.
    socketHandlers.get('ssh-joined')({ sessionId: 'ssh-test', noTerminalState: true, isController: true });

    // The sync window closed — buffered data must move to the write path
    // (previously it stayed stuck in syncBuffer forever: the client never
    // saw that output and line-diff TUI rows went permanently stale).
    expect(session.syncing).toBe(false);
    expect(session.syncBuffer).toEqual([]);
    expect(session.writeChunks).toEqual(['live-frame']);
    expect(raf.pendingCount()).toBe(1);

    raf.pump();
    expect(written).toEqual(['live-frame']);
  });

  test('data arriving before the terminal exists is buffered, not dropped', () => {
    const raf = makeRAF();
    const client = makeClient(Cls, raf);
    client.requestAnimationFrame = raf.requestAnimationFrame;
    client.cancelAnimationFrame = raf.cancelAnimationFrame;
    const { session, written, terminal } = makeSession();
    session.terminal = null; // initTerminal hasn't finished yet
    client.sessions.set('ssh-test', session);

    client.onSSHData({ sessionId: 'ssh-test', data: 'first-screenful' });
    expect(session.writeChunks).toEqual(['first-screenful']);

    // Terminal materialises; the scheduled flush retries and writes it.
    session.terminal = terminal;
    raf.pump(); // flush → terminal-null branch → 50ms retry timer
    jest.advanceTimersByTime(0);
    raf.pump();
    expect(written).toEqual(['first-screenful']);
  });
});

describe('Settle refresh max-wait (continuous flood regression)', () => {
  let Cls;

  beforeAll(() => {
    Cls = loadClientClass();
  });

  test('writes keep postponing the 350ms settle, but the 2s max-wait still forces a full recompute', () => {
    jest.useFakeTimers();
    try {
      const raf = makeRAF();
      const client = makeClient(Cls, raf);
      client.requestAnimationFrame = raf.requestAnimationFrame;
      client.cancelAnimationFrame = raf.cancelAnimationFrame;
      const { session, terminal } = makeSession();
      client.sessions.set('ssh-test', session);

      const recomputes = [];
      client._repaintTerminal = (s) => { recomputes.push(s); };

      // Simulate a continuous flood: a write every 100ms for 3 seconds.
      for (let i = 0; i < 30; i++) {
        client._scheduleSettleRefresh(session);
        jest.advanceTimersByTime(100);
      }

      // The trailing 350ms settle never fired (flood never paused)...
      // but the 2s max-wait must have forced recomputes meanwhile.
      expect(recomputes.length).toBeGreaterThanOrEqual(1);

      // And once the flood stops, the trailing refresh fires at 350ms.
      jest.advanceTimersByTime(400);
      // No crash, timers cleaned up.
      expect(session.settleRefreshMaxTimer).toBeNull();
      expect(session.settleRefreshTimer).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('the 2s max-wait recompute never fires while a screen sync is in flight', () => {
    jest.useFakeTimers();
    try {
      const raf = makeRAF();
      const client = makeClient(Cls, raf);
      client.requestAnimationFrame = raf.requestAnimationFrame;
      client.cancelAnimationFrame = raf.cancelAnimationFrame;
      const { session } = makeSession();
      client.sessions.set('ssh-test', session);

      const recomputes = [];
      client._repaintTerminal = (s) => { recomputes.push(s); };

      // Continuous flood...
      client._scheduleSettleRefresh(session);
      // ...and a screen sync starts (state being written, syncing=true).
      session.syncing = true;
      jest.advanceTimersByTime(2500);

      // The max-wait timer fired but must NOT have recomputed mid-sync
      // (repaint/atlas rebuild during the half-applied state garbles
      // the screen — the "characters go crazy" symptom).
      expect(recomputes.length).toBe(0);

      // Sync completes; the flood continues — the next max-wait runs.
      session.syncing = false;
      client._scheduleSettleRefresh(session);
      jest.advanceTimersByTime(2500);
      expect(recomputes.length).toBeGreaterThanOrEqual(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
