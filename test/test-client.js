/**
 * Test script for WebSSH client
 * Tests the Socket.IO connection and SSH functionality
 */

const io = require('socket.io-client');
const assert = require('assert');
const { getTestConfig } = require('./test-helper');

const SERVER_URL = 'http://localhost:3000';

// Test configuration - loaded from .env files
const TEST_CONFIG = getTestConfig();

console.log('Test configuration:', {
  host: TEST_CONFIG.host,
  port: TEST_CONFIG.port,
  username: TEST_CONFIG.username,
  password: '***'
});

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  return new Promise((resolve, reject) => {
    console.log(`\n🧪 Running: ${name}`);
    const timeout = setTimeout(() => {
      console.log(`❌ FAILED: ${name} (timeout)`);
      testsFailed++;
      reject(new Error(`Test timeout: ${name}`));
    }, 30000);
    
    fn()
      .then(() => {
        clearTimeout(timeout);
        console.log(`✅ PASSED: ${name}`);
        testsPassed++;
        resolve();
      })
      .catch((err) => {
        clearTimeout(timeout);
        console.log(`❌ FAILED: ${name}`);
        console.log(`   Error: ${err.message}`);
        testsFailed++;
        reject(err);
      });
  });
}

async function runTests() {
  console.log('\n========================================');
  console.log('WebSSH Client Tests');
  console.log('========================================\n');

  // Test 1: Socket.IO Connection
  await test('Socket.IO connection', () => {
    return new Promise((resolve, reject) => {
      const socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: false
      });
      
      socket.on('connect', () => {
        console.log(`   Connected with socket ID: ${socket.id}`);
        socket.disconnect();
        resolve();
      });
      
      socket.on('connect_error', (err) => {
        reject(new Error(`Connection failed: ${err.message}`));
      });
    });
  });

  // Test 2: SSH Connection
  await test('SSH connection', () => {
    return new Promise((resolve, reject) => {
      const socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: false
      });
      
      let sessionId = null;
      let dataReceived = false;
      
      socket.on('connect', () => {
        console.log(`   Socket connected: ${socket.id}`);
        console.log(`   Attempting SSH to ${TEST_CONFIG.host}:${TEST_CONFIG.port}`);
        
        socket.emit('ssh-connect', {
          sessionId: 'test-ssh-' + Date.now(),
          host: TEST_CONFIG.host,
          port: TEST_CONFIG.port,
          username: TEST_CONFIG.username,
          password: TEST_CONFIG.password,
          cols: 80,
          rows: 24
        });
      });
      
      socket.on('ssh-connected', (data) => {
        console.log(`   SSH connected: ${data.sessionId}`);
        sessionId = data.sessionId;
      });
      
      socket.on('ssh-data', (data) => {
        if (!dataReceived) {
          dataReceived = true;
          console.log(`   Received SSH data (${data.data.length} bytes)`);
          // Disconnect after receiving data
          socket.disconnect();
          resolve();
        }
      });
      
      socket.on('ssh-error', (data) => {
        reject(new Error(`SSH error: ${data.message}`));
      });
      
      socket.on('connect_error', (err) => {
        reject(new Error(`Connection error: ${err.message}`));
      });
    });
  });

  // Test 3: SSH Input/Output
  await test('SSH command execution (echo test)', () => {
    return new Promise((resolve, reject) => {
      const socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: false
      });
      
      let sessionId = null;
      let connected = false;
      let outputBuffer = '';
      
      socket.on('connect', () => {
        console.log(`   Socket connected: ${socket.id}`);
        
        socket.emit('ssh-connect', {
          sessionId: 'test-cmd-' + Date.now(),
          host: TEST_CONFIG.host,
          port: TEST_CONFIG.port,
          username: TEST_CONFIG.username,
          password: TEST_CONFIG.password,
          cols: 80,
          rows: 24
        });
      });
      
      socket.on('ssh-connected', (data) => {
        sessionId = data.sessionId;
        connected = true;
        console.log(`   SSH session connected`);
        
        // Wait a bit for shell to be ready, then send command
        setTimeout(() => {
          console.log(`   Sending: echo "TEST123"`);
          socket.emit('ssh-data', {
            sessionId: sessionId,
            data: 'echo "TEST123"\n'
          });
        }, 1000);
      });
      
      socket.on('ssh-data', (data) => {
        outputBuffer += data.data;
        if (outputBuffer.includes('TEST123')) {
          console.log(`   Command output received`);
          socket.disconnect();
          resolve();
        }
      });
      
      socket.on('ssh-error', (data) => {
        reject(new Error(`SSH error: ${data.message}`));
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (outputBuffer.includes('TEST123')) {
          socket.disconnect();
          resolve();
        } else {
          reject(new Error('Timeout waiting for command output'));
        }
      }, 10000);
    });
  });

  // Test 4: Terminal Resize
  await test('SSH terminal resize', () => {
    return new Promise((resolve, reject) => {
      const socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: false
      });
      
      let sessionId = null;
      
      socket.on('connect', () => {
        console.log(`   Socket connected: ${socket.id}`);
        
        socket.emit('ssh-connect', {
          sessionId: 'test-resize-' + Date.now(),
          host: TEST_CONFIG.host,
          port: TEST_CONFIG.port,
          username: TEST_CONFIG.username,
          password: TEST_CONFIG.password,
          cols: 80,
          rows: 24
        });
      });
      
      socket.on('ssh-connected', (data) => {
        sessionId = data.sessionId;
        console.log(`   SSH session connected`);
        
        // Send resize
        setTimeout(() => {
          console.log(`   Resizing terminal to 120x40`);
          socket.emit('ssh-resize', {
            sessionId: sessionId,
            cols: 120,
            rows: 40
          });
          
          // Wait a bit then disconnect
          setTimeout(() => {
            socket.disconnect();
            resolve();
          }, 500);
        }, 500);
      });
      
      socket.on('ssh-error', (data) => {
        reject(new Error(`SSH error: ${data.message}`));
      });
      
      setTimeout(() => {
        reject(new Error('Timeout'));
      }, 10000);
    });
  });

  // Test 5: SFTP Connection
  await test('SFTP connection', () => {
    return new Promise((resolve, reject) => {
      const socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: false
      });
      
      let sessionId = null;
      
      socket.on('connect', () => {
        console.log(`   Socket connected: ${socket.id}`);
        
        socket.emit('sftp-connect', {
          sessionId: 'test-sftp-' + Date.now(),
          host: TEST_CONFIG.host,
          port: TEST_CONFIG.port,
          username: TEST_CONFIG.username,
          password: TEST_CONFIG.password
        });
      });
      
      socket.on('sftp-connected', (data) => {
        console.log(`   SFTP connected: ${data.sessionId}`);
        sessionId = data.sessionId;
        socket.disconnect();
        resolve();
      });
      
      socket.on('sftp-error', (data) => {
        reject(new Error(`SFTP error: ${data.message}`));
      });
      
      socket.on('connect_error', (err) => {
        reject(new Error(`Connection error: ${err.message}`));
      });
      
      setTimeout(() => {
        reject(new Error('Timeout'));
      }, 15000);
    });
  });

  // Test 6: SFTP List Directory
  await test('SFTP list directory', () => {
    return new Promise((resolve, reject) => {
      const socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: false
      });
      
      let sessionId = null;
      
      socket.on('connect', () => {
        console.log(`   Socket connected: ${socket.id}`);
        
        socket.emit('sftp-connect', {
          sessionId: 'test-sftp-list-' + Date.now(),
          host: TEST_CONFIG.host,
          port: TEST_CONFIG.port,
          username: TEST_CONFIG.username,
          password: TEST_CONFIG.password
        });
      });
      
      socket.on('sftp-connected', (data) => {
        sessionId = data.sessionId;
        console.log(`   SFTP connected`);
        
        // List home directory
        socket.emit('sftp-list', {
          sessionId: sessionId,
          path: '/root'
        });
      });
      
      socket.on('sftp-list-result', (data) => {
        console.log(`   Listed: ${data.path}`);
        console.log(`   Files: ${data.files.length} items`);
        socket.disconnect();
        resolve();
      });
      
      socket.on('sftp-error', (data) => {
        reject(new Error(`SFTP error: ${data.message}`));
      });
      
      setTimeout(() => {
        reject(new Error('Timeout'));
      }, 15000);
    });
  });

  // Test 7: Multiple Sessions
  await test('Multiple concurrent sessions', () => {
    return new Promise((resolve, reject) => {
      const socket1 = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnection: false });
      const socket2 = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnection: false });
      
      let session1Connected = false;
      let session2Connected = false;
      
      const checkDone = () => {
        if (session1Connected && session2Connected) {
          console.log(`   Both sessions connected`);
          socket1.disconnect();
          socket2.disconnect();
          resolve();
        }
      };
      
      socket1.on('connect', () => {
        socket1.emit('ssh-connect', {
          sessionId: 'test-multi-1-' + Date.now(),
          host: TEST_CONFIG.host,
          port: TEST_CONFIG.port,
          username: TEST_CONFIG.username,
          password: TEST_CONFIG.password,
          cols: 80,
          rows: 24
        });
      });
      
      socket2.on('connect', () => {
        socket2.emit('ssh-connect', {
          sessionId: 'test-multi-2-' + Date.now(),
          host: TEST_CONFIG.host,
          port: TEST_CONFIG.port,
          username: TEST_CONFIG.username,
          password: TEST_CONFIG.password,
          cols: 80,
          rows: 24
        });
      });
      
      socket1.on('ssh-connected', () => {
        session1Connected = true;
        checkDone();
      });
      
      socket2.on('ssh-connected', () => {
        session2Connected = true;
        checkDone();
      });
      
      socket1.on('ssh-error', (data) => {
        reject(new Error(`Session 1 error: ${data.message}`));
      });
      
      socket2.on('ssh-error', (data) => {
        reject(new Error(`Session 2 error: ${data.message}`));
      });
      
      setTimeout(() => {
        reject(new Error('Timeout'));
      }, 20000);
    });
  });

  // Test 8: Disconnect and cleanup
  await test('SSH disconnect and cleanup', () => {
    return new Promise((resolve, reject) => {
      const socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: false
      });
      
      let sessionId = null;
      
      socket.on('connect', () => {
        socket.emit('ssh-connect', {
          sessionId: 'test-disconnect-' + Date.now(),
          host: TEST_CONFIG.host,
          port: TEST_CONFIG.port,
          username: TEST_CONFIG.username,
          password: TEST_CONFIG.password,
          cols: 80,
          rows: 24
        });
      });
      
      socket.on('ssh-connected', (data) => {
        sessionId = data.sessionId;
        console.log(`   SSH connected`);
        
        // Request disconnect
        setTimeout(() => {
          console.log(`   Sending disconnect request`);
          socket.emit('ssh-disconnect', { sessionId: sessionId });
          
          // Wait for disconnect confirmation
          setTimeout(() => {
            socket.disconnect();
            resolve();
          }, 1000);
        }, 1000);
      });
      
      socket.on('ssh-disconnected', (data) => {
        console.log(`   Session disconnected`);
      });
      
      socket.on('ssh-error', (data) => {
        reject(new Error(`SSH error: ${data.message}`));
      });
      
      setTimeout(() => {
        reject(new Error('Timeout'));
      }, 15000);
    });
  });

  // Print summary
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📊 Total: ${testsPassed + testsFailed}`);
  console.log('========================================\n');
  
  if (testsFailed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((err) => {
  console.error('Test suite failed:', err.message);
  process.exit(1);
});