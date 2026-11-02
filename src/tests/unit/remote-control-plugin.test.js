/**
 * Tests for the remote-control plugin (loopback HTTP API for local
 * assistants) and the plugin-manager/ssh-manager support it relies on:
 * plain-text screen reading, the one-client claim flow, tab listing and
 * teardown on reload.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { Terminal } = require('@xterm/headless');

const RemoteControl = require(path.join(__dirname, '..', '..', '..', 'plugins', 'remote-control', 'index.js'));

function request(port, method, url, { token, body, origin } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: url,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function makeCtx(dir) {
  const screens = new Map();
  const ctx = {
    writes: [],
    switched: [],
    claimResult: { claimed: true },
    tabs: [
      { sessionId: 's1', position: 1, name: 'box', type: 'ssh', connected: true },
      { sessionId: 's2', position: 2, name: 'box', type: 'ssh', connected: true },
      { sessionId: 'f1', position: 3, name: 'files', type: 'sftp', connected: true },
    ],
    active: 's1',
    screens,
    getDataDir: () => dir,
    getTabs: () => ({ activeSessionId: ctx.active, tabs: ctx.tabs }),
    getBookmarks: () => [
      { id: 'b1', name: 'levi', type: 'ssh', folder: null },
      { id: 'u1', name: 'docs', type: 'url', folder: null },
    ],
    getTerminalText: id => screens.get(id) || { lines: ['$ '], cursorLine: 0, alternateScreen: false, bracketedPaste: false, applicationCursorKeys: false },
    sendInput: (id, data) => { ctx.writes.push([id, data]); return true; },
    renamed: [],
    renameTab: (id, name) => { if (!ctx.tabs.some(t => t.sessionId === id)) return false; ctx.renamed.push([id, name]); return true; },
    switchTab: id => { if (!ctx.tabs.some(t => t.sessionId === id)) return false; ctx.active = id; ctx.switched.push(id); return true; },
    requestClientAction: async () => {
      if (ctx.claimResult.claimed) ctx.tabs.push({ sessionId: 's3', position: 4, name: 'levi', type: 'ssh', connected: true });
      return ctx.claimResult;
    },
  };
  return ctx;
}

describe('remote-control plugin', () => {
  let dir, ctx, plugin, port, token;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshift-rc-'));
    ctx = makeCtx(dir);
    port = 20000 + Math.floor(Math.random() * 20000);
    plugin = new RemoteControl(ctx, { port });
    plugin.init();
    await new Promise(resolve => plugin.server.once('listening', resolve));
    token = fs.readFileSync(path.join(dir, 'remote-control.token'), 'utf8').trim();
  });

  afterEach(() => {
    plugin.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('creates a private token and rejects unauthenticated or browser requests', async () => {
    expect(fs.statSync(path.join(dir, 'remote-control.token')).mode & 0o777).toBe(0o600);
    expect((await request(port, 'GET', '/v1/tabs')).status).toBe(401);
    expect((await request(port, 'GET', '/v1/tabs', { token: 'x'.repeat(64) })).status).toBe(401);
    expect((await request(port, 'GET', '/v1/tabs', { token, origin: 'http://evil.example' })).status).toBe(403);
    expect((await request(port, 'GET', '/v1/health', { token })).body).toEqual({ ok: true });
  });

  test('refuses to bind to a non-loopback host', () => {
    const other = new RemoteControl(ctx, { port: port + 1, host: '0.0.0.0' });
    other.init();
    expect(other.server).toBeNull();
  });

  test('lists tabs with focus and app hints', async () => {
    ctx.screens.set('s2', { lines: ['', ' ? for shortcuts'], cursorLine: 0, alternateScreen: false });
    const { body } = await request(port, 'GET', '/v1/tabs', { token });
    expect(body.activeSessionId).toBe('s1');
    expect(body.tabs.map(t => [t.sessionId, t.focused, t.app])).toEqual([['s1', true, 'shell'], ['s2', false, 'claude'], ['f1', false, null]]);
  });

  test('types single-line text into the focused tab without submitting', async () => {
    const { status, body } = await request(port, 'POST', '/v1/type', { token, body: { text: 'git status' } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ typed: true, sessionId: 's1', submitted: false });
    expect(ctx.writes).toEqual([['s1', 'git status']]);
  });

  test('rejects control characters and unpasteable multi-line text', async () => {
    expect((await request(port, 'POST', '/v1/type', { token, body: { text: 'ls\x1b[201~' } })).status).toBe(400);
    expect((await request(port, 'POST', '/v1/type', { token, body: { text: 'rm -rf x\nls' } })).status).toBe(409);
    expect(ctx.writes).toEqual([]);
  });

  test('wraps multi-line text in bracketed paste when the app enabled it', async () => {
    ctx.screens.set('s1', { lines: ['>'], cursorLine: 0, bracketedPaste: true });
    await request(port, 'POST', '/v1/type', { token, body: { text: 'line one\r\nline two' } });
    expect(ctx.writes).toEqual([['s1', '\x1b[200~line one\nline two\x1b[201~']]);
  });

  test('sends named keys, honouring application cursor mode', async () => {
    await request(port, 'POST', '/v1/key', { token, body: { key: 'enter' } });
    await request(port, 'POST', '/v1/key', { token, body: { key: 'up', repeat: 2 } });
    ctx.screens.set('s1', { lines: [''], cursorLine: 0, applicationCursorKeys: true });
    await request(port, 'POST', '/v1/key', { token, body: { key: 'up' } });
    expect(ctx.writes.map(w => w[1])).toEqual(['\r', '\x1b[A\x1b[A', '\x1bOA']);
    expect((await request(port, 'POST', '/v1/key', { token, body: { key: 'rm' } })).status).toBe(400);
    expect((await request(port, 'POST', '/v1/key', { token, body: { key: 'enter', repeat: 99 } })).status).toBe(400);
  });

  test('only SSH tabs accept input', async () => {
    expect((await request(port, 'POST', '/v1/type', { token, body: { sessionId: 'f1', text: 'x' } })).status).toBe(409);
    expect((await request(port, 'POST', '/v1/type', { token, body: { sessionId: 'nope', text: 'x' } })).status).toBe(404);
  });

  test('switches tabs and opens bookmarks through one claiming client', async () => {
    expect((await request(port, 'POST', '/v1/switch', { token, body: { sessionId: 's2' } })).body).toMatchObject({ switched: true, sessionId: 's2' });
    expect(ctx.switched).toEqual(['s2']);
    expect((await request(port, 'POST', '/v1/open', { token, body: { bookmarkId: 'b1' } })).body).toMatchObject({ opened: true, sessionId: 's3', name: 'levi' });
    expect((await request(port, 'POST', '/v1/open', { token, body: { bookmarkId: 'u1' } })).status).toBe(409);
    ctx.claimResult = { claimed: false, reason: 'no-clients' };
    expect((await request(port, 'POST', '/v1/open', { token, body: { bookmarkId: 'b1' } })).status).toBe(409);
  });

  test('renames tabs with validated names', async () => {
    expect((await request(port, 'POST', '/v1/rename', { token, body: { sessionId: 's2', name: '  snake   game ' } })).body).toEqual({ renamed: true, sessionId: 's2', name: 'snake game' });
    expect(ctx.renamed).toEqual([['s2', 'snake game']]);
    expect((await request(port, 'POST', '/v1/rename', { token, body: { sessionId: 's2', name: '' } })).status).toBe(400);
    expect((await request(port, 'POST', '/v1/rename', { token, body: { sessionId: 's2', name: 'x'.repeat(41) } })).status).toBe(400);
    expect((await request(port, 'POST', '/v1/rename', { token, body: { sessionId: 's2', name: 'a\x1b[2J' } })).status).toBe(400);
    expect((await request(port, 'POST', '/v1/rename', { token, body: { sessionId: 'nope', name: 'x' } })).status).toBe(404);
  });

  test('bookmarks never expose credentials', async () => {
    const { body } = await request(port, 'GET', '/v1/bookmarks', { token });
    expect(body.bookmarks[0]).toEqual({ id: 'b1', name: 'levi', type: 'ssh', folder: null });
  });
});

describe('plugin-manager remote support', () => {
  function freshManager() {
    jest.resetModules();
    return require('../../server/plugins/plugin-manager');
  }

  test('requestClientAction grants exactly one claim', async () => {
    const pm = freshManager();
    const handlers = [];
    const emitted = [];
    pm.io = { sockets: { sockets: new Map([['a', {}], ['b', {}]]) }, emit: (e, d) => emitted.push([e, d]) };
    const sockets = ['a', 'b'].map(id => ({ id, on: (event, fn) => handlers.push([id, fn]) }));
    sockets.forEach(s => pm.registerSocket(s));
    const pending = pm.requestClientAction('remote-open-bookmark', { bookmarkId: 'b1' });
    const { requestId } = emitted[0][1];
    const acks = [];
    handlers.forEach(([, fn]) => fn({ requestId }, r => acks.push(r.granted)));
    expect(acks).toEqual([true, false]);
    expect(await pending).toMatchObject({ claimed: true, socketId: 'a' });
  });

  test('requestClientAction reports no clients without waiting', async () => {
    const pm = freshManager();
    pm.io = { sockets: { sockets: new Map() }, emit: () => {} };
    expect(await pm.requestClientAction('x')).toEqual({ claimed: false, reason: 'no-clients' });
  });

  test('reload calls destroy() on plugin instances', () => {
    const pm = freshManager();
    const destroy = jest.fn();
    pm.config = { plugins: [] };
    pm.plugins.set('x', { instance: { destroy } });
    pm.reload({ plugins: [] });
    expect(destroy).toHaveBeenCalled();
  });
});

describe('ssh-manager getTerminalText', () => {
  test('returns plain visible lines, cursor and input modes', async () => {
    const sshManager = require('../../server/services/ssh-manager');
    const terminal = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    sshManager.sessions.set('t1', { terminal, cols: 40, rows: 5 });
    await new Promise(resolve => terminal.write('\x1b[31mred\x1b[0m line\r\n\x1b[?2004h$ git st', resolve));
    const text = sshManager.getTerminalText('t1');
    expect(text.lines).toEqual(['red line', '$ git st']);
    expect(text.cursorLine).toBe(1);
    expect(text.bracketedPaste).toBe(true);
    expect(text.alternateScreen).toBe(false);
    sshManager.sessions.delete('t1');
    terminal.dispose();
  });
});
