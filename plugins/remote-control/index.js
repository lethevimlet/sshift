/**
 * remote-control Plugin
 *
 * A small HTTP API for LOCAL automation, e.g. a voice assistant's MCP
 * server: list and switch tabs, open bookmarks, read a session's screen as
 * plain text, type text and send named keys.
 *
 * Security model:
 *   - Binds to a loopback address only (non-loopback `host` is refused).
 *   - Every request needs `Authorization: Bearer <token>`. The token lives in
 *     `<dataDir>/remote-control.token` (mode 0600), generated on first start.
 *     Anyone who can read that file can type into your sessions.
 *   - Text input never contains control characters. Multi-line text is only
 *     accepted when the target application enabled bracketed paste, so a
 *     newline can never execute a shell line on its own. Enter is a separate,
 *     explicit key request — callers decide when to submit.
 *   - Credentials are never returned (bookmarks are listed by name/type).
 *
 * Config (config.json → plugins[] entry "remote-control"):
 *   { "port": 8044, "host": "127.0.0.1", "tokenFile": "<optional path>" }
 *
 * Endpoints (JSON):
 *   GET  /v1/health
 *   GET  /v1/tabs                     → { activeSessionId, tabs: [...] }
 *   GET  /v1/bookmarks                → { bookmarks: [{ id, name, type, folder }] }
 *   GET  /v1/screen?sessionId=&history=N
 *   POST /v1/switch { sessionId }
 *   POST /v1/open   { bookmarkId }    → opens it on ONE connected browser
 *   POST /v1/type   { sessionId?, text }
 *   POST /v1/key    { sessionId?, key, repeat? }
 * sessionId defaults to the focused tab.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_BODY = 64 * 1024;
const MAX_TEXT = 8000;

// Named keys. Cursor keys depend on DECCKM (application cursor mode).
const KEYS = {
  enter: '\r',
  tab: '\t',
  'shift-tab': '\x1b[Z',
  escape: '\x1b',
  backspace: '\x7f',
  delete: '\x1b[3~',
  space: ' ',
  'ctrl-a': '\x01',
  'ctrl-c': '\x03',
  'ctrl-d': '\x04',
  'ctrl-e': '\x05',
  'ctrl-k': '\x0b',
  'ctrl-l': '\x0c',
  'ctrl-r': '\x12',
  'ctrl-u': '\x15',
  'ctrl-w': '\x17',
  'ctrl-z': '\x1a',
  'page-up': '\x1b[5~',
  'page-down': '\x1b[6~',
};
const CURSOR_KEYS = { up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F' };
const KEY_NAMES = [...Object.keys(KEYS), ...Object.keys(CURSOR_KEYS)];

// App hints so callers can find "the claude tab" or "the opencode tab".
// Case-sensitive wordmarks, mirroring the attention plugins' signatures.
const APP_PATTERNS = [
  ['claude', /\? for shortcuts|esc to interrupt|⏵⏵|accept edits on|bypass permissions on|shift\+tab to cycle|Claude Code/],
  ['opencode', /OpenCode|ctrl\+p commands/],
];

function detectApp(text) {
  if (!text) return null;
  const tail = text.lines.slice(-30).join('\n');
  for (const [app, pattern] of APP_PATTERNS) if (pattern.test(tail)) return app;
  return text.alternateScreen ? 'fullscreen' : 'shell';
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

class RemoteControlPlugin {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    this.server = null;
  }

  init() {
    const host = this.config.host || '127.0.0.1';
    const port = Number(this.config.port) || 8044;
    if (!LOOPBACK.has(host)) {
      console.error(`[remote-control] Refusing non-loopback host "${host}"; plugin disabled.`);
      return;
    }
    try {
      this.token = this._loadToken();
    } catch (err) {
      console.error('[remote-control] Cannot prepare token file:', err.message);
      return;
    }
    this.server = http.createServer((req, res) => this._handle(req, res));
    this.server.on('error', err => console.error('[remote-control] Server error:', err.message));
    this.server.listen(port, host, () => console.log(`[remote-control] Listening on http://${host}:${port}`));
  }

  destroy() {
    if (this.server) this.server.close();
    this.server = null;
  }

  _tokenFile() {
    return this.config.tokenFile || path.join(this.ctx.getDataDir(), 'remote-control.token');
  }

  _loadToken() {
    const file = this._tokenFile();
    try {
      const token = fs.readFileSync(file, 'utf8').trim();
      if (token.length >= 32) return token;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const token = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, token + '\n', { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    console.log(`[remote-control] Generated access token in ${file}`);
    return token;
  }

  _authorized(req) {
    const header = req.headers.authorization || '';
    const match = /^Bearer (\S+)$/.exec(header);
    if (!match || !this.token) return false;
    const a = Buffer.from(match[1]);
    const b = Buffer.from(this.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async _handle(req, res) {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      // Browsers must never drive this API (DNS rebinding / CSRF).
      if (req.headers.origin) throw new HttpError(403, 'Browser requests are not allowed');
      if (!this._authorized(req)) throw new HttpError(401, 'Unauthorized');
      const url = new URL(req.url, 'http://localhost');
      const route = `${req.method} ${url.pathname}`;
      const body = req.method === 'POST' ? await this._readBody(req) : {};
      switch (route) {
        case 'GET /v1/health': return send(200, { ok: true });
        case 'GET /v1/tabs': return send(200, this.tabs());
        case 'GET /v1/bookmarks': return send(200, { bookmarks: this.ctx.getBookmarks() });
        case 'GET /v1/screen': return send(200, this.screen(url.searchParams.get('sessionId'), url.searchParams.get('history')));
        case 'POST /v1/switch': return send(200, this.switchTab(body.sessionId));
        case 'POST /v1/open': return send(200, await this.open(body.bookmarkId));
        case 'POST /v1/type': return send(200, await this.type(body.sessionId, body.text));
        case 'POST /v1/key': return send(200, await this.key(body.sessionId, body.key, body.repeat));
        default: throw new HttpError(404, 'Not found');
      }
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error('[remote-control] Request failed:', err.message);
      send(status, { error: status === 500 ? 'Internal error' : err.message });
    }
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'Body too large')); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          resolve(value);
        } catch { reject(new HttpError(400, 'Invalid JSON body')); }
      });
      req.on('error', reject);
    });
  }

  tabs() {
    const { activeSessionId, tabs } = this.ctx.getTabs();
    return {
      activeSessionId,
      tabs: tabs.map(tab => ({
        ...tab,
        focused: tab.sessionId === activeSessionId,
        app: tab.type === 'ssh' && tab.connected ? detectApp(this.ctx.getTerminalText(tab.sessionId)) : null,
      })),
    };
  }

  _target(sessionId) {
    const { activeSessionId, tabs } = this.ctx.getTabs();
    let id = sessionId;
    if (!id) {
      const ssh = tabs.filter(t => t.type === 'ssh' && t.connected);
      id = activeSessionId || (ssh.length === 1 ? ssh[0].sessionId : null);
      if (!id) throw new HttpError(409, 'No focused tab; specify sessionId');
    }
    const tab = tabs.find(t => t.sessionId === id);
    if (!tab) throw new HttpError(404, 'Tab not found');
    if (tab.type !== 'ssh') throw new HttpError(409, 'Only SSH terminal tabs accept input');
    if (!tab.connected) throw new HttpError(409, 'The tab is not connected');
    return tab;
  }

  screen(sessionId, history) {
    const tab = this._target(sessionId);
    const text = this.ctx.getTerminalText(tab.sessionId, { history: Math.min(Number(history) || 0, 500) });
    if (!text) throw new HttpError(409, 'Screen unavailable');
    return { sessionId: tab.sessionId, name: tab.name, app: detectApp(text), ...text };
  }

  switchTab(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) throw new HttpError(400, 'sessionId required');
    if (!this.ctx.switchTab(sessionId)) throw new HttpError(404, 'Tab not found');
    const tab = this.ctx.getTabs().tabs.find(t => t.sessionId === sessionId);
    return { switched: true, sessionId, name: tab?.name || null };
  }

  async open(bookmarkId) {
    const bookmark = this.ctx.getBookmarks().find(b => b.id === bookmarkId);
    if (!bookmark) throw new HttpError(404, 'Bookmark not found');
    if (!['ssh', 'sftp'].includes(bookmark.type)) throw new HttpError(409, 'Only SSH/SFTP bookmarks can be opened');
    const before = new Set(this.ctx.getTabs().tabs.map(t => t.sessionId));
    const claim = await this.ctx.requestClientAction('remote-open-bookmark', { bookmarkId });
    if (!claim.claimed) {
      throw new HttpError(409, 'No sshift browser page is open to connect the bookmark; open sshift first');
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const tab = this.ctx.getTabs().tabs.find(t => !before.has(t.sessionId));
      if (tab) {
        // The opening client's tabs-save can arrive before the tab exists on
        // the server, leaving no focused session; focus the new tab here.
        this.ctx.switchTab(tab.sessionId);
        return { opened: true, sessionId: tab.sessionId, name: tab.name, connected: tab.connected };
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return { opened: true, sessionId: null, name: bookmark.name, pending: true };
  }

  async _inputLine(sessionId) {
    await new Promise(resolve => setTimeout(resolve, 150));
    const text = this.ctx.getTerminalText(sessionId);
    if (!text) return null;
    return (text.lines[text.cursorLine] || '').trimEnd().slice(-300);
  }

  async type(sessionId, text) {
    if (typeof text !== 'string' || !text.length) throw new HttpError(400, 'text required');
    if (text.length > MAX_TEXT) throw new HttpError(413, 'text too long');
    const normalized = text.replace(/\r\n?/g, '\n');
    if (/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(normalized)) {
      throw new HttpError(400, 'text must not contain control characters; use /v1/key for keys');
    }
    const tab = this._target(sessionId);
    const multiLine = normalized.includes('\n');
    let data = normalized;
    if (multiLine) {
      const screen = this.ctx.getTerminalText(tab.sessionId);
      if (!screen || !screen.bracketedPaste) {
        throw new HttpError(409, 'This application does not accept pasted multi-line text; send one line at a time');
      }
      data = `\x1b[200~${normalized}\x1b[201~`;
    }
    this.ctx.sendInput(tab.sessionId, data);
    return { typed: true, sessionId: tab.sessionId, name: tab.name, pasted: multiLine, submitted: false, inputLine: await this._inputLine(tab.sessionId) };
  }

  async key(sessionId, key, repeat = 1) {
    if (!KEY_NAMES.includes(key)) throw new HttpError(400, `Unknown key; use one of: ${KEY_NAMES.join(', ')}`);
    const times = Number.isInteger(repeat) ? repeat : 1;
    if (times < 1 || times > 20) throw new HttpError(400, 'repeat must be 1-20');
    const tab = this._target(sessionId);
    let sequence = KEYS[key];
    if (!sequence) {
      const screen = this.ctx.getTerminalText(tab.sessionId);
      sequence = (screen && screen.applicationCursorKeys ? '\x1bO' : '\x1b[') + CURSOR_KEYS[key];
    }
    this.ctx.sendInput(tab.sessionId, sequence.repeat(times));
    return { sent: true, sessionId: tab.sessionId, name: tab.name, key, repeat: times, inputLine: await this._inputLine(tab.sessionId) };
  }
}

RemoteControlPlugin.KEY_NAMES = KEY_NAMES;
RemoteControlPlugin.detectApp = detectApp;
module.exports = RemoteControlPlugin;
