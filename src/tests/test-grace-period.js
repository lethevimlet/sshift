/**
 * Test to verify sticky grace period is correctly applied
 */

const io = require('socket.io-client');
const { getTestConfig } = require('./test-helper');

const BASE_URL = 'process.env.SERVER_URL || 'http://localhost:8022'';
const TEST_CONFIG = getTestConfig();

async function testGracePeriod() {
  console.log('========================================');
  console.log('Testing Sticky Sessions Grace Period');
  console.log('========================================\n');

  return new Promise((resolve, reject) => {
    const socket1 = io(BASE_URL, {
      transports: ['websocket'],
      forceNew: true
    });

    let sessionId = null;
    let startTime = null;

    socket1.on('connect', async () => {
      console.log('✓ Socket 1 connected');
      
      // Connect to SSH
      socket1.emit('ssh-connect', {
        sessionId: 'ssh-test-' + Date.now(),
        host: TEST_CONFIG.host,
        port: TEST_CONFIG.port,
        username: TEST_CONFIG.username,
        password: TEST_CONFIG.password
      });
    });

    socket1.on('ssh-connected', (data) => {
      console.log('✓ SSH connected:', data.sessionId);
      sessionId = data.sessionId;
      
      // Disconnect socket 1
      console.log('\nDisconnecting socket 1...');
      startTime = Date.now();
      socket1.disconnect();
    });

    socket1.on('ssh-error', (err) => {
      console.error('✗ SSH error:', err);
      reject(err);
    });

    // Listen for disconnect
    socket1.on('disconnect', () => {
      console.log('✓ Socket 1 disconnected');
      
      // Wait 2 seconds, then reconnect with a new socket
      setTimeout(() => {
        console.log('\nConnecting socket 2 (after 2s)...');
        
        const socket2 = io(BASE_URL, {
          transports: ['websocket'],
          forceNew: true
        });

        socket2.on('connect', () => {
          console.log('✓ Socket 2 connected');
          
          // Try to join the session
          socket2.emit('ssh-join', { sessionId });
        });

        socket2.on('ssh-joined', (data) => {
          const elapsed = Date.now() - startTime;
          console.log(`✓ Session rejoined after ${elapsed}ms`);
          console.log(`✓ Grace period is working correctly`);
          console.log('\n========================================');
          console.log('✓ Test passed!');
          console.log('========================================');
          socket2.disconnect();
          resolve();
        });

        socket2.on('ssh-error', (err) => {
          console.error('✗ SSH error on socket 2:', err);
          reject(new Error('Session should have been preserved during grace period'));
        });
      }, 2000);
    });
  });
}

testGracePeriod()
  .then(() => {
    console.log('\n✓ All tests passed');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n✗ Test failed:', err.message);
    process.exit(1);
  });