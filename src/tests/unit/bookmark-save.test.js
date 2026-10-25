const fs = require('fs');
const path = require('path');

describe('bookmark writes over authenticated sockets and REST', () => {
  let config;
  let handlers;
  let routes;
  let socket;
  let io;
  let saveConfig;
  let encryption;
  let authenticated;

  beforeEach(() => {
    jest.resetModules();
    config = { bookmarks: [{ id: 'url-1', name: 'Link', type: 'url', url: 'https://old.example' }] };
    authenticated = true;
    saveConfig = jest.fn(() => true);
    jest.doMock('../../server/utils/config', () => ({
      loadConfig: () => config,
      saveConfig,
      isPasswordSet: () => true
    }));
    jest.doMock('../../server/endpoints/rest/auth', () => ({ isValidAuthToken: () => authenticated }));
    encryption = require('../../server/utils/bookmark-encryption');
    handlers = new Map();
    routes = new Map();
    socket = {
      handshake: { auth: { token: 'test-token' }, query: {} },
      on: (event, handler) => handlers.set(event, handler)
    };
    io = { emit: jest.fn() };
    require('../../server/endpoints/ws/bookmarks').registerBookmarkHandlers(socket, io);
    const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [
      method, (route, handler) => routes.set(`${method} ${route}`, handler)
    ]));
    require('../../server/endpoints/rest/bookmarks').registerBookmarkEndpoints(app, io);
  });

  afterEach(() => {
    encryption.clearBookmarkEncryptionKey();
    jest.dontMock('../../server/utils/config');
    jest.dontMock('../../server/endpoints/rest/auth');
  });

  test.each([false, true])('URL edits persist through both transports (encrypted=%s)', encrypted => {
    if (encrypted) {
      const prepared = encryption.prepareEncryptedBookmarks(config.bookmarks, 'test-password');
      config = { bookmarkEncryptionEnabled: true, bookmarks: prepared.bookmarks };
      encryption.setBookmarkEncryptionKey(prepared.key);
    }
    const ack = jest.fn();
    handlers.get('bookmark-save')({ id: 'url-1', bookmark: { url: 'https://socket.example' } }, ack);
    expect(ack).toHaveBeenCalledWith({ bookmark: expect.objectContaining({ id: 'url-1', url: 'https://socket.example' }) });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    routes.get('put /api/bookmarks/:id')({ params: { id: 'url-1' }, body: { url: 'https://rest.example' } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'url-1', url: 'https://rest.example' }));
    expect(encryption.getDecryptedBookmarks(config)[0].url).toBe('https://rest.example');
    if (encrypted) expect(JSON.stringify(config)).not.toContain('https://rest.example');
    expect(saveConfig).toHaveBeenCalledTimes(2);
  });

  test('expired authentication cannot write or broadcast', () => {
    authenticated = false;
    const ack = jest.fn();
    handlers.get('bookmark-save')({ id: 'url-1', bookmark: { url: 'https://new.example' } }, ack);
    expect(ack).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(saveConfig).not.toHaveBeenCalled();
    expect(io.emit).not.toHaveBeenCalled();
  });

  test('locked encryption, missing bookmarks and failed writes are reported without success broadcasts', () => {
    const ack = jest.fn();
    handlers.get('bookmark-save')({ id: 'missing', bookmark: {} }, ack);
    expect(ack).toHaveBeenLastCalledWith({ error: 'Bookmark not found' });
    config.bookmarkEncryptionEnabled = true;
    handlers.get('bookmark-save')({ id: 'url-1', bookmark: {} }, ack);
    expect(ack).toHaveBeenLastCalledWith({ error: 'Encrypted bookmarks are locked; sign in again' });
    config.bookmarkEncryptionEnabled = false;
    saveConfig.mockReturnValue(false);
    handlers.get('bookmark-save')({ id: 'url-1', bookmark: {} }, ack);
    expect(ack).toHaveBeenLastCalledWith({ error: 'Failed to save bookmark' });
    expect(io.emit).not.toHaveBeenCalled();
  });
});

describe('bookmark save client', () => {
  let client;
  let fetch;
  let emitWithAck;

  beforeEach(() => {
    const values = { bookmarkId: 'url-1', bookmarkName: 'Link', bookmarkType: 'url', bookmarkFolder: '', bookmarkUrl: 'https://new.example' };
    const document = {
      addEventListener: () => {},
      getElementById: id => ({ value: values[id] })
    };
    fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const source = fs.readFileSync(path.join(__dirname, '../../webapp/js/app.js'), 'utf8');
    const Client = new Function('document', 'fetch', source + '\nreturn SSHIFTClient;')(document, fetch);
    client = Object.create(Client.prototype);
    client.bookmarks = [{ id: 'url-1', url: 'https://old.example' }];
    emitWithAck = jest.fn(async () => ({ bookmark: { id: 'url-1', name: 'Link', type: 'url', url: 'https://new.example' } }));
    client.socket = { connected: true, timeout: () => ({ emitWithAck }) };
    client.renderBookmarks = jest.fn();
    client.showToast = jest.fn();
    client.closeModal = jest.fn();
    client.handleApiFetchError = jest.fn();
  });

  test('saves a URL using the existing socket when HTTPS fetch would fail', async () => {
    await client.saveBookmark();
    expect(fetch).not.toHaveBeenCalled();
    expect(emitWithAck).toHaveBeenCalledWith('bookmark-save', { id: 'url-1', bookmark: { name: 'Link', type: 'url', url: 'https://new.example' } });
    expect(client.bookmarks).toHaveLength(1);
    expect(client.bookmarks[0].url).toBe('https://new.example');
    expect(client.closeModal).toHaveBeenCalledWith('bookmarkModal');
    expect(client.handleApiFetchError).not.toHaveBeenCalled();
  });

  test('offline socket uses REST and updates the local bookmark without a second fetch', async () => {
    client.socket.connected = false;
    fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'url-1', url: 'https://new.example' }) });
    await client.saveBookmark();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/bookmarks/url-1', expect.objectContaining({ method: 'PUT' }));
    expect(client.closeModal).toHaveBeenCalledWith('bookmarkModal');
  });

  test('rapid saves send one request; timeout keeps the editor open without a misleading certificate dialog', async () => {
    let reject;
    emitWithAck.mockImplementation(() => new Promise((resolve, rejectRequest) => { reject = rejectRequest; }));
    const pending = client.saveBookmark();
    await client.saveBookmark();
    expect(emitWithAck).toHaveBeenCalledTimes(1);
    reject(new Error('operation has timed out'));
    await pending;
    expect(client.closeModal).not.toHaveBeenCalled();
    expect(client.showToast).toHaveBeenCalledWith('operation has timed out', 'error');
    expect(client.handleApiFetchError).not.toHaveBeenCalled();
    expect(client._savingBookmark).toBe(false);
  });
});
