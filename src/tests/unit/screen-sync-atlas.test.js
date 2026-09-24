/**
 * Regression tests for the ssh-screen-sync handler ordering.
 *
 * The serialized screen the server sends is laid out for exactly
 * `cols x rows`. The handler must therefore reset the terminal, resize it
 * to the server's geometry, THEN replay the state, then repaint, and only
 * then let a controller re-fit to its own container. Writing the state
 * first (into whatever size the freshly created terminal happened to have,
 * usually 80x24) wrapped every full-width row, and the alternate buffer is
 * never reflowed by a later resize — every TUI row became a text row
 * followed by an overflow row: the "alternating black line" bug when
 * opening a session in a new window.
 *
 * The repaint is a plain refresh (never a WebGL atlas clear — the atlas is
 * shared between terminals).
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
    setTimeout, clearTimeout, setInterval, clearInterval,
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

describe('Bug 1: screen-sync clears WebGL atlas after resize (no interlace)', () => {
  let client;
  let socketHandlers;
  let callLog;

  beforeEach(() => {
    const Cls = loadApp();
    client = new Cls();
    client.socket = {
      on: (event, handler) => socketHandlers.set(event, handler),
      emit: () => {}, connected: true, disconnect: () => {}, connect: () => {}
    };
    client.sticky = true;
    client.isSyncingTabs = false;
    client.isRestoring = false;
    client.isMobile = false;

    socketHandlers = new Map();
    callLog = [];

    // Stub _repaintTerminal so we can assert on its invocation (a plain
    // full repaint — never an atlas clear, the atlas is shared).
    client._repaintTerminal = (session) => {
      callLog.push({ op: 'repaint', sessionId: session && session.id });
    };
    client._fitTerminal = (session) => {
      callLog.push({ op: 'fit', sessionId: session && session.id });
      return true;
    };

    // Inject a fake terminal whose write() and resize() record their ops.
    const fakeTerminal = {
      id: 'ssh-test-bug1',
      reset: () => callLog.push({ op: 'reset' }),
      write: (data, cb) => {
        callLog.push({ op: 'write', length: data.length });
        // simulate async completion
        setTimeout(() => { if (cb) cb(); }, 0);
      },
      resize: (cols, rows) => callLog.push({ op: 'resize', cols, rows }),
      scrollToBottom: () => callLog.push({ op: 'scrollToBottom' }),
      focus: () => callLog.push({ op: 'focus' }),
      options: {},
      buffer: { active: { length: 100 } },
      rows: 24,
      cols: 80
    };

    client.sessions.set('ssh-bug1', {
      id: 'ssh-bug1',
      syncing: true,
      connected: true,
      isController: true,
      terminal: fakeTerminal,
      fitAddon: { fit: () => {} },
      writeChunks: [],
      writeRAF: null,
      pendingOsc52: null,
      syncTimeout: null,
      _syncRetries: 0,
      isResyncing: false
    });

    // Wire the open-tabs handlers by invoking setupSocketListeners.
    client.setupSocketListeners();
  });

  test('ssh-screen-sync resets → resizes to the server size → writes → repaints → refits controller (in this order)', (done) => {
    // Base64-encode a fake serialized state — the decode path uses atob.
    const fakeState = Buffer.from('hello world\r\n', 'utf-8').toString('base64');

    // Fire the ssh-screen-sync handler.
    socketHandlers.get('ssh-screen-sync')({
      sessionId: 'ssh-bug1',
      state: fakeState,
      cols: 100,
      rows: 30,
      encoded: true,
      partial: false
    });

    // Use setTimeout to let terminal.write()'s fake async cb fire.
    setTimeout(() => {
      const ops = callLog.map(c => c.op);
      const resetIdx = ops.indexOf('reset');
      const resizeIdx = ops.indexOf('resize');
      const writeIdx = ops.indexOf('write');
      const repaintIdx = ops.indexOf('repaint');
      const fitIdx = ops.indexOf('fit');

      expect(resetIdx).not.toBe(-1);
      expect(resizeIdx).not.toBe(-1);
      expect(writeIdx).not.toBe(-1);
      expect(repaintIdx).not.toBe(-1);
      expect(fitIdx).not.toBe(-1);

      // The serialized screen is laid out for the server's cols/rows, so
      // the terminal MUST be at that size BEFORE the state is replayed:
      // writing it into an 80x24 terminal wraps every full-width row and
      // the alternate buffer is never reflowed by a later resize (the
      // "alternating text / black line" bug on a freshly opened window).
      expect(resetIdx).toBeLessThan(resizeIdx);
      expect(resizeIdx).toBeLessThan(writeIdx);
      expect(writeIdx).toBeLessThan(repaintIdx);
      // Only after the server's screen is in place may the controller
      // re-fit to its own container (which pushes a PTY resize if needed).
      expect(repaintIdx).toBeLessThan(fitIdx);
      const resize = callLog.find(c => c.op === 'resize');
      expect(resize).toEqual({ op: 'resize', cols: 100, rows: 30 });
      // The server-driven resize must not echo back as a PTY resize.
      const session = client.sessions.get('ssh-bug1');
      expect(session.remoteCols).toBe(100);
      expect(session.remoteRows).toBe(30);
      expect(session.isResyncing).toBe(false);
      done();
    }, 20);
  });

  test('ssh-screen-sync skips the resize when the terminal already has the server size', (done) => {
    const session = client.sessions.get('ssh-bug1');
    session.terminal.cols = 100;
    session.terminal.rows = 30;
    const fakeState = Buffer.from('x', 'utf-8').toString('base64');
    socketHandlers.get('ssh-screen-sync')({
      sessionId: 'ssh-bug1', state: fakeState, cols: 100, rows: 30, encoded: true, partial: false
    });
    setTimeout(() => {
      expect(callLog.map(c => c.op)).not.toContain('resize');
      expect(callLog.map(c => c.op)).toContain('repaint');
      done();
    }, 20);
  });

  test('observers are not re-fitted after a sync (they mirror the server size)', (done) => {
    const session = client.sessions.get('ssh-bug1');
    session.isController = false;
    const fakeState = Buffer.from('x', 'utf-8').toString('base64');
    socketHandlers.get('ssh-screen-sync')({
      sessionId: 'ssh-bug1', state: fakeState, cols: 120, rows: 40, encoded: true, partial: false
    });
    setTimeout(() => {
      const ops = callLog.map(c => c.op);
      expect(ops).toContain('resize');
      expect(ops).not.toContain('fit');
      done();
    }, 20);
  });

  test('syncing flag clears after sync completion', (done) => {
    const session = client.sessions.get('ssh-bug1');
    const fakeState = Buffer.from('partial state', 'utf-8').toString('base64');
    socketHandlers.get('ssh-screen-sync')({
      sessionId: 'ssh-bug1',
      state: fakeState,
      cols: 80, rows: 24,
      encoded: true,
      partial: false
    });
    setTimeout(() => {
      expect(session.syncing).toBe(false);
      done();
    }, 20);
  });
});