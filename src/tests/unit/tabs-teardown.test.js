/**
 * Explicit closes end shared sessions; detach/disconnect retains sticky
 * sessions and reconnect grace without interrupting other viewers.
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

describe('explicit close versus temporary detach', () => {
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

  test.each([
    ['ssh', true, ['sock-closer', 'sock-remain']],
    ['ssh', true, ['sock-closer']],
    ['ssh', false, ['sock-closer']],
    ['sftp', true, ['sock-closer', 'sock-remain']],
    ['sftp', false, ['sock-closer']]
  ])('tab-close terminates %s (sticky=%s, viewers=%j) immediately', (type, sticky, viewers) => {
    const { socket, handlers } = makeMockSocket('sock-closer');
    const { io, ioEmitted } = makeMockIo();
    registerTabHandlers(socket, io);
    const disconnect = jest.spyOn(type === 'ssh' ? sshManager : sftpManager, 'disconnect').mockImplementation(() => {});
    tabManager.addTab('s-sticky-1', {
      name: 'Test',
      type,
      connectionData: {},
      activeSockets: new Set(viewers),
      sticky
    });
    tabManager.setActiveTab('panel-0', 's-sticky-1');
    tabManager.setActiveSession('s-sticky-1');
    const timer = setTimeout(() => { throw new Error('Closed session timer fired'); }, 5000);
    tabManager.setCloseTimer('s-sticky-1', timer);
    handlers.get('tab-close')({ sessionId: 's-sticky-1' });
    expect(disconnect).toHaveBeenCalledWith('s-sticky-1');
    expect(tabManager.getTab('s-sticky-1')).toBeUndefined();
    expect(tabManager.getTabOrder()).not.toContain('s-sticky-1');
    expect(tabManager.getActiveSession()).toBeNull();
    expect(ioEmitted).toContainEqual({ event: 'tab-closed', data: { sessionId: 's-sticky-1' }, target: 'io' });
    expect(ioEmitted.some(e => e.event === 'sessions-updated')).toBe(true);
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
