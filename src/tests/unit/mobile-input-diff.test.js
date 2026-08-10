/**
 * Regression tests for the mobile hidden-textarea input diffing
 * (Gboard autocomplete "re-types the whole line" loop).
 *
 * Root cause of the loop: the old implementation diffed each `input` event
 * against a per-event `beforeinput` snapshot that was reset to '' after
 * every input AND on compositionend. Gboard fires input/composition events
 * in device-specific orders around suggestion taps — when an input event
 * arrived without a fresh snapshot, the diff treated the ENTIRE textarea
 * content as newly-appended text and re-sent it. A post-compositionend
 * guard additionally overwrote the textarea with the (empty) snapshot,
 * desyncing Gboard's own state and making it re-insert the full text on
 * the next suggestion tap — amplifying the loop.
 *
 * The fix: _syncTextareaToTerminal() diffs the textarea against a
 * PERSISTENT `_sentValue` baseline (the content already sent to the
 * terminal). The sync is idempotent — any event interleaving converges to
 * the textarea content being sent exactly once. Mid-string replacements
 * erase back to the divergence point and retype the remainder (the
 * terminal cursor sits at the end, so deleting only a middle span is
 * impossible with plain DELs).
 */

const path = require('path');
const fs = require('fs');

function loadMobileHandlerClass() {
  const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'mobile-terminal.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const scope = {
    window: {},
    console
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(scope), source + '\nreturn MobileTerminalHandler;');
  return factory(...Object.values(scope));
}

// Build a bare handler instance without running the DOM-heavy constructor.
function makeHandler(Cls) {
  const h = Object.create(Cls.prototype);
  h.hiddenTextarea = { value: '' };
  h._sentValue = '';
  h._isComposing = false;
  h.sent = [];
  h._sendToTerminal = (text) => h.sent.push(text);
  return h;
}

// What the terminal line looks like after applying the sent payloads
// (\x7f = erase one code point from the end, like readline).
function applyToLine(sent) {
  let line = [];
  for (const payload of sent) {
    for (const ch of payload) {
      if (ch === '\x7f') {
        line.pop();
      } else {
        line.push(ch);
      }
    }
  }
  return line.join('');
}

