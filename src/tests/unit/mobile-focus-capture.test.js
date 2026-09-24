/**
 * v1.8.2: on mobile, xterm's own helper textarea must never receive focus.
 *
 * xterm focuses its textarea from its `mousedown` listener; on a phone that
 * listener runs on the compatibility mousedown ~1 ms after our touchend
 * focused the mobile textarea, so every tap handed Gboard to xterm's
 * textarea (and xterm's clear-after-input Android handling, which
 * duplicates words with suggestions). The mobile handler now shadows the
 * core's focus(), forwards physical special keys itself, syncs
 * compositions live, treats the field like a keystroke log across line
 * breaks and can re-open a dismissed keyboard on tap.
 */

const path = require('path');
const fs = require('fs');

function loadMobileHandlerClass(document) {
  const sourcePath = path.join(__dirname, '..', '..', 'webapp', 'js', 'mobile-terminal.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const scope = { window: { innerWidth: 393, innerHeight: 851 }, console, document };
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(scope), source + '\nreturn MobileTerminalHandler;');
  return factory(...Object.values(scope));
}

function fakeTextarea() {
  const ta = {
    value: '', selectionStart: 0, selectionEnd: 0, tabIndex: 0, listeners: {},
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    removeAttribute() {}, setAttribute() {},
    fire(t, e) { (this.listeners[t] || []).forEach(f => f(e || {})); }
  };
  ta.focus = () => { ta.doc.activeElement = ta; ta.fire('focus'); };
  ta.blur = () => { if (ta.doc.activeElement === ta) ta.doc.activeElement = null; ta.fire('blur'); };
  return ta;
}

function makeHandler(document, terminal) {
  const Cls = loadMobileHandlerClass(document);
  const h = Object.create(Cls.prototype);
  h.hiddenTextarea = fakeTextarea();
  h.hiddenTextarea.doc = document;
  h.hiddenTextarea.addEventListener('blur', () => h._onTextareaBlur());
  h.terminal = terminal || null;
  h._sentValue = '';
  h._isComposing = false;
  h._pendingTrackingReset = false;
  h._suppressBlurReset = false;
  h._maxInnerHeightByWidth = {};
  h._deferredSyncTimer = null;
  h._xtermCore = null;
  h._xtermTextareaFocusListener = null;
  h._keyboardCollapsed = false;
  h.touchState = { isDragging: false, isSelecting: false, isLongPress: false, longPressTimer: null, startX: 0, startY: 0, startTime: 0 };
  h.selection = { active: false };
  h.app = { isMobile: true };
  h.sent = [];
  h._sendToTerminal = (text) => h.sent.push(text);
  return h;
}

function fakeTerminal() {
  const proto = { focus() { this.protoFocusCalls = (this.protoFocusCalls || 0) + 1; } };
  const core = Object.create(proto);
  const textarea = fakeTextarea();
  return { _core: core, textarea, modes: { applicationCursorKeysMode: false } };
}

function keyEvent(props) {
  return { key: '', keyCode: 0, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, prevented: false, preventDefault() { this.prevented = true; }, ...props };
}

describe('xterm focus capture', () => {
  test('core.focus() is redirected to the hidden textarea and restored on release', () => {
    const document = { activeElement: null };
    const t = fakeTerminal();
    t.textarea.doc = document;
    const h = makeHandler(document, t);
    const focusSpy = jest.spyOn(h, '_focusHiddenTextarea');

    h._captureTerminalFocus();
    expect(Object.prototype.hasOwnProperty.call(t._core, 'focus')).toBe(true);
    expect(t.textarea.tabIndex).toBe(-1);

    t._core.focus();                       // what xterm's mousedown listener does
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(t._core.protoFocusCalls).toBeUndefined();
    expect(document.activeElement).toBe(h.hiddenTextarea);

    // Safety net: something else focuses xterm's textarea → handed back.
    document.activeElement = t.textarea;
    t.textarea.fire('focus');
    expect(document.activeElement).toBe(h.hiddenTextarea);

    h._releaseTerminalFocus();
    expect(Object.prototype.hasOwnProperty.call(t._core, 'focus')).toBe(false);
    expect(t.textarea.listeners.focus || []).toHaveLength(0);
    t._core.focus();
    expect(t._core.protoFocusCalls).toBe(1);
  });

  test('when selection mode blocks the hand-over, xterm textarea is blurred instead', () => {
    const document = { activeElement: null };
    const t = fakeTerminal();
    t.textarea.doc = document;
    const h = makeHandler(document, t);
    h._captureTerminalFocus();
    h.touchState.isSelecting = true;
    document.activeElement = t.textarea;
    t.textarea.fire('focus');
    expect(document.activeElement).toBeNull();   // never left on xterm's textarea
  });
});

