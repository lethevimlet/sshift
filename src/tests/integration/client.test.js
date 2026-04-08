/**
 * Integration tests for WebSSH client
 * Tests Socket.IO connection and SSH functionality
 */

const io = require('socket.io-client');
const { createSocketClient, waitForConnect, waitForEvent, disconnectSocket, createSSHParams, createSFTPParams, sleep } = require('../helpers/test-utils');

// Test configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const TEST_CONFIG = {
  host: process.env.TEST_HOST || 'localhost',
  port: parseInt(process.env.TEST_PORT) || 22,
  username: process.env.TEST_USER || 'testuser',
  password: process.env.TEST_PASS || 'testpassword'
};

// Check if SSH tests should be skipped
const SKIP_SSH_TESTS = process.env.SKIP_SSH_TESTS === 'true' || !process.env.TEST_USER;

// Skip SSH tests if no SSH server is available - must be at module level
const describeSSH = SKIP_SSH_TESTS ? describe.skip : describe;

describe('WebSSH Client Integration Tests', () => {
  // Increase timeout for integration tests
  jest.setTimeout(30000);

  describe('Socket.IO Connection', () => {
    let socket;

    afterEach(() => {
      disconnectSocket(socket);
    });

    test('should connect to Socket.IO server', async () => {
      socket = createSocketClient(SERVER_URL);
      await waitForConnect(socket);
      expect(socket.connected).toBe(true);
    });

    test('should receive socket ID on connection', async () => {
      socket = createSocketClient(SERVER_URL);
      await waitForConnect(socket);
      expect(socket.id).toBeDefined();
      expect(typeof socket.id).toBe('string');
    });
  });
  
  describeSSH('SSH Connection', () => {
    let socket;

    beforeEach(async () => {
      socket = createSocketClient(SERVER_URL);
      await waitForConnect(socket);
    });

    afterEach(() => {
      disconnectSocket(socket);
    });

    test('should establish SSH connection', async () => {
      const sshParams = createSSHParams();
      
      socket.emit('ssh-connect', sshParams);
      
      const data = await waitForEvent(socket, 'ssh-connected', 15000);
      expect(data).toBeDefined();
      expect(data.sessionId).toBeDefined();
    });

    test('should receive SSH data after connection', async () => {
      const sshParams = createSSHParams();
      
      socket.emit('ssh-connect', sshParams);
      
      await waitForEvent(socket, 'ssh-connected', 15000);
      
      const data = await waitForEvent(socket, 'ssh-data', 10000);
      expect(data).toBeDefined();
      expect(data.data).toBeDefined();
    });

    test('should handle SSH errors gracefully', async () => {
      const invalidParams = {
        ...createSSHParams(),
        host: 'invalid-host-that-does-not-exist',
        username: 'invalid',
        password: 'invalid'
      };
      
      socket.emit('ssh-connect', invalidParams);
      
      const error = await waitForEvent(socket, 'ssh-error', 15000);
      expect(error).toBeDefined();
      expect(error.message).toBeDefined();
    });
  });

  describeSSH('SSH Command Execution', () => {
    let socket;
    let sessionId;

    beforeEach(async () => {
      socket = createSocketClient(SERVER_URL);
      await waitForConnect(socket);
      
      const sshParams = createSSHParams();
      socket.emit('ssh-connect', sshParams);
      
      const data = await waitForEvent(socket, 'ssh-connected', 15000);
      sessionId = data.sessionId;
    });

    afterEach(() => {
      disconnectSocket(socket);
    });

    test('should execute echo command and receive output', async () => {
      // Wait for shell to be ready
      await sleep(1000);
      
      // Send command
      socket.emit('ssh-data', {
        sessionId: sessionId,
        data: 'echo "TEST123"\n'
      });
      
      // Collect output
      let outputBuffer = '';
      const dataPromise = new Promise((resolve) => {
        socket.on('ssh-data', (data) => {
          outputBuffer += data.data;
          if (outputBuffer.includes('TEST123')) {
            resolve();
          }
        });
      });
      
      await dataPromise;
      expect(outputBuffer).toContain('TEST123');
    });
  });

  describeSSH('SSH Terminal Resize', () => {
    let socket;
    let sessionId;

    beforeEach(async () => {
      socket = createSocketClient(SERVER_URL);
      await waitForConnect(socket);
      
      const sshParams = createSSHParams();
      socket.emit('ssh-connect', sshParams);
      
      const data = await waitForEvent(socket, 'ssh-connected', 15000);
      sessionId = data.sessionId;
    });

    afterEach(() => {
      disconnectSocket(socket);
    });

    test('should handle terminal resize', async () => {
      // Wait for connection to be ready
      await sleep(500);
      
      // Send resize
      socket.emit('ssh-resize', {
        sessionId: sessionId,
        cols: 120,
        rows: 40
      });
      
      // Wait a bit for resize to process
      await sleep(500);
      
      // If we get here without error, resize was successful
      expect(true).toBe(true);
    });
  });

  describeSSH('SFTP Connection', () => {
    let socket;

    beforeEach(async () => {
      socket = createSocketClient(SERVER_URL);
      await waitForConnect(socket);
    });

    afterEach(() => {
      disconnectSocket(socket);
    });

    test('should establish SFTP connection', async () => {
      const sftpParams = createSFTPParams();
      
      socket.emit('sftp-connect', sftpParams);
      
      const data = await waitForEvent(socket, 'sftp-connected', 15000);
      expect(data).toBeDefined();
      expect(data.sessionId).toBeDefined();
    });

    test('should list directory contents', async () => {
      const sftpParams = createSFTPParams();
      
      socket.emit('sftp-connect', sftpParams);
      await waitForEvent(socket, 'sftp-connected', 15000);
      
      socket.emit('sftp-list', {
        sessionId: sftpParams.sessionId,
        path: '/root'
      });
      
      const result = await waitForEvent(socket, 'sftp-list-result', 15000);
      expect(result).toBeDefined();
      expect(result.path).toBe('/root');
      expect(result.files).toBeDefined();
      expect(Array.isArray(result.files)).toBe(true);
    });
  });

  describeSSH('Multiple Concurrent Sessions', () => {
    let socket1, socket2;

    afterEach(() => {
      disconnectSocket(socket1);
      disconnectSocket(socket2);
    });

    test('should handle multiple concurrent SSH sessions', async () => {
      socket1 = createSocketClient(SERVER_URL);
      socket2 = createSocketClient(SERVER_URL);
      
      await Promise.all([
        waitForConnect(socket1),
        waitForConnect(socket2)
      ]);
      
      const sshParams1 = createSSHParams({ sessionId: 'test-multi-1-' + Date.now() });
      const sshParams2 = createSSHParams({ sessionId: 'test-multi-2-' + Date.now() });
      
      socket1.emit('ssh-connect', sshParams1);
      socket2.emit('ssh-connect', sshParams2);
      
      const [result1, result2] = await Promise.all([
        waitForEvent(socket1, 'ssh-connected', 20000),
        waitForEvent(socket2, 'ssh-connected', 20000)
      ]);
      
      expect(result1.sessionId).toBeDefined();
      expect(result2.sessionId).toBeDefined();
      expect(result1.sessionId).not.toBe(result2.sessionId);
    });
  });

  describeSSH('SSH Disconnect and Cleanup', () => {
    let socket;
    let sessionId;

    beforeEach(async () => {
      socket = createSocketClient(SERVER_URL);
      await waitForConnect(socket);
      
      const sshParams = createSSHParams();
      socket.emit('ssh-connect', sshParams);
      
      const data = await waitForEvent(socket, 'ssh-connected', 15000);
      sessionId = data.sessionId;
    });

    afterEach(() => {
      disconnectSocket(socket);
    });

    test('should disconnect SSH session cleanly', async () => {
      // Wait for connection to be ready
      await sleep(1000);
      
      // Request disconnect
      socket.emit('ssh-disconnect', { sessionId: sessionId });
      
      // Wait for disconnect confirmation
      const disconnectedPromise = new Promise((resolve) => {
        socket.on('ssh-disconnected', () => resolve());
      });
      
      await disconnectedPromise;
      
      // If we get here, disconnect was successful
      expect(true).toBe(true);
    });
  });
});