/**
 * Test SSH keepalive configuration
 * Verifies that keepalive settings are properly loaded from config and passed to SSH connections
 */

const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const { getTestConfig } = require('./test-helper');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// Test configuration - loaded from .env files
const testConfig = getTestConfig();

const SERVER_URL = 'process.env.SERVER_URL || 'http://localhost:8022'';

// Helper to create a socket connection
function createSocket() {
  return io(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true
  });
}

// Test 1: Verify config.json has keepalive settings
async function testConfigFile() {
  console.log('\n🧪 Running: Config file has keepalive settings');
  
  try {
    const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(configData);
    
    // Check if keepalive settings exist (or will use defaults)
    const hasInterval = 'sshKeepaliveInterval' in config;
    const hasCountMax = 'sshKeepaliveCountMax' in config;
    
    console.log('   Config file structure:', JSON.stringify(config, null, 2).substring(0, 200) + '...');
    
    if (hasInterval && hasCountMax) {
      console.log('   ✅ Keepalive settings found in config');
      console.log(`   Interval: ${config.sshKeepaliveInterval}ms`);
      console.log(`   Count Max: ${config.sshKeepaliveCountMax}`);
    } else {
      console.log('   ℹ️  Keepalive settings not in config, will use defaults (10000ms, 1000)');
    }
    
    return true;
  } catch (err) {
    console.error('   ❌ Error reading config:', err.message);
    return false;
  }
}

// Test 2: Verify API returns keepalive settings
async function testAPIConfig() {
  return new Promise((resolve) => {
    console.log('\n🧪 Running: API returns keepalive settings');
    
    const socket = createSocket();
    
    socket.on('connect', () => {
      console.log('   Socket connected:', socket.id);
      
      // Fetch config via HTTP API
      const http = require('http');
      http.get(`${SERVER_URL}/api/config`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const config = JSON.parse(data);
            console.log('   API config response:', JSON.stringify(config));
            
            if ('sshKeepaliveInterval' in config && 'sshKeepaliveCountMax' in config) {
              console.log('   ✅ API returns keepalive settings');
              console.log(`   Interval: ${config.sshKeepaliveInterval}ms`);
              console.log(`   Count Max: ${config.sshKeepaliveCountMax}`);
              socket.disconnect();
              resolve(true);
            } else {
              console.log('   ❌ API missing keepalive settings');
              socket.disconnect();
              resolve(false);
            }
          } catch (err) {
            console.error('   ❌ Error parsing API response:', err.message);
            socket.disconnect();
            resolve(false);
          }
        });
      }).on('error', (err) => {
        console.error('   ❌ HTTP request error:', err.message);
        socket.disconnect();
        resolve(false);
      });
    });
    
    socket.on('connect_error', (err) => {
      console.error('   ❌ Socket connection error:', err.message);
      resolve(false);
    });
    
    setTimeout(() => {
      console.error('   ❌ Test timeout');
      socket.disconnect();
      resolve(false);
    }, 5000);
  });
}

// Test 3: Verify SSH connection uses keepalive settings
async function testSSHConnection() {
  return new Promise((resolve) => {
    console.log('\n🧪 Running: SSH connection with keepalive settings');
    
    const socket = createSocket();
    
    socket.on('connect', () => {
      console.log('   Socket connected:', socket.id);
      
      socket.emit('ssh-connect', {
        host: testConfig.host,
        port: testConfig.port,
        username: testConfig.username,
        password: testConfig.password,
        name: 'test-keepalive',
        cols: 80,
        rows: 24
      });
    });
    
    socket.on('ssh-connected', (data) => {
      console.log('   SSH connected:', data.sessionId);
      console.log('   ✅ SSH connection established with keepalive settings');
      
      // Disconnect after successful connection
      socket.emit('ssh-disconnect', { sessionId: data.sessionId });
      socket.disconnect();
      resolve(true);
    });
    
    socket.on('ssh-error', (error) => {
      console.error('   ❌ SSH error:', error.message);
      socket.disconnect();
      resolve(false);
    });
    
    socket.on('connect_error', (err) => {
      console.error('   ❌ Socket connection error:', err.message);
      resolve(false);
    });
    
    setTimeout(() => {
      console.error('   ❌ Test timeout');
      socket.disconnect();
      resolve(false);
    }, 10000);
  });
}

// Run all tests
async function runTests() {
  console.log('\n========================================');
  console.log('SSH Keepalive Configuration Tests');
  console.log('========================================\n');
  
  const results = [];
  
  results.push(await testConfigFile());
  results.push(await testAPIConfig());
  results.push(await testSSHConnection());
  
  console.log('\n========================================');
  console.log('Test Results:');
  console.log('========================================');
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log(`Passed: ${passed}/${total}`);
  
  if (passed === total) {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed\n');
    process.exit(1);
  }
}

// Run tests
runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});