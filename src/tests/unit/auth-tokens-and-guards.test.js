/**
 * v1.9.9: persistent login tokens, crash guards, tab-order validation.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

describe('persistent auth tokens', () => {
  let dir;
  let tokens;
  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshift-tokens-'));
    tokens = require('../../server/utils/auth-tokens');
    tokens._setStorePath(path.join(dir, 'auth-tokens.json'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('a token survives a restart (fresh module, same file)', () => {
    const t = tokens.issueToken('scrypt$a$b', null);
    expect(tokens.verifyToken(t, 'scrypt$a$b')).toBeTruthy();
    jest.resetModules();
    const again = require('../../server/utils/auth-tokens');
    again._setStorePath(path.join(dir, 'auth-tokens.json'));
    expect(again.verifyToken(t, 'scrypt$a$b')).toBeTruthy();
  });

  test('only token hashes are stored, file is private', () => {
    const t = tokens.issueToken('h', null);
    const file = path.join(dir, 'auth-tokens.json');
    expect(fs.readFileSync(file, 'utf8')).not.toContain(t);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o077).toBe(0);
    }
  });

  test('a changed password hash invalidates the token', () => {
    const t = tokens.issueToken('old-hash', null);
    expect(tokens.verifyToken(t, 'new-hash')).toBeNull();
    // and it stays invalid even with the old hash again
    expect(tokens.verifyToken(t, 'old-hash')).toBeNull();
  });

  test('logout revokes one token, revokeAll revokes every token', () => {
    const a = tokens.issueToken('h', null);
    const b = tokens.issueToken('h', null);
    tokens.revokeToken(a);
    expect(tokens.verifyToken(a, 'h')).toBeNull();
    expect(tokens.verifyToken(b, 'h')).toBeTruthy();
    tokens.revokeAll();
    expect(tokens.verifyToken(b, 'h')).toBeNull();
  });

  test('the bookmark key is recoverable with the token only', () => {
    const key = crypto.randomBytes(32);
    const t = tokens.issueToken('h', { key, salt: 'salt1' });
    expect(fs.readFileSync(path.join(dir, 'auth-tokens.json'), 'utf8')).not.toContain(key.toString('base64'));
    expect(tokens.getBookmarkKeyForToken(t, 'salt1').equals(key)).toBe(true);
    expect(tokens.getBookmarkKeyForToken(t, 'other-salt')).toBeNull();
    expect(tokens.getBookmarkKeyForToken('f'.repeat(64), 'salt1')).toBeNull();
  });

  test('rewrap gives seen tokens the new key', () => {
    const t = tokens.issueToken('h', null);
    const key = crypto.randomBytes(32);
    tokens.rewrapBookmarkKey(key, 's2');
    expect(tokens.getBookmarkKeyForToken(t, 's2').equals(key)).toBe(true);
    tokens.rewrapBookmarkKey(null, null);
    expect(tokens.getBookmarkKeyForToken(t, 's2')).toBeNull();
  });
});

describe('crash guards', () => {
  const { guardSocket, guardExpressApp } = require('../../server/utils/safe-handlers');

  test('socket listeners that throw or reject are contained', async () => {
    const listeners = {};
    const socket = { on: (ev, fn) => { listeners[ev] = fn; } };
    guardSocket(socket);
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    socket.on('sync', (data) => data.sessionId);
    socket.on('async', async (data) => data.sessionId);
    expect(() => listeners.sync()).not.toThrow();
    await expect(listeners.async()).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  test('async route rejections go to next()', async () => {
    const routes = {};
    const app = { post: (p, ...h) => { routes[p] = h; }, get: (p, ...h) => { routes[p] = h; return 'setting'; } };
    guardExpressApp(app);
    expect(app.get('env')).toBe('setting');
    app.post('/x', async (req) => req.body.password.trim());
    const next = jest.fn();
    await routes['/x'][0]({ body: {} }, {}, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(expect.any(TypeError));
  });
});

describe('tab order validation', () => {
  test('non-array or junk orders cannot poison the server', () => {
    jest.resetModules();
    const tm = require('../../server/utils/tab-manager');
    tm.addTab('a', { type: 'ssh' });
    tm.addTab('b', { type: 'ssh' });
    tm.setTabOrder('x');
    expect(tm.getTabOrder()).toEqual(['a', 'b']);
    tm.setTabOrder([null, 5, 'b', 'b']);
    // unlisted live tab 'a' is kept at the end
    expect(tm.getTabOrder()).toEqual(['b', 'a']);
  });

  test('ended sessions are reported as closed, unknown ones are not', () => {
    jest.resetModules();
    const tm = require('../../server/utils/tab-manager');
    tm.addTab('s1', { type: 'ssh' });
    tm.removeTab('s1');
    expect(tm.wasRecentlyClosed('s1')).toBe(true);
    expect(tm.wasRecentlyClosed('never-seen')).toBe(false);
    tm.addTab('s1', { type: 'ssh' });
    expect(tm.wasRecentlyClosed('s1')).toBe(false);
  });
});
