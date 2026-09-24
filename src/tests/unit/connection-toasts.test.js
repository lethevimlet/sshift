/**
 * v1.8.2: connection / control toasts.
 *
 * Reopening the PWA on a phone used to show four toasts: "Connected"
 * (page reload), "Disconnected" + "Reconnected" (the auth-token socket
 * swap in updateSocketAuth) and "You are now in control" (automatic
 * take-control on rejoin). Now: nothing on the initial connect, nothing
 * for deliberate reconnects, "Disconnected" only after a visible outage
 * longer than the grace period, "Reconnected" only after an announced
 * outage, and control toasts only for explicit takes or real hand-overs
 * from another device.
 */

const path = require('path');
const fs = require('fs');

function loadApp(mockDocument) {
  const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'app.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const mockWindow = { innerWidth: 1280, addEventListener: () => {}, removeEventListener: () => {}, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }), matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) };
  const scope = {
    window: mockWindow, document: mockDocument,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { clipboard: { writeText: () => Promise.resolve(true) }, userAgent: 'node' },
    io: function () { return { on: () => {}, emit: () => {}, connected: true, disconnect: () => {}, connect: () => {} }; },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    setTimeout: (...args) => global.setTimeout(...args),
    clearTimeout: (...args) => global.clearTimeout(...args),
    setInterval: (...args) => global.setInterval(...args),
    clearInterval: (...args) => global.clearInterval(...args),
    console,
    Terminal: undefined, FitAddon: undefined, WebLinksAddon: undefined, SearchAddon: undefined, SerializeAddon: undefined, WebglAddon: undefined, Unicode11Addon: undefined, ImageAddon: undefined,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextDecoder, Worker: function () {}, visualViewport: null, performance: { now: () => Date.now() },
    fetch: () => Promise.reject(new Error('no network in tests'))
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(scope), source + '\nreturn SSHIFTClient;');
  const Cls = factory(...Object.values(scope));
  Cls.prototype.init = function () { /* test stub */ };
  return Cls;
}

describe('connection toasts', () => {
  let client;
  let handlers;
  let toasts;
  let mockDocument;

  beforeEach(() => {
    jest.useFakeTimers();
    mockDocument = { hidden: false, addEventListener: () => {}, removeEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } }, documentElement: { setAttribute: () => {}, getAttribute: () => null, classList: { add: () => {}, remove: () => {} } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, style: {} }), fonts: { ready: Promise.resolve() } };
    const Cls = loadApp(mockDocument);
    client = new Cls();
    handlers = new Map();
    toasts = [];
    client.socket = {
      id: 'sock-1', connected: true,
      on: (event, handler) => handlers.set(event, handler),
      emit: () => {},
      disconnect() { this.connected = false; return this; },
      connect() { this.connected = true; return this; }
    };
    client.showToast = (message, type) => toasts.push({ message, type });
    client.rejoinActiveSessions = jest.fn();
    client.loadBookmarks = jest.fn();
    client._checkServerVersion = jest.fn();
    client.updateControlOverlay = jest.fn();
    client.setupSocketListeners();
  });

  afterEach(() => { jest.useRealTimers(); });

  const connect = () => handlers.get('connect')();
  const disconnect = (reason = 'transport close') => { client.socket.connected = false; handlers.get('disconnect')(reason); };

  test('the initial connect is silent', () => {
    connect();
    expect(toasts).toEqual([]);
    expect(client.loadBookmarks).toHaveBeenCalled();
    expect(client._checkServerVersion).toHaveBeenCalled();
  });

  test('a short blip (disconnect + reconnect inside the grace period) shows nothing', () => {
    connect();
    disconnect();
    jest.advanceTimersByTime(1000);
    client.socket.connected = true;
    connect();
    jest.advanceTimersByTime(10000);
    expect(toasts).toEqual([]);
    expect(client.rejoinActiveSessions).toHaveBeenCalledTimes(1);
  });

  test('a lasting outage is announced once, and its recovery once', () => {
    connect();
    disconnect();
    jest.advanceTimersByTime(client.DISCONNECT_TOAST_GRACE_MS + 10);
    expect(toasts.map(t => t.type)).toEqual(['warning']);
    client.socket.connected = true;
    connect();
    expect(toasts.map(t => t.message)).toEqual([
      'Disconnected from server — will reconnect automatically',
      'Reconnected to server'
    ]);
    // a later clean connect does not repeat "Reconnected"
    connect();
    expect(toasts).toHaveLength(2);
  });

  test('the auth-token reconnect (updateSocketAuth) is completely silent', () => {
    connect();
    client.authToken = 'tok';
    client.updateSocketAuth();
    disconnect('io client disconnect');
    jest.advanceTimersByTime(10000);
    client.socket.connected = true;
    connect();
    jest.advanceTimersByTime(10000);
    expect(toasts).toEqual([]);
    expect(client._silentReconnect).toBe(false);
  });

  test('an outage while the page is hidden is not announced', () => {
    connect();
    mockDocument.hidden = true;
    disconnect();
    jest.advanceTimersByTime(10000);
    expect(toasts).toEqual([]);
    client.socket.connected = true;
    connect();
    expect(toasts).toEqual([]);
  });

  test('nothing is announced during a self-update', () => {
    connect();
    client.isUpdating = true;
    disconnect();
    jest.advanceTimersByTime(10000);
    client.socket.connected = true;
    connect();
    expect(toasts).toEqual([]);
  });
});