describe('physical keyboard special keys on the hidden textarea', () => {
  let h;
  beforeEach(() => {
    h = makeHandler({ activeElement: null }, fakeTerminal());
  });

  test.each([
    [{ key: 'ArrowUp' }, '\x1b[A'],
    [{ key: 'ArrowLeft' }, '\x1b[D'],
    [{ key: 'ArrowRight', shiftKey: true }, '\x1b[1;2C'],
    [{ key: 'ArrowUp', ctrlKey: true }, '\x1b[1;5A'],
    [{ key: 'Home' }, '\x1b[H'],
    [{ key: 'End' }, '\x1b[F'],
    [{ key: 'PageUp' }, '\x1b[5~'],
    [{ key: 'PageDown' }, '\x1b[6~'],
    [{ key: 'Delete' }, '\x1b[3~'],
    [{ key: 'Insert' }, '\x1b[2~'],
    [{ key: 'Escape' }, '\x1b'],
    [{ key: 'F1' }, '\x1bOP'],
    [{ key: 'F5' }, '\x1b[15~'],
    [{ key: 'F12' }, '\x1b[24~'],
    [{ key: 'c', ctrlKey: true }, '\x03'],
    [{ key: 'd', ctrlKey: true }, '\x04'],
    [{ key: 'z', ctrlKey: true }, '\x1a'],
    [{ key: '[', ctrlKey: true }, '\x1b'],
    [{ key: 'x', altKey: true }, '\x1bx'],
    [{ key: 'b', altKey: true, ctrlKey: true }, '\x1b\x02'],
  ])('%o → %j', (props, seq) => {
    expect(h._specialKeySequence(keyEvent(props))).toBe(seq);
  });

  test('application cursor mode switches arrows/Home/End to SS3', () => {
    h.terminal.modes.applicationCursorKeysMode = true;
    expect(h._specialKeySequence(keyEvent({ key: 'ArrowDown' }))).toBe('\x1bOB');
    expect(h._specialKeySequence(keyEvent({ key: 'Home' }))).toBe('\x1bOH');
    expect(h._specialKeySequence(keyEvent({ key: 'ArrowDown', shiftKey: true }))).toBe('\x1b[1;2B');
  });

  test.each([
    [{ key: 'a' }], [{ key: 'A', shiftKey: true }], [{ key: ' ' }], [{ key: 'Shift' }], [{ key: 'Control' }],
    [{ key: 'v', ctrlKey: true }], [{ key: 'V', ctrlKey: true, shiftKey: true }], [{ key: 'a', ctrlKey: true }],
    [{ key: 'Unidentified', keyCode: 229 }], [{ key: 'Process' }], [{ key: 'Dead' }], [{ key: 'k', metaKey: true }],
  ])('%o is left to the browser / app handlers', (props) => {
    expect(h._specialKeySequence(keyEvent(props))).toBeNull();
  });

  test('keydown: special keys are sent and prevented, text keys are not', () => {
    const up = keyEvent({ key: 'ArrowUp' });
    h._handleTextareaKeyDown(up);
    expect(up.prevented).toBe(true);
    expect(h.sent).toEqual(['\x1b[A']);

    const a = keyEvent({ key: 'a' });
    h._handleTextareaKeyDown(a);
    expect(a.prevented).toBe(false);
    expect(h.sent).toEqual(['\x1b[A']);
  });

  test('keydown: IME keydowns (keyCode 229) are never prevented, even mid-composition', () => {
    h._isComposing = true;
    const ime = keyEvent({ key: 'Unidentified', keyCode: 229 });
    h._handleTextareaKeyDown(ime);
    expect(ime.prevented).toBe(false);
    const enter = keyEvent({ key: 'Enter' });
    h._handleTextareaKeyDown(enter);
    expect(enter.prevented).toBe(false);   // browser inserts \n → diff sends \r
    expect(h.sent).toEqual([]);
  });

  test('keydown: Backspace on an empty field goes straight to the terminal', () => {
    const bs = keyEvent({ key: 'Backspace' });
    h._handleTextareaKeyDown(bs);
    expect(bs.prevented).toBe(true);
    expect(h.sent).toEqual(['\x7f']);

    h.hiddenTextarea.value = 'ls';
    const bs2 = keyEvent({ key: 'Backspace' });
    h._handleTextareaKeyDown(bs2);
    expect(bs2.prevented).toBe(false);     // browser deletes, diff sends the DEL
    expect(h.sent).toEqual(['\x7f']);
  });

  test('keydown: Tab is sent, everything is swallowed while a selection is active', () => {
    const tab = keyEvent({ key: 'Tab' });
    h._handleTextareaKeyDown(tab);
    expect(tab.prevented).toBe(true);
    expect(h.sent).toEqual(['\t']);
    h.selection.active = true;
    const up = keyEvent({ key: 'ArrowUp' });
    h._handleTextareaKeyDown(up);
    expect(up.prevented).toBe(true);
    expect(h.sent).toEqual(['\t']);
  });
});

