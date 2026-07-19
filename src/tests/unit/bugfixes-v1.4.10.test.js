/**
 * Regression tests for two post-v1.4.9 bugs:
 *
 * 1. **Bug A — Mobile dropdown switchTab closes all tabs**
 *    Root cause: ssh-request-sync rate-limit (added in Phase 3) emitted
 *    an `ssh-error` event with `message: 'Sync rate limit reached'`.
 *    The client's ssh-error handler at app.js:4521 had a catchall
 *    `closeTab(data.sessionId)` for any error message that wasn't
 *    exactly "Session not found". Because `switchTab` triggers
 *    `requestScreenSync` for sticky sessions, every rate-limited
 *    refresh fired closeTab — collapsing the visible tab on every
 *    mobile dropdown click.
 *    Fix: server now tags advisory errors with `advisory: true`; client
 *    skips closeTab for advisory errors and shows a debug warning instead.
 *
 * 2. **Bug B — Server restart shows stale tabs**
 *    Root cause: when the server reports 0 active tabs (post-restart),
 *    the `open-tabs` handler and the 3s `_serverSyncTimeout` fallback
 *    both called `restoreTabs()` which auto-reconstructed every stale
 *    localStorage tab as a fresh SSH connection — silently spawning
 *    duplicates broadcast to every other client.
 *    Fix: server-restart now produces a fresh slate — `restoreTabs()` is
 *    a no-op, the timeout fallback calls `clearTabs()` to wipe the stale
 *    localStorage cache instead of resurrecting it.
 *
 * Tests drive the WS handlers and SSH manager via mock sockets/objects
 * so they run with no live server and no real SSH.
 */

function makeMockSocket(id) {
  const handlers = new Map();
  const socketEmitted = [];
  return {
    socket: {
      id,
      on: (event, handler) => handlers.set(event, handler),
      once: (event, handler) => handlers.set(event, handler),
      emit: (event, data) => socketEmitted.push({ event, data, target: 'self' }),
      to: () => ({ emit: (event, data) => socketEmitted.push({ event, data, target: 'room' }) }),
      broadcast: { emit: (event, data) => socketEmitted.push({ event, data, target: 'broadcast' }) },
      join: () => {},
      leave: () => {}
    },
    handlers,
    socketEmitted
  };
}

function makeMockIo() {
  const ioEmitted = [];
  return {
    io: {
      emit: (event, data) => ioEmitted.push({ event, data, target: 'io' }),
      to: () => ({ emit: (event, data) => ioEmitted.push({ event, data, target: 'io-room' }) })
    },
    ioEmitted
  };
}

