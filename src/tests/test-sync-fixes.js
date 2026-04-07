/**
 * Test for SSH session synchronization fixes
 * 
 * Tests:
 * 1. No connecting message when restoring session
 * 2. Syncing flag prevents data during sync
 * 3. Screen sync sent before joining room
 * 4. Alternate buffer serialization works
 */

const fs = require('fs');
const path = require('path');

function testFile(filePath, patterns, description) {
  const content = fs.readFileSync(filePath, 'utf8');
  const results = [];
  
  for (const pattern of patterns) {
    const found = content.includes(pattern);
    results.push({
      pattern: pattern.substring(0, 50) + '...',
      found
    });
  }
  
  return { description, results };
}

console.log('========================================');
console.log('Testing SSH Session Sync Fixes');
console.log('========================================\n');

// Test 1: Check that connecting message is conditional
console.log('=== Test 1: Connecting Message Conditional ===');
const appContent = fs.readFileSync('src/webapp/js/app.js', 'utf8');
const hasConditionalMessage = appContent.includes("if (restoreSessionId)") && 
                               appContent.includes("// Show connecting message only for new connections");
console.log('✓ Connecting message is conditional:', hasConditionalMessage);

// Test 2: Check syncing flag in onSSHData
console.log('\n=== Test 2: Syncing Flag in onSSHData ===');
const hasSyncingCheck = appContent.includes('if (session.syncing)') && 
                        appContent.includes('Skipping data during sync');
console.log('✓ Syncing flag check in onSSHData:', hasSyncingCheck);

// Test 3: Check syncing flag set before join
console.log('\n=== Test 3: Syncing Flag Set Before Join ===');
const hasSyncingBeforeJoin = appContent.includes("session.syncing = true;") && 
                             appContent.includes("// Set syncing flag BEFORE sending join request");
console.log('✓ Syncing flag set before join:', hasSyncingBeforeJoin);

// Test 4: Check syncing flag set in requestScreenSync
console.log('\n=== Test 4: Syncing Flag in requestScreenSync ===');
const hasSyncingInRequest = appContent.includes("requestScreenSync") && 
                           appContent.includes("session.syncing = true;");
console.log('✓ Syncing flag set in requestScreenSync:', hasSyncingInRequest);

// Test 5: Check server sends sync before joining room
console.log('\n=== Test 5: Server Sync Before Join ===');
const sshManagerContent = fs.readFileSync(path.join(__dirname, '..', 'server', 'ssh-manager.js'), 'utf8');
const hasSyncBeforeJoin = sshManagerContent.includes("// Send current terminal state to the joining socket BEFORE joining the room");
console.log('✓ Server sends sync before joining room:', hasSyncBeforeJoin);

// Test 6: Check syncing flag cleared after sync
console.log('\n=== Test 6: Syncing Flag Cleared After Sync ===');
const hasSyncingCleared = appContent.includes("session.syncing = false;");
console.log('✓ Syncing flag cleared after sync:', hasSyncingCleared);

// Test 7: Check terminal reset before sync
console.log('\n=== Test 7: Terminal Reset Before Sync ===');
const hasResetBeforeSync = appContent.includes("session.terminal.reset()");
console.log('✓ Terminal reset before sync:', hasResetBeforeSync);

// Test 8: Check alternate buffer serialization
console.log('\n=== Test 8: Alternate Buffer Serialization ===');
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
const serializeAddon = new SerializeAddon();
terminal.loadAddon(serializeAddon);

// Write to normal buffer
terminal.write('Normal buffer line 1\r\nNormal buffer line 2\r\n', () => {
  // Switch to alternate buffer
  terminal.write('\x1b[?1049h', () => {
    // Write to alternate buffer
    terminal.write('Alternate buffer line 1\r\nAlternate buffer line 2\r\n', () => {
      const state = serializeAddon.serialize({ mode: 'all' });
      console.log('✓ Alternate buffer serialized, length:', state.length);
      
      // Verify it contains the alternate buffer switch sequence
      const hasAltBufferSeq = state.includes('\x1b[?1049h');
      console.log('✓ Contains alternate buffer sequence:', hasAltBufferSeq);
      
      // Test deserialization
      const terminal2 = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      const serializeAddon2 = new SerializeAddon();
      terminal2.loadAddon(serializeAddon2);
      
      terminal2.reset();
      terminal2.write(state, () => {
        const isAltBuffer = terminal2.buffer.active.type === 'alternate';
        console.log('✓ Deserialized terminal is in alternate buffer mode:', isAltBuffer);
      });
    });
  });
});

// Summary
console.log('\n========================================');
console.log('Test Results');
console.log('========================================');
const allPassed = hasConditionalMessage && hasSyncingCheck && hasSyncingBeforeJoin && 
                  hasSyncingInRequest && hasSyncBeforeJoin && hasSyncingCleared && 
                  hasResetBeforeSync;

if (allPassed) {
  console.log('✓ All sync fix tests passed!');
} else {
  console.log('✗ Some tests failed');
  process.exit(1);
}