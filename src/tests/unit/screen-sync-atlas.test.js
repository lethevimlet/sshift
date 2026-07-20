/**
 * Regression test for Bug 1 (interlaced lines after Take Control on a
 * refreshed browser tab).
 *
 * Root cause: when an ssh-screen-sync arrived, the handler at app.js:4082
 * wrote the serialized state, then called `terminal.resize(cols, rows)`
 * but did NOT clear the WebGL glyph atlas. The atlas held glyphs
 * rasterised at the PRE-sync cell size while the renderer now painted
 * them at the POST-sync cell size — every other row landed outside the
 * visible grid, producing the "interlaced / alternating black bands"
 * appearance. Resizing the browser window fixed it because that path
 * runs `_fitTerminal()` which calls `_resetWebGLAtlas()`.
 *
 * Fix: the screen-sync completion callback now invokes
 * `this._resetWebGLAtlas(session)` AFTER the resize so glyphs are
 * re-rasterised at the new cell dimensions.
 *
 * This test exercises the production `on('ssh-screen-sync')` handler via
 * a stubbed socket and a fake xterm Terminal instance. The fake Terminal
 * records every call so we can assert that `_resetWebGLAtlas` runs after
 * `terminal.resize`.
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

    // Stub _resetWebGLAtlas so we can assert on its invocation.
    client._resetWebGLAtlas = (session) => {
      callLog.push({ op: 'resetWebGLAtlas', sessionId: session && session.id });
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
      rows: 24
    };

    client.sessions.set('ssh-bug1', {
      id: 'ssh-bug1',
      syncing: true,
      connected: true,
      isController: true,
      terminal: fakeTerminal,
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

  test('ssh-screen-sync resets → writes → resizes → clears WebGL atlas (in this order)', (done) => {
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
      const writeIdx = ops.indexOf('write');
      const resizeIdx = ops.indexOf('resize');
      const atlasIdx = ops.indexOf('resetWebGLAtlas');

      // The four operations must ALL have happened.
      expect(resetIdx).not.toBe(-1);
      expect(writeIdx).not.toBe(-1);
      expect(resizeIdx).not.toBe(-1);
      expect(atlasIdx).not.toBe(-1);

      // Order assertion: reset → write → resize → atlas-clear.
      // This is the regression-prevention pattern: the atlas MUST be
      // cleared AFTER the resize so glyphs are re-rasterised at the
      // new cell dimensions and don't paint at stale/interleaved rows.
      expect(resetIdx).toBeLessThan(writeIdx);
      expect(writeIdx).toBeLessThan(resizeIdx);
      expect(resizeIdx).toBeLessThan(atlasIdx);

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