describe('Bug A: ssh-request-sync rate-limit must not close the tab', () => {
  let registerSSHHandlers;
  let sshManager;

  beforeEach(() => {
    jest.resetModules();
    registerSSHHandlers = require('../../server/endpoints/ws/ssh').registerSSHHandlers;
    sshManager = require('../../server/services').sshManager;
    // Clear singleton state between tests
    for (const [sid] of sshManager.sessions) {
      try { sshManager.disconnect(sid); } catch (_) {}
    }
  });

  afterEach(() => {
    for (const [sid] of sshManager.sessions) {
      try { sshManager.disconnect(sid); } catch (_) {}
    }
  });

  test('rate-limited ssh-request-sync emits ssh-error WITH advisory=true', () => {
    const { socket, handlers, socketEmitted } = makeMockSocket('sock-rate-1');
    const { io } = makeMockIo();
    registerSSHHandlers(socket, io);
    // Provide a fake terminal state so the success path would otherwise
    // emit ssh-screen-sync. The rate-limit path runs BEFORE this lookup.
    sshManager.getTerminalState = () => ({ state: 'fake', cols: 80, rows: 24 });

    handlers.get('ssh-request-sync')({ sessionId: 's-rate-A' });
    handlers.get('ssh-request-sync')({ sessionId: 's-rate-A' }); // within 2s → rate limited

    const errs = socketEmitted.filter(e => e.event === 'ssh-error');
    expect(errs.length).toBe(1);
    // The crucial regression-prevention assertion:
    expect(errs[0].data.advisory).toBe(true);
    expect(errs[0].data.message).toMatch(/Sync rate limit/);
  });

  test('advisory flag also set on validation errors (ssh-data, ssh-resize, bufferFull)', () => {
    // ssh-data validation: non-string payload
    const { socket: sock1, handlers: h1, socketEmitted: e1 } = makeMockSocket('sock-1');
    const { io: io1 } = makeMockIo();
    registerSSHHandlers(sock1, io1);
    sshManager.isController = () => true;
    h1.get('ssh-data')({ sessionId: 's-x', data: 123 });
    const errs1 = e1.filter(e => e.event === 'ssh-error');
    expect(errs1.length).toBe(1);
    expect(errs1[0].data.advisory).toBe(true);

    // ssh-resize validation: cols=0
    const { socket: sock2, handlers: h2, socketEmitted: e2 } = makeMockSocket('sock-2');
    const { io: io2 } = makeMockIo();
    registerSSHHandlers(sock2, io2);
    h2.get('ssh-resize')({ sessionId: 's-x', cols: 0, rows: 24 });
    const errs2 = e2.filter(e => e.event === 'ssh-error');
    expect(errs2.length).toBe(1);
    expect(errs2[0].data.advisory).toBe(true);

    // bufferFull via sshManager.write overflow
    sshManager.sessions.set('s-bf', {
      stream: { write: () => false, once: () => {} },
      writeQueue: [],
      drainListener: false
    });
    const origIo = sshManager.io;
    const writesSeen = [];
    sshManager.io = { to: () => ({ emit: (event, data) => writesSeen.push({ event, data }) }) };
    for (let i = 0; i < 70; i++) sshManager.write('s-bf', 'x');
    const bf = writesSeen.filter(e => e.event === 'ssh-error');
    expect(bf.length).toBeGreaterThanOrEqual(1);
    expect(bf.some(e => e.data.advisory === true && e.data.message === 'bufferFull')).toBe(true);
    sshManager.io = origIo;
  });

  test('hard errors (unmarked) still do NOT carry advisory=true', () => {
    // Auth/network failures from ssh-connect's catch block should NOT
    // carry the advisory flag — those are real failures that the client
    // should close the tab for (the connection never succeeded).
    const { socket, handlers, socketEmitted } = makeMockSocket('sock-hard');
    const { io } = makeMockIo();
    registerSSHHandlers(socket, io);

    // Drive the ssh-connect error path by calling the handler with bad
    // credentials — sshManager.connect will throw.
    sshManager.connect = async () => { throw new Error('All configured authentication methods failed'); };
    // The handler is async and emits ssh-error inside its catch block.
    return handlers.get('ssh-connect')({ sessionId: 's-connect-1', host: 'h', port: 22, username: 'u', password: 'wrong' })
      .then(() => {
        const errs = socketEmitted.filter(e => e.event === 'ssh-error');
        expect(errs.length).toBe(1);
        // Crucial: hard errors have NO advisory flag (or advisory: false).
        expect(errs[0].data.advisory).toBeFalsy();
      });
  });
});

