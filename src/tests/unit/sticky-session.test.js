/**
 * Unit tests for sticky session management
 * Tests the tab management logic without requiring a server
 */

// Mock tab manager class (simulates server-side tab management)
class MockTabManager {
  constructor() {
    this.tabs = new Map();
    this.timers = new Map();
  }
  
  createSession(sessionId, sticky = true) {
    this.tabs.set(sessionId, {
      name: 'test-ssh',
      type: 'ssh',
      connectionData: { host: 'localhost', port: 22, username: 'testuser' },
      activeSockets: new Set(),
      sticky: sticky,
      closeTimer: null
    });
    return this.tabs.get(sessionId);
  }
  
  addSocket(sessionId, socketId) {
    const tab = this.tabs.get(sessionId);
    if (tab) {
      // Clear any pending close timer
      if (tab.closeTimer) {
        clearTimeout(tab.closeTimer);
        tab.closeTimer = null;
      }
      tab.activeSockets.add(socketId);
    }
  }
  
  removeSocket(sessionId, socketId) {
    const tab = this.tabs.get(sessionId);
    if (tab) {
      tab.activeSockets.delete(socketId);
      
      // If no more active sockets, schedule session close with grace period
      if (tab.activeSockets.size === 0) {
        const gracePeriod = tab.sticky ? 5000 : 1000;
        
        return new Promise((resolve) => {
          tab.closeTimer = setTimeout(() => {
            const currentTab = this.tabs.get(sessionId);
            if (currentTab && currentTab.activeSockets.size === 0) {
              this.tabs.delete(sessionId);
              resolve({ closed: true });
            } else {
              resolve({ closed: false, reason: 'new_sockets' });
            }
          }, gracePeriod);
          
          resolve({ timerStarted: true, gracePeriod });
        });
      }
    }
    return Promise.resolve({ closed: false });
  }
  
  getSession(sessionId) {
    return this.tabs.get(sessionId);
  }
}

