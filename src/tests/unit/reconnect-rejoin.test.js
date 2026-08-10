/**
 * Regression tests for Bug 2: "can't type after a stale connection until
 * the page is reloaded".
 *
 * Root cause: a Socket.IO reconnect gives the client a NEW socket.id.
 * Server-side, the old socket was removed from every `session-<id>` room
 * and its controller slot reassigned/cleared — but the client never
 * re-emitted ssh-join for tabs it already had (syncTabsFromServer skips
 * existing sessions). The new socket was therefore unknown to the session:
 * input was silently dropped by the server's controller check and the
 * client's controller state went stale. Reloading "fixed" it because the
 * restore path emits ssh-join.
 *
 * Additionally, the ssh-joined handler's takeControlDefault branch
 * referenced an undeclared `sessionId` variable (ReferenceError), so
 * automatic take-control after joining an existing session silently never
 * worked.
 *
 * Fixes under test:
 *  1. rejoinActiveSessions() re-emits ssh-join/sftp-join for live sessions
 *     after a reconnect, flags them as restoring/syncing, and records
 *     whether we held control before the drop.
 *  2. The ssh-joined handler re-takes control (guarded by the usual
 *     no-controller / only-client checks) when we held it before the
 *     reconnect — and uses data.sessionId (ReferenceError fix).
 */

const path = require('path');
const fs = require('fs');

function loadApp() {
  const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'app.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const mockWindow = { innerWidth: 1280, addEventListener: () => {}, removeEventListener: () => {}, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }), matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) };
  const mockDocument = { addEventListener: () => {}, removeEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } }, documentElement: { setAttribute: () => {}, getAttribute: () => null, classList: { add: () => {}, remove: () => {} } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, style: {} }), fonts: { ready: Promise.resolve() } };
  const scope = {
    window: mockWindow, document: mockDocument,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { clipboard: { writeText: () => Promise.resolve(true) }, userAgent: 'node' },
    io: function () { return { on: () => {}, emit: () => {}, connected: true, disconnect: () => {}, connect: () => {} }; },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    // Late-bind timers to the CURRENT globals so jest.useFakeTimers()
    // (which swaps global.setTimeout) controls timers registered by the
    // sandboxed app code.
    setTimeout: (...args) => global.setTimeout(...args),
    clearTimeout: (...args) => global.clearTimeout(...args),
    setInterval: (...args) => global.setInterval(...args),
    clearInterval: (...args) => global.clearInterval(...args),
    console,
    Terminal: undefined, FitAddon: undefined, WebLinksAddon: undefined, SearchAddon: undefined, SerializeAddon: undefined, WebglAddon: undefined, Unicode11Addon: undefined, ImageAddon: undefined,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextDecoder, Worker: function () {}, visualViewport: null, performance: { now: () => Date.now() }
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(scope), source + '\nreturn SSHIFTClient;');
  const Cls = factory(...Object.values(scope));
  Cls.prototype.init = function () { /* test stub */ };
  return Cls;
}

