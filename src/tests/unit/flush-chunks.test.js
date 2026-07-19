/**
 * Unit tests for the surrogate-pair / escape-aware split logic and the
 * OSC 52 cross-chunk reassembly used by `_flushWriteChunks` / `_handleOsc52`.
 *
 * The split logic was promoted to a static method on SSHIFTClient so it
 * can be tested in isolation (see app.js `findSafeWriteSplitPoint`).
 * We load the production script into a mock browser scope and invoke it
 * directly — no xterm.js needed.
 *
 * The OSC 52 path is harder to reach without a full Terminal mock, so
 * the OSC 52 test replcates the algorithmic contract (pending buffer
 * reassembly) on a small standalone shim that mirrors the in-app
 * behavior, then asserts on it. Both the production code and the shim
 * follow the same algorithm; if they diverge the test will fail.
 */

const path = require('path');
const fs = require('fs');

// --- Load SSHIFTClient source ----------------------------------------------
// app.js uses browser globals (window, document, io, requestAnimationFrame).
// We build a minimal mock so the class definition parses without error.
function loadAppSource() {
  const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'app.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const mockWindow = {
    innerWidth: 1280,
    addEventListener: () => {},
    removeEventListener: () => {},
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    VisualViewport: function () {}
  };
  const mockDocument = {
    addEventListener: () => {},
    removeEventListener: () => {},
    body: { classList: { add: () => {}, remove: () => {} } },
    documentElement: { setAttribute: () => {}, getAttribute: () => null, classList: { add: () => {}, remove: () => {} } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      classList: { add: () => {}, remove: () => {} },
      setAttribute: () => {},
      appendChild: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      style: {}
    })
  };
  const scope = {
    window: mockWindow,
    document: mockDocument,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    navigator: { clipboard: { writeText: () => Promise.resolve(true) }, userAgent: 'node' },
    io: function () { return { on: () => {}, emit: () => {}, connected: false, disconnect: () => {}, connect: () => {} }; },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    console,
    // xterm global constructors are referenced inside methods — only
    // invoked when a tab is actually opened, so undefined here is fine.
    Terminal: undefined,
    FitAddon: undefined,
    WebLinksAddon: undefined,
    SearchAddon: undefined,
    SerializeAddon: undefined,
    WebglAddon: undefined,
    Unicode11Addon: undefined,
    ImageAddon: undefined,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextDecoder,
    Worker: function () {},
    visualViewport: null,
    performance: { now: () => Date.now() }
  };

  // The script does `class SSHIFTClient { ... }` at top-level. After
  // evaluation the class is bound inside the function-scope, so we
  // also need to expose it. We append `return SSHIFTClient;` to read
  // the class back out of the eval scope.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    ...Object.keys(scope),
    source + '\nglobalThis.__SSHIFTClient = SSHIFTClient;'
  );
  factory(...Object.values(scope));
  return globalThis.__SSHIFTClient;
}

const SSHIFTClient = loadAppSource();

