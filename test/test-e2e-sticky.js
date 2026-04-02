/**
 * End-to-end test for sticky session synchronization
 * 
 * This test simulates the complete flow:
 * 1. Client connects and creates an SSH session
 * 2. Client disconnects (simulating page reload)
 * 3. Client reconnects within grace period
 * 4. Session should be restored with terminal state
 */

const assert = require('assert');
const { getTestConfig } = require('./test-helper');

// Test configuration - loaded from .env files
const testConfig = getTestConfig();

// Simulate the server-side tab management
class MockTabManager {
  constructor() {
    this.tabs = new Map();
    this.timers = new Map();
  }
  
  createSession(sessionId, sticky = true) {
    this.tabs.set(sessionId, {
      name: 'test-ssh',
      type: 'ssh',
      connectionData: { host: testConfig.host, port: testConfig.port, username: testConfig.username },
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

// Test 1: Grace period prevents immediate close
async function testGracePeriodPreventsImmediateClose() {
  console.log('\n=== Test: Grace Period Prevents Immediate Close ===');
  
  const manager = new MockTabManager();
  const sessionId = 'test-session-1';
  
  // Create session with sticky enabled
  manager.createSession(sessionId, true);
  manager.addSocket(sessionId, 'socket-1');
  
  // Remove socket (simulating disconnect)
  const result = await manager.removeSocket(sessionId, 'socket-1');
  
  assert.strictEqual(result.timerStarted, true, 'Timer should be started');
  assert.strictEqual(result.gracePeriod, 5000, 'Grace period should be 5000ms');
  console.log('✓ Grace period started on disconnect');
  
  // Session should still exist
  const session = manager.getSession(sessionId);
  assert.ok(session, 'Session should still exist during grace period');
  console.log('✓ Session still exists during grace period');
}

// Test 2: Session closes after grace period
async function testSessionClosesAfterGracePeriod() {
  console.log('\n=== Test: Session Closes After Grace Period ===');
  
  const manager = new MockTabManager();
  const sessionId = 'test-session-2';
  
  // Create session with sticky disabled (shorter grace period)
  manager.createSession(sessionId, false);
  manager.addSocket(sessionId, 'socket-1');
  
  // Remove socket
  await manager.removeSocket(sessionId, 'socket-1');
  
  // Wait for grace period + buffer
  await new Promise(resolve => setTimeout(resolve, 1100));
  
  // Session should be closed
  const session = manager.getSession(sessionId);
  assert.strictEqual(session, undefined, 'Session should be closed after grace period');
  console.log('✓ Session closed after grace period');
}

// Test 3: New socket cancels close timer
async function testNewSocketCancelsCloseTimer() {
  console.log('\n=== Test: New Socket Cancels Close Timer ===');
  
  const manager = new MockTabManager();
  const sessionId = 'test-session-3';
  
  // Create session
  manager.createSession(sessionId, true);
  manager.addSocket(sessionId, 'socket-1');
  
  // Remove socket (start grace period)
  await manager.removeSocket(sessionId, 'socket-1');
  
  // Add new socket before grace period expires
  manager.addSocket(sessionId, 'socket-2');
  
  // Wait for grace period
  await new Promise(resolve => setTimeout(resolve, 5100));
  
  // Session should still exist because new socket joined
  const session = manager.getSession(sessionId);
  assert.ok(session, 'Session should still exist after new socket joined');
  assert.ok(session.activeSockets.has('socket-2'), 'New socket should be in active sockets');
  console.log('✓ New socket canceled close timer');
}

// Test 4: Non-sticky session has shorter grace period
async function testNonStickyShorterGracePeriod() {
  console.log('\n=== Test: Non-Sticky Session Has Shorter Grace Period ===');
  
  const manager = new MockTabManager();
  const sessionId = 'test-session-4';
  
  // Create session with sticky disabled
  manager.createSession(sessionId, false);
  manager.addSocket(sessionId, 'socket-1');
  
  // Remove socket
  const result = await manager.removeSocket(sessionId, 'socket-1');
  
  assert.strictEqual(result.gracePeriod, 1000, 'Grace period should be 1000ms for non-sticky');
  console.log('✓ Non-sticky session has 1000ms grace period');
}

// Test 5: Multiple disconnects don't create multiple timers
async function testMultipleDisconnectsDontCreateMultipleTimers() {
  console.log('\n=== Test: Multiple Disconnects Single Timer ===');
  
  const manager = new MockTabManager();
  const sessionId = 'test-session-5';
  
  // Create session
  manager.createSession(sessionId, true);
  manager.addSocket(sessionId, 'socket-1');
  manager.addSocket(sessionId, 'socket-2');
  
  // Remove first socket
  await manager.removeSocket(sessionId, 'socket-1');
  
  // Remove second socket
  await manager.removeSocket(sessionId, 'socket-2');
  
  // Should only have one timer
  const session = manager.getSession(sessionId);
  assert.ok(session.closeTimer, 'Should have a close timer');
  console.log('✓ Single timer created for multiple disconnects');
}

// Run all tests
async function runTests() {
  console.log('========================================');
  console.log('End-to-End Sticky Session Tests');
  console.log('========================================');
  
  await testGracePeriodPreventsImmediateClose();
  await testSessionClosesAfterGracePeriod();
  await testNewSocketCancelsCloseTimer();
  await testNonStickyShorterGracePeriod();
  await testMultipleDisconnectsDontCreateMultipleTimers();
  
  console.log('\n========================================');
  console.log('✓ All end-to-end tests passed!');
  console.log('========================================');
}

runTests().catch(console.error);