describe('Bug 2: sessions are re-joined after a socket reconnect', () => {
  let client;
  let socketHandlers;
  let emitted;

  beforeEach(() => {
    const Cls = loadApp();
    client = new Cls();
    socketHandlers = new Map();
    emitted = [];
    client.socket = {
      id: 'sock-new',
      connected: true,
      on: (event, handler) => socketHandlers.set(event, handler),
      emit: (event, data) => emitted.push({ event, data }),
      disconnect: () => {},
      connect: () => {}
    };
    client.sticky = true;
    client.isSyncingTabs = false;
    client.isRestoring = false;
    client.isMobile = false;
    client.takeControlDefault = false;
    client.setupSocketListeners();
  });

  function addSshSession(id, overrides = {}) {
    client.sessions.set(id, {
      id,
      type: 'ssh',
      connected: true,
      connecting: false,
      isController: false,
      isRestoring: false,
      syncing: false,
      syncTimeout: null,
      _syncRetries: 0,
      terminal: null,
      writeChunks: [],
      writeRAF: null,
      pendingOsc52: null,
      connectionData: { host: 'example.com', username: 'user' },
      ...overrides
    });
    return client.sessions.get(id);
  }

  test('rejoinActiveSessions re-emits ssh-join for connected sessions', () => {
    const s1 = addSshSession('ssh-1', { isController: true });
    const s2 = addSshSession('ssh-2', { isController: false });
    addSshSession('ssh-connecting', { connected: false, connecting: true });

    client.rejoinActiveSessions();

    const joins = emitted.filter(e => e.event === 'ssh-join').map(e => e.data.sessionId);
    expect(joins).toEqual(expect.arrayContaining(['ssh-1', 'ssh-2']));
    // Sessions still connecting complete via their own ssh-connect flow.
    expect(joins).not.toContain('ssh-connecting');

    // Rejoined sessions are flagged for the restore/sync path.
    expect(s1.isRestoring).toBe(true);
    expect(s1.syncing).toBe(true);
    expect(s1._retakeControlOnRejoin).toBe(true);   // held control before drop
    expect(s2._retakeControlOnRejoin).toBe(false);  // was a viewer

    // Clean up watchdog timers.
    [s1, s2].forEach(s => { if (s.syncTimeout) clearTimeout(s.syncTimeout); });
  });

  test('rejoinActiveSessions re-emits sftp-join for live SFTP sessions', () => {
    client.sftpSessions.set('sftp-1', {
      id: 'sftp-1', type: 'sftp', connecting: false, isRestoring: false,
      currentPath: '/home', connectionData: {}
    });
    client.sftpSessions.set('sftp-connecting', {
      id: 'sftp-connecting', type: 'sftp', connecting: true, isRestoring: false,
      currentPath: '/', connectionData: {}
    });

    client.rejoinActiveSessions();

    const joins = emitted.filter(e => e.event === 'sftp-join').map(e => e.data.sessionId);
    expect(joins).toEqual(['sftp-1']);
  });

  test('reconnect (connect after disconnect) triggers the rejoin', () => {
    const s1 = addSshSession('ssh-1', { isController: true });
    client._wasDisconnected = true;
    client.isUpdating = false;
    client.showToast = () => {};
    client.loadBookmarks = () => {};

    socketHandlers.get('connect')();

    const joins = emitted.filter(e => e.event === 'ssh-join').map(e => e.data.sessionId);
    expect(joins).toEqual(['ssh-1']);
    if (s1.syncTimeout) clearTimeout(s1.syncTimeout);
  });

  test('first connect (no prior disconnect) does NOT re-join', () => {
    addSshSession('ssh-1');
    client._wasDisconnected = false;
    client.isUpdating = false;
    client.showToast = () => {};
    client.loadBookmarks = () => {};

    socketHandlers.get('connect')();

    expect(emitted.filter(e => e.event === 'ssh-join')).toHaveLength(0);
  });

  test('ssh-joined re-takes control after rejoin when we held it (ReferenceError fix)', () => {
    jest.useFakeTimers();
    try {
      const s1 = addSshSession('ssh-1', { isController: true });
      client.rejoinActiveSessions();
      expect(s1._retakeControlOnRejoin).toBe(true);
      emitted.length = 0;

      // Server response: we are a plain viewer now (old socket's controller
      // slot was cleared), and we're the only client.
      socketHandlers.get('ssh-joined')({
        sessionId: 'ssh-1',
        noTerminalState: true,
        controllerSocket: null,
        isController: false,
        socketCount: 1
      });

      // The take-control request is sent after a 100-300ms anti-war delay.
      jest.advanceTimersByTime(400);

      const takeControl = emitted.filter(e => e.event === 'ssh-take-control');
      expect(takeControl).toHaveLength(1);
      expect(takeControl[0].data.sessionId).toBe('ssh-1');
      // Flag is consumed — later joins don't auto-steal control.
      expect(s1._retakeControlOnRejoin).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('ssh-joined does NOT steal control from another active controller', () => {
    jest.useFakeTimers();
    try {
      const s1 = addSshSession('ssh-1', { isController: true });
      client.rejoinActiveSessions();
      emitted.length = 0;

      // Another client took control while we were away.
      socketHandlers.get('ssh-joined')({
        sessionId: 'ssh-1',
        noTerminalState: true,
        controllerSocket: 'sock-other',
        isController: false,
        socketCount: 2
      });

      jest.advanceTimersByTime(400);

      expect(emitted.filter(e => e.event === 'ssh-take-control')).toHaveLength(0);
      expect(s1.isController).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('takeControlDefault path uses data.sessionId (no ReferenceError)', () => {
    jest.useFakeTimers();
    try {
      client.takeControlDefault = true;
      addSshSession('ssh-1', { isController: false });
      emitted.length = 0;

      socketHandlers.get('ssh-joined')({
        sessionId: 'ssh-1',
        noTerminalState: true,
        controllerSocket: null,
        isController: false,
        socketCount: 1
      });

      // Before the fix this threw "sessionId is not defined" inside the
      // timer callback and never emitted.
      expect(() => jest.advanceTimersByTime(400)).not.toThrow();

      const takeControl = emitted.filter(e => e.event === 'ssh-take-control');
      expect(takeControl).toHaveLength(1);
      expect(takeControl[0].data.sessionId).toBe('ssh-1');
    } finally {
      jest.useRealTimers();
    }
  });
});
