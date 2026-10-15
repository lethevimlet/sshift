const crypto = require('crypto');

describe('bookmark connection encryption', () => {
  let encryption;

  beforeEach(() => {
    jest.resetModules();
    encryption = require('../../server/utils/bookmark-encryption');
    encryption.clearBookmarkEncryptionKey();
  });

  afterEach(() => {
    encryption.clearBookmarkEncryptionKey();
    jest.dontMock('../../server/utils/config');
  });

  const bookmark = {
    id: 'bookmark-1',
    name: 'Production',
    type: 'ssh',
    folderId: 'work',
    host: 'private.example.com',
    port: 2222,
    username: 'deploy',
    password: 'secret-password',
    privateKey: 'PRIVATE KEY DATA',
    passphrase: 'key-secret'
  };

  test('stores connection fields as authenticated ciphertext and preserves metadata', () => {
    const prepared = encryption.prepareEncryptedBookmarks([bookmark], 'app-password');
    const stored = prepared.bookmarks[0];
    const serialized = JSON.stringify(stored);

    expect(stored).toMatchObject({
      id: bookmark.id,
      name: bookmark.name,
      type: bookmark.type,
      folderId: bookmark.folderId
    });
    expect(stored.encryptedConnection).toMatchObject({ version: 1 });
    expect(serialized).not.toContain(bookmark.host);
    expect(serialized).not.toContain(bookmark.username);
    expect(serialized).not.toContain(bookmark.password);
    expect(serialized).not.toContain(bookmark.privateKey);

    expect(encryption.decryptBookmarks(prepared.bookmarks, prepared.key)).toEqual([bookmark]);
  });

  test('rejects the wrong password and ciphertext moved to another bookmark id', () => {
    const prepared = encryption.prepareEncryptedBookmarks([bookmark], 'correct-password');
    const wrongKey = encryption.deriveKey('wrong-password', prepared.salt);
    expect(() => encryption.decryptBookmarks(prepared.bookmarks, wrongKey)).toThrow();

    const moved = [{ ...prepared.bookmarks[0], id: 'bookmark-2' }];
    expect(() => encryption.decryptBookmarks(moved, prepared.key)).toThrow();
  });

  test('requires the in-memory key for encrypted bookmark access', () => {
    const prepared = encryption.prepareEncryptedBookmarks([bookmark], 'app-password');
    const config = {
      bookmarkEncryptionEnabled: true,
      bookmarkEncryptionSalt: prepared.salt,
      bookmarks: prepared.bookmarks
    };

    expect(() => encryption.getDecryptedBookmarks(config)).toThrow(encryption.BookmarkEncryptionLockedError);
    encryption.unlockBookmarkEncryption(config, 'app-password');
    expect(encryption.getDecryptedBookmarks(config)).toEqual([bookmark]);
    encryption.clearBookmarkEncryptionKey();
    expect(() => encryption.getDecryptedBookmarks(config)).toThrow(encryption.BookmarkEncryptionLockedError);
  });

  test('password endpoints encrypt on enable and decrypt before password removal', async () => {
    let config = {
      passwordHash: null,
      bookmarkEncryptionEnabled: false,
      bookmarkEncryptionSalt: null,
      bookmarks: [{ ...bookmark }]
    };
    const hashPassword = password => {
      const salt = Buffer.alloc(16, 1);
      const hash = crypto.scryptSync(password, salt, 32);
      return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
    };
    const verifyPasswordAsync = async password => {
      if (!config.passwordHash) return true;
      const [, salt, expected] = config.passwordHash.split('$');
      return crypto.scryptSync(password, Buffer.from(salt, 'base64'), 32)
        .equals(Buffer.from(expected, 'base64'));
    };
    jest.doMock('../../server/utils/config', () => ({
      hashPassword,
      isPasswordSet: () => !!config.passwordHash,
      loadConfig: () => config,
      saveConfig: next => { config = next; return true; },
      verifyPasswordAsync
    }));

    const { registerAuthEndpoints } = require('../../server/endpoints/rest/auth');
    const routes = new Map();
    const app = {
      get: (route, handler) => routes.set(`GET ${route}`, handler),
      post: (route, handler) => routes.set(`POST ${route}`, handler)
    };
    registerAuthEndpoints(app, {});

    const makeResponse = () => ({
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    });

    const enableResponse = makeResponse();
    await routes.get('POST /api/auth/set-password')({
      body: { newPassword: 'app-password', encryptBookmarks: true }
    }, enableResponse);
    expect(enableResponse.statusCode).toBe(200);
    expect(config.bookmarkEncryptionEnabled).toBe(true);
    expect(JSON.stringify(config.bookmarks)).not.toContain(bookmark.host);

    const removeResponse = makeResponse();
    await routes.get('POST /api/auth/remove-password')({
      body: { currentPassword: 'app-password' }
    }, removeResponse);
    expect(removeResponse.statusCode).toBe(200);
    expect(config.passwordHash).toBeNull();
    expect(config.bookmarkEncryptionEnabled).toBe(false);
    expect(config.bookmarks).toEqual([bookmark]);
  });
});
