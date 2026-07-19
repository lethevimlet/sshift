/**
 * Server-side robustness tests for the WebSocket handler hardening done
 * in Phase 3 + Phase 4.
 *
 * These tests instantiate the WS handlers with a mock socket/io and
 * drive them with crafted payloads to verify the validation guards:
 *
 *   - `ssh-data` rejects non-string payloads (would throw inside ssh2
 *     stream.write otherwise).
 *   - `ssh-resize` rejects out-of-range cols/rows (would crash headless
 *     terminal.resize otherwise).
 *   - `ssh-request-sync` enforces a per-session 2s rate limit so a
 *     non-controller can't DoS the server with 1MB serializations.
 *
 * Plus direct `sshManager` unit tests:
 *
 *   - `sshManager.resize` swallows `stream.setWindow` and
 *     `terminal.resize` throws (a malformed payload must NOT tear down
 *     an otherwise-healthy session).
 *   - `sshManager.write` caps `writeQueue` at 64 chunks and emits
 *     `ssh-error` with `bufferFull` on overflow (avoids server OOM on
 *     a slow/half-open remote).
 *   - `sshManager.disconnect` calls both `stream.end()` and
 *     `stream.destroy()` to force teardown of half-open sockets.
 *   - `sshManager.disconnect` clears `session.exitTimer` (the 500ms
 *     safety timer armed by `stream.on('exit')`).
 *   - `sshManager.getTerminalState` returns null on serialize throw
 *     instead of propagating the exception.
 */

const path = require('path');

// Helper: build a minimal mock socket that records handler registrations
// and offers a fake `emit`/`to`/`broadcast` API.
function makeMockSocket(id = 'sock-1') {
  const handlers = new Map();
  const socketEmitted = [];
  const socket = {
    id,
    on(event, handler) {
      handlers.set(event, handler);
    },
    once(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, data) {
      socketEmitted.push({ event, data, target: 'self' });
    },
    to(room) {
      return {
        emit: (event, data) => socketEmitted.push({ event, data, target: 'room', room })
      };
    },
    broadcast: {
      emit: (event, data) => socketEmitted.push({ event, data, target: 'broadcast' })
    },
    join: () => {},
    leave: () => {}
  };
  return { socket, handlers, socketEmitted };
}

function makeMockIo() {
  const ioEmitted = [];
  return {
    io: {
      emit: (event, data) => ioEmitted.push({ event, data, target: 'io' }),
      to: () => ({ emit: (event, data) => ioEmitted.push({ event, data, target: 'io-room' }) })
    },
    ioEmitted
  };
}

// The sshManager is a module-level singleton. Reset its state between
// tests so a tab from one test doesn't leak into another.
function resetSshManagerState(sshManager) {
  for (const [sid] of sshManager.sessions) {
    try { sshManager.disconnect(sid); } catch (_) {}
  }
}

