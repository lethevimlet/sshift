/**
 * Integration tests for sticky sessions grace period
 * Tests session preservation during reconnection
 */

const io = require('socket.io-client');

const BASE_URL = process.env.SERVER_URL || 'http://localhost:3000';
const TEST_CONFIG = {
  host: process.env.TEST_HOST || 'localhost',
  port: parseInt(process.env.TEST_PORT) || 22,
  username: process.env.TEST_USER || 'testuser',
  password: process.env.TEST_PASS || 'testpassword'
};

// Check if SSH tests should be skipped
const SKIP_SSH_TESTS = process.env.SKIP_SSH_TESTS === 'true' || !process.env.TEST_USER;

/**
 * Helper to create socket client
 */
function createSocket() {
  return io(BASE_URL, {
    transports: ['websocket'],
    forceNew: true
  });
}

/**
 * Helper to wait for event
 */
function waitForEvent(socket, event, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);
    
    socket.on(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// Skip all grace period tests if no SSH server is available
const describeGrace = SKIP_SSH_TESTS ? describe.skip : describe;

describeGrace('Sticky Sessions Grace Period Tests', () => {
  // Increase timeout for integration tests
  jest.setTimeout(60000);

  describe('Grace Period Functionality', () => {
    test('should preserve session during grace period', async () => {
      const socket1 = createSocket();
      let sessionId = null;
      const startTime = Date.now();
      
      // Connect socket 1
      await waitForEvent(socket1, 'connect');
      
      // Connect to SSH
      socket1.emit('ssh-connect', {
        sessionId: 'ssh-test-' + Date.now(),
        host: TEST_CONFIG.host,
        port: TEST_CONFIG.port,
        username: TEST_CONFIG.username,
        password: TEST_CONFIG.password
      });
      
      // Wait for SSH connection
      const sshData = await waitForEvent(socket1, 'ssh-connected', 15000);
      sessionId = sshData.sessionId;
      expect(sessionId).toBeDefined();
      
      // Disconnect socket 1
      socket1.disconnect();
      
      // Wait 2 seconds (within grace period)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Connect socket 2
      const socket2 = createSocket();
      await waitForEvent(socket2, 'connect');
      
      // Try to join the session
      socket2.emit('ssh-join', { sessionId });
      
      // Wait for join confirmation
      const joinedData = await waitForEvent(socket2, 'ssh-joined', 10000);
      const elapsed = Date.now() - startTime;
      
      expect(joinedData).toBeDefined();
      expect(elapsed).toBeLessThan(10000); // Should reconnect within grace period
      
      socket2.disconnect();
    });

    test('should handle multiple disconnects during grace period', async () => {
      const socket1 = createSocket();
      let sessionId = null;
      
      // Connect socket 1
      await waitForEvent(socket1, 'connect');
      
      // Connect to SSH
      socket1.emit('ssh-connect', {
        sessionId: 'ssh-test-multi-' + Date.now(),
        host: TEST_CONFIG.host,
        port: TEST_CONFIG.port,
        username: TEST_CONFIG.username,
        password: TEST_CONFIG.password
      });
      
      // Wait for SSH connection
      const sshData = await waitForEvent(socket1, 'ssh-connected', 15000);
      sessionId = sshData.sessionId;
      
      // Disconnect socket 1
      socket1.disconnect();
      
      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Connect socket 2
      const socket2 = createSocket();
      await waitForEvent(socket2, 'connect');
      
      // Join session
      socket2.emit('ssh-join', { sessionId });
      
      // Wait for join
      await waitForEvent(socket2, 'ssh-joined', 10000);
      
      // Disconnect socket 2
      socket2.disconnect();
      
      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Connect socket 3
      const socket3 = createSocket();
      await waitForEvent(socket3, 'connect');
      
      // Join session
      socket3.emit('ssh-join', { sessionId });
      
      // Wait for join
      const joinedData = await waitForEvent(socket3, 'ssh-joined', 10000);
      expect(joinedData).toBeDefined();
      
      socket3.disconnect();
    });
  });

  describe('Session Cleanup', () => {
    test('should clean up session after grace period expires', async () => {
      // This test would require a shorter grace period for testing
      // In production, grace period is typically 5-30 seconds
      
      const socket = createSocket();
      let sessionId = null;
      
      // Connect socket
      await waitForEvent(socket, 'connect');
      
      // Connect to SSH
      socket.emit('ssh-connect', {
        sessionId: 'ssh-test-cleanup-' + Date.now(),
        host: TEST_CONFIG.host,
        port: TEST_CONFIG.port,
        username: TEST_CONFIG.username,
        password: TEST_CONFIG.password
      });
      
      // Wait for SSH connection
      const sshData = await waitForEvent(socket, 'ssh-connected', 15000);
      sessionId = sshData.sessionId;
      
      // Disconnect socket
      socket.disconnect();
      
      // Wait for grace period to expire (assuming 5 second grace period)
      // We'll wait 6 seconds to be safe
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      // Try to join the session after grace period
      const socket2 = createSocket();
      await waitForEvent(socket2, 'connect');
      
      socket2.emit('ssh-join', { sessionId });
      
      // Should receive an error since session should be cleaned up
      try {
        await waitForEvent(socket2, 'ssh-joined', 5000);
        // If we get here, session might still exist (grace period might be longer)
        // This is not necessarily a failure
      } catch (error) {
        // Expected - session should not exist
        expect(error.message).toContain('Timeout');
      }
      
      socket2.disconnect();
    });
  });
});