describe('diff across line breaks (keystroke-log semantics)', () => {
  let h;
  beforeEach(() => { h = makeHandler({ activeElement: null }); });

  test('Backspace on an empty line after Enter sends one DEL (was swallowed)', () => {
    h.hiddenTextarea.value = 'ls\n';
    h._syncTextareaToTerminal();
    expect(h.sent.join('')).toBe('ls\r');
    h.sent.length = 0;
    h.hiddenTextarea.value = 'ls';            // browser removed the newline
    h._syncTextareaToTerminal();
    expect(h.sent.join('')).toBe('\x7f');
    h.sent.length = 0;
    h.hiddenTextarea.value = 'l';             // and keeps deleting, like a real keyboard
    h._syncTextareaToTerminal();
    expect(h.sent.join('')).toBe('\x7f');
    expect(h._sentValue).toBe('l');
  });

  test('a swipe-to-delete crossing the newline sends one DEL per removed character', () => {
    h.hiddenTextarea.value = 'echo hi\nab';
    h._syncTextareaToTerminal();
    h.sent.length = 0;
    h.hiddenTextarea.value = 'echo';
    h._syncTextareaToTerminal();
    expect(h.sent.join('')).toBe('\x7f'.repeat(6));   // " hi" + "\n" + "ab"
  });

  test('an IME rewrite of an already submitted line sends nothing for that line', () => {
    h.hiddenTextarea.value = 'abc\ndef';
    h._syncTextareaToTerminal();
    h.sent.length = 0;
    h.hiddenTextarea.value = 'aXc\ndef';
    h._syncTextareaToTerminal();
    expect(h.sent).toEqual([]);
    expect(h._sentValue).toBe('aXc\ndef');
    // current-line changes are still delivered afterwards
    h.hiddenTextarea.value = 'aXc\ndefg';
    h._syncTextareaToTerminal();
    expect(h.sent).toEqual(['g']);
  });

  test('current-line correction plus previous-line rewrite only touches the current line', () => {
    h.hiddenTextarea.value = 'abc\nteh';
    h._syncTextareaToTerminal();
    h.sent.length = 0;
    h.hiddenTextarea.value = 'ABC\nthe ';
    h._syncTextareaToTerminal();
    expect(h.sent.join('')).toBe('\x7f\x7fhe ');
  });
});

