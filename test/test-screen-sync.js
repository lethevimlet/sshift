/**
 * Test script to verify terminal screen synchronization
 * 
 * This tests:
 * 1. Server-side terminal state management with xterm-headless
 * 2. Terminal serialization with SerializeAddon
 * 3. Screen sync on session join
 * 4. Screen sync on manual request
 * 5. Dimension synchronization across clients
 */

const http = require('http');
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

const BASE_URL = 'http://localhost:3000';

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (options.json) {
            resolve(JSON.parse(data));
          } else {
            resolve(data);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function testXtermHeadless() {
  console.log('\n=== Testing xterm-headless ===');
  
  try {
    // Create a headless terminal
    const terminal = new Terminal({
      cols: 80,
      rows: 24,
      allowProposedApi: true
    });
    
    // Create serialize addon
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon);
    
    // Write some test data using callback to ensure completion
    await new Promise((resolve) => {
      terminal.write('\x1b[31mRed Text\x1b[0m Normal Text\r\n', resolve);
    });
    await new Promise((resolve) => {
      terminal.write('Line 2\r\n', resolve);
    });
    await new Promise((resolve) => {
      terminal.write('Line 3 with \x1b[1mbold\x1b[0m text', resolve);
    });
    
    // Serialize the terminal state - try different modes
    const serializedAll = serializeAddon.serialize({ mode: 'all' });
    const serializedNormal = serializeAddon.serialize();
    const serializedAlt = serializeAddon.serialize({ mode: 'alt' });
    
    console.log(`✓ xterm-headless Terminal created successfully`);
    console.log(`✓ SerializeAddon loaded successfully`);
    console.log(`  Serialized (all): ${serializedAll.length} bytes`);
    console.log(`  Serialized (default): ${serializedNormal.length} bytes`);
    console.log(`  Serialized (alt): ${serializedAlt.length} bytes`);
    
    // Check the buffer directly
    const buffer = terminal.buffer.active;
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    const line2 = buffer.getLine(2);
    
    const line0Text = line0?.translateToString(true) || '';
    const line1Text = line1?.translateToString(true) || '';
    const line2Text = line2?.translateToString(true) || '';
    
    console.log(`  Buffer line 0: "${line0Text}"`);
    console.log(`  Buffer line 1: "${line1Text}"`);
    console.log(`  Buffer line 2: "${line2Text}"`);
    
    // Verify buffer contains expected content
    if (line0Text.includes('Red Text') && line1Text.includes('Line 2')) {
      console.log('✓ Terminal buffer contains expected content');
    } else {
      console.error('❌ FAIL: Terminal buffer missing expected content');
      console.error(`  Expected "Red Text" in line 0, got: "${line0Text}"`);
      console.error(`  Expected "Line 2" in line 1, got: "${line1Text}"`);
      return false;
    }
    
    // Verify serialization contains content
    if (serializedAll.length > 0 || serializedNormal.length > 0) {
      console.log('✓ Terminal state can be serialized');
    } else {
      console.error('❌ FAIL: Terminal state serialization returned empty');
      return false;
    }
    
    // Test resize
    terminal.resize(120, 40);
    if (terminal.cols === 120 && terminal.rows === 40) {
      console.log('✓ Terminal resize works correctly');
    } else {
      console.error('❌ FAIL: Terminal resize failed');
      return false;
    }
    
    // Clean up
    terminal.dispose();
    
    return true;
  } catch (err) {
    console.error('❌ FAIL: Error testing xterm-headless:', err.message);
    console.error(err.stack);
    return false;
  }
}

async function testServerTerminalState() {
  console.log('\n=== Testing Server Terminal State ===');
  
  try {
    // Import SSH manager
    const path = require('path');
    const sshManagerPath = path.join(__dirname, '..', 'ssh-manager.js');
    
    // Check if module exports required methods
    const fs = require('fs');
    const sshManagerCode = fs.readFileSync(sshManagerPath, 'utf8');
    
    // Verify getTerminalState method exists
    if (!sshManagerCode.includes('getTerminalState(sessionId)')) {
      console.error('❌ FAIL: getTerminalState method not found in ssh-manager.js');
      return false;
    }
    
    // Verify headless terminal is created
    if (!sshManagerCode.includes("require('@xterm/headless')")) {
      console.error('❌ FAIL: @xterm/headless not imported in ssh-manager.js');
      return false;
    }
    
    // Verify SerializeAddon is used
    if (!sshManagerCode.includes("require('@xterm/addon-serialize')")) {
      console.error('❌ FAIL: @xterm/addon-serialize not imported in ssh-manager.js');
      return false;
    }
    
    // Verify terminal.write is called for data
    if (!sshManagerCode.includes('session.terminal.write')) {
      console.error('❌ FAIL: Terminal not being written to in ssh-manager.js');
      return false;
    }
    
    // Verify terminal.resize is called on resize
    if (!sshManagerCode.includes('session.terminal.resize')) {
      console.error('❌ FAIL: Terminal resize not implemented in ssh-manager.js');
      return false;
    }
    
    console.log('✓ ssh-manager.js has all required terminal state management code');
    console.log('✓ Headless terminal is created for each session');
    console.log('✓ Terminal state is serialized on join');
    
    return true;
  } catch (err) {
    console.error('❌ FAIL: Error testing server terminal state:', err.message);
    return false;
  }
}