describe('SSH WS handler payload validation', () => {
  let registerSSHHandlers;
  let sshManager;
  let tabManager;

  beforeEach(() => {
    jest.resetModules();
    registerSSHHandlers = require('../../server/endpoints/ws/ssh').registerSSHHandlers;
    sshManager = require('../../server/services').sshManager;
    tabManager = require('../../server/utils/tab-manager');
    resetSshManagerState(sshManager);
  });

  afterEach(() => {
    // Clear any leftover tab state in the singleton tab manager.
    for (const [sid] of tabManager.getOpenTabs()) {
      tabManager.removeTab(sid);
    }
    resetSshManagerState(sshManager);
  });

  test('ssh-data with a non-string payload emits ssh-error and skips the write', () => {
    const { socket, handlers, socketEmitted } = makeMockSocket('sock-1');
    const { io } = makeMockIo();
    registerSSHHandlers(socket, io);

    // Stub isController to true so the validation path runs.
    sshManager.isController = () => true;
    // Replace sshManager.write with a spy that throws if it's ever
    // called with a non-string (the underlying ssh2 write would throw).
    let writeCalls = [];
    const realWrite = sshManager.write.bind(sshManager);
    sshManager.write = (sid, data) => { writeCalls.push({ sid, data }); };
    // Also inject a fake session so the path doesn't bail earlier.
    sshManager.sessions.set('s-x', { stream: { write: () => true } });

    handlers.get('ssh-data')({ sessionId: 's-x', data: 123 });
    const errs = socketEmitted.filter(e => e.event === 'ssh-error');
    expect(errs.length).toBe(1);
    expect(errs[0].data.message).toMatch(/Invalid input payload/);
    expect(writeCalls.length).toBe(0);

    sshManager.write = realWrite;
  });

  test('ssh-data with a string payload forwards to sshManager.write', () => {
    const { socket, handlers } = makeMockSocket('sock-2');
    const { io } = makeMockIo();
    registerSSHHandlers(socket, io);

    sshManager.isController = () => true;
    let writeCalls = [];
    const realWrite = sshManager.write.bind(sshManager);
    sshManager.write = (sid, data) => { writeCalls.push({ sid, data }); };

    handlers.get('ssh-data')({ sessionId: 's-x', data: 'ls -la\r' });
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0]).toEqual({ sid: 's-x', data: 'ls -la\r' });

    sshManager.write = realWrite;
  });

  test('ssh-resize rejects cols=0 / rows=0 (would crash headless terminal.resize)', () => {
    const { socket, handlers, socketEmitted } = makeMockSocket('sock-3');
    const { io } = makeMockIo();
    registerSSHHandlers(socket, io);

    sshManager.isController = () => true;
    let resizeCalls = [];
    const realResize = sshManager.resize.bind(sshManager);
    sshManager.resize = (sid, cols, rows) => { resizeCalls.push({ sid, cols, rows }); };

    handlers.get('ssh-resize')({ sessionId: 's-x', cols: 0, rows: 24 });
    handlers.get('ssh-resize')({ sessionId: 's-x', cols: 80, rows: 0 });
    handlers.get('ssh-resize')({ sessionId: 's-x', cols: -1, rows: 24 });
    handlers.get('ssh-resize')({ sessionId: 's-x', cols: 80, rows: 'NaN' });

    const errs = socketEmitted.filter(e => e.event === 'ssh-error');
    expect(errs.length).toBe(4);
    errs.forEach(e => expect(e.data.message).toMatch(/Invalid terminal dimensions/));
    expect(resizeCalls.length).toBe(0);

    sshManager.resize = realResize;
  });

  test('ssh-resize rejects oversized cols / rows', () => {
    const { socket, handlers, socketEmitted } = makeMockSocket('sock-4');
    const { io } = makeMockIo();
    registerSSHHandlers(socket, io);

    sshManager.isController = () => true;
    sshManager.resize = () => { throw new Error('should not be called'); };

    handlers.get('ssh-resize')({ sessionId: 's-x', cols: 401, rows: 24 });
    handlers.get('ssh-resize')({ sessionId: 's-x', cols: 80, rows: 201 });

    const errs = socketEmitted.filter(e => e.event === 'ssh-error');
    expect(errs.length).toBe(2);
  });

  test('ssh-resize accepts in-range dimensions and forwards to sshManager.resize', () => {
    const { socket, handlers, socketEmitted } = makeMockSocket('sock-5');
    const { io } = makeMockIo();
    registerSSHHandlers(socket, io);

    sshManager.isController = () => true;
    let resizeCalls = [];
    sshManager.resize = (sid, cols, rows) => { resizeCalls.push({ sid, cols, rows }); };

    handlers.get('ssh-resize')({ sessionId: 's-x', cols: 120, rows: 40 });
    expect(resizeCalls.length).toBe(1);
    expect(resizeCalls[0]).toEqual({ sid: 's-x', cols: 120, rows: 40 });
    const errs = socketEmitted.filter(e => e.event === 'ssh-error');
    expect(errs.length).toBe(0);
  });

  test('ssh-request-sync rate limits to one request per 2 seconds per session', () => {
    const { socket, handlers, socketEmitted } = makeMockSocket('sock-6');
    const { io } = makeMockIo();
    registerSSHHandlers(socket, io);

    // Provide a fake terminal state so the success path is exercised.
    sshManager.getTerminalState = () => ({ state: 'fake', cols: 80, rows: 24 });

    handlers.get('ssh-request-sync')({ sessionId: 's-rate' });
    handlers.get('ssh-request-sync')({ sessionId: 's-rate' });

    const errs = socketEmitted.filter(e => e.event === 'ssh-error');
    expect(errs.length).toBe(1);
    expect(errs[0].data.message).toMatch(/Sync rate limit/);
  });

  test('ssh-request-sync allows a second request after the rate window', () => {
    const { socket, handlers, socketEmitted } = makeMockSocket('sock-7');
    const { io } = makeMockIo();
    registerSSHHandlers(socket, io);

    sshManager.getTerminalState = () => ({ state: 'fake', cols: 80, rows: 24 });

    handlers.get('ssh-request-sync')({ sessionId: 's-rate2' });
    // Advance past the 2s rate window. ssh.js measures wall-clock via
    // Date.now(); use a synchronous busy-wait so the handler sees the
    // new timestamp on its next invocation.
    const start = Date.now();
    while (Date.now() - start < 2100) {
      // busy-wait — keeps this test self-contained, no fake timers.
    }
    handlers.get('ssh-request-sync')({ sessionId: 's-rate2' });

    const errs = socketEmitted.filter(e => e.event === 'ssh-error');
    expect(errs.length).toBe(0);
  });
});