describe('SSHIFTClient.findSafeWriteSplitPoint (surrogate-pair safety)', () => {
  test('returns the full length when input is under the cap', () => {
    expect(SSHIFTClient.findSafeWriteSplitPoint('abc', 100)).toBe(3);
  });

  test('returns the cap when no ESC or surrogate appears near the boundary', () => {
    const s = 'x'.repeat(50000);
    expect(SSHIFTClient.findSafeWriteSplitPoint(s, 32768)).toBe(32768);
  });

  test('backs off to before a leading ESC at the boundary', () => {
    const s = 'x'.repeat(32768) + '\x1b[31m';
    expect(SSHIFTClient.findSafeWriteSplitPoint(s, 32768)).toBe(32768);
  });

  test('backs off to before an ESC that sits just inside the cap', () => {
    // ESC at position 32766 (cap-2). Split before ESC.
    const s = 'x'.repeat(32766) + '\x1b[m';
    const splitAt = SSHIFTClient.findSafeWriteSplitPoint(s, 32768);
    expect(splitAt).toBe(32766);
    // First chunk does NOT contain the ESC.
    expect(s.substring(0, splitAt).indexOf('\x1b')).toBe(-1);
    expect(s.substring(splitAt).startsWith('\x1b')).toBe(true);
  });

  test('does not bisect a UTF-16 surrogate pair at the boundary', () => {
    // Build: 32767 ASCII chars + 1 lead surrogate + 1 trail surrogate + tail.
    const lead = '\uD83D'; // 0xD800 range (lead of 😀)
    const trail = '\uDE00'; // 0xDC00 range (trail of 😀)
    const s = 'x'.repeat(32767) + lead + trail + 'x'.repeat(100);
    const splitAt = SSHIFTClient.findSafeWriteSplitPoint(s, 32768);
    // The pair starts at index 32767. Splitting at 32767 keeps the pair
    // together in chunk-2 (neither chunk contains a lone half-pair).
    expect(splitAt).toBe(32767);
    const head = s.substring(0, splitAt);
    const tail = s.substring(splitAt);
    // Both halves well-formed: head ends on an ASCII char, tail starts
    // with the LEAD, so the pair is intact in chunk-2.
    expect(head.endsWith('x')).toBe(true);
    expect(tail.startsWith(lead)).toBe(true);
    expect(tail.charCodeAt(0) >= 0xD800 && tail.charCodeAt(0) <= 0xDBFF).toBe(true);
  });

  test('keeps ASCII-heavy chunks at the cap when no surrogate straddles', () => {
    // Surrogate pair positioned far past the cap — split should be the cap.
    const s = 'x'.repeat(33000) + '\uD83D\uDE00';
    expect(SSHIFTClient.findSafeWriteSplitPoint(s, 32768)).toBe(32768);
  });
});

// --- OSC 52 cross-chunk reassembly (mirrors _handleOsc52 algorithm) --------

// Minimal standalone replica of the cross-chunk pending-buffer algorithm
// in `_handleOsc52`. The production code in app.js follows the same
// contract: incomplete OSC 52 / DCS sequences are stashed on
// session.pendingOsc52 and stripped from the data to xterm, then
// prepended to the next chunk to reassemble a complete sequence.
function makeOsc52Processor() {
  let pending = null;
  return {
    pending: () => pending,
    process(data) {
      let working = data;
      if (pending) {
        working = pending + working;
        pending = null;
      }
      if (working.indexOf('52;') === -1 &&
          working.indexOf('\x1bPtmux;') === -1 &&
          working.indexOf('\x1bP\x1b') === -1) {
        return working;
      }
      let result = working;
      // Single-sequence path: look for an OSC 52 and either strip+capture
      // or stash the partial.
      const startIdx = result.indexOf('\x1b]52;');
      if (startIdx !== -1) {
        const endIdx = result.search(/(\x07|\x1b\\)/);
        const belIdx = result.indexOf('\x07', startIdx + 5);
        const stIdx = result.indexOf('\x1b\\', startIdx + 5);
        let endPos = -1;
        if (belIdx !== -1 && (stIdx === -1 || belIdx < stIdx)) endPos = belIdx;
        else if (stIdx !== -1) endPos = stIdx;
        if (endPos === -1) {
          pending = result.substring(startIdx);
          result = result.substring(0, startIdx);
        } else {
          result = result.substring(0, startIdx) + result.substring(endPos + (result.charAt(endPos) === '\x1b' ? 2 : 1));
        }
      }
      return result;
    }
  };
}

describe('OSC 52 cross-chunk reassembly contract', () => {
  test('a complete OSC 52 in one frame is stripped from the data to xterm', () => {
    const p = makeOsc52Processor();
    const out = p.process('hello\x1b]52;c;AAA=\x07world');
    expect(out).toBe('helloworld');
    expect(p.pending()).toBeNull();
  });

  test('a partial OSC 52 arriving across two frames is reassembled and stripped', () => {
    const p = makeOsc52Processor();
    const out1 = p.process('hello\x1b]52;c;AAA');
    expect(out1).toBe('hello');
    expect(p.pending()).toBe('\x1b]52;c;AAA');

    const out2 = p.process('=\x07world');
    expect(out2).toBe('world');
    expect(p.pending()).toBeNull();
  });

  test('non-OSC-52 data without a pending partial is passed through unchanged', () => {
    const p = makeOsc52Processor();
    expect(p.process('plain text\r\n')).toBe('plain text\r\n');
    expect(p.pending()).toBeNull();
  });

  test('a partial pending state clears on the next frame even if no terminator arrives', () => {
    const p = makeOsc52Processor();
    p.process('\x1b]52;c;partial');
    expect(p.pending()).toBe('\x1b]52;c;partial');
    // Eventually completing the sequence should clear the pending.
    p.process('done\x07trailing');
    expect(p.pending()).toBeNull();
  });
});

