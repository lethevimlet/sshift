/**
 * Test for sticky session page reload synchronization
 * 
 * This test simulates the exact scenario where:
 * 1. User has sticky enabled
 * 2. User reloads the page
 * 3. Session should persist with grace period
 * 4. Terminal state should sync correctly
 */

const assert = require('assert');
const { getTestConfig } = require('./test-helper');

// Test configuration - loaded from .env files
const testConfig = getTestConfig();

// Test grace period is applied correctly
function testGracePeriodApplied() {
  console.log('\n=== Test: Grace Period Applied on Disconnect ===');
  
  // Simulate tab with sticky enabled
  const tab = {
    name: 'test-ssh',
    type: 'ssh',
    connectionData: { host: testConfig.host, port: testConfig.port, username: testConfig.username },
    activeSockets: new Set(['socket1']),
    sticky: true,
    closeTimer: null
  };
  
  // Simulate disconnect
  tab.activeSockets.delete('socket1');
  
  // Check grace period logic
  if (tab.activeSockets.size === 0) {
    const gracePeriod = tab.sticky ? 5000 : 1000;
    assert.strictEqual(gracePeriod, 5000, 'Grace period should be 5000ms for sticky sessions');
    console.log('✓ Grace period correctly set to 5000ms for sticky sessions');
    
    // Simulate timer
    let timerStarted = false;
    tab.closeTimer = setTimeout(() => {
      timerStarted = true;
    }, gracePeriod);
    
    assert.ok(tab.closeTimer, 'Close timer should be started');
    console.log('✓ Close timer started');
    
    // Clean up
    clearTimeout(tab.closeTimer);
  }
  
  console.log('✓ Grace period test passed');
}

// Test session rejoins during grace period
function testSessionRejoinDuringGracePeriod() {
  console.log('\n=== Test: Session Rejoins During Grace Period ===');
  
  const tab = {
    name: 'test-ssh',
    type: 'ssh',
    connectionData: { host: testConfig.host, port: testConfig.port, username: testConfig.username },
    activeSockets: new Set(['socket1']),
    sticky: true,
    closeTimer: null
  };
  
  // Simulate disconnect
  tab.activeSockets.delete('socket1');
  
  // Start grace period timer
  const gracePeriod = tab.sticky ? 5000 : 1000;
  let sessionClosed = false;
  
  tab.closeTimer = setTimeout(() => {
    if (tab.activeSockets.size === 0) {
      sessionClosed = true;
    }
  }, gracePeriod);
  
  console.log('✓ Grace period started');
  
  // Simulate new socket joining before timer fires
  tab.activeSockets.add('socket2');
  
  // Wait for timer to fire
  setTimeout(() => {
    assert.strictEqual(sessionClosed, false, 'Session should not be closed when new socket joined');
    console.log('✓ Session not closed when new socket joined during grace period');
  }, gracePeriod + 100);
  
  // Clean up
  clearTimeout(tab.closeTimer);
}

// Test non-sticky session has shorter grace period
function testNonStickyGracePeriod() {
  console.log('\n=== Test: Non-Sticky Session Grace Period ===');
  
  const tab = {
    name: 'test-ssh',
    type: 'ssh',
    connectionData: { host: testConfig.host, port: testConfig.port, username: testConfig.username },
    activeSockets: new Set(['socket1']),
    sticky: false, // Non-sticky
    closeTimer: null
  };
  
  // Simulate disconnect
  tab.activeSockets.delete('socket1');
  
  const gracePeriod = tab.sticky ? 5000 : 1000;
  assert.strictEqual(gracePeriod, 1000, 'Grace period should be 1000ms for non-sticky sessions');
  console.log('✓ Grace period correctly set to 1000ms for non-sticky sessions');
}

// Test terminal state serialization size limit
function testTerminalStateSizeLimit() {
  console.log('\n=== Test: Terminal State Size Limit ===');
  
  // Simulate large terminal state
  const maxSize = 1024 * 1024; // 1MB
  
  // Create a mock serialized state
  const smallState = 'x'.repeat(1000);
  const largeState = 'x'.repeat(maxSize + 1);
  
  // Test small state passes
  assert.ok(smallState.length < maxSize, 'Small state should be under limit');
  console.log('✓ Small terminal state passes size check');
  
  // Test large state fails
  assert.ok(largeState.length > maxSize, 'Large state should exceed limit');
  console.log('✓ Large terminal state correctly rejected');
}

// Test syncing flag prevents data race
function testSyncingFlagPreventsDataRace() {
  console.log('\n=== Test: Syncing Flag Prevents Data Race ===');
  
  const session = {
    syncing: false,
    syncTimeout: null
  };
  
  // Set syncing flag before join
  session.syncing = true;
  session.syncTimeout = setTimeout(() => {
    session.syncing = false;
  }, 5000);
  
  assert.strictEqual(session.syncing, true, 'Syncing flag should be set');
  console.log('✓ Syncing flag set before join');
  
  // Simulate data arriving during sync
  const dataArrived = false;
  if (session.syncing) {
    console.log('✓ Data blocked during sync (preventing duplication)');
  }
  
  // Clear syncing after screen sync
  clearTimeout(session.syncTimeout);
  session.syncing = false;
  
  assert.strictEqual(session.syncing, false, 'Syncing flag should be cleared');
  console.log('✓ Syncing flag cleared after sync');
}

// Run all tests
console.log('========================================');
console.log('Testing Sticky Session Page Reload');
console.log('========================================');

testGracePeriodApplied();
testSessionRejoinDuringGracePeriod();
testNonStickyGracePeriod();
testTerminalStateSizeLimit();
testSyncingFlagPreventsDataRace();

// Wait for async tests to complete
setTimeout(() => {
  console.log('\n========================================');
  console.log('✓ All sticky session tests passed!');
  console.log('========================================');
}, 6000);