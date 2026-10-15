const fs = require('fs');
const path = require('path');

function loadClient() {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'webapp', 'js', 'app.js'), 'utf8');
  const storage = { currentLayout: 'columns-2' };
  const document = {
    body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } },
    documentElement: { style: { setProperty: () => {} } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const window = {
    innerWidth: 1280,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  };
  const scope = {
    window,
    document,
    localStorage: {
      getItem: key => storage[key] ?? null,
      setItem: (key, value) => { storage[key] = String(value); },
      removeItem: key => { delete storage[key]; }
    },
    navigator: { userAgent: 'node', clipboard: {} },
    io: () => ({ on: () => {}, emit: () => {}, connected: true }),
    requestAnimationFrame: callback => callback(),
    cancelAnimationFrame: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    Terminal: undefined,
    FitAddon: undefined,
    WebLinksAddon: undefined,
    SearchAddon: undefined,
    SerializeAddon: undefined,
    WebglAddon: undefined,
    Unicode11Addon: undefined,
    ImageAddon: undefined,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    TextDecoder,
    Worker: function () {},
    visualViewport: null,
    performance: { now: () => Date.now() }
  };
  const factory = new Function(...Object.keys(scope), source + '\nreturn SSHIFTClient;');
  const Client = factory(...Object.values(scope));
  Client.prototype.init = function () {};
  return new Client();
}

describe('per-device layout and mobile tab sync regressions', () => {
  test('initial layout is applied even when sticky tab cache exists', async () => {
    const client = loadClient();
    const layouts = [
      { id: 'single', name: 'Single' },
      { id: 'columns-2', name: 'Two columns' }
    ];
    client.loadLayouts = async () => layouts;
    client.loadTabs = () => ({ tabs: [{ sessionId: 'cached' }] });
    client.sticky = true;
    client.updateLayoutActiveState = jest.fn();
    client.applyLayout = jest.fn();
    client.handleResize = jest.fn();

    await client.initLayoutSystem();

    expect(client.currentLayout).toBe(layouts[1]);
    expect(client.applyLayout).toHaveBeenCalledWith(layouts[1]);
  });

  test('mobile maps desktop panels to panel-0 and keeps the source focused tab', () => {
    const client = loadClient();
    client.isMobile = true;
    client.sessions.set('left', {});
    client.sessions.set('right', {});
    client.getAllPanels = () => ['panel-0'];
    client.getClockwisePanels = () => ['panel-0'];
    client.moveTabToPanel = jest.fn();
    client.switchTab = jest.fn();
    client.updateMobileTabsDropdown = jest.fn();
    client.saveTabs = jest.fn();

    client.distributeTabsToPanels([
      { sessionId: 'left', panelId: 'panel-0-0', active: true },
      { sessionId: 'right', panelId: 'panel-1-0', active: true }
    ], 'right');

    expect(client.moveTabToPanel).toHaveBeenCalledWith('left', 'panel-0');
    expect(client.moveTabToPanel).toHaveBeenCalledWith('right', 'panel-0');
    expect(client.switchTab).toHaveBeenCalledTimes(1);
    expect(client.switchTab).toHaveBeenCalledWith('right', 'panel-0');
  });
});

describe('focused session server relay', () => {
  test('tabs-save stores and broadcasts the source focused session', () => {
    jest.resetModules();
    const tabManager = require('../../server/utils/tab-manager');
    const { registerTabHandlers } = require('../../server/endpoints/ws/tabs');
    const handlers = new Map();
    const broadcasts = [];
    const socket = {
      id: 'device-sync-socket',
      on: (event, handler) => handlers.set(event, handler),
      broadcast: { emit: (event, data) => broadcasts.push({ event, data }) }
    };
    const sessionId = 'device-sync-session';
    tabManager.addTab(sessionId, {
      name: 'Focused',
      type: 'ssh',
      connectionData: {},
      activeSockets: new Set()
    });

    try {
      registerTabHandlers(socket, { emit: () => {} });
      handlers.get('tabs-save')({
        tabs: [{ sessionId, panelId: 'panel-1-0', active: true }],
        layout: 'columns-2',
        activeSessionId: sessionId
      });

      expect(tabManager.getActiveSession()).toBe(sessionId);
      expect(broadcasts).toContainEqual({
        event: 'tabs-sync',
        data: {
          tabs: [{ sessionId, panelId: 'panel-1-0', active: true }],
          layout: 'columns-2',
          activeSessionId: sessionId
        }
      });
    } finally {
      tabManager.removeTab(sessionId);
    }
  });
});