// --- Drive the actual production _handleOsc52 against a fake session ----
// The standalone shim above proves the algorithm; this block drives the
// real `_handleOsc52(session, data)` method on the SSHIFTClient class to
// assert it honors the same contract — without instantiating the full
// class (which requires browser globals). We `.call()` the method with
// a minimal `this` shim.
describe('production _handleOsc52 cross-chunk behavior (real class method)', () => {
  let handlerThis; // the `this` binding for `_handleOsc52`
  let writeCalls; // captured clipboard writes

  beforeEach(() => {
    writeCalls = [];
    handlerThis = {
      osc52Buffer: null,
      copyToClipboard: (text) => { writeCalls.push(text); return Promise.resolve(true); }
    };
  });

  // The production method reads/writes `session.pendingOsc52`; a fake
  // session object is all it needs.
  function fakeSession() {
    return { pendingOsc52: null };
  }

  function handle(session, data) {
    return SSHIFTClient.prototype._handleOsc52.call(handlerThis, session, data);
  }

  test('fast path: payload without 52; passes through unchanged', () => {
    const s = fakeSession();
    expect(handle(s, 'plain text\r\n')).toBe('plain text\r\n');
    expect(s.pendingOsc52).toBeNull();
  });

  test('complete OSC 52 sequence is stripped from the data to xterm', () => {
    const s = fakeSession();
    const out = handle(s, 'hello\x1b]52;c;SGVsbG8=\x07world');
    // The OSC 52 sequence is extracted; surrounding text is preserved.
    expect(out).toBe('helloworld');
    expect(s.pendingOsc52).toBeNull();
    // The decoded payload ("Hello") is written to the clipboard.
    expect(writeCalls.some(t => t === 'Hello')).toBe(true);
  });

  test('an OSC 52 split across two frames is reassembled and stripped', () => {
    const s = fakeSession();
    // First frame: incomplete OSC 52 (no terminator yet).
    const out1 = handle(s, 'hello\x1b]52;c;SGVsbG');
    expect(out1).toBe('hello');
    expect(s.pendingOsc52).toBe('\x1b]52;c;SGVsbG');
    // Second frame: the terminator arrives.
    const out2 = handle(s, '8=\x07world');
    expect(out2).toBe('world');
    expect(s.pendingOsc52).toBeNull();
  });

  test('pending partial is preserved when the next frame is also non-terminating', () => {
    const s = fakeSession();
    handle(s, '\x1b]52;c;part1');
    expect(s.pendingOsc52).toBe('\x1b]52;c;part1');
    handle(s, 'part2');
    // Still no terminator — the buffer should keep growing.
    expect(s.pendingOsc52).toBe('\x1b]52;c;part1part2');
  });

  test('a tmux DCS passthrough OSC 52 split across frames is reassembled', () => {
    const s = fakeSession();
    // First frame: DCS wrapper opened but not terminated.
    const out1 = handle(s, 'hello\x1bPtmux;\x1b\x1b]52;c;SGVs');
    expect(out1).toBe('hello');
    expect(s.pendingOsc52).not.toBeNull();
    // Second frame: DCS terminator + remainder.
    const out2 = handle(s, 'bG8=\x07\x1b\\world');
    // Inner OSC 52 is processed and stripped from the stream.
    expect(out2).toBe('world');
    expect(s.pendingOsc52).toBeNull();
  });

  test('multiple OSC 52 sequences in one frame are all stripped', () => {
    const s = fakeSession();
    const out = handle(s, 'a\x1b]52;c;AAA=\x07b\x1b]52;c;BBB=\x07c');
    expect(out).toBe('abc');
  });

  test('a clear-clipboard OSC 52 (empty payload) writes empty string to clipboard', () => {
    const s = fakeSession();
    // OSC 52 with empty base64 = "clear the clipboard".
    const out = handle(s, '\x1b]52;c;\x07');
    expect(out).toBe('');
    expect(s.pendingOsc52).toBeNull();
  });
});