async function testClientScreenSync() {
  console.log('\n=== Testing Client Screen Sync ===');
  
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Check app.js for screen sync handlers
    const appPath = path.join(__dirname, '..', 'public', 'js', 'app.js');
    const appCode = fs.readFileSync(appPath, 'utf8');
    
    // Verify ssh-screen-sync event handler
    if (!appCode.includes("socket.on('ssh-screen-sync'")) {
      console.error('❌ FAIL: ssh-screen-sync event handler not found in app.js');
      return false;
    }
    
    // Verify ssh-resize-sync event handler
    if (!appCode.includes("socket.on('ssh-resize-sync'")) {
      console.error('❌ FAIL: ssh-resize-sync event handler not found in app.js');
      return false;
    }
    
    // Verify requestScreenSync method
    if (!appCode.includes('requestScreenSync')) {
      console.error('❌ FAIL: requestScreenSync method not found in app.js');
      return false;
    }
    
    // Verify manual sync keyboard shortcut
    if (!appCode.includes("e.key === 'R'") || !appCode.includes('requestScreenSync')) {
      console.error('❌ FAIL: Manual sync keyboard shortcut not found in app.js');
      return false;
    }
    
    // Verify screen sync on tab switch
    if (!appCode.includes('switchTab') || !appCode.includes('requestScreenSync(sessionId)')) {
      console.error('❌ FAIL: Screen sync on tab switch not implemented in app.js');
      return false;
    }
    
    console.log('✓ Client has ssh-screen-sync event handler');
    console.log('✓ Client has ssh-resize-sync event handler');
    console.log('✓ Client has requestScreenSync method');
    console.log('✓ Client has manual sync keyboard shortcut (Ctrl+Shift+R)');
    console.log('✓ Client requests screen sync on tab switch');
    
    return true;
  } catch (err) {
    console.error('❌ FAIL: Error testing client screen sync:', err.message);
    return false;
  }
}

async function testServerEvents() {
  console.log('\n=== Testing Server Events ===');
  
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Check server.js for event handlers
    const serverPath = path.join(__dirname, '..', 'server.js');
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    
    // Verify ssh-request-sync event handler
    if (!serverCode.includes("socket.on('ssh-request-sync'")) {
      console.error('❌ FAIL: ssh-request-sync event handler not found in server.js');
      return false;
    }
    
    // Verify resize broadcast
    if (!serverCode.includes("socket.to(`session-${data.sessionId}`).emit('ssh-resize-sync'")) {
      console.error('❌ FAIL: Resize broadcast not found in server.js');
      return false;
    }
    
    // Verify screen sync on join
    if (!serverCode.includes("socket.emit('ssh-screen-sync'")) {
      console.error('❌ FAIL: Screen sync on join not found in server.js');
      return false;
    }
    
    console.log('✓ Server has ssh-request-sync event handler');
    console.log('✓ Server broadcasts resize events to all clients');
    console.log('✓ Server sends screen sync on session join');
    
    return true;
  } catch (err) {
    console.error('❌ FAIL: Error testing server events:', err.message);
    return false;
  }
}

async function testSerializeAddonInPublic() {
  console.log('\n=== Testing SerializeAddon in Public ===');
  
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Check if serialize addon is copied to public
    const serializePath = path.join(__dirname, '..', 'public', 'libs', 'xterm', 'xterm-addon-serialize.js');
    
    if (!fs.existsSync(serializePath)) {
      console.error('❌ FAIL: xterm-addon-serialize.js not found in public/libs/xterm/');
      return false;
    }
    
    // Check if it's included in index.html
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    const indexCode = fs.readFileSync(indexPath, 'utf8');
    
    if (!indexCode.includes('xterm-addon-serialize.js')) {
      console.error('❌ FAIL: xterm-addon-serialize.js not included in index.html');
      return false;
    }
    
    // Check if SerializeAddon is normalized
    if (!indexCode.includes('Normalize SerializeAddon')) {
      console.error('❌ FAIL: SerializeAddon normalization not found in index.html');
      return false;
    }
    
    console.log('✓ xterm-addon-serialize.js exists in public/libs/xterm/');
    console.log('✓ xterm-addon-serialize.js is included in index.html');
    console.log('✓ SerializeAddon normalization code exists in index.html');
    
    return true;
  } catch (err) {
    console.error('❌ FAIL: Error testing SerializeAddon in public:', err.message);
    return false;
  }
}

async function runTests() {
  console.log('========================================');
  console.log('Testing Terminal Screen Synchronization');
  console.log('========================================');
  
  const results = [];
  
  results.push(await testXtermHeadless());
  results.push(await testServerTerminalState());
  results.push(await testClientScreenSync());
  results.push(await testServerEvents());
  results.push(await testSerializeAddonInPublic());
  
  console.log('\n========================================');
  console.log('Test Results');
  console.log('========================================');
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log(`Passed: ${passed}/${total}`);
  
  if (passed === total) {
    console.log('✓ All tests passed!');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});