/**
 * Regression tests for the layout-change refit bugs (v1.7.5).
 *
 * Symptom reported: "when changing viewport layouts, especially when going
 * back to single, the refit is not triggering and the terminal retains its
 * previous shape".
 *
 * Two independent causes were found by driving a real browser against a real
 * SSH session and asking the remote shell for `tput cols x tput lines`:
 *
 *  1. The stale remote PTY.  The ONLY automatic "tell the server our new
 *     size" path was xterm's `onResize` event, which fires exclusively when
 *     cols/rows actually change, and whose emit is debounced through
 *     `session.resizeTimeout`.  The container ResizeObserver used that SAME
 *     field for its own fit debounce, and fit() changes the wrapper's inner
 *     geometry — so the observer re-fired, cleared the pending *emit*, and
 *     replaced it with a fit that was already a no-op.  The client ended up
 *     at 156 columns while the remote PTY stayed at 76, so the remote
 *     program kept drawing at the previous shape.  Fixed by giving the
 *     observer its own `roFitTimeout` and by reconciling the remote size
 *     explicitly at the end of `_fitTerminal` (`syncRemoteTerminalSize`).
 *
 *  2. The 10x5 crush.  `_refreshAllWebGLSessions` (called on every layout
 *     change) fell back to a bare `fitAddon.fit()` for sessions whose WebGL
 *     addon had to be recreated.  FitAddon reads the *computed* style of the
 *     container, and for a hidden element `height: 100%` computes to the
 *     literal "100%" — parsed as 100px.  Every background session was
 *     therefore resized to ~10x5 and, being the controller, pushed that size
 *     to its remote PTY.  Fixed by routing those refits through
 *     `_fitTerminal`, which refuses to fit a hidden / unlaid-out container.
 */

const path = require('path');
const fs = require('fs');

const APP_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'webapp', 'js', 'app.js'),
  'utf8'
);

// The structural assertions below inspect code, not prose — and the comments
// around these fixes deliberately name the very identifiers we assert are
// absent.
function codeOnly(src) {
  return src.replace(/^\s*\/\/.*$/gm, '');
}

function loadApp(documentStub) {
  const mockWindow = {
    innerWidth: 1280,
    addEventListener: () => {},
    removeEventListener: () => {},
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  };
  const scope = {
    window: mockWindow,
    document: documentStub,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { clipboard: { writeText: () => Promise.resolve(true) }, userAgent: 'node' },
    io: function () { return { on: () => {}, emit: () => {}, connected: true, disconnect: () => {}, connect: () => {} }; },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Terminal: undefined, FitAddon: undefined, WebLinksAddon: undefined,
    SearchAddon: undefined, SerializeAddon: undefined, WebglAddon: undefined,
    Unicode11Addon: undefined, ImageAddon: undefined,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextDecoder, Worker: function () {}, visualViewport: null,
    performance: { now: () => Date.now() }
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(scope), APP_SOURCE + '\nreturn SSHIFTClient;');
  const Cls = factory(...Object.values(scope));
  Cls.prototype.init = function () { /* test stub */ };
  return Cls;
}

/**
 * Build a client with one SSH session whose wrapper/container are stubbed.
 * `size` is the container's laid-out size; a hidden pane reports 0x0 and the
 * wrapper loses its `active` class.
 */
function makeClient({ active = true, size = { width: 1324, height: 800 }, isController = true } = {}) {
  const fitCalls = [];
  const emitted = [];
  const sessionId = 'ssh-1';

  const container = {
    getBoundingClientRect: () => ({ width: size.width, height: size.height }),
    offsetHeight: size.height,
    offsetWidth: size.width,
    querySelector: () => null
  };
  const wrapper = {
    classList: { contains: (c) => c === 'active' && active },
    offsetHeight: size.height,
    offsetWidth: size.width
  };

  const documentStub = {
    addEventListener: () => {}, removeEventListener: () => {},
    body: { classList: { add: () => {}, remove: () => {} } },
    documentElement: { setAttribute: () => {}, getAttribute: () => null, classList: { add: () => {}, remove: () => {} } },
    getElementById: (id) => {
      if (id === `terminal-wrapper-${sessionId}`) return wrapper;
      if (id === `terminal-${sessionId}`) return container;
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, style: {} }),
    fonts: { ready: Promise.resolve() }
  };

  const Cls = loadApp(documentStub);
  const client = new Cls();
  client.isMobile = false;
  client.socket = {
    on: () => {},
    emit: (event, data) => emitted.push({ event, data }),
    connected: true
  };
  client._forceRendererDimensionRecompute = () => {};

  const session = {
    id: sessionId,
    connected: true,
    isController,
    terminal: {
      cols: 156,
      rows: 44,
      _core: null
    },
    fitAddon: {
      fit: () => { fitCalls.push(Date.now()); }
    }
  };
  client.sessions.set(sessionId, session);

  return { client, session, fitCalls, emitted };
}

