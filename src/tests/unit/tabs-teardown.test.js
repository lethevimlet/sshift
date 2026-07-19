/**
 * Phase 7 hardening tests for sticky-session teardown.
 *
 * Verifies that explicit `tab-close` / `ssh-disconnect` / `sftp-disconnect`
 * from one client does NOT yank the underlying SSH/SFTP stream out from
 * under other viewers when sticky is enabled, and that the same flow
 * schedules a cancelable grace period for non-sticky sessions with no
 * remaining viewers.
 *
 * Tests drive the WS handlers via mock sockets/io and assert on emitted
 * events + direct calls into sshManager/sftpManager/tab-manager.
 */

// Build a minimal mock socket that records handler registrations and
// routes broadcasts back through a shared io mock.
function makeMockSocket(id) {
  const handlers = new Map();
  const socketEmitted = [];
  return {
    socket: {
      id,
      on: (event, handler) => handlers.set(event, handler),
      once: (event, handler) => handlers.set(event, handler),
      emit: (event, data) => socketEmitted.push({ event, data, target: 'self' }),
      to: () => ({ emit: (event, data) => socketEmitted.push({ event, data, target: 'room' }) }),
      broadcast: { emit: (event, data) => socketEmitted.push({ event, data, target: 'broadcast' }) },
      join: () => {},
      leave: () => {}
    },
    handlers,
    socketEmitted
  };
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

describe('sticky tab close respects remaining viewers', () => {
  let registerSSHHandlers;
  let registerSFTPHandlers;
  let registerTabHandlers;
  let sshManager;
  let sftpManager;
  let tabManager;

  beforeEach(() => {
    jest.resetModules();
    registerSSHHandlers = require('../../server/endpoints/ws/ssh').registerSSHHandlers;
    registerSFTPHandlers = require('../../server/endpoints/ws/sftp').registerSFTPHandlers;
    registerTabHandlers = require('../../server/endpoints/ws/tabs').registerTabHandlers;
    sshManager = require('../../server/services').sshManager;
    sftpManager = require('../../server/services').sftpManager;
    tabManager = require('../../server/utils/tab-manager');
  });

  afterEach(() => {
    // Clear tab-manager singleton state.
    for (const [sid] of tabManager.getOpenTabs()) {
      tabManager.removeTab(sid);
    }
    // Clear sshManager singleton state.
    for (const [sid] of sshManager.sessions) {
      try { sshManager.disconnect(sid); } catch (_) {}
    }
  });

  test('tab-close with remaining viewers keeps the session alive (no tab-closed emit)', () => {
    const { socket, handlers } = makeMockSocket('sock-closer');
    const { io, ioEmitted } = makeMockIo();
    registerTabHandlers(socket, io);

    // Set up a tab with TWO active sockets (the closer + one remaining viewer).
    tabManager.addTab('s-sticky-1', {
      name: 'Test',
      type: 'ssh',
      connectionData: {},
      activeSockets: new Set(['sock-closer', 'sock-remain']),
      sticky: true
    });

    // Drive the tab-close handler.
    handlers.get('tab-close')({ sessionId: 's-sticky-1' });

    // The tab record should still exist (we only removed the closer's socket).
    const tab = tabManager.getTab('s-sticky-1');
    expect(tab).toBeDefined();
    expect(tab.activeSockets.size).toBe(1);
    expect([...tab.activeSockets][0]).toBe('sock-remain');

    // The handler must NOT emit `tab-closed` (the session is still in use).
    const tabClosed = ioEmitted.filter(e => e.event === 'tab-closed');
    expect(tabClosed.length).toBe(0);
    // It should emit `sessions-updated` so remaining viewers refresh counts.
    const sessionsUpdated = ioEmitted.filter(e => e.event === 'sessions-updated');
    expect(sessionsUpdated.length).toBeGreaterThanOrEqual(1);
  });

  test('tab-close for the LAST viewer on a sticky session keeps it alive indefinitely', () => {
    const { socket, handlers } = makeMockSocket('sock-last-sticky');
    const { io, ioEmitted } = makeMockIo();
    registerTabHandlers(socket, io);

    tabManager.addTab('s-sticky-last', {
      name: 'Test',
      type: 'ssh',
      connectionData: {},
      activeSockets: new Set(['sock-last-sticky']),
      sticky: true
    });

    handlers.get('tab-close')({ sessionId: 's-sticky-last' });

    // After the close, no viewers remain. Sticky sessions must NOT schedule
    // a grace timer OR destroy the underlying session — the tab remains
    // for another client to rejoin later.
    const tab = tabManager.getTab('s-sticky-last');
    expect(tab).toBeDefined();
    expect(tab.closeTimer).toBeFalsy();
    // No tab-closed broadcast (session is still alive on the server).
    const tabClosed = ioEmitted.filter(e => e.event === 'tab-closed');
    expect(tabClosed.length).toBe(0);
  });

  test('tab-close for the LAST viewer on a NON-sticky session schedules a 5s grace timer', () => {
    const { socket, handlers } = makeMockSocket('sock-nonsticky');
    const { io, ioEmitted } = makeMockIo();
    registerTabHandlers(socket, io);

    tabManager.addTab('s-nonsticky-1', {
      name: 'Test',
      type: 'ssh',
      connectionData: {},
      activeSockets: new Set(['sock-nonsticky']),
      sticky: false
    });

    // Use fake timers so we can control the 5s grace window.
    jest.useFakeTimers();
    try {
      handlers.get('tab-close')({ sessionId: 's-nonsticky-1' });

      // Grace timer should be armed but the tab and SSH stream are still alive
      // until the timer fires.
      const tab = tabManager.getTab('s-nonsticky-1');
      expect(tab).toBeDefined();
      expect(tab.closeTimer).toBeTruthy();
      expect(ioEmitted.filter(e => e.event === 'tab-closed').length).toBe(0);

      // Spy on the manager's disconnect so we can assert it fires only
      // after the grace period.
      const realDisconnect = sshManager.disconnect.bind(sshManager);
      let disconnectCalls = [];
      sshManager.disconnect = (sid) => { disconnectCalls.push(sid); };
      try {
        // Re-running the handler with the spy in place.
        tabManager.addTab('s-nonsticky-2', {
          name: 'Test',
          type: 'ssh',
          connectionData: {},
          activeSockets: new Set(['sock-nonsticky-2']),
          sticky: false
        });
        handlers.get('tab-close')({ sessionId: 's-nonsticky-2' });
        // Not yet fired.
        expect(disconnectCalls.length).toBe(0);
        jest.advanceTimersByTime(5001);
        // After the 5s grace, disconnect fires for the second session.
        expect(disconnectCalls.length).toBeGreaterThanOrEqual(1);
      } finally {
        sshManager.disconnect = realDisconnect;
      }
    } finally {
      jest.useRealTimers();
    }
  });

  test('ssh-disconnect with remaining viewers calls leaveSession and keeps session alive', () => {
    const { socket, handlers } = makeMockSocket('sock-ssh-close');
    const { io, ioEmitted } = makeMockIo();
    registerSSHHandlers(socket, io);

    tabManager.addTab('s-ssh-1', {
      name: 'Test',
      type: 'ssh',
      connectionData: {},
      activeSockets: new Set(['sock-ssh-close', 'sock-other']),
      sticky: true
    });

    // Stub leaveSession so we can verify the closer's socket is dropped
    // from the SSH session room (without affecting the SSH stream itself).
    let leaveCalls = [];
    const realLeave = sshManager.leaveSession.bind(sshManager);
    sshManager.leaveSession = (sock, sid) => { leaveCalls.push({ sockId: sock.id, sid }); };

    handlers.get('ssh-disconnect')({ sessionId: 's-ssh-1' });

    // leaveSession was called for the closing socket.
    expect(leaveCalls.length).toBe(1);
    expect(leaveCalls[0]).toEqual({ sockId: 'sock-ssh-close', sid: 's-ssh-1' });
    // The remaining viewer is preserved.
    const tab = tabManager.getTab('s-ssh-1');
    expect(tab.activeSockets.size).toBe(1);
    expect([...tab.activeSockets][0]).toBe('sock-other');
    // No tab-closed broadcast (still viewers + sticky).
    expect(ioEmitted.filter(e => e.event === 'tab-closed').length).toBe(0);

    sshManager.leaveSession = realLeave;
  });

  test('ssh-disconnect for sticky + no viewers keeps session alive and schedules no timer', () => {
    const { socket, handlers } = makeMockSocket('sock-ssh-last');
    const { io, ioEmitted } = makeMockIo();
    registerSSHHandlers(socket, io);

    tabManager.addTab('s-ssh-sticky-last', {
      name: 'Test',
      type: 'ssh',
      connectionData: {},
      activeSockets: new Set(['sock-ssh-last']),
      sticky: true
    });

    // leaveSession should still fire (the closing socket leaves the room).
    let leaveCalls = [];
    const realLeave = sshManager.leaveSession.bind(sshManager);
    sshManager.leaveSession = (sock, sid) => { leaveCalls.push({ sockId: sock.id, sid }); };

    handlers.get('ssh-disconnect')({ sessionId: 's-ssh-sticky-last' });

    expect(leaveCalls.length).toBe(1);
    const tab = tabManager.getTab('s-ssh-sticky-last');
    expect(tab).toBeDefined();
    expect(tab.closeTimer).toBeFalsy();
    expect(ioEmitted.filter(e => e.event === 'tab-closed').length).toBe(0);

    sshManager.leaveSession = realLeave;
  });

  test('sftp-disconnect with remaining viewers keeps the session alive', () => {
    const { socket, handlers } = makeMockSocket('sock-sftp-close');
    const { io, ioEmitted } = makeMockIo();
    registerSFTPHandlers(socket, io);

    tabManager.addTab('s-sftp-1', {
      name: 'Test',
      type: 'sftp',
      connectionData: {},
      activeSockets: new Set(['sock-sftp-close', 'sock-other']),
      sticky: true
    });

    handlers.get('sftp-disconnect')({ sessionId: 's-sftp-1' });

    const tab = tabManager.getTab('s-sftp-1');
    expect(tab).toBeDefined();
    expect(tab.activeSockets.size).toBe(1);
    expect([...tab.activeSockets][0]).toBe('sock-other');
    expect(ioEmitted.filter(e => e.event === 'tab-closed').length).toBe(0);
  });

  test('ssh-disconnect rejoining within grace cancels the close', () => {
    const { socket, handlers } = makeMockSocket('sock-grace');
    const { io } = makeMockIo();
    registerSSHHandlers(socket, io);

    // Non-sticky with one viewer.
    tabManager.addTab('s-grace-1', {
      name: 'Test',
      type: 'ssh',
      connectionData: {},
      activeSockets: new Set(['sock-grace']),
      sticky: false
    });

    jest.useFakeTimers();
    try {
      handlers.get('ssh-disconnect')({ sessionId: 's-grace-1' });
      const tab = tabManager.getTab('s-grace-1');
      expect(tab.closeTimer).toBeTruthy();

      // Simulate a new viewer joining within the grace window by
      // adding a fresh active socket entry to the tab.
      tabManager.addSocketToTab('s-grace-1', 'sock-rejoin');
      expect(tab.activeSockets.size).toBe(1); // closer was already removed

      // Advance past the grace period. The handler's setTimeout callback
      // checks activeSockets.size and should NOT close the session.
      let disconnectCalls = [];
      const realDisconnect = sshManager.disconnect.bind(sshManager);
      sshManager.disconnect = (sid) => { disconnectCalls.push(sid); };
      try {
        jest.advanceTimersByTime(5001);
        expect(disconnectCalls.length).toBe(0);
      } finally {
        sshManager.disconnect = realDisconnect;
      }
    } finally {
      jest.useRealTimers();
    }
  });
});