describe('control toasts', () => {
  let client;
  let handlers;
  let toasts;

  beforeEach(() => {
    jest.useFakeTimers();   // rejoinActiveSessions arms sync watchdogs
    const mockDocument = { hidden: false, addEventListener: () => {}, removeEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } }, documentElement: { setAttribute: () => {}, getAttribute: () => null, classList: { add: () => {}, remove: () => {} } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, style: {} }), fonts: { ready: Promise.resolve() } };
    const Cls = loadApp(mockDocument);
    client = new Cls();
    handlers = new Map();
    toasts = [];
    client.socket = { id: 'me', connected: true, on: (e, h) => handlers.set(e, h), emit: jest.fn(), disconnect() { return this; }, connect() { return this; } };
    client.showToast = (message, type) => toasts.push({ message, type });
    client.updateControlOverlay = jest.fn();
    client.setupSocketListeners();
    client.sessions.set('s1', { id: 's1', type: 'ssh', connected: true, isController: false, terminal: null, fitAddon: null });
  });

  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  test('automatic take-control (join / rejoin) is silent, an explicit take is confirmed', () => {
    client.requestTakeControl('s1', { announce: false });
    handlers.get('ssh-control-acquired')({ sessionId: 's1' });
    expect(toasts).toEqual([]);

    client.sessions.get('s1').isController = false;
    client.requestTakeControl('s1', { announce: true });
    handlers.get('ssh-control-acquired')({ sessionId: 's1' });
    expect(toasts.map(t => t.message)).toEqual(['You are now in control']);
    expect(client.socket.emit).toHaveBeenCalledWith('ssh-take-control', { sessionId: 's1' });
  });

  test('requestTakeControl without options stays silent', () => {
    client.requestTakeControl('s1');
    handlers.get('ssh-control-acquired')({ sessionId: 's1' });
    expect(toasts).toEqual([]);
  });

  test('getting our own control back after a reconnect is silent; a real hand-over is announced', () => {
    const s = client.sessions.get('s1');
    s.isController = true;
    client.rejoinActiveSessions();                 // marks _heldControlBeforeDrop
    s.isController = false;                        // server reassigned while we were away
    handlers.get('ssh-control-taken')({ sessionId: 's1', controllerSocket: 'me' });
    expect(toasts).toEqual([]);
    expect(s.isController).toBe(true);

    // another client held it and left
    s.isController = false;
    handlers.get('ssh-control-taken')({ sessionId: 's1', controllerSocket: 'me' });
    expect(toasts.map(t => t.message)).toEqual(['You are now in control (previous controller left)']);
  });

  test('losing control to another device is announced only when we actually held it', () => {
    const s = client.sessions.get('s1');
    s.isController = false;
    handlers.get('ssh-control-taken')({ sessionId: 's1', controllerSocket: 'other' });
    expect(toasts).toEqual([]);
    s.isController = true;
    handlers.get('ssh-control-taken')({ sessionId: 's1', controllerSocket: 'other' });
    expect(toasts.map(t => t.message)).toEqual(['Another device took control']);
  });
});
