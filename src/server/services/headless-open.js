/**
 * Open an SSH bookmark on the SERVER, without any browser page.
 *
 * Used by automation (the remote-control plugin → voice assistants): the
 * server connects the bookmark itself with a stand-in socket, registers the
 * tab, and tells every connected browser through the normal `tab-opened`
 * broadcast, so open pages attach exactly as they do for a tab opened on
 * another device. Pages opened later get it through `open-tabs`.
 *
 * Credentials are read from the stored bookmark on the server; they are never
 * broadcast (the browsers only receive name/host/port/username). Encrypted
 * bookmarks work only while the server holds the unlock key (after a login).
 */

const crypto = require('crypto');
const { loadConfig, getStickySetting, getScrollback } = require('../utils/config');
const { getDecryptedBookmarks } = require('../utils/bookmark-encryption');
const tabManager = require('../utils/tab-manager');
const sshManager = require('./ssh-manager');

// Size of the server-side terminal until a browser attaches and resizes it.
// Wider than the 80x24 default so coding agents (Claude Code, opencode) and
// screen reads by the assistant are not cramped.
const HEADLESS_COLS = 120;
const HEADLESS_ROWS = 36;

class HeadlessOpenError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A Socket.IO-shaped object that receives nothing: the session's output goes to
// the `session-<id>` room (browsers that join later) and to the headless terminal.
function standInSocket() {
  const noop = () => {};
  return { id: `headless-${crypto.randomUUID()}`, emit: noop, join: noop, leave: noop, to: () => ({ emit: noop }) };
}

async function openBookmarkHeadless(io, bookmarkId, { cols = HEADLESS_COLS, rows = HEADLESS_ROWS } = {}) {
  const config = loadConfig();
  let bookmarks;
  try {
    bookmarks = getDecryptedBookmarks(config);
  } catch (err) {
    if (err.code === 'BOOKMARKS_LOCKED') throw new HeadlessOpenError(409, 'Bookmarks are encrypted and locked; log in to sshift once to unlock them');
    throw err;
  }
  const bookmark = bookmarks.find(b => b.id === bookmarkId);
  if (!bookmark) throw new HeadlessOpenError(404, 'Bookmark not found');
  if ((bookmark.type || 'ssh') !== 'ssh') throw new HeadlessOpenError(409, 'Only SSH bookmarks can be opened without a browser');

  const name = bookmark.name || bookmark.host || 'SSH';
  const publicData = { name, host: bookmark.host, port: bookmark.port || 22, username: bookmark.username };
  const socket = standInSocket();
  let sessionId;
  try {
    sessionId = await sshManager.connect(socket, {
      ...publicData,
      password: bookmark.password || '',
      privateKey: bookmark.privateKey || '',
      passphrase: bookmark.passphrase || '',
      cols, rows,
      sshKeepaliveInterval: config.sshKeepaliveInterval || 10000,
      sshKeepaliveCountMax: config.sshKeepaliveCountMax || 1000,
      scrollback: getScrollback()
    });
  } catch (err) {
    throw new HeadlessOpenError(502, `Could not connect ${name}: ${err.message}`);
  }

  // Nobody is attached: no controller, so the first browser that joins gets control.
  const session = sshManager.sessions.get(sessionId);
  if (session) {
    session.sockets.delete(socket.id);
    if (session.controllerSocket === socket.id) session.controllerSocket = null;
  }
  tabManager.addTab(sessionId, {
    name,
    type: 'ssh',
    connectionData: publicData,
    activeSockets: new Set(),
    sticky: getStickySetting(),
    openedHeadless: true
  });
  if (io) {
    io.emit('tab-opened', { sessionId, name, type: 'ssh', connectionData: publicData });
    io.emit('sessions-updated');
  }
  return { sessionId, name };
}

module.exports = { openBookmarkHeadless, HeadlessOpenError, HEADLESS_COLS, HEADLESS_ROWS };
