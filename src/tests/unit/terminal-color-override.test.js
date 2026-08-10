/**
 * Regression tests for the terminal color override feature.
 *
 * Bug: "terminal colour override stopped working". Historically,
 * saveTerminalColorSettings could run while `this.theme` (or the color
 * properties) were still undefined, persisting the literal string
 * "undefined" into localStorage (and under "..._undefined" keys). Those
 * strings are truthy, so `value || default` fallbacks passed them straight
 * to xterm.js — which silently renders unparseable colors as #000000.
 * With bg AND fg corrupted, enabling the override painted black-on-black
 * (invisible terminal), i.e. the override looked permanently broken.
 *
 * Fixes under test:
 *  1. Persisted colors are sanitized on load/save (#rrggbb or default).
 *  2. Override defaults to OFF and is opt-in: only an explicit persisted
 *     'true' under the v2 key enables it (the legacy key was polluted by
 *     the old always-on default, so it is deliberately ignored).
 *  3. Saves are skipped while this.theme is uninitialized (no junk keys).
 *  4. getTerminalTheme never emits an invalid color even if instance
 *     fields are corrupted at runtime.
 */

const path = require('path');
const fs = require('fs');

function loadApp(storeSeed = {}) {
  const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'app.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const store = new Map(Object.entries(storeSeed));
  const localStorageMock = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    __store: store
  };
  const mockWindow = { innerWidth: 1280, addEventListener: () => {}, removeEventListener: () => {}, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }), matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) };
  const mockDocument = { addEventListener: () => {}, removeEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } }, documentElement: { setAttribute: () => {}, getAttribute: () => null, classList: { add: () => {}, remove: () => {} } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, style: {} }), fonts: { ready: Promise.resolve() } };
  const scope = {
    window: mockWindow, document: mockDocument,
    localStorage: localStorageMock,
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
  return { Cls, localStorage: localStorageMock };
}

describe('Terminal color override: defaults and sanitization', () => {
  test('defaults to OFF with valid default colors on a fresh profile', () => {
    const { Cls } = loadApp();
    const client = new Cls();
    expect(client.terminalColorOverride).toBe(false);

    client.theme = 'dark';
    client.loadTerminalColorSettings();
    expect(client.terminalColorOverride).toBe(false);
    expect(client.terminalBgColor).toBe('#0d1117');
    expect(client.terminalFgColor).toBe('#e6edf3');
    expect(client.terminalSelectionColor).toBe('#264f78');
  });

  test('corrupt persisted colors ("undefined" strings) are sanitized to defaults', () => {
    const { Cls } = loadApp({
      terminalBgColor_dark: 'undefined',
      terminalFgColor_dark: 'undefined',
      terminalSelectionColor_dark: 'not-a-color',
      terminalColorOverrideV2_dark: 'true'
    });
    const client = new Cls();
    client.theme = 'dark';
    client.loadTerminalColorSettings();

    expect(client.terminalColorOverride).toBe(true);
    expect(client.terminalBgColor).toBe('#0d1117');
    expect(client.terminalFgColor).toBe('#e6edf3');
    expect(client.terminalSelectionColor).toBe('#264f78');

    // And the theme fed to xterm contains only valid colors.
    const theme = client.getTerminalTheme('dark');
    expect(theme.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.foreground).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('legacy always-on override key is ignored (reset-once to OFF)', () => {
    const { Cls } = loadApp({
      terminalColorOverride_dark: 'true' // v1 key polluted by the old default
    });
    const client = new Cls();
    client.theme = 'dark';
    client.loadTerminalColorSettings();
    expect(client.terminalColorOverride).toBe(false);
  });

  test('explicit v2 override choice persists and round-trips', () => {
    const { Cls, localStorage } = loadApp();
    const client = new Cls();
    client.theme = 'dark';
    client.loadTerminalColorSettings();
    expect(client.terminalColorOverride).toBe(false);

    // User toggles ON (updateTerminalColorOverrideUI/updateTerminalThemes
    // are DOM no-ops in the sandbox).
    client.toggleTerminalColorOverride();
    expect(client.terminalColorOverride).toBe(true);
    expect(localStorage.getItem('terminalColorOverrideV2_dark')).toBe('true');

    // A fresh client (same storage) sees the persisted ON choice.
    const client2 = new Cls();
    client2.theme = 'dark';
    client2.loadTerminalColorSettings();
    expect(client2.terminalColorOverride).toBe(true);

    // Toggle OFF persists too.
    client.toggleTerminalColorOverride();
    expect(localStorage.getItem('terminalColorOverrideV2_dark')).toBe('false');
  });

  test('save is skipped while this.theme is uninitialized (no junk keys)', () => {
    const { Cls, localStorage } = loadApp();
    const client = new Cls();
    client.theme = undefined;
    client.saveTerminalColorSettings();
    const keys = Array.from(localStorage.__store.keys());
    expect(keys.filter(k => k.includes('_undefined'))).toEqual([]);
    expect(keys.filter(k => k.startsWith('terminal'))).toEqual([]);
  });

  test('junk *_undefined keys from old versions are cleaned up on load', () => {
    const { Cls, localStorage } = loadApp({
      terminalBgColor_undefined: 'undefined',
      terminalColorOverride_undefined: 'true',
      terminalFgColor_undefined: '#e6edf3'
    });
    const client = new Cls();
    client.theme = 'dark';
    client.loadTerminalColorSettings();
    const keys = Array.from(localStorage.__store.keys());
    expect(keys.filter(k => k.endsWith('_undefined'))).toEqual([]);
  });

  test('valid custom colors survive the load/save round trip', () => {
    const { Cls, localStorage } = loadApp({
      terminalBgColor_dark: '#112233',
      terminalFgColor_dark: '#AABBCC',
      terminalSelectionColor_dark: '#445566',
      terminalColorOverrideV2_dark: 'true'
    });
    const client = new Cls();
    client.theme = 'dark';
    client.loadTerminalColorSettings();
    expect(client.terminalColorOverride).toBe(true);
    expect(client.terminalBgColor).toBe('#112233');
    expect(client.terminalFgColor).toBe('#aabbcc'); // normalized lowercase
    expect(client.terminalSelectionColor).toBe('#445566');

    client.saveTerminalColorSettings();
    expect(localStorage.getItem('terminalBgColor_dark')).toBe('#112233');
    const theme = client.getTerminalTheme('dark');
    expect(theme.background).toBe('#112233');
    expect(theme.foreground).toBe('#aabbcc');
  });

  test('light theme has its own settings with OFF default', () => {
    const { Cls } = loadApp({
      terminalColorOverrideV2_dark: 'true',
      terminalBgColor_dark: '#112233'
    });
    const client = new Cls();
    client.theme = 'light';
    client.loadTerminalColorSettings();
    expect(client.terminalColorOverride).toBe(false);
    expect(client.terminalBgColor).toBe('#ffffff');
    expect(client.terminalFgColor).toBe('#1f2328');
  });

  test('getTerminalTheme (override off) returns the fixed default theme', () => {
    const { Cls } = loadApp();
    const client = new Cls();
    client.theme = 'dark';
    client.loadTerminalColorSettings();
    const theme = client.getTerminalTheme('dark');
    expect(theme.background).toBe('#0d1117');
    // ANSI palette untouched so remote colors render with xterm defaults.
    expect(theme.red).toBeUndefined();
    expect(theme.green).toBeUndefined();
  });
});
