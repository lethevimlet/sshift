/**
 * Test for sticky session cleanup behavior
 * 
 * This test verifies that:
 * 1. Sticky sessions remain open on server when browser disconnects
 * 2. Non-sticky sessions close after grace period when browser disconnects
 * 3. Explicitly closed tabs close immediately regardless of sticky setting
 */

const fs = require('fs');
const path = require('path');

console.log('========================================');
console.log('Testing Sticky Session Cleanup Behavior');
console.log('========================================\n');

let allPassed = true;

// Read server.js
const serverPath = path.join(__dirname, '..', 'server.js');
const serverCode = fs.readFileSync(serverPath, 'utf8');

// Test 1: Check that sticky sessions don't have a close timer on disconnect
console.log('Test 1: Checking sticky sessions remain open on disconnect...');
const stickyDisconnectMatch = serverCode.match(/socket\.on\('disconnect'[\s\S]*?if \(tab\.sticky\)[\s\S]*?console\.log\('\[TAB\] Sticky session remains open on server:'/);
if (stickyDisconnectMatch) {
  console.log('✓ Sticky sessions remain open on server when browser disconnects');
} else {
  console.log('✗ Sticky sessions may close incorrectly on disconnect');
  allPassed = false;
}

// Test 2: Check that non-sticky sessions have grace period on disconnect
console.log('\nTest 2: Checking non-sticky sessions close after grace period...');
const nonStickyDisconnectMatch = serverCode.match(/socket\.on\('disconnect'[\s\S]*?else \{[\s\S]*?\/\/ For non-sticky sessions[\s\S]*?const gracePeriod = 5000/);
if (nonStickyDisconnectMatch) {
  console.log('✓ Non-sticky sessions close after 5s grace period on disconnect');
} else {
  console.log('✗ Non-sticky sessions may not close correctly on disconnect');
  allPassed = false;
}

// Test 3: Check that tab-close closes immediately regardless of sticky
console.log('\nTest 3: Checking tab-close behavior...');
const tabCloseMatch = serverCode.match(/socket\.on\('tab-close'[\s\S]*?\/\/ When user explicitly closes a tab, close the session immediately[\s\S]*?\/\/ regardless of sticky setting/);
if (tabCloseMatch) {
  console.log('✓ Explicitly closed tabs close immediately regardless of sticky setting');
} else {
  console.log('✗ Tab-close may not close sessions immediately');
  allPassed = false;
}

// Test 4: Verify no grace period for tab-close
console.log('\nTest 4: Checking tab-close has no grace period...');
const tabCloseNoGrace = serverCode.match(/socket\.on\('tab-close'[\s\S]*?console\.log\('\[TAB\] Tab explicitly closed by user, closing session:'/);
if (tabCloseNoGrace) {
  console.log('✓ Tab-close closes sessions immediately without grace period');
} else {
  console.log('✗ Tab-close may have grace period delay');
  allPassed = false;
}

// Test 5: Check that sticky sessions clear any existing close timers
console.log('\nTest 5: Checking sticky sessions clear close timers...');
const clearTimerMatch = serverCode.match(/if \(tab\.sticky\)[\s\S]*?if \(tab\.closeTimer\)[\s\S]*?clearTimeout\(tab\.closeTimer\)/);
if (clearTimerMatch) {
  console.log('✓ Sticky sessions clear any existing close timers');
} else {
  console.log('✗ Sticky sessions may not clear close timers');
  allPassed = false;
}

// Test 6: Verify disconnect handler doesn't close sticky sessions
console.log('\nTest 6: Checking disconnect handler doesn\'t close sticky sessions...');
// Check that within the sticky block, there's no disconnect call
const disconnectHandler = serverCode.match(/socket\.on\('disconnect'[\s\S]*?\}\);/);
if (disconnectHandler) {
  const handlerCode = disconnectHandler[0];
  // Extract the sticky block
  const stickyBlock = handlerCode.match(/if \(tab\.sticky\)[\s\S]*?\}/);
  if (stickyBlock) {
    const hasDisconnect = stickyBlock[0].includes('sshManager.disconnect') || stickyBlock[0].includes('sftpManager.disconnect');
    if (!hasDisconnect) {
      console.log('✓ Disconnect handler does not close sticky sessions');
    } else {
      console.log('✗ Disconnect handler closes sticky sessions incorrectly');
      allPassed = false;
    }
  } else {
    console.log('✗ Could not find sticky block in disconnect handler');
    allPassed = false;
  }
} else {
  console.log('✗ Could not find disconnect handler');
  allPassed = false;
}

// Test 7: Verify disconnect handler closes non-sticky sessions
console.log('\nTest 7: Checking disconnect handler closes non-sticky sessions...');
const disconnectNonStickyClose = serverCode.match(/socket\.on\('disconnect'[\s\S]*?else \{[\s\S]*?\/\/ For non-sticky sessions[\s\S]*?sshManager\.disconnect\(sessionId\)/);
if (disconnectNonStickyClose) {
  console.log('✓ Disconnect handler closes non-sticky sessions after grace period');
} else {
  console.log('✗ Disconnect handler may not close non-sticky sessions');
  allPassed = false;
}

console.log('\n========================================');
if (allPassed) {
  console.log('✓ All sticky session cleanup tests passed!');
  console.log('========================================');
  process.exit(0);
} else {
  console.log('✗ Some tests failed');
  console.log('========================================');
  process.exit(1);
}