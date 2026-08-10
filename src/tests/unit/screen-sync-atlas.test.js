/**
 * Regression test for Bug 1 (interlaced lines after Take Control on a
 * refreshed browser tab).
 *
 * Root cause: when an ssh-screen-sync arrived, the handler wrote the
 * serialized state, then called `terminal.resize(cols, rows)` but did NOT
 * force the renderer to recompute its dimensions. The WebGL renderer kept
 * painting at a stale device cell pitch — every other row landed outside
 * the visible grid, producing the "interlaced / alternating black bands"
 * appearance. Crucially, a plain atlas clear was NOT sufficient: when the
 * terminal was already at the synced cols/rows, `terminal.resize()` and
 * `fitAddon.fit()` both short-circuit inside xterm.js, so nothing re-ran
 * the renderer's `_updateDimensions()`. Changing the font size fixed it
 * (an actual fontSize change fires handleCharSizeChanged → renderer
 * handleResize) and a real window resize fixed it (different cols/rows →
 * real resize) — which is exactly what users reported.
 *
 * Fix: the screen-sync completion callback now invokes
 * `this._forceRendererDimensionRecompute(session)` AFTER the resize. That
 * helper drives the renderer's full resize path
 * (_renderService.handleResize → _updateDimensions + device-pixel canvas
 * resize) and rebuilds the glyph atlas — even when cols/rows are
 * unchanged.
 *
 * This test exercises the production `on('ssh-screen-sync')` handler via
 * a stubbed socket and a fake xterm Terminal instance. The fake Terminal
 * records every call so we can assert that
 * `_forceRendererDimensionRecompute` runs after `terminal.resize`.
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

    // Stub _forceRendererDimensionRecompute so we can assert on its
    // invocation (it supersedes the old plain _resetWebGLAtlas call —
    // full renderer dimension recompute + atlas rebuild).
    client._forceRendererDimensionRecompute = (session) => {
      callLog.push({ op: 'forceRendererRecompute', sessionId: session && session.id });
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

  test('ssh-screen-sync resets → writes → resizes → recomputes renderer dims (in this order)', (done) => {
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
      const recomputeIdx = ops.indexOf('forceRendererRecompute');

      // The four operations must ALL have happened.
      expect(resetIdx).not.toBe(-1);
      expect(writeIdx).not.toBe(-1);
      expect(resizeIdx).not.toBe(-1);
      expect(recomputeIdx).not.toBe(-1);

      // Order assertion: reset → write → resize → renderer recompute.
      // This is the regression-prevention pattern: the renderer dimension
      // recompute (which includes the atlas rebuild) MUST run AFTER the
      // resize so glyphs are re-rasterised at the new cell dimensions and
      // don't paint at stale/interleaved rows — including when resize()
      // short-circuited because cols/rows were already equal.
      expect(resetIdx).toBeLessThan(writeIdx);
      expect(writeIdx).toBeLessThan(resizeIdx);
      expect(resizeIdx).toBeLessThan(recomputeIdx);

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