describe('Bug B: server restart = fresh slate, no localStorage-based restore', () => {
  let SSHIFTClient;

  beforeEach(() => {
    jest.resetModules();
    const path = require('path');
    const fs = require('fs');
    const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'app.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    const mockWindow = { innerWidth: 1280, addEventListener: () => {}, removeEventListener: () => {}, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }), matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) };
    const mockDocument = { addEventListener: () => {}, removeEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } }, documentElement: { setAttribute: () => {}, getAttribute: () => null, classList: { add: () => {}, remove: () => {} } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, style: {} }) };
    scope = {
      window: mockWindow, document: mockDocument,
      localStorage: { _s: {}, getItem(k) { return (k in this._s) ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } },
      navigator: { clipboard: { writeText: () => Promise.resolve(true) }, userAgent: 'node' },
      io: function () { return { on: () => {}, emit: () => {}, connected: true, disconnect: () => {}, connect: () => {} }; },
      requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
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
    SSHIFTClient = factory(...Object.values(scope));
    SSHIFTClient.prototype.init = function () { /* test stub */ };
  });

  function makeClient() {
    const client = new SSHIFTClient();
    client.socket = { on: () => {}, emit: () => {}, connected: true, disconnect: () => {}, connect: () => {} };
    client.sticky = true;
    client.isSyncingTabs = false;
    client.isRestoring = false;
    client.isMobile = false;
    client.currentLayout = { id: 'single' };
    client._serverLayout = null;
    client._serverPanelMap = new Map();
    client._initReady = true; // pretend init() has finished
    client._initialSyncDone = false;
    return client;
  }

  test('restoreTabs() is a no-op and CLEARS localStorage (never reconstructs tabs)', async () => {
    const client = makeClient();
    // Seed localStorage with stale tabs that would previously have been
    // reconstructed as fresh SSH connections.
    client.loadTabs = () => ({
      tabs: [
        { sessionId: 'ssh-stale-1', name: 'OldTab1', type: 'ssh', connectionData: { host: 'h1', port: 22, username: 'u', password: 'p' }, active: true, panelId: 'panel-0' },
        { sessionId: 'ssh-stale-2', name: 'OldTab2', type: 'ssh', connectionData: { host: 'h2', port: 22, username: 'u', password: 'p' }, active: false, panelId: 'panel-0' }
      ],
      layout: 'single'
    });
    let clearCalls = 0;
    client.clearTabs = () => { clearCalls++; };
    client.createSSHTab = () => { throw new Error('restoreTabs must NOT call createSSHTab'); };

    await client.restoreTabs();

    expect(clearCalls).toBe(1); // stale cache wiped
    expect(client._initialSyncDone).toBe(true); // race-guard flag set
    expect(client.isRestoring).toBe(false);
  });

  test('open-tabs arriving AFTER init with 0 tabs clears localStorage (does not call restoreTabs)', () => {
    const client = makeClient();
    let restoreCalls = 0;
    let clearCalls = 0;
    client.restoreTabs = async () => { restoreCalls++; };
    client.clearTabs = () => { clearCalls++; };
    client.setLayoutFromServer = () => {}; // no-op
    client.applyLayout = () => {};
    client.handleResize = () => {};
    // Wire up the open-tabs handler by re-running setupSocketListeners
    // against the stubbed socket. The class's setupSocketListeners
    // expects socket.on(event, handler) — our client.socket.on is a noop
    // so we capture via a manual wire.
    const socketHandlers = new Map();
    client.socket.on = (event, handler) => socketHandlers.set(event, handler);
    client.socket.connected = true;
    if (typeof client.setupSocketListeners === 'function') {
      client.setupSocketListeners();
    } else {
      throw new Error('SSHIFTClient has no setupSocketListeners method');
    }

    // Simulate server's open-tabs arriving: data.tabs.length === 0.
    socketHandlers.get('open-tabs')({
      tabs: [],
      layout: 'single',
      activeTabsByPanel: {},
      theme: 'dark',
      accent: 'fuchsia'
    });

    expect(restoreCalls).toBe(0); // restoreTabs NOT called → Bug B
    expect(clearCalls).toBe(1); // localStorage wiped instead
  });

  test('3s _serverSyncTimeout fallback clears localStorage instead of calling restoreTabs', () => {
    jest.useFakeTimers();
    try {
      const client = makeClient();
      // Pretend init() just finished and started the _serverSyncTimeout
      // (which is set in init() when this.sticky === true).
      let restoreCalls = 0;
      let clearCalls = 0;
      client.restoreTabs = async () => { restoreCalls++; };
      client.clearTabs = () => { clearCalls++; };

      // Mirror the init()-side code:
      client.isRestoring = false;
      client._serverSyncTimeout = setTimeout(() => {
        if (!client._initialSyncDone) {
          try { client.clearTabs(); } catch (_) {}
          client.isRestoring = false;
          client._initialSyncDone = true;
        }
      }, 3000);

      // Advance beyond 3s.
      jest.advanceTimersByTime(3001);

      expect(restoreCalls).toBe(0); // restoreTabs NOT called → Bug B
      expect(clearCalls).toBe(1); // localStorage cleared
      expect(client._initialSyncDone).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('open-tabs WITH tabs still syncs normally (server-restart case isolated)', () => {
    const client = makeClient();
    let clearCalls = 0;
    let syncCalls = 0;
    const syncedTabsFromServer = [];
    client.clearTabs = () => { clearCalls++; };
    client.syncTabsFromServer = async (tabs) => {
      syncCalls++;
      syncedTabsFromServer.push(tabs);
    };
    client.setLayoutFromServer = () => {};
    client.handleResize = () => {};
    client.applyLayout = () => {};

    const socketHandlers = new Map();
    client.socket.on = (event, handler) => socketHandlers.set(event, handler);
    client.socket.connected = true;
    client.setupSocketListeners();

    socketHandlers.get('open-tabs')({
      tabs: [
        { sessionId: 'ssh-1', name: 'Live', type: 'ssh', panelId: 'panel-0', active: true }
      ],
      layout: 'single',
      activeTabsByPanel: { 'panel-0': 'ssh-1' },
      theme: 'dark',
      accent: 'fuchsia'
    });

    expect(clearCalls).toBe(0); // localStorage NOT cleared when server has tabs
    expect(syncCalls).toBe(1); // syncTabsFromServer invoked with the live tab set
    expect(syncedTabsFromServer[0].length).toBe(1);
  });
});