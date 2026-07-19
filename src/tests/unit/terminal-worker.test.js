/**
 * Unit tests for the terminal data worker (`src/webapp/js/terminal-worker.js`).
 *
 * The worker file is written for the browser Web Worker environment (it uses
 * `self.onmessage` and `self.postMessage`). Jest's default test environment
 * is `node`, so we evaluate the worker source in a minimal mock of the
 * browser-worker global scope and assert on the postMessage calls the worker
 * emits back to the "main thread".
 *
 * Timeouts are mocked with fake timers so the 8ms flush interval doesn't
 * slow the suite down.
 */

const path = require('path');
const fs = require('fs');

function loadWorker() {
  // Per-invocation mock of the browser Worker global scope.
  const posted = [];
  const scope = {
    postMessage: (msg) => posted.push(msg),
    setTimeout: (fn, ms) => setTimeout(fn, ms), // passthrough; tests use fake timers
    clearTimeout,
    console: console,
    warn: console.warn
  };
  // Evaluate the worker file in a function scope where `self` resolves
  // to our mock and bare references like `postMessage`/`setTimeout` work.
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'webapp', 'js', 'terminal-worker.js'),
    'utf8'
  );
  // eslint-disable-next-line no-new-func
  const factory = new Function('self', 'postMessage', 'setTimeout', 'clearTimeout', 'console', source + '\nreturn self;');
  const selfRef = factory(scope, scope.postMessage, scope.setTimeout, scope.clearTimeout, console) || scope;
  return {
    post: (msg) => selfRef.onmessage({ data: msg }),
    posted
  };
}

describe('terminal-worker.js protocol', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('`init` acks with a `ready` message including cols/rows', () => {
    const w = loadWorker();
    w.post({ type: 'init', sessionId: 's1', cols: 120, rows: 40 });
    const ready = w.posted.find(m => m.type === 'ready');
    expect(ready).toBeDefined();
    expect(ready.sessionId).toBe('s1');
    expect(ready.cols).toBe(120);
    expect(ready.rows).toBe(40);
  });

  test('`ping` acks with `pong`', () => {
    const w = loadWorker();
    w.post({ type: 'ping', sessionId: 's1' });
    const pong = w.posted.find(m => m.type === 'pong');
    expect(pong).toBeDefined();
    expect(pong.sessionId).toBe('s1');
  });

  test('`data` flushes the exact payload back to the main thread', () => {
    const w = loadWorker();
    w.post({ type: 'data', sessionId: 's1', data: 'Hello\r\n' });
    // Flush is async via setTimeout(flushInterval=8ms).
    jest.advanceTimersByTime(50);
    const data = w.posted.find(m => m.type === 'data' && m.sessionId === 's1');
    expect(data).toBeDefined();
    expect(data.data).toBe('Hello\r\n');
  });

  test('unknown message type yields an explicit `error` reply', () => {
    const w = loadWorker();
    w.post({ type: 'bogus', sessionId: 's1' });
    const err = w.posted.find(m => m.type === 'error');
    expect(err).toBeDefined();
    expect(err.error).toBe('unknownMessage');
    expect(err.messageType).toBe('bogus');
  });

  test('`pause` stops further flushes until `resume` arrives', () => {
    const w = loadWorker();
    w.post({ type: 'data', sessionId: 's1', data: 'first' });
    // Let the first flush fire before pausing.
    jest.advanceTimersByTime(50);
    w.post({ type: 'pause', sessionId: 's1' });
    w.post({ type: 'data', sessionId: 's1', data: 'second' });
    jest.advanceTimersByTime(200);
    const flushed = w.posted.filter(m => m.type === 'data' && m.sessionId === 's1');
    // Only "first" should have been flushed before pause took effect.
    // "second" is buffered but not flushed until resume.
    expect(flushed.length).toBe(1);
    expect(flushed[0].data).toBe('first');

    w.post({ type: 'resume', sessionId: 's1' });
    jest.advanceTimersByTime(200);
    const afterResume = w.posted.filter(m => m.type === 'data' && m.sessionId === 's1');
    const secondFlush = afterResume.find(m => m.data === 'second');
    expect(secondFlush).toBeDefined();
  });

  test('`destroy` deletes session state', () => {
    const w = loadWorker();
    w.post({ type: 'data', sessionId: 's1', data: 'pending' });
    w.post({ type: 'destroy', sessionId: 's1' });
    // Session state is gone — subsequent stats should return null.
    w.post({ type: 'stats', sessionId: 's1' });
    const stats = w.posted.find(m => m.type === 'stats' && m.sessionId === 's1');
    expect(stats.stats).toBeNull();
  });

  test('`config` updates chunk size and flush interval without dropping sessions', () => {
    const w = loadWorker();
    w.post({ type: 'init', sessionId: 's1' });
    w.post({ type: 'config', chunkSize: 1024, flushInterval: 4 });
    w.post({ type: 'data', sessionId: 's1', data: 'x'.repeat(2048) });
    jest.advanceTimersByTime(50);
    // With chunkSize=1024 and a 2048-byte buffer, the first flush should
    // emit exactly 1024 bytes and a second flush should emit the rest.
    const flushes = w.posted.filter(m => m.type === 'data' && m.sessionId === 's1');
    expect(flushes.length).toBe(2);
    expect(flushes[0].data.length).toBe(1024);
    expect(flushes[1].data.length).toBe(1024);
  });
});