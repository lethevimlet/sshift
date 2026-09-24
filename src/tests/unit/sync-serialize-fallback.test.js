/**
 * Regression tests for the screen-sync serialization fallback.
 *
 * Bug: when a session's full scrollback serialized above the size cap the
 * server tried `serialize({ mode: 'normal' })` as a "viewport-only"
 * fallback. `mode` is not a SerializeAddon option, so that call returned
 * the identical full payload, tripped the second cap and the sync was
 * skipped entirely (`noTerminalState: true`). A browser joining a
 * long-running session (a fresh window, a reload, a take-control) then
 * received NO screen state and only saw the live stream from that point
 * on: line-diff TUIs never repaint rows they consider unchanged, so the
 * screen stayed a mix of painted and black rows until a resize forced a
 * full repaint — the "alternating text/black lines in a new window" bug.
 *
 * Fix: _serializeForSync() shrinks the scrollback in tiers (full → 2000 →
 * 500 → 100 → viewport only) and always returns the viewport tier, which
 * is a few KB.
 */

const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const SSHManager = require('../../server/services/ssh-manager');

function makeSession({ cols = 160, rows = 40, lines = 6000, altScreen = false } = {}) {
  const terminal = new Terminal({ cols, rows, scrollback: 10000, allowProposedApi: true, logLevel: 'off' });
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(serializeAddon);
  let out = '';
  for (let i = 0; i < lines; i++) {
    out += `\x1b[38;2;200;200;200mline ${i} \x1b[48;2;40;40;40m${'x'.repeat(cols - 20)}\x1b[0m\r\n`;
  }
  if (altScreen) {
    out += '\x1b[?1049h\x1b[H';
    for (let r = 1; r <= rows; r++) out += `\x1b[${r};1H\x1b[44mTUI ROW ${r} ${'#'.repeat(cols - 12)}\x1b[0m`;
  }
  return new Promise((resolve) => {
    terminal.write(out, () => resolve({ terminal, serializeAddon, cols, rows }));
  });
}

function manager() {
  // The service module exports a singleton instance in some versions and a
  // class in others — support both.
  return (typeof SSHManager === 'function') ? new SSHManager() : SSHManager;
}

describe('screen-sync serialization fallback (_serializeForSync)', () => {
  jest.setTimeout(20000);

  test('small sessions are sent with the full scrollback (partial: false)', async () => {
    const m = manager();
    const session = await makeSession({ lines: 50 });
    const snap = m._serializeForSync(session, 512 * 1024);
    expect(snap).not.toBeNull();
    expect(snap.partial).toBe(false);
    expect(snap.state).toContain('line 0 ');
    expect(snap.state).toContain('line 49 ');
    session.terminal.dispose();
  });

  test('oversized scrollback falls back to a trimmed tier instead of returning null', async () => {
    const m = manager();
    const session = await makeSession({ lines: 6000 });
    const full = session.serializeAddon.serialize();
    // Pick a cap the full history cannot satisfy but a trimmed tier can.
    const cap = Math.floor(full.length / 4);
    const snap = m._serializeForSync(session, cap);
    expect(snap).not.toBeNull();
    expect(snap.partial).toBe(true);
    expect(snap.state.length).toBeLessThanOrEqual(cap);
    // The most recent output is always preserved.
    expect(snap.state).toContain('line 5999 ');
    session.terminal.dispose();
  });

  test('the viewport tier is always returned even under a tiny cap', async () => {
    const m = manager();
    const session = await makeSession({ lines: 3000 });
    const snap = m._serializeForSync(session, 1);
    expect(snap).not.toBeNull();
    expect(snap.partial).toBe(true);
    expect(snap.scrollbackLines).toBe(0);
    expect(snap.state).toContain('line 2999 ');
    session.terminal.dispose();
  });

  test('a full-screen TUI on the alternate buffer keeps its screen in every tier', async () => {
    const m = manager();
    const session = await makeSession({ lines: 5000, altScreen: true });
    const snap = m._serializeForSync(session, 1);
    expect(snap).not.toBeNull();
    expect(snap.state).toContain('\x1b[?1049h');
    expect(snap.state).toContain('TUI ROW 1 ');
    expect(snap.state).toContain(`TUI ROW ${session.rows} `);
    session.terminal.dispose();
  });

  test('getTerminalState() never returns null for an existing session with a huge history', async () => {
    const m = manager();
    const session = await makeSession({ lines: 9000, cols: 200 });
    m.sessions.set('big', session);
    const state = m.getTerminalState('big');
    expect(state).not.toBeNull();
    expect(state.cols).toBe(200);
    expect(state.rows).toBe(40);
    expect(typeof state.partial).toBe('boolean');
    m.sessions.delete('big');
    session.terminal.dispose();
  });

  test('hasSession() distinguishes a missing session from a failed serialization', () => {
    const m = manager();
    expect(m.hasSession('nope')).toBe(false);
    m.sessions.set('yes', {});
    expect(m.hasSession('yes')).toBe(true);
    m.sessions.delete('yes');
  });
});