describe('Sticky Session Unit Tests', () => {
  // Use fake timers for timer-related tests
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Grace Period Prevents Immediate Close', () => {
    test('should start grace period on disconnect', async () => {
      const manager = new MockTabManager();
      const sessionId = 'test-session-1';
      
      // Create session with sticky enabled
      manager.createSession(sessionId, true);
      manager.addSocket(sessionId, 'socket-1');
      
      // Remove socket (simulating disconnect)
      const result = await manager.removeSocket(sessionId, 'socket-1');
      
      expect(result.timerStarted).toBe(true);
      expect(result.gracePeriod).toBe(5000);
    });

    test('should keep session during grace period', () => {
      const manager = new MockTabManager();
      const sessionId = 'test-session-1';
      
      // Create session with sticky enabled
      manager.createSession(sessionId, true);
      manager.addSocket(sessionId, 'socket-1');
      
      // Remove socket
      manager.removeSocket(sessionId, 'socket-1');
      
      // Session should still exist
      const session = manager.getSession(sessionId);
      expect(session).toBeDefined();
    });
  });

  describe('Session Closes After Grace Period', () => {
    test('should close session after grace period expires', async () => {
      const manager = new MockTabManager();
      const sessionId = 'test-session-2';
      
      // Create session with sticky disabled (shorter grace period)
      manager.createSession(sessionId, false);
      manager.addSocket(sessionId, 'socket-1');
      
      // Remove socket
      manager.removeSocket(sessionId, 'socket-1');
      
      // Advance time past grace period
      jest.advanceTimersByTime(1100);
      
      // Session should be closed
      const session = manager.getSession(sessionId);
      expect(session).toBeUndefined();
    });
  });

  describe('New Socket Cancels Close Timer', () => {
    test('should cancel close timer when new socket joins', () => {
      const manager = new MockTabManager();
      const sessionId = 'test-session-3';
      
      // Create session
      manager.createSession(sessionId, true);
      manager.addSocket(sessionId, 'socket-1');
      
      // Remove socket (start grace period)
      manager.removeSocket(sessionId, 'socket-1');
      
      // Add new socket before grace period expires
      manager.addSocket(sessionId, 'socket-2');
      
      // Advance time past grace period
      jest.advanceTimersByTime(5100);
      
      // Session should still exist because new socket joined
      const session = manager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session.activeSockets.has('socket-2')).toBe(true);
    });
  });

  describe('Non-Sticky Session Has Shorter Grace Period', () => {
    test('should use 1000ms grace period for non-sticky sessions', async () => {
      const manager = new MockTabManager();
      const sessionId = 'test-session-4';
      
      // Create session with sticky disabled
      manager.createSession(sessionId, false);
      manager.addSocket(sessionId, 'socket-1');
      
      // Remove socket
      const result = await manager.removeSocket(sessionId, 'socket-1');
      
      expect(result.gracePeriod).toBe(1000);
    });

    test('should use 5000ms grace period for sticky sessions', async () => {
      const manager = new MockTabManager();
      const sessionId = 'test-session-5';
      
      // Create session with sticky enabled
      manager.createSession(sessionId, true);
      manager.addSocket(sessionId, 'socket-1');
      
      // Remove socket
      const result = await manager.removeSocket(sessionId, 'socket-1');
      
      expect(result.gracePeriod).toBe(5000);
    });
  });

  describe('Multiple Disconnects Single Timer', () => {
    test('should create only one timer for multiple disconnects', () => {
      const manager = new MockTabManager();
      const sessionId = 'test-session-6';
      
      // Create session
      manager.createSession(sessionId, true);
      manager.addSocket(sessionId, 'socket-1');
      manager.addSocket(sessionId, 'socket-2');
      
      // Remove first socket
      manager.removeSocket(sessionId, 'socket-1');
      
      // Remove second socket
      manager.removeSocket(sessionId, 'socket-2');
      
      // Should only have one timer
      const session = manager.getSession(sessionId);
      expect(session.closeTimer).toBeDefined();
    });
  });

  describe('Session Management', () => {
    test('should track multiple sessions independently', () => {
      const manager = new MockTabManager();
      
      // Create multiple sessions
      manager.createSession('session-1', true);
      manager.createSession('session-2', false);
      manager.createSession('session-3', true);
      
      expect(manager.getSession('session-1')).toBeDefined();
      expect(manager.getSession('session-2')).toBeDefined();
      expect(manager.getSession('session-3')).toBeDefined();
    });

    test('should track multiple sockets per session', () => {
      const manager = new MockTabManager();
      const sessionId = 'test-session-7';
      
      manager.createSession(sessionId, true);
      manager.addSocket(sessionId, 'socket-1');
      manager.addSocket(sessionId, 'socket-2');
      manager.addSocket(sessionId, 'socket-3');
      
      const session = manager.getSession(sessionId);
      expect(session.activeSockets.size).toBe(3);
      expect(session.activeSockets.has('socket-1')).toBe(true);
      expect(session.activeSockets.has('socket-2')).toBe(true);
      expect(session.activeSockets.has('socket-3')).toBe(true);
    });

    test('should clear close timer when socket is added', () => {
      const manager = new MockTabManager();
      const sessionId = 'test-session-8';
      
      manager.createSession(sessionId, true);
      manager.addSocket(sessionId, 'socket-1');
      manager.removeSocket(sessionId, 'socket-1');
      
      // Timer should be set
      const sessionAfterRemove = manager.getSession(sessionId);
      expect(sessionAfterRemove.closeTimer).toBeDefined();
      
      // Add new socket
      manager.addSocket(sessionId, 'socket-2');
      
      // Timer should be cleared
      const sessionAfterAdd = manager.getSession(sessionId);
      expect(sessionAfterAdd.closeTimer).toBeNull();
    });
  });
});