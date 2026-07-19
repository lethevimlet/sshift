/**
 * Phase 2 hardening tests for the `saveTabs()` debounce + signature dedup
 * added to the SSHIFTClient class.
 *
 * Verifies:
 *  - Rapid-fire `saveTabs()` calls collapse into a single `tabs-save`
 *    socket emit (debounce, 150ms).
 *  - Identical payloads (same JSON signature) skip the emit entirely
 *    (dedup) — even after the debounce timer fires.
 *  - Different payloads trigger exactly one emit per change.
 *  - When `isSyncingTabs` is true, `tabs-save` is never emitted (cross-
 *    client sync loop guard).
 *  - When `isRestoring` is true, `saveTabs()` is a no-op (the restore
 *    path writes its own state).
 *  - When `sticky` is false, `saveTabs()` clears localStorage instead
 *    of writing a snapshot.
 */

const path = require('path');
const fs = require('fs');

function loadAppSource() {
  const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'app.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const mockWindow = {
    innerWidth: 1280,
    addEventListener: () => {}, removeEventListener: () => {},
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  };
  const mockDocument = {
    addEventListener: () => {}, removeEventListener: () => {},
    body: { classList: { add: () => {}, remove: () => {} } },
    documentElement: { setAttribute: () => {}, getAttribute: () => null, classList: { add: () => {}, remove: () => {} } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, style: {} })
  };
  const emittedTabsSave = [];
  const mockSocket = {
    on: () => {},
    emit: (event, data) => { if (event === 'tabs-save') emittedTabsSave.push(data); },
    connected: true,
    disconnect: () => {}, connect: () => {}
  };
  const localStorageStore = {};
  const mockLocalStorage = {
    getItem: (k) => (k in localStorageStore ? localStorageStore[k] : null),
    setItem: (k, v) => { localStorageStore[k] = String(v); },
    removeItem: (k) => { delete localStorageStore[k]; }
  };
  const scope = {
    window: mockWindow,
    document: mockDocument,
    localStorage: mockLocalStorage,
    navigator: { clipboard: { writeText: () => Promise.resolve(true) }, userAgent: 'node' },
    io: function () { return mockSocket; },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    // Pass-through to the CURRENT global timers — so jest.useFakeTimers()
    // called AFTER module load still intercepts setTimeout calls made
    // by the production closure (which captured these wrappers).
    setTimeout: (...a) => global.setTimeout(...a),
    clearTimeout: (...a) => global.clearTimeout(...a),
    setInterval: (...a) => global.setInterval(...a),
    clearInterval: (...a) => global.clearInterval(...a),
    console,
    Terminal: undefined, FitAddon: undefined, WebLinksAddon: undefined, SearchAddon: undefined,
    SerializeAddon: undefined, WebglAddon: undefined, Unicode11Addon: undefined, ImageAddon: undefined,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextDecoder,
    Worker: function () {},
    visualViewport: null,
    performance: { now: () => Date.now() }
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(scope), source + '\nreturn SSHIFTClient;');
  return { Cls: factory(...Object.values(scope)), mockSocket, mockLocalStorage, localStorageStore, emittedTabsSave };
}