describe('Layout-change refit: hidden panes are never fitted', () => {
  test('_fitTerminal refuses to fit a hidden wrapper (would crush it to ~10x5)', () => {
    const { client, session, fitCalls, emitted } = makeClient({ active: false, size: { width: 0, height: 0 } });

    const result = client._fitTerminal(session);

    expect(result).toBe(false);
    expect(fitCalls).toHaveLength(0);
    expect(session.needsResize).toBe(true);
    expect(emitted).toHaveLength(0);
  });

  test('_fitTerminal refuses to fit a container that has not been laid out yet', () => {
    const { client, session, fitCalls } = makeClient({ active: true, size: { width: 20, height: 20 } });

    expect(client._fitTerminal(session)).toBe(false);
    expect(fitCalls).toHaveLength(0);
    expect(session.needsResize).toBe(true);
  });

  test('_fitTerminal refuses to fit a non-controller (it must mirror the server)', () => {
    const { client, session, fitCalls, emitted } = makeClient({ isController: false });

    expect(client._fitTerminal(session)).toBe(false);
    expect(fitCalls).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  test('_refreshAllWebGLSessions never calls fitAddon.fit() directly', () => {
    // The recreate-after-context-loss branch used to do exactly that, which
    // resized every hidden background session to 10x5 on layout changes.
    const body = codeOnly(APP_SOURCE.slice(
      APP_SOURCE.indexOf('\n  _refreshAllWebGLSessions() {'),
      APP_SOURCE.indexOf('\n  _setupDPRListener() {')
    ));
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/fitAddon\.fit\(\)/);
    expect(body).toMatch(/_fitTerminal\(session\)/);
  });
});

describe('Layout-change refit: the remote PTY is told about the new size', () => {
  test('a fit that lands on unchanged cols/rows still syncs the server', () => {
    // xterm fires onResize ONLY when the dimensions change, so this is the
    // exact case where the old code silently left the PTY on its previous
    // (previous-layout) size.
    const { client, session, emitted } = makeClient();

    expect(client._fitTerminal(session)).toBe(true);

    expect(emitted).toEqual([
      { event: 'ssh-resize', data: { sessionId: 'ssh-1', cols: 156, rows: 44 } }
    ]);
  });

  test('the sync is idempotent once the server is known to be at that size', () => {
    const { client, session, emitted } = makeClient();

    client._fitTerminal(session);
    client._fitTerminal(session);
    client._fitTerminal(session);

    expect(emitted).toHaveLength(1);
  });

  test('a later size change is pushed again', () => {
    const { client, session, emitted } = makeClient();

    client._fitTerminal(session);
    session.terminal.cols = 76;
    client._fitTerminal(session);

    expect(emitted.map(e => e.data.cols)).toEqual([156, 76]);
  });

  test('syncRemoteTerminalSize stays quiet for non-controllers and while resyncing', () => {
    const { client, session, emitted } = makeClient();

    session.isController = false;
    client.syncRemoteTerminalSize(session);
    expect(emitted).toHaveLength(0);

    session.isController = true;
    session.isResyncing = true;
    client.syncRemoteTerminalSize(session);
    expect(emitted).toHaveLength(0);

    session.isResyncing = false;
    client.syncRemoteTerminalSize(session);
    expect(emitted).toHaveLength(1);
  });
});

describe('Layout-change refit: the resize debounces must not collide', () => {
  // Behavioural coverage for this lives in the browser: the ResizeObserver
  // fires as a side effect of fit(), so in-process we assert the invariant
  // structurally — the observer must not be able to cancel the pending
  // `ssh-resize` emit by reusing its timer field.
  const observerStart = APP_SOURCE.indexOf('// Setup ResizeObserver to handle container size changes');
  const observerBody = codeOnly(APP_SOURCE.slice(
    observerStart,
    APP_SOURCE.indexOf('resizeObserver.observe(wrapper);', observerStart)
  ));

  test('the ResizeObserver fit debounce uses its own timer field', () => {
    expect(observerStart).toBeGreaterThan(0);
    expect(observerBody).toMatch(/session\.roFitTimeout/);
    expect(observerBody).not.toMatch(/session\.resizeTimeout/);
  });

  test('the ssh-resize emit debounce still owns session.resizeTimeout', () => {
    const onResizeBody = codeOnly(APP_SOURCE.slice(
      APP_SOURCE.indexOf('terminal.onResize(({ cols, rows }) => {'),
      APP_SOURCE.indexOf('// Handle copy/paste keyboard shortcuts')
    ));
    expect(onResizeBody).toMatch(/sess\.resizeTimeout = setTimeout/);
    expect(onResizeBody).toMatch(/ssh-resize/);
  });
});
