/**
 * Tests for the opencode-attention and claude-attention plugins.
 *
 * The old implementations were text-pattern based and fired on generic
 * strings ("❯ ", "(y/n)", "press enter", "allow", ...) that routinely
 * appear in shell prompts, chat prose and code — with a sticky app flag
 * that never reset after the app exited. Result: tabs flashed at plain
 * shell prompts and while the user was typing.
 *
 * The new engine flashes ONLY on a working → idle transition, verified
 * against the live viewport, with non-sticky app detection and user-input
 * awareness. These tests drive the engine with a fake plugin context and
 * fake timers, covering the old false-positive scenarios and the intended
 * transitions.
 */

const path = require('path');

const OpenCodePlugin = require(path.join(__dirname, '..', '..', '..', 'plugins', 'opencode-attention', 'index.js'));
const ClaudePlugin = require(path.join(__dirname, '..', '..', '..', 'plugins', 'claude-attention', 'index.js'));

const SID = 'ssh-test-1';

function makeCtx() {
  const ctx = {
    flashes: [],
    stops: [],
    screenLines: [],
    screenRows: 24,
    // Set to true to emulate a busy session where the full-scrollback
    // serialization blows past its 1MB guard and returns null.
    stateTooLarge: false,
    // Raw override for the viewport string (alternate-buffer tests).
    rawViewport: null,
    setScreen(lines, rows = 24) {
      ctx.screenLines = lines;
      ctx.screenRows = rows;
      ctx.rawViewport = null;
    },
    flashTab(sessionId, options) { ctx.flashes.push({ sessionId, options, at: Date.now() }); },
    stopFlashTab(sessionId) { ctx.stops.push({ sessionId, at: Date.now() }); },
    _screenState() {
      if (ctx.rawViewport !== null) {
        return { state: ctx.rawViewport, rows: ctx.screenRows, cols: 80 };
      }
      // Pad to a full viewport like the serialized state does.
      const lines = [...ctx.screenLines];
      while (lines.length < ctx.screenRows) lines.unshift('');
      return { state: lines.join('\n'), rows: ctx.screenRows, cols: 80 };
    },
    getTerminalViewport() { return ctx._screenState(); },
    getTerminalState() { return ctx.stateTooLarge ? null : ctx._screenState(); },
    getActiveSessions() { return [SID]; },
    getConfig() { return {}; },
    getPluginConfig() { return {}; },
    emitToSession() {}, emitToAll() {}, writeToSession() {}
  };
  return ctx;
}

// Simulate an agent streaming burst: several sizable chunks over ~1s.
function streamBurst(plugin, bytes = 800, chunks = 4) {
  for (let i = 0; i < chunks; i++) {
    plugin.onData(SID, 'x'.repeat(Math.ceil(bytes / chunks)));
    jest.advanceTimersByTime(250);
  }
}

// OpenCode screens
const OC_IDLE = [
  '│ some reply text from the agent',
  '│ more text',
  '',
  '┃ ❯ ',
  'Build auto · Claude Fable 5 Anthropic · max',
  '/root/project        349.6K (35%) · $52.14  ctrl+p commands · OpenCode 1.18.15'
];
const OC_WORKING = [
  '│ some reply text from the agent',
  '⠹ working... esc to interrupt',
  '',
  '┃ ❯ ',
  'Build auto · Claude Fable 5 Anthropic · max',
  '/root/project        349.6K (35%) · $52.14  ctrl+p commands · OpenCode 1.18.15'
];
const SHELL = [
  'user@host:~/opencode$ ls',
  'index.js  package.json  README.md',
  'Type "make install" and press enter to continue (y/n)',
  '❯ ~/projects/opencode git:(main)'
];