describe('saveTabs debounce + signature dedup (Phase 2)', () => {
  let client, emittedTabsSave, localStorageStore;

  beforeEach(() => {
    const loaded = loadAppSource();
    // Stub init so constructor doesn't fire the full real setup.
    loaded.Cls.prototype.init = function () { /* test stub */ };
    client = new loaded.Cls();
    emittedTabsSave = loaded.emittedTabsSave;
    localStorageStore = loaded.localStorageStore;
    // Wire the client to use the freshly-built socket mock.
    client.socket = loaded.mockSocket;
    // Pretend sticky is on (otherwise saveTabs() just clears localStorage).
    client.sticky = true;
    // Pretend we're NOT in the middle of a server sync (would suppress
    // tabs-save emit). Even though the production flag default is false,
    // restoreBetween tests may have left it true if any shared state
    // leaked — set explicitly.
    client.isSyncingTabs = false;
    client.isRestoring = false;
    // No sessions by default so iterate loops are zero-length; we'll
    // manually seed sessions + DOM in tests that need them.
  });

  function seedPanelAndSession(sessionId, name) {
    // Minimal session entry. saveTabs() iterates panels' tab children
    // and reads session.name/type/connectionData.
    client.sessions.set(sessionId, {
      id: sessionId, name, type: 'ssh', connectionData: { host: 'h', port: 22 }
    });
    // We need a panel + tabs container to produce a tab DOM child for
    // the iteration. We use the global `document` mock since saveTabs()
    // indirectly calls `this.getTabsContainer(panelId)` which calls
    // `document.getElementById('tabs')`. Returning null means
    // saveTabs() skips that panel (no tab entries appended).
    // Force the document.getElementsByName('tabs') to return a stub with
    // a single child matching this session.
    const fakeTab = { dataset: { sessionId } };
    client.getTabsContainer = () => ({ children: [fakeTab] });
    client.getAllPanels = () => ['panel-0'];
    client.getTerminalsContainer = () => ({});
    // activeSessionsByPanel defaults to empty Map — active flag calc
    // simply yields false for entries not in the map.
    client.activeSessionsByPanel = new Map();
    client.isMobile = false;
    client.currentLayout = { id: 'single' };
    client._serverLayout = null;
  }

  test('rapid identical saveTabs() calls collapse to one tabs-save emit (debounce + dedup)', () => {
    // The first burst always emits once because the cached signature
    // starts as null and the first payload is a "change". Subsequent
    // identical payloads within the same debounce window are deduped
    // to zero extra emits.
    jest.useFakeTimers();
    try {
      seedPanelAndSession('s-1', 'Tab A');
      for (let i = 0; i < 5; i++) client.saveTabs();
      jest.advanceTimersByTime(500);
      expect(emittedTabsSave.length).toBe(1);
      // Calling saveTabs again with the SAME payload must NOT re-emit
      // (signature matches the cached value).
      client.saveTabs();
      jest.advanceTimersByTime(500);
      expect(emittedTabsSave.length).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a payload CHANGE triggers one tabs-save emit per change', () => {
    jest.useFakeTimers();
    try {
      seedPanelAndSession('s-2', 'Tab V1');
      client.saveTabs();
      jest.advanceTimersByTime(200);

      // Change the session name — payload signature changes.
      seedPanelAndSession('s-2', 'Tab V2');
      client.saveTabs();
      jest.advanceTimersByTime(200);

      // Each distinct payload produces one emit. The dedup is based on
      // signature equality, and "V1" !== "V2" so both are emitted.
      expect(emittedTabsSave.length).toBe(2);
      expect(emittedTabsSave[0].tabs[0].name).toBe('Tab V1');
      expect(emittedTabsSave[1].tabs[0].name).toBe('Tab V2');
    } finally {
      jest.useRealTimers();
    }
  });

  test('successive DIFFERENT payload changes collapse to one emit per change', () => {
    jest.useFakeTimers();
    try {
      seedPanelAndSession('s-3', 'v0');
      client.saveTabs();

      seedPanelAndSession('s-3', 'v1');
      client.saveTabs();

      seedPanelAndSession('s-3', 'v2');
      client.saveTabs();

      seedPanelAndSession('s-3', 'v3');
      client.saveTabs();

      jest.advanceTimersByTime(500);
      // Only the LAST change wins the debounce race; signature dedup
      // suppresses the earlier intermediate ones.
      expect(emittedTabsSave.length).toBe(1);
      expect(emittedTabsSave[0].tabs[0].name).toBe('v3');
    } finally {
      jest.useRealTimers();
    }
  });

  test('isSyncingTabs=true suppresses tabs-save emit but still writes localStorage', () => {
    jest.useFakeTimers();
    try {
      seedPanelAndSession('s-sync', 'SyncTest');
      client.isSyncingTabs = true;
      client.saveTabs();
      jest.advanceTimersByTime(200);
      expect(emittedTabsSave.length).toBe(0);
      // localStorage still updated (the dedup signature sees the new
      // payload and writes it).
      expect(localStorageStore['openTabs']).toContain('SyncTest');
    } finally {
      jest.useRealTimers();
    }
  });

  test('isRestoring=true short-circuits saveTabs entirely', () => {
    jest.useFakeTimers();
    try {
      seedPanelAndSession('s-rest', 'RestoreTest');
      client.isRestoring = true;
      client.saveTabs();
      jest.advanceTimersByTime(500);
      expect(emittedTabsSave.length).toBe(0);
      expect(localStorageStore['openTabs']).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test('sticky=false clears the saved tabs instead of emitting', () => {
    jest.useFakeTimers();
    try {
      seedPanelAndSession('s-nosticky', 'NoSticky');
      client.sticky = false;
      // Pre-seed localStorage so we can assert it gets removed.
      localStorageStore['openTabs'] = JSON.stringify({ tabs: [{ sessionId: 'stale' }], layout: 'single' });
      client.saveTabs();
      jest.advanceTimersByTime(500);
      expect(emittedTabsSave.length).toBe(0);
      // Sticky-disabled path calls clearTabs() which removeItem's openTabs.
      expect(localStorageStore['openTabs']).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});