describe('live composition sync', () => {
  test('composition updates are sent as they happen; compositionend adds a catch-up sync', () => {
    jest.useFakeTimers();
    const h = makeHandler({ activeElement: null });
    h._isComposing = true;
    h.hiddenTextarea.value = 'h';
    h._syncTextareaToTerminal();
    h.hiddenTextarea.value = 'he';
    h._syncTextareaToTerminal();
    h.hiddenTextarea.value = 'hel';
    h._syncTextareaToTerminal();
    expect(h.sent.join('')).toBe('hel');
    // suggestion tap replaces the composed word
    h.hiddenTextarea.value = 'hello ';
    h._syncTextareaToTerminal();
    expect(h.sent.join('')).toBe('hello ');
    h._onCompositionEnd();
    expect(h._isComposing).toBe(false);
    // Chrome committed the final text to the DOM only after compositionend
    h.hiddenTextarea.value = 'hello world ';
    jest.runAllTimers();
    expect(h.sent.join('')).toBe('hello world ');
    jest.useRealTimers();
  });
});

describe('re-opening a dismissed keyboard', () => {
  test('_reshowKeyboard keeps the field content and the deferred reset', () => {
    const document = { activeElement: null };
    const h = makeHandler(document);
    h.hiddenTextarea.value = 'git ';
    h._sentValue = 'git ';
    h.hiddenTextarea.focus();
    h._resetInputTracking();          // deferred: focused
    expect(h._pendingTrackingReset).toBe(true);

    h._reshowKeyboard();
    expect(document.activeElement).toBe(h.hiddenTextarea);
    expect(h.hiddenTextarea.value).toBe('git ');   // untouched across blur/focus
    expect(h._sentValue).toBe('git ');
    expect(h._pendingTrackingReset).toBe(true);     // still waits for a real blur
    expect(h.hiddenTextarea.selectionStart).toBe(4);

    h.hiddenTextarea.blur();                        // a real blur applies it
    expect(h.hiddenTextarea.value).toBe('');
    expect(h._pendingTrackingReset).toBe(false);
  });

  test('a tap on an already focused field re-opens the keyboard only when it looks hidden', () => {
    const document = { activeElement: null };
    const h = makeHandler(document);
    h.hiddenTextarea.focus();
    const reshow = jest.spyOn(h, '_reshowKeyboard').mockImplementation(() => {});
    jest.spyOn(h, '_keyboardProbablyHidden').mockReturnValue(false);
    h._focusHiddenTextarea({ userGesture: true });
    expect(reshow).not.toHaveBeenCalled();
    h._keyboardProbablyHidden.mockReturnValue(true);
    h._focusHiddenTextarea();                        // programmatic refocus: never
    expect(reshow).not.toHaveBeenCalled();
    h._focusHiddenTextarea({ userGesture: true });
    expect(reshow).toHaveBeenCalledTimes(1);
  });

  test('keyboard heuristic: a shrunken layout viewport means the keyboard is up', () => {
    const h = makeHandler({ activeElement: null });
    h._maxInnerHeightByWidth = { 393: 851 };
    // the sandbox window reports 393x851 → full height → hidden
    expect(h._keyboardProbablyHidden()).toBe(true);
    h._maxInnerHeightByWidth = { 393: 1400 };
    expect(h._keyboardProbablyHidden()).toBe(false);
  });
});

describe('touch end', () => {
  function touchEnd(h, { dx = 0, dy = 0, elapsed = 300 } = {}) {
    h.touchState.startX = 100; h.touchState.startY = 200;
    h.touchState.startTime = Date.now() - elapsed;
    h.touchState.isSelecting = true;
    h._handleTouchEnd({ changedTouches: [{ clientX: 100 + dx, clientY: 200 + dy }] });
  }

  test('any tap shorter than a long press focuses the field with a user gesture', () => {
    const h = makeHandler({ activeElement: null });
    const focus = jest.spyOn(h, '_focusHiddenTextarea').mockImplementation(() => {});
    touchEnd(h, { elapsed: 350 });     // used to be ignored (>200 ms) and left isSelecting stuck
    expect(focus).toHaveBeenCalledWith({ userGesture: true });
    expect(h.touchState.isSelecting).toBe(false);
  });

  test('a scroll gesture does not focus but still leaves selection mode', () => {
    const h = makeHandler({ activeElement: null });
    const focus = jest.spyOn(h, '_focusHiddenTextarea').mockImplementation(() => {});
    touchEnd(h, { dy: 40 });
    expect(focus).not.toHaveBeenCalled();
    expect(h.touchState.isSelecting).toBe(false);
  });
});
