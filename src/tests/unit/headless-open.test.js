/**
 * Server-side bookmark opening (no browser): the server connects the SSH
 * session with a stand-in socket, registers the tab, broadcasts tab-opened
 * WITHOUT credentials, and the first browser that joins gets control.
 */

const path = require('path');

const servicesDir = path.join(__dirname, '..', '..', 'server', 'services');
const utilsDir = path.join(__dirname, '..', '..', 'server', 'utils');

jest.mock('../../server/utils/config', () => ({
  loadConfig: () => ({ bookmarks: [] }),
  getStickySetting: () => true,
  getScrollback: () => 1000,
}));
jest.mock('../../server/utils/bookmark-encryption', () => ({ getDecryptedBookmarks: () => global.__bookmarks() }));

const sshManager = require(path.join(servicesDir, 'ssh-manager'));
const tabManager = require(path.join(utilsDir, 'tab-manager'));
const { openBookmarkHeadless } = require(path.join(servicesDir, 'headless-open'));

describe('openBookmarkHeadless', () => {
  let connectSpy, emitted, io;
  beforeEach(() => {
    global.__bookmarks = () => [
      { id: 'b1', name: 'levi', type: 'ssh', host: 'h', port: 22, username: 'u', password: 'secret' },
      { id: 'u1', name: 'docs', type: 'url', url: 'https://x' },
    ];
    emitted = [];
    io = { emit: (event, data) => emitted.push([event, data]) };
    connectSpy = jest.spyOn(sshManager, 'connect').mockImplementation(async (socket, options) => {
      sshManager.sessions.set('s-new', { id: 's-new', sockets: new Set([socket.id]), controllerSocket: socket.id, options });
      return 's-new';
    });
  });
  afterEach(() => {
    connectSpy.mockRestore();
    sshManager.sessions.delete('s-new');
    tabManager.removeTab('s-new');
  });

  test('connects on the server, registers the tab and never broadcasts credentials', async () => {
    const result = await openBookmarkHeadless(io, 'b1');
    expect(result).toEqual({ sessionId: 's-new', name: 'levi' });
    const options = connectSpy.mock.calls[0][1];
    expect(options).toMatchObject({ host: 'h', username: 'u', password: 'secret', cols: 120, rows: 36 });
    const session = sshManager.sessions.get('s-new');
    expect(session.sockets.size).toBe(0);
    expect(session.controllerSocket).toBeNull();
    expect(tabManager.getTab('s-new')).toMatchObject({ name: 'levi', type: 'ssh', sticky: true });
    const opened = emitted.find(([event]) => event === 'tab-opened')[1];
    expect(opened).toEqual({ sessionId: 's-new', name: 'levi', type: 'ssh', connectionData: { name: 'levi', host: 'h', port: 22, username: 'u' } });
    expect(JSON.stringify(emitted)).not.toContain('secret');
    expect(JSON.stringify(tabManager.getTab('s-new'))).not.toContain('secret');
  });

  test('refuses unknown, non-SSH and locked bookmarks; reports connection failures', async () => {
    await expect(openBookmarkHeadless(io, 'nope')).rejects.toMatchObject({ status: 404 });
    await expect(openBookmarkHeadless(io, 'u1')).rejects.toMatchObject({ status: 409 });
    global.__bookmarks = () => { throw Object.assign(new Error('locked'), { code: 'BOOKMARKS_LOCKED' }); };
    await expect(openBookmarkHeadless(io, 'b1')).rejects.toMatchObject({ status: 409 });
    global.__bookmarks = () => [{ id: 'b1', name: 'levi', type: 'ssh', host: 'h', username: 'u' }];
    connectSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(openBookmarkHeadless(io, 'b1')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('ECONNREFUSED') });
  });

  test('the first browser that joins a controller-less session gets control', () => {
    const session = { id: 's-new', sockets: new Set(), controllerSocket: null };
    sshManager.sessions.set('s-new', session);
    const socket = { id: 'browser-1', emit: jest.fn(), join: jest.fn() };
    expect(sshManager.joinSession(socket, 's-new')).toBe(true);
    expect(session.controllerSocket).toBe('browser-1');
    expect(socket.emit).toHaveBeenCalledWith('ssh-joined', expect.objectContaining({ isController: true }));
    const second = { id: 'browser-2', emit: jest.fn(), join: jest.fn() };
    sshManager.joinSession(second, 's-new');
    expect(session.controllerSocket).toBe('browser-1');
  });
});
