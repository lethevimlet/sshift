/**
 * Regression tests for:
 *   Bug 2 — SFTP download: `stats.isDirectory is not a function`
 *
 * Root cause: `sftpManager.stat()` was normalizing the ssh2 Stats object
 * into a plain JS object with BOOLEAN properties `isDirectory` / `isFile`.
 * The SFTP download handler at src/server/endpoints/ws/sftp.js:144 then
 * called `stats.isDirectory()` as a METHOD — crashing the WebSocket
 * handler before any file download could begin.
 *
 * Fix: `sftpManager.stat()` now returns an object with `isDirectory()` /
 * `isFile()` as METHODS (delegating to the underlying ssh2 Stats object),
 * plus scalar-aliased fields (`isDirectoryValue` / `isFileValue` /
 * `size` / `modifyTime`) for callers that already read those as values.
 *
 * These tests drive `sftpManager.stat()` directly with a mock ssh2 sftp
 * session so they run with no live SSH server.
 */

describe('Bug 2: sftpManager.stat() returns callable isDirectory / isFile', () => {
  let sftpManager;

  beforeEach(() => {
    jest.resetModules();
    sftpManager = require('../../server/services').sftpManager;
    // Clear any stale state from prior tests (it's a singleton).
    for (const [sid] of sftpManager.sessions) {
      try { sftpManager.disconnect(sid); } catch (_) {}
    }
  });

  afterEach(() => {
    for (const [sid] of sftpManager.sessions) {
      try { sftpManager.disconnect(sid); } catch (_) {}
    }
  });

  // Inject a fake session whose `sftp.stat` returns a Stats-like object
  // with `isDirectory()` / `isFile()` methods (ssh2's Stats API).
  function injectMockSession(sessionId, mode = 'file' /* | 'dir' */) {
    const fakeStats = {
      size: 4096,
      mtime: 1700000000,
      isDirectory: () => mode === 'dir',
      isFile: () => mode === 'file'
    };
    sftpManager.sessions.set(sessionId, {
      sftp: {
        stat: (path, cb) => cb(null, fakeStats)
      },
      conn: { end: () => {} }
    });
  }

  test('stat() returns an object exposing isDirectory() as a callable method (file case)', async () => {
    injectMockSession('sftp-stat-1', 'file');
    const stats = await sftpManager.stat('sftp-stat-1', '/some/file.txt');
    expect(typeof stats.isDirectory).toBe('function');
    expect(typeof stats.isFile).toBe('function');
    expect(stats.isDirectory()).toBe(false);
    expect(stats.isFile()).toBe(true);
  });

  test('stat() returns an object exposing isDirectory() as a callable method (dir case)', async () => {
    injectMockSession('sftp-stat-2', 'dir');
    const stats = await sftpManager.stat('sftp-stat-2', '/some/dir/');
    expect(stats.isDirectory()).toBe(true);
    expect(stats.isFile()).toBe(false);
  });

  test('stat() still exposes scalar fields for backward compatibility', async () => {
    injectMockSession('sftp-stat-3', 'file');
    const stats = await sftpManager.stat('sftp-stat-3', '/some/file.bin');
    // Scalar fields used by the file-listing renderer:
    expect(stats.size).toBe(4096);
    expect(stats.modifyTime).toBe(1700000000 * 1000);
    expect(stats.isDirectoryValue).toBe(false);
    expect(stats.isFileValue).toBe(true);
  });

  test('sftp-download workflow: directory check does NOT throw on stats.isDirectory()', async () => {
    // Replicates the code shape in src/server/endpoints/ws/sftp.js:144
    // — this is the exact expression that used to throw.
    injectMockSession('sftp-stat-4', 'file');
    const stats = await sftpManager.stat('sftp-stat-4', '/path/to/download.txt');
    expect(() => stats.isDirectory()).not.toThrow();
    expect(stats.isDirectory()).toBe(false);
  });

  test('sftp-download workflow: directory download is correctly rejected', async () => {
    injectMockSession('sftp-stat-5', 'dir');
    const stats = await sftpManager.stat('sftp-stat-5', '/path/to/dir/');
    // The download handler should branch into "Cannot download a directory"
    // rather than crashing — this is the contract preserved by the fix.
    const wouldDownloadFile = !stats.isDirectory();
    expect(wouldDownloadFile).toBe(false);
  });
});