describe('sshManager core hardening', () => {
  let sshManager;

  beforeEach(() => {
    jest.resetModules();
    sshManager = require('../../server/services').sshManager;
    resetSshManagerState(sshManager);
  });

  afterEach(() => {
    resetSshManagerState(sshManager);
  });

  test('resize swallows stream.setWindow throws', () => {
    const stream = {
      setWindow: () => { throw new Error('boom'); }
    };
    const terminal = {
      resize: () => {}
    };
    sshManager.sessions.set('s-r1', { stream, terminal, cols: 80, rows: 24 });

    expect(() => sshManager.resize('s-r1', 120, 40)).not.toThrow();
    // cols/rows were updated even though setWindow threw — local state
    // stays consistent with what we asked the PTY to adopt.
    const session = sshManager.sessions.get('s-r1');
    expect(session.cols).toBe(120);
    expect(session.rows).toBe(40);
  });

  test('resize swallows headless terminal.resize throws', () => {
    const stream = {
      setWindow: () => {}
    };
    const terminal = {
      resize: () => { throw new Error('bad dims'); }
    };
    sshManager.sessions.set('s-r2', { stream, terminal, cols: 80, rows: 24 });
    expect(() => sshManager.resize('s-r2', 120, 40)).not.toThrow();
  });

  test('write caps writeQueue at 64 chunks and emits ssh-error(bufferFull) on overflow', () => {
    // Force stream.write to return false (backpressure) so every queued
    // chunk piles up in writeQueue.
    const stream = {
      write: () => false,
      once: () => {}
    };
    const captured = [];
    sshManager.sessions.set('s-w1', { stream, writeQueue: [], drainListener: false });
    // Force broadcastToSession to be observable so we can detect the
    // ssh-error emission. We replace io temporarily.
    const origIo = sshManager.io;
    sshManager.io = {
      to: () => ({
        emit: (event, data) => captured.push({ event, data })
      })
    };

    // Push 70 chunks; the cap is 64.
    // First 64: queue grows from 0 to 64 (each call pushes).
    // 65th call: queue.length >= 64 → overflow path → queue cleared,
    //            ssh-error(bufferFull) emitted, return without pushing.
    // Calls 66..70: queue.length is 0 again → push succeeds, grows to 5.
    for (let i = 0; i < 70; i++) {
      sshManager.write('s-w1', 'x');
    }
    const errors = captured.filter(e => e.event === 'ssh-error');
    expect(errors.length).toBe(1);
    expect(errors[0].data.message).toBe('bufferFull');
    // After the 65th call cleared the queue, calls 66..70 re-populated it
    // with 5 chunks. Verifying the queue has at most 64 elements (not
    // unbounded growth) is the real invariant the cap enforces.
    const session = sshManager.sessions.get('s-w1');
    expect(session.writeQueue.length).toBeLessThanOrEqual(64);
    expect(session.writeQueue.length).toBe(5);

    sshManager.io = origIo;
  });

  test('disconnect calls both stream.end() and stream.destroy()', () => {
    let endCalls = 0;
    let destroyCalls = 0;
    const stream = {
      end: () => { endCalls++; },
      destroy: () => { destroyCalls++; }
    };
    const conn = { end: () => {} };
    const terminal = { dispose: () => {} };
    sshManager.sessions.set('s-d1', { stream, conn, terminal, batchTimer: null });

    sshManager.disconnect('s-d1');
    expect(endCalls).toBe(1);
    expect(destroyCalls).toBe(1);
    expect(sshManager.sessions.has('s-d1')).toBe(false);
  });

  test('disconnect clears the exitTimer', () => {
    let timerCleared = false;
    const timer = setTimeout(() => {}, 10000);
    const stream = { end: () => {}, destroy: () => {} };
    const conn = { end: () => {} };
    const terminal = { dispose: () => {} };
    sshManager.sessions.set('s-d2', { stream, conn, terminal, batchTimer: null, exitTimer: timer });
    // Spy on clearTimeout — disconnect should call it.
    const origClear = global.clearTimeout;
    let clearedArgs = [];
    global.clearTimeout = (t) => { clearedArgs.push(t); origClear(t); };
    try {
      sshManager.disconnect('s-d2');
      expect(clearedArgs).toContain(timer);
    } finally {
      global.clearTimeout = origClear;
    }
    expect(sshManager.sessions.has('s-d2')).toBe(false);
  });

  test('disconnect is idempotent (calling twice does not throw)', () => {
    const stream = { end: () => {}, destroy: () => {} };
    const conn = { end: () => {} };
    const terminal = { dispose: () => {} };
    sshManager.sessions.set('s-d3', { stream, conn, terminal, batchTimer: null });
    sshManager.disconnect('s-d3');
    expect(() => sshManager.disconnect('s-d3')).not.toThrow();
  });

  test('getTerminalState returns null when serialize throws', () => {
    // Build a session whose serializeAddon.serialize throws.
    const session = {
      terminal: {},
      serializeAddon: {
        serialize: () => { throw new Error('concurrent dispose'); }
      },
      cols: 80,
      rows: 24
    };
    sshManager.sessions.set('s-g1', session);
    const state = sshManager.getTerminalState('s-g1');
    expect(state).toBeNull();
  });

  test('getTerminalState returns null for an unknown session', () => {
    expect(sshManager.getTerminalState('s-nonexistent')).toBeNull();
  });

  test('broadcastToSession is a no-op when io is not set', () => {
    const origIo = sshManager.io;
    sshManager.io = null;
    sshManager.sessions.set('s-b1', { sockets: new Set(['x']) });
    expect(() => sshManager.broadcastToSession('s-b1', 'test', {})).not.toThrow();
    sshManager.io = origIo;
  });
});