describe('Mobile textarea → terminal diff sync (_syncTextareaToTerminal)', () => {
  let Cls;
  let h;

  beforeAll(() => {
    Cls = loadMobileHandlerClass();
  });

  beforeEach(() => {
    h = makeHandler(Cls);
  });

  test('simple append sends only the delta', () => {
    h.hiddenTextarea.value = 'hello';
    h._syncTextareaToTerminal();
    expect(h.sent).toEqual(['hello']);

    h.hiddenTextarea.value = 'hello world';
    h._syncTextareaToTerminal();
    expect(h.sent).toEqual(['hello', ' world']);
  });

  test('sync is idempotent — duplicate events send nothing (loop regression)', () => {
    h.hiddenTextarea.value = 'ls -la';
    h._syncTextareaToTerminal();
    expect(h.sent).toEqual(['ls -la']);

    // Gboard suggestion tap re-firing input events with unchanged content
    // (or a duplicate input right after compositionend) must NOT re-send.
    h._syncTextareaToTerminal();
    h._syncTextareaToTerminal();
    expect(h.sent).toEqual(['ls -la']);
  });

  test('autocomplete tap replacing the current word sends erase + correction', () => {
    h.hiddenTextarea.value = 'git sttaus';
    h._syncTextareaToTerminal();

    // User taps the "status" suggestion; Gboard replaces the word.
    h.hiddenTextarea.value = 'git status ';
    h._syncTextareaToTerminal();

    expect(applyToLine(h.sent)).toBe('git status ');
    // And the whole line was never re-sent as a blob.
    expect(h.sent.filter(s => s === 'git status ')).toHaveLength(0);
  });

  test('mid-string replacement erases to divergence point and retypes remainder', () => {
    h.hiddenTextarea.value = 'hello world';
    h._syncTextareaToTerminal();
    h.sent.length = 0;

    // Replace the middle: "hello" -> "help" (suffix " world" unchanged).
    h.hiddenTextarea.value = 'help world';
    h._syncTextareaToTerminal();

    // Old (broken) behavior sent only 2 DELs + "p" producing "hello worp".
    // Correct behavior: erase back to "hel", retype "p world".
    expect(h.sent).toEqual(['\x7f'.repeat(8), 'p world']);
  });

  test('deletion-only change sends DELs', () => {
    h.hiddenTextarea.value = 'abcdef';
    h._syncTextareaToTerminal();
    h.hiddenTextarea.value = 'abc';
    h._syncTextareaToTerminal();
    expect(h.sent).toEqual(['abcdef', '\x7f\x7f\x7f']);
  });

  test('composition interleaving converges without double-send (Gboard quirk)', () => {
    // Gboard sometimes fires a plain input BEFORE compositionstart, then
    // compositionend with the same word. Old code needed a heuristic
    // (_lastSentInput) to dedupe; the persistent baseline handles it.
    h.hiddenTextarea.value = 'hello';
    h._syncTextareaToTerminal();       // input event (pre-composition quirk)
    h._isComposing = true;             // compositionstart
    h._isComposing = false;            // compositionend...
    h._syncTextareaToTerminal();       // ...syncs the (unchanged) value
    expect(h.sent).toEqual(['hello']);
  });

  test('newline committed through the input path is translated to \\r and resets tracking', () => {
    h.hiddenTextarea.value = 'ls';
    h._syncTextareaToTerminal();
    h.hiddenTextarea.value = 'ls\n';
    h._syncTextareaToTerminal();
    expect(h.sent).toEqual(['ls', '\r']);
    // Clean slate afterwards (mirrors the Enter keydown path).
    expect(h.hiddenTextarea.value).toBe('');
    expect(h._sentValue).toBe('');
  });

  test('never splits surrogate pairs and counts code points for DELs', () => {
    h.hiddenTextarea.value = '😀';
    h._syncTextareaToTerminal();
    h.sent.length = 0;

    // 😀 (U+1F600) and 😁 (U+1F601) share the same high surrogate; a naive
    // UTF-16 prefix diff would split the pair and send a lone surrogate.
    h.hiddenTextarea.value = '😁';
    h._syncTextareaToTerminal();

    expect(h.sent).toEqual(['\x7f', '😁']);
    // No lone surrogates in any payload.
    for (const payload of h.sent) {
      for (let i = 0; i < payload.length; i++) {
        const code = payload.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) {
          const next = payload.charCodeAt(i + 1);
          expect(next >= 0xDC00 && next <= 0xDFFF).toBe(true);
        }
      }
    }
  });

  test('_resetInputTracking clears both the textarea and the baseline', () => {
    h.hiddenTextarea.value = 'stale';
    h._sentValue = 'stale';
    h._resetInputTracking();
    expect(h.hiddenTextarea.value).toBe('');
    expect(h._sentValue).toBe('');

    // Next input starts from a clean diff state.
    h.hiddenTextarea.value = 'new';
    h._syncTextareaToTerminal();
    expect(h.sent).toEqual(['new']);
  });

  test('full Gboard autocomplete session never re-sends the whole line', () => {
    // Simulates: type words, tap suggestions repeatedly. The terminal-side
    // reconstruction must equal the textarea, and no payload may contain
    // the full accumulated line again.
    const steps = [
      'g', 'gi', 'git', 'git ', 'git c', 'git co',
      'git commit ',           // suggestion tap (replaces "co")
      'git commit -m ',
      'git commit -m "fix bug"'
    ];
    for (const value of steps) {
      h.hiddenTextarea.value = value;
      h._syncTextareaToTerminal();
      // Duplicate event after every step (worst-case Gboard chatter).
      h._syncTextareaToTerminal();
    }
    expect(applyToLine(h.sent)).toBe('git commit -m "fix bug"');
    // The regression: payloads like "git commit -m " re-sent wholesale.
    const resent = h.sent.filter((p, i) => i > 0 && p.length > 1 && steps.includes(p));
    expect(resent).toEqual([]);
  });
});
