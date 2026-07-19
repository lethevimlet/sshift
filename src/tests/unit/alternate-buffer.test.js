/**
 * Unit tests for xterm.js alternate buffer handling.
 *
 * Tests terminal buffer serialization and deserialization using the same
 * headless packages the server uses for state management
 * (`@xterm/headless` + `@xterm/addon-serialize`).
 *
 * xterm's `terminal.write(data)` is asynchronous — the data is queued
 * and parsed on later ticks. All tests use the `terminal.write(data, cb)`
 * callback form wrapped in a Promise so Jest can await parse completion
 * before asserting on buffer contents / serialized state.
 */

const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

// Skip the entire suite if the optional xterm packages aren't installed
// (e.g. running tests in a stripped CI image). This keeps the suite green
// in degraded environments without hiding real failures.
const hasXterm = (() => {
  try {
    require.resolve('@xterm/headless');
    require.resolve('@xterm/addon-serialize');
    return true;
  } catch (_) {
    return false;
  }
})();

const maybeDescribe = hasXterm ? describe : describe.skip;

// Helper: write a chunk and resolve once xterm has parsed it.
function writeAsync(terminal, data) {
  return new Promise((resolve) => {
    terminal.write(data, () => resolve());
  });
}

function makeTerminal(opts = {}) {
  const t = new Terminal({
    cols: 80,
    rows: 24,
    allowProposedApi: true,
    scrollback: 1000,
    ...opts
  });
  const serializeAddon = new SerializeAddon();
  t.loadAddon(serializeAddon);
  return { terminal: t, serializeAddon };
}