// Claude screens
const CL_WORKING = [
  '● Working on the refactor...',
  '✻ Deliberating… (12s · ↓ 2.1k tokens · esc to interrupt)',
  '╭──────────────────────────────╮',
  '│ ❯                            │',
  '╰──────────────────────────────╯',
  '  ? for shortcuts'
];
const CL_IDLE = [
  '● Done! I refactored the module.',
  '',
  '╭──────────────────────────────╮',
  '│ ❯                            │',
  '╰──────────────────────────────╯',
  '  ? for shortcuts'
];

describe('opencode-attention plugin', () => {
  let ctx, plugin;

  beforeEach(() => {
    jest.useFakeTimers();
    ctx = makeCtx();
    plugin = new OpenCodePlugin(ctx, {});
    plugin.onSessionConnect(SID);
  });

  afterEach(() => {
    plugin.onSessionDisconnect(SID);
    jest.useRealTimers();
  });

  test('REGRESSION: never flashes at a shell prompt with ❯ / (y/n) / "opencode" text', () => {
    ctx.setScreen(SHELL);
    // Long-running shell command output: big agent-like bursts with no typing.
    for (let i = 0; i < 5; i++) {
      streamBurst(plugin, 2000, 4);
      jest.advanceTimersByTime(3000);
    }
    // Lots of idle time and periodic checks.
    jest.advanceTimersByTime(30000);
    expect(ctx.flashes).toHaveLength(0);
  });

  test('flashes exactly once when a working episode ends (spinner path)', () => {
    ctx.setScreen(OC_WORKING);
    // User sends a message, agent starts.
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 3000, 6);
    jest.advanceTimersByTime(500);
    expect(ctx.flashes).toHaveLength(0); // still working

    // Agent finishes: spinner gone, output stops.
    ctx.setScreen(OC_IDLE);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);

    // No repeat flashing while it stays idle.
    jest.advanceTimersByTime(30000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('flashes when a permission dialog appears after working (no prompt patterns needed)', () => {
    ctx.setScreen(OC_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 2000, 4);

    // Dialog: working indicator gone, question shown, output stops.
    ctx.setScreen([
      '│ I need to run: rm -rf ./dist',
      '│ Allow this command?',
      '│  ❯ Yes   No',
      '┃ ❯ ',
      '/root/project  ctrl+p commands · OpenCode 1.18.15'
    ]);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('does not flash while working, even during long quiet thinking with spinner visible', () => {
    ctx.setScreen(OC_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 1000, 2);
    // Long thinking: no output, but the spinner stays on screen — the
    // periodic viewport check must keep the session in working state
    // (up to workStaleMs, see the frozen-screen test below).
    jest.advanceTimersByTime(45000);
    expect(ctx.flashes).toHaveLength(0);
  });

  test('user input stops an active flash and suppresses re-flash (cooldown)', () => {
    ctx.setScreen(OC_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 2000, 4);
    ctx.setScreen(OC_IDLE);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);

    // User comes back and types.
    plugin.onUserInput(SID, 'h');
    expect(ctx.stops).toHaveLength(1);

    // Idle evaluations right after must not re-flash.
    jest.advanceTimersByTime(2000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('typing at an idle OpenCode input box never flashes', () => {
    ctx.setScreen(OC_IDLE);
    jest.advanceTimersByTime(5000); // app detected, idle
    // User types a long message: keystrokes + small echo repaints.
    for (let i = 0; i < 40; i++) {
      plugin.onUserInput(SID, 'a');
      plugin.onData(SID, '\x1b[7;5H┃ ❯ aaaa'); // small UI echo
      jest.advanceTimersByTime(300);
    }
    jest.advanceTimersByTime(20000);
    expect(ctx.flashes).toHaveLength(0);
  });

  test('exiting OpenCode mid-episode does not flash at the shell', () => {
    ctx.setScreen(OC_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 2000, 4);

    // Quitting always goes through keystrokes (ctrl+c, /exit, ctrl+d) and
    // those drop the working episode — that is what keeps the shell quiet.
    plugin.onUserInput(SID, '\x03');
    plugin.onUserInput(SID, 'exit\r');

    // Shell prompt now on screen (no wordmark).
    ctx.setScreen(SHELL.slice(0, 2).concat(['user@host:~$ ']));
    jest.advanceTimersByTime(30000);
    expect(ctx.flashes).toHaveLength(0);

    // And plain shell output afterwards can't arm a new episode either.
    streamBurst(plugin, 5000, 8);
    jest.advanceTimersByTime(30000);
    expect(ctx.flashes).toHaveLength(0);
  });

  test('REGRESSION: still works when the full-scrollback state is too large', () => {
    // getTerminalState() returns null for busy sessions (>1MB serialized);
    // the plugin must read the viewport-only accessor instead of going blind.
    ctx.stateTooLarge = true;
    ctx.setScreen(OC_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 3000, 6);

    ctx.setScreen(OC_IDLE);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('reads the alternate screen buffer, not the scrolled-away shell below it', () => {
    // Serialized state = normal buffer + `\x1b[?1049h` + alt buffer (the
    // full-screen TUI). Only the part after the marker is on screen.
    const alt = (lines) => 'user@host:~$ opencode\n' + SHELL.join('\n') +
      '\x1b[?1049h\x1b[H' + lines.join('\n');

    ctx.rawViewport = alt(OC_WORKING);
    plugin.onUserInput(SID, '\r');
    plugin.onData(SID, '⠹ working... esc interrupt'); // TUI repaint
    jest.advanceTimersByTime(2000);
    expect(plugin._getSessionState(SID).working).toBe(true);

    ctx.rawViewport = alt(OC_IDLE);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('REGRESSION: a transition suppressed by the input cooldown is retried, not lost', () => {
    ctx.setScreen(OC_WORKING);
    jest.advanceTimersByTime(2000); // app detected + working

    // User types a follow-up while the agent is still running: that starts
    // a cooldown. The agent keeps working for a moment, then finishes
    // INSIDE the cooldown window — the old engine dropped the event.
    plugin.onUserInput(SID, 'hi\r');
    jest.advanceTimersByTime(100);
    plugin.onData(SID, '⠹ working... esc to interrupt');
    ctx.setScreen(OC_IDLE);

    jest.advanceTimersByTime(2600); // idle threshold met, still in cooldown
    expect(ctx.flashes).toHaveLength(0);

    jest.advanceTimersByTime(4000); // cooldown over -> queued flash goes out
    expect(ctx.flashes).toHaveLength(1);
  });

  test('REGRESSION: a second episode flashes again even if the client never reported the first', () => {
    ctx.setScreen(OC_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 2000, 4);
    ctx.setScreen(OC_IDLE);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);

    // No user input, no stop event: the client cleared the highlight on its
    // own (tab was visible). A new working -> idle cycle must flash again.
    ctx.setScreen(OC_WORKING);
    jest.advanceTimersByTime(4000);
    ctx.setScreen(OC_IDLE);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(2);
  });

  test('onSessionFocus clears the flash so later episodes can flash again', () => {
    ctx.setScreen(OC_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 2000, 4);
    ctx.setScreen(OC_IDLE);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);

    plugin.onSessionFocus(SID);
    expect(ctx.stops).toHaveLength(1);
    expect(plugin._flashing.get(SID)).toBeUndefined();

    ctx.setScreen(OC_WORKING);
    jest.advanceTimersByTime(4000);
    ctx.setScreen(OC_IDLE);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(2);
  });

  test('custom attention patterns from config still work (footer, idle only)', () => {
    plugin.onSessionDisconnect(SID);
    plugin = new OpenCodePlugin(ctx, { patterns: ['Deploy to production\\?'] });
    plugin.onSessionConnect(SID);

    ctx.setScreen(OC_IDLE.slice(0, -2).concat([
      'Deploy to production? (this is a custom prompt)',
      '/root/project  ctrl+p commands · OpenCode 1.18.15'
    ]));
    jest.advanceTimersByTime(5000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('lowercase "opencode" shell text does not arm the engine (case-sensitive wordmark)', () => {
    ctx.setScreen(['user@host:~$ cd opencode', 'user@host:~/opencode$ cat big.log']);
    streamBurst(plugin, 5000, 8); // big shell output burst
    jest.advanceTimersByTime(10000);
    expect(ctx.flashes).toHaveLength(0);
  });
});

describe('claude-attention plugin', () => {
  let ctx, plugin;

  beforeEach(() => {
    jest.useFakeTimers();
    ctx = makeCtx();
    plugin = new ClaudePlugin(ctx, {});
    plugin.onSessionConnect(SID);
  });

  afterEach(() => {
    plugin.onSessionDisconnect(SID);
    jest.useRealTimers();
  });

  test('flashes once when "esc to interrupt" disappears after a run', () => {
    ctx.setScreen(CL_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 3000, 6);
    expect(ctx.flashes).toHaveLength(0);

    ctx.setScreen(CL_IDLE);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);

    jest.advanceTimersByTime(30000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('flashes for a permission dialog after working', () => {
    ctx.setScreen(CL_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 2000, 4);

    ctx.setScreen([
      '● Edit file src/index.js',
      '  Do you want to make this edit?',
      '  ❯ 1. Yes',
      '    2. No',
      '  ? for shortcuts'
    ]);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('REGRESSION: "·" in status lines is not a work/spinner signal', () => {
    // Idle screen full of "·" separators — the old plugin treated "·" as a
    // spinner char, flipping the session into fake "working" state.
    ctx.setScreen(CL_IDLE.concat(['  3.2k tokens · $0.42 · sonnet']));
    jest.advanceTimersByTime(10000);
    const state = plugin._getSessionState(SID);
    expect(state.working).toBe(false);
    expect(ctx.flashes).toHaveLength(0);
  });

  test('REGRESSION: chat prose with "(y/n)" / "allow" / "Do you want" does not flash while idle', () => {
    ctx.setScreen([
      '● The script asks "Do you want to continue? (y/n)" — you should',
      '  allow it only if you trust the source.',
      '╭──────────────────────────────╮',
      '│ ❯                            │',
      '╰──────────────────────────────╯',
      '  ? for shortcuts'
    ]);
    jest.advanceTimersByTime(30000);
    expect(ctx.flashes).toHaveLength(0);
  });

  test('REGRESSION: never flashes at a shell prompt', () => {
    ctx.setScreen(SHELL);
    for (let i = 0; i < 5; i++) {
      streamBurst(plugin, 2000, 4);
      jest.advanceTimersByTime(3000);
    }
    jest.advanceTimersByTime(30000);
    expect(ctx.flashes).toHaveLength(0);
  });

  test('a dialog that hides every Claude signature still flashes the armed episode', () => {
    ctx.setScreen(CL_WORKING);
    plugin.onUserInput(SID, '\r');
    plugin.onData(SID, '✻ Deliberating… (1s · esc to interrupt)');
    jest.advanceTimersByTime(2000); // working episode armed

    // Full-screen confirmation view: no wordmark, no footer hints, no
    // spinner. The old engine treated this as "Claude left the screen" and
    // threw the episode away, so nothing ever flashed.
    ctx.setScreen([
      '  src/index.js',
      '  1  - const a = 1;',
      '  2  + const a = 2;',
      '',
      '  Apply this change?   Yes / No',
    ]);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('REGRESSION: still works when the full-scrollback state is too large', () => {
    ctx.stateTooLarge = true;
    ctx.setScreen(CL_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 3000, 6);

    ctx.setScreen(CL_IDLE);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('REGRESSION: a transition suppressed by the input cooldown is retried, not lost', () => {
    ctx.setScreen(CL_WORKING);
    jest.advanceTimersByTime(2000);

    plugin.onUserInput(SID, 'go\r');
    jest.advanceTimersByTime(100);
    plugin.onData(SID, '✻ Deliberating… (1s · esc to interrupt)');
    ctx.setScreen(CL_IDLE);

    jest.advanceTimersByTime(2600);
    expect(ctx.flashes).toHaveLength(0);

    jest.advanceTimersByTime(4000);
    expect(ctx.flashes).toHaveLength(1);
  });

  test('braille spinner in the footer keeps the session in working state', () => {
    ctx.setScreen([
      '● Running tests...',
      '⠧ Running… (45s · esc to interrupt)',
      '│ ❯                            │',
      '  ? for shortcuts'
    ]);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 1000, 2);
    jest.advanceTimersByTime(45000);
    expect(ctx.flashes).toHaveLength(0);

    const state = plugin._getSessionState(SID);
    expect(state.working).toBe(true);
  });

  test('a screen frozen past workStaleMs is not treated as working forever', () => {
    // A real run repaints its elapsed-time counter every second. A footer
    // that still says "esc to interrupt" while the session has produced
    // nothing for over a minute is a leftover — without this guard the
    // session stayed "working" and never flashed again.
    ctx.setScreen([
      '● Running tests...',
      '⠧ Running… (45s · esc to interrupt)',
      '│ ❯                            │',
      '  ? for shortcuts'
    ]);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 1000, 2);

    jest.advanceTimersByTime(70000);
    expect(ctx.flashes).toHaveLength(1);
    expect(plugin._getSessionState(SID).working).toBe(false);
  });

  test('a leftover spinner glyph in the footer does not block the transition', () => {
    // Claude finished and rendered a dialog; the last status line is still
    // within the scanned footer region but nothing is repainting it.
    ctx.setScreen(CL_WORKING);
    plugin.onUserInput(SID, '\r');
    jest.advanceTimersByTime(2000);
    streamBurst(plugin, 2000, 4);

    ctx.setScreen([
      '✻ Deliberating… (12s · 2.1k tokens)',
      '╭──────────────────────────────╮',
      '│ Do you want to proceed?      │',
      '│ ❯ 1. Yes                     │',
      '│   2. No                      │',
      '╰──────────────────────────────╯',
    ]);
    jest.advanceTimersByTime(8000);
    expect(ctx.flashes).toHaveLength(1);
  });
});

describe('plugin-manager hooks', () => {
  test('onUserInput hook is registered and dispatched to plugins', () => {
    jest.resetModules();
    const pluginManager = require('../../server/plugins/plugin-manager');
    expect(pluginManager.hooks.onUserInput).toBeDefined();

    const received = [];
    pluginManager.hooks.onUserInput.push({
      pluginName: 'test',
      fn: (sessionId, data) => received.push({ sessionId, data })
    });
    pluginManager.onUserInput('s-1', 'abc');
    expect(received).toEqual([{ sessionId: 's-1', data: 'abc' }]);
    pluginManager.hooks.onUserInput.length = 0;
  });

  test('onSessionFocus clears the server-side flash state and notifies clients', () => {
    jest.resetModules();
    const pluginManager = require('../../server/plugins/plugin-manager');
    expect(pluginManager.hooks.onSessionFocus).toBeDefined();

    const emitted = [];
    pluginManager.io = { emit: (event, data) => emitted.push({ event, data }) };
    pluginManager.flashingSessions.set('s-2', { duration: 0 });

    const received = [];
    pluginManager.hooks.onSessionFocus.push({
      pluginName: 'test',
      fn: (sessionId) => received.push(sessionId)
    });

    pluginManager.onSessionFocus('s-2');
    expect(received).toEqual(['s-2']);
    expect(pluginManager.flashingSessions.has('s-2')).toBe(false);
    expect(emitted).toEqual([{ event: 'tab-flash-stop', data: { sessionId: 's-2' } }]);

    pluginManager.hooks.onSessionFocus.length = 0;
    pluginManager.io = null;
  });
});
