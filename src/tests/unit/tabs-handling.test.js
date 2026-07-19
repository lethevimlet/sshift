/**
 * Unit tests for the tab-handling invariants hardened in Phase 1:
 *
 *  - `handleTabOpened` creates at most ONE DOM `.tab` per received
 *    `tab-opened` broadcast (the duplicate-block bug).
 *  - `closeTab` / `removeTabLocally` / `handleTabClosed` remove EVERY
 *    DOM `.tab[data-session-id]` node (defensive against future dupes).
 *
 * We don't load the full xterm stack; instead we instantiate
 * SSHIFTClient with a stubbed DOM + io + Terminal and drive the public
 * tab lifecycle methods directly. The real DOM behavior is approximated
 * by a tiny in-memory document mock that supports the querySelectorAll
 * / getElementById / appendChild / removeChild APIs the app exercises.
 */

const path = require('path');
const fs = require('fs');

// --- Minimal in-memory DOM mock ---------------------------------------------
function makeDom() {
  function makeElement(tag, id) {
    const el = {
      tagName: tag,
      id: id || null,
      dataset: {},
      classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, contains(c) { return this._set.has(c); }, toggle(c, f) { f ? this._set.add(c) : this._set.delete(c); } },
      style: { setProperty: () => {}, getProperty: () => '' },
      children: [],
      childNodes: [],
      parentNode: null,
      parentElement: null,
      _listeners: {},
      _className: '',
      setAttribute(k, v) { this[k] = v; if (k === 'data-session-id') this.dataset.sessionId = v; },
      getAttribute(k) { return this[k]; },
      addEventListener(t, h) { (this._listeners[t] = this._listeners[t] || []).push(h); },
      removeEventListener() {},
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        child.parentElement = this;
        this.children.push(child);
        this.childNodes.push(child);
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter(c => c !== child);
        this.childNodes = this.childNodes.filter(c => c !== child);
        child.parentNode = null;
        child.parentElement = null;
        return child;
      },
      remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
      },
      querySelector(sel) {
        return querySelector(this, sel, false);
      },
      querySelectorAll(sel) {
        return querySelector(this, sel, true);
      },
      innerHTML: '',
      textContent: '',
      insertAdjacentHTML() {},
      contains: () => false,
      closest: () => null,
      focus: () => {},
      blur: () => {}
    };
    // Mock the `className` property so assigning a string (real-DOM
    // behavior) also populates `classList`. Production code does both
    // `tab.className = 'tab'` and `tab.classList.add('tab')` depending on
    // the path, so the mock needs to bridge them.
    Object.defineProperty(el, 'className', {
      get() { return this._className; },
      set(v) {
        this._className = String(v);
        this.classList._set = new Set();
        if (typeof v === 'string' && v.length > 0) {
          v.split(/\s+/).forEach(c => { if (c) this.classList._set.add(c); });
        }
      },
      enumerable: true,
      configurable: true
    });
    return el;
  }

  function querySelector(root, sel, all) {
    // Support only the subset of selectors the app uses:
    //   .tab[data-session-id="xxxx"]
    //   [data-session-id="xxxx"]
    //   #some-id
    //   .some-class
    const results = [];
    function visit(node) {
      if (!node || !node.tagName) return;
      // class match
      if (sel.startsWith('.') && !sel.includes('[')) {
        const cls = sel.slice(1);
        if (node.classList && node.classList.contains(cls)) results.push(node);
      }
      // id match
      else if (sel.startsWith('#')) {
        if (node.id === sel.slice(1)) results.push(node);
      }
      // attribute match(.someclass[attr="value"] or [attr="value"])
      else {
        const m = sel.match(/^(?:\.([\w-]+))?\[([\w-]+)(?:="([^"]*)")?\]$/);
        if (m) {
          const cls = m[1], attrName = m[2], attrVal = m[3];
          if (cls && !(node.classList && node.classList.contains(cls))) {
            // class does not match — skip but still descend
          } else {
            const actual = node[attrName] !== undefined ? node[attrName]
              : (node.dataset && node.dataset[toCamel(attrName)]);
            if (attrVal === undefined) {
              if (actual !== undefined && actual !== null && actual !== '') results.push(node);
            } else if (String(actual) === String(attrVal)) {
              results.push(node);
            }
          }
        }
      }
      for (const c of (node.children || [])) visit(c);
    }
    visit(root);
    return all ? results : (results[0] || null);
  }

  function toCamel(s) {
    // The HTML dataset spec strips the leading `data-` before
    // camelCasing the rest.
    const stripped = s.startsWith('data-') ? s.slice(5) : s;
    return stripped.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  const docState = {
    body: makeElement('body', null),
    documentElement: makeElement('html', null),
    _byId: new Map(),
    getElementById(id) { return docState._byId.get(id) || null; },
    createElement(tag) {
      const el = makeElement(tag, null);
      return el;
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector(sel) { return querySelector(docState.body, sel, false); },
    querySelectorAll(sel) { return querySelector(docState.body, sel, true); }
  };

  // Track IDs: assigning el.id='foo' registers in _byId
  const origSet = Object.getOwnPropertyDescriptor(Object.prototype, 'id');
  // We can't intercept property sets cheaply; instead we patch the
  // getElementById path by scanning the tree each time. Simpler: monkey-
  // patch the makeElement id setter by post-processing creation.
  // Use a wrapper to scan-and-find by id:
  docState.getElementById = function (id) {
    function visit(n) {
      if (!n) return null;
      if (n.id === id) return n;
      for (const c of (n.children || [])) {
        const f = visit(c);
        if (f) return f;
      }
      return null;
    }
    return visit(docState.body);
  };

  // Pre-populate the single-panel layout DOM so createSSHTab /
  // createSFTPTab find their containers. Single-panel uses the bare
  // IDs `tabs` and `terminalsContainer` (per getTabsContainer / 
  // getTerminalsContainer at app.js).
  const tabsContainer = makeElement('div', 'tabs');
  const terminalsContainer = makeElement('div', 'terminalsContainer');
  docState.body.appendChild(tabsContainer);
  docState.body.appendChild(terminalsContainer);

  return { document: docState, makeElement };
}

// --- Load SSHIFTClient with browser shims ----------------------------------
function loadClient(domMock) {
  const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'app.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const mockWindow = {
    innerWidth: 1280,
    addEventListener: () => {},
    removeEventListener: () => {},
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  };
  const mockDocument = domMock.document;
  const scope = {
    window: mockWindow,
    document: mockDocument,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { clipboard: { writeText: () => Promise.resolve(true) }, userAgent: 'node' },
    io: function () {
      return {
        on: () => {},
        emit: () => {},
        connected: true,
        disconnect: () => {},
        connect: () => {}
      };
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    console,
    Terminal: function () { return { on: () => {}, onData: () => {}, onResize: () => {}, onScroll: () => {}, onSelectionChange: () => {}, write: () => {}, writeln: () => {}, dispose: () => {}, open: () => {}, fit: () => {}, focus: () => {}, blur: () => {}, reset: () => {}, refresh: () => {}, scrollToBottom: () => {}, resize: () => {}, options: {}, buffer: { active: { length: 100 } } }; },
    FitAddon: function () { return { fit: () => {}, proposeDimensions: () => ({ cols: 80, rows: 24 }) }; },
    WebLinksAddon: function () { return { activate: () => {}, dispose: () => {} }; },
    SearchAddon: function () { return { activate: () => {}, dispose: () => {}, findNext: () => {}, findPrevious: () => {} }; },
    SerializeAddon: function () { return { activate: () => {}, dispose: () => {}, serialize: () => '' }; },
    WebglAddon: function () { return { activate: () => {}, dispose: () => {}, clearTextureAtlas: () => {}, onContextLoss: () => {} }; },
    Unicode11Addon: function () { return { activate: () => {}, dispose: () => {} }; },
    ImageAddon: function () { return { activate: () => {}, dispose: () => {} }; },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextDecoder,
    Worker: function () {},
    visualViewport: null,
    performance: { now: () => Date.now() }
  };

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    ...Object.keys(scope),
    source + '\nreturn SSHIFTClient;'
  );
  const Cls = factory(...Object.values(scope));
  // Stub init so `new Cls()` doesn't fire the full real init flow
  // (which expects a live server + DOM-level event setup).
  const originalInit = Cls.prototype.init;
  Cls.prototype.init = function () { /* test stub */ };
  return Cls;
}

describe('tab handling invariants (Phase 1 hardening)', () => {
  let client;
  let doc;

  beforeEach(() => {
    const dom = makeDom();
    doc = dom.document;
    const Cls = loadClient(dom);
    client = new Cls();
    // Skip init() — it expects a real server; we just need tab helpers.
  });

  test('handleTabOpened creates exactly one DOM tab per tab-opened', () => {
    const sessionId = 'ssh-test-1';
    // Don't pre-populate sessions.has — that would short-circuit the OUTER
    // "I already have this session" guard. We want to exercise the INNER
    // dedupe (querySelectorAll check) that survives future regressions of
    // the duplicate-block bug.
    client.handleTabOpened({
      sessionId,
      name: 'Test',
      type: 'ssh',
      connectionData: { host: 'h', port: 22 }
    });
    // Simulate the original duplicated-block bug: a second invocation
    // with the same payload must NOT create a second DOM tab. The fix
    // uses querySelectorAll to detect existing tabs before creating.
    client.handleTabOpened({
      sessionId,
      name: 'Test',
      type: 'ssh',
      connectionData: { host: 'h', port: 22 }
    });
    const tabs = doc.querySelectorAll(`.tab[data-session-id="${sessionId}"]`);
    expect(tabs.length).toBe(1);
  });

  test('handleTabOpened creates exactly one tab for an unknown session', () => {
    const sessionId = 'ssh-test-2';
    // No pre-existing session in the map. handleTabOpened must still
    // create exactly one DOM tab.
    client.handleTabOpened({
      sessionId,
      name: 'Fresh',
      type: 'ssh',
      connectionData: { host: 'h', port: 22 }
    });
    const tabs = doc.querySelectorAll(`.tab[data-session-id="${sessionId}"]`);
    expect(tabs.length).toBe(1);
  });

  test('createSSHTab dedupes by sessionId (idempotency guard)', () => {
    const id = 'ssh-dedupe-1';
    const a = client.createSSHTab('Test', { host: 'h', port: 22 }, id);
    const b = client.createSSHTab('Test', { host: 'h', port: 22 }, id);
    expect(a).toBe(id);
    expect(b).toBe(id);
    const tabs = doc.querySelectorAll(`.tab[data-session-id="${id}"]`);
    expect(tabs.length).toBe(1);
  });

  test('closing a session removes ALL duplicate .tab DOM matches (defensive)', () => {
    const id = 'ssh-cleanup-1';
    client.sessions.set(id, {
      id, type: 'ssh', name: 'Test',
      terminal: null, mobileHandler: null, writeRAF: null, scrollbackRestoreTimer: null,
      osc52FlushListener: null, wheelHandler: null, wheelElement: null, originalScrollback: null,
      resizeObserver: null, resizeTimeout: null
    });
    // Manually inject TWO DOM .tab buttons with the same data-session-id
    // to simulate leftover duplicates from before Phase 1.
    const tabA = doc.createElement('button');
    tabA.className = 'tab';
    tabA.dataset.sessionId = id;
    doc.body.appendChild(tabA);
    const tabB = doc.createElement('button');
    tabB.className = 'tab';
    tabB.dataset.sessionId = id;
    doc.body.appendChild(tabB);
    expect(doc.querySelectorAll(`.tab[data-session-id="${id}"]`).length).toBe(2);

    // removeTabLocally is expected to clear every stale DOM duplicate.
    client.removeTabLocally(id);

    expect(doc.querySelectorAll(`.tab[data-session-id="${id}"]`).length).toBe(0);
  });
});