maybeDescribe('Alternate Buffer Tests (real xterm)', () => {
  test('normal buffer: written text is serializable', async () => {
    const { terminal, serializeAddon } = makeTerminal();
    await writeAsync(terminal, 'Normal buffer line 1\r\n');
    await writeAsync(terminal, 'Normal buffer line 2\r\n');

    expect(terminal.buffer.active.type).toBe('normal');
    const content = serializeAddon.serialize({ mode: 'all' });
    expect(content).toContain('Normal buffer line 1');
    expect(content).toContain('Normal buffer line 2');
  });

  test('alternate buffer: DECSET 1049 switches buffer type', async () => {
    const { terminal } = makeTerminal();
    await writeAsync(terminal, '\x1b[?1049h');
    expect(terminal.buffer.active.type).toBe('alternate');
  });

  test('alternate buffer: written text lands in the alt buffer and serializes', async () => {
    const { terminal, serializeAddon } = makeTerminal();
    await writeAsync(terminal, '\x1b[?1049h');
    await writeAsync(terminal, 'Alternate buffer line 1\r\n');
    await writeAsync(terminal, 'Alternate buffer line 2\r\n');

    expect(terminal.buffer.active.type).toBe('alternate');
    const content = serializeAddon.serialize({ mode: 'all' });
    expect(content).toContain('Alternate buffer line 1');
    expect(content).toContain('Alternate buffer line 2');
  });

  test('DECRST 1049 returns to normal buffer and preserves prior normal-buffer content', async () => {
    const { terminal, serializeAddon } = makeTerminal();
    await writeAsync(terminal, 'Normal buffer line 1\r\n');
    await writeAsync(terminal, '\x1b[?1049h');
    await writeAsync(terminal, 'Alternate buffer line 1\r\n');
    await writeAsync(terminal, '\x1b[?1049l');

    expect(terminal.buffer.active.type).toBe('normal');
    const content = serializeAddon.serialize({ mode: 'all' });
    // Normal-buffer text remains after the alt-buffer round trip.
    expect(content).toContain('Normal buffer line 1');
    // Alt-buffer content is NOT preserved after returning to normal.
    expect(content).not.toContain('Alternate buffer line 1');
  });

  test('round-trip: serialized buffer can be replayed into a fresh terminal', async () => {
    const { terminal: src, serializeAddon: srcSer } = makeTerminal();
    await writeAsync(src, 'Line 1\r\n');
    await writeAsync(src, 'Line 2\r\n');
    await writeAsync(src, 'Line 3\r\n');
    const serialized = srcSer.serialize({ mode: 'all' });
    expect(serialized.length).toBeGreaterThan(0);

    const { terminal: dst } = makeTerminal();
    dst.reset();
    await writeAsync(dst, serialized);

    // translated lines should contain the original content. Lines beyond
    // the bottom of the viewport still count as part of buffer.active.
    function firstNonBlankLine(terminal) {
      for (let i = 0; i < 5; i++) {
        const line = terminal.buffer.active.getLine(i);
        if (!line) continue;
        const text = line.translateToString(false).trim();
        if (text) return text;
      }
      return '';
    }
    const l0 = firstNonBlankLine(dst);
    expect(l0).toContain('Line 1');
    // Verify line 2/3 via direct line lookup — newer terminal may keep
    // cursor position so order is checked too.
    function findLineContaining(terminal, needle) {
      for (let i = 0; i < terminal.buffer.active.length; i++) {
        const line = terminal.buffer.active.getLine(i);
        if (!line) continue;
        const text = line.translateToString(false);
        if (text.includes(needle)) return text;
      }
      return null;
    }
    expect(findLineContaining(dst, 'Line 2')).not.toBeNull();
    expect(findLineContaining(dst, 'Line 3')).not.toBeNull();
  });

  test('scrollback: serialize({mode:"all"}) preserves lines scrolled out of viewport', async () => {
    const { terminal, serializeAddon } = makeTerminal({ scrollback: 1000 });
    // Write more lines than the viewport (rows=24).
    for (let i = 0; i < 50; i++) {
      await writeAsync(terminal, `Scrollback line ${i}\r\n`);
    }
    const all = serializeAddon.serialize({ mode: 'all' });
    expect(all).toContain('Scrollback line 0');
    expect(all).toContain('Scrollback line 49');
  });

  test('serialize modes differ only in scope, not in normal-buffer content', async () => {
    const { terminal, serializeAddon } = makeTerminal({ scrollback: 1000 });
    for (let i = 0; i < 10; i++) {
      await writeAsync(terminal, `Visible line ${i}\r\n`);
    }
    const all = serializeAddon.serialize({ mode: 'all' });
    const normal = serializeAddon.serialize({ mode: 'normal' });
    // Both modes must contain the recently-written visible lines.
    expect(all).toContain('Visible line 9');
    expect(normal).toContain('Visible line 9');
  });

  test('OSC 52 sequence does not leak through to the serialized buffer', async () => {
    // xterm.js headless has no clipboard so OSC 52 sequences are not
    // handled as clipboard writes, but they must not corrupt the buffer
    // content either.
    const { terminal, serializeAddon } = makeTerminal();
    await writeAsync(terminal, 'before\r\n');
    await writeAsync(terminal, '\x1b]52;c;SGVsbG8=\x07');
    await writeAsync(terminal, 'after\r\n');
    const all = serializeAddon.serialize({ mode: 'all' });
    expect(all).toContain('before');
    expect(all).toContain('after');
    // The raw OSC 52 escape sequence must not appear verbatim in the
    // serialized buffer (xterm parses it as control and discards it).
    expect(all).not.toContain('\x1b]52;');
  });

  test('Unicode 11 addon does not break serialization of wide characters', async () => {
    let Unicode11Addon;
    try {
      Unicode11Addon = require('@xterm/addon-unicode11').Unicode11Addon;
    } catch (_) {
      // Addon not installed — skip this assertion by serializing ASCII
      // which is width-agnostic.
    }
    const { terminal, serializeAddon } = makeTerminal();
    if (Unicode11Addon) {
      const unicode11 = new Unicode11Addon();
      terminal.loadAddon(unicode11);
      terminal.unicode.activeVersion = '11';
    }
    await writeAsync(terminal, 'Wide: 😀 emoji\r\n');
    await writeAsync(terminal, 'CJK: 中文测试\r\n');
    const all = serializeAddon.serialize({ mode: 'all' });
    expect(all).toContain('Wide');
    expect(all).toContain('emoji');
    expect(all).toContain('中文测试');
  });
});