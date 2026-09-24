/**
 * v1.8.1: the hidden textarea is never cleared while it owns focus (a live
 * Gboard/IME session keeps its own model of the field; a programmatic
 * clear is invisible to it and desyncs the next suggestion tap). Resets
 * requested while focused are deferred to the next blur. Also covers the
 * input trace ring buffer used for device bug reports.
 */

const path = require('path');
const fs = require('fs');

function loadMobileHandlerClass(document) {
  const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'mobile-terminal.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const scope = { window: {}, console, document };
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(scope), source + '\nreturn MobileTerminalHandler;');
  return factory(...Object.values(scope));
}

function makeHandler(document) {
  const Cls = loadMobileHandlerClass(document);
  const h = Object.create(Cls.prototype);
  h.hiddenTextarea = { value: '', selectionStart: 0, selectionEnd: 0 };
  h._sentValue = '';
  h._isComposing = false;
  h._pendingTrackingReset = false;
  h.touchState = { isDragging: false, isSelecting: false };
  h.selection = { active: false };
  h.sent = [];
  h._sendToTerminal = (text) => h.sent.push(text);
  return h;
}

describe('focus-guarded input tracking reset', () => {
  test('reset is applied immediately when the textarea is not focused', () => {
    const document = { activeElement: null };
    const h = makeHandler(document);
    h.hiddenTextarea.value = 'ls -la\n';
    h._sentValue = 'ls -la\n';
    h._resetInputTracking();
    expect(h.hiddenTextarea.value).toBe('');
    expect(h._sentValue).toBe('');
    expect(h._pendingTrackingReset).toBe(false);
  });

  test('reset is deferred while focused and applied on blur', () => {
    const document = { activeElement: null };
    const h = makeHandler(document);
    document.activeElement = h.hiddenTextarea;
    h.hiddenTextarea.value = 'hello';
    h._sentValue = 'hello';

    h._resetInputTracking();
    expect(h.hiddenTextarea.value).toBe('hello'); // untouched under a live IME
    expect(h._sentValue).toBe('hello');
    expect(h._pendingTrackingReset).toBe(true);

    // typing continues to diff normally against the intact baseline
    h.hiddenTextarea.value = 'hello world';
    h._syncTextareaToTerminal();
    expect(h.sent).toEqual([' world']);

    // blur (as _collapseKeyboard does before clearing) → reset applies
    document.activeElement = null;
    h._resetInputTracking();
    expect(h.hiddenTextarea.value).toBe('');
    expect(h._sentValue).toBe('');
    expect(h._pendingTrackingReset).toBe(false);
  });

  test('compositionend with a deferred reset still syncs when focused', () => {
    const document = { activeElement: null };
    const h = makeHandler(document);
    document.activeElement = h.hiddenTextarea;
    h._sentValue = 'git ';
    h.hiddenTextarea.value = 'git ';
    h._isComposing = true;
    h._resetInputTracking(); // deferred (composing + focused)
    h.hiddenTextarea.value = 'git status';
    h._onCompositionEnd();
    expect(h._isComposing).toBe(false);
    expect(h.sent).toEqual(['status']);
    expect(h.hiddenTextarea.value).toBe('git status'); // not cleared under the IME
    expect(h._pendingTrackingReset).toBe(true); // still waiting for blur
  });

  test('compositionend applies a deferred reset when not focused', () => {
    const document = { activeElement: null };
    const h = makeHandler(document);
    h._sentValue = 'abc';
    h.hiddenTextarea.value = 'abc';
    h._isComposing = true;
    h._resetInputTracking();
    expect(h._pendingTrackingReset).toBe(true);
    h.hiddenTextarea.value = 'abcd';
    h._onCompositionEnd();
    expect(h.sent).toEqual([]); // composition result discarded with the reset
    expect(h.hiddenTextarea.value).toBe('');
    expect(h._pendingTrackingReset).toBe(false);
  });

  test('input trace records syncs and resets, capped at 400 entries', () => {
    const document = { activeElement: null };
    const h = makeHandler(document);
    h.hiddenTextarea.value = 'hi';
    h._syncTextareaToTerminal();
    h._resetInputTracking();
    const trace = h.getInputTrace();
    expect(trace.map(e => e.kind)).toEqual(['sync', 'reset']);
    expect(trace[0]).toMatchObject({ insert: 'hi', del: 0, prefixLen: 0, len: 2 });
    for (let i = 0; i < 500; i++) h._trace('x', { i });
    expect(h.getInputTrace().length).toBe(400);
    expect(h.getInputTrace()[399].i).toBe(499);
  });
});
