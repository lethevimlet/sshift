const fs = require('fs');
const path = require('path');

console.log('========================================');
console.log('Testing Settings Modal Code Structure');
console.log('========================================\n');

let allPassed = true;

// Test 1: Check if initSettingsModalHandlers is called in setupEventListeners
console.log('Test 1: Checking if initSettingsModalHandlers is called in setupEventListeners...');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'js', 'app.js'), 'utf8');

const setupEventListenersMatch = appJs.match(/setupEventListeners\(\)\s*\{[\s\S]*?\/\/ Settings button[\s\S]*?document\.getElementById\('settingsBtn'\)\.addEventListener[\s\S]*?this\.initSettingsModalHandlers\(\);/);

if (setupEventListenersMatch) {
  console.log('✓ initSettingsModalHandlers is called in setupEventListeners');
} else {
  console.log('✗ initSettingsModalHandlers is NOT called in setupEventListeners');
  allPassed = false;
}

// Test 2: Check if initSettingsModalHandlers method exists
console.log('\nTest 2: Checking if initSettingsModalHandlers method exists...');
if (appJs.includes('initSettingsModalHandlers()')) {
  console.log('✓ initSettingsModalHandlers method exists');
} else {
  console.log('✗ initSettingsModalHandlers method not found');
  allPassed = false;
}

// Test 3: Check if closeSettingsModal event listener is attached
console.log('\nTest 3: Checking if closeSettingsModal event listener is attached...');
const closeBtnMatch = appJs.match(/closeSettingsModal[\s\S]*?addEventListener\('click'/);
if (closeBtnMatch) {
  console.log('✓ closeSettingsModal event listener is attached');
} else {
  console.log('✗ closeSettingsModal event listener not found');
  allPassed = false;
}

// Test 4: Check if cancelSettings event listener is attached
console.log('\nTest 4: Checking if cancelSettings event listener is attached...');
const cancelBtnMatch = appJs.match(/cancelSettings[\s\S]*?addEventListener\('click'/);
if (cancelBtnMatch) {
  console.log('✓ cancelSettings event listener is attached');
} else {
  console.log('✗ cancelSettings event listener not found');
  allPassed = false;
}

// Test 5: Check if saveSettings event listener is attached
console.log('\nTest 5: Checking if saveSettings event listener is attached...');
const saveBtnMatch = appJs.match(/saveSettings[\s\S]*?addEventListener\('click'/);
if (saveBtnMatch) {
  console.log('✓ saveSettings event listener is attached');
} else {
  console.log('✗ saveSettings event listener not found');
  allPassed = false;
}

// Test 6: Check if openSettingsModal method exists
console.log('\nTest 6: Checking if openSettingsModal method exists...');
if (appJs.includes('openSettingsModal()')) {
  console.log('✓ openSettingsModal method exists');
} else {
  console.log('✗ openSettingsModal method not found');
  allPassed = false;
}

// Test 7: Check if saveStickyConfig method exists
console.log('\nTest 7: Checking if saveStickyConfig method exists...');
if (appJs.includes('saveStickyConfig()')) {
  console.log('✓ saveStickyConfig method exists');
} else {
  console.log('✗ saveStickyConfig method not found');
  allPassed = false;
}

// Test 8: Check if HTML has all required elements
console.log('\nTest 8: Checking if HTML has all required elements...');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'index.html'), 'utf8');

const requiredElements = [
  'id="settingsModal"',
  'id="settingsBtn"',
  'id="closeSettingsModal"',
  'id="cancelSettings"',
  'id="saveSettings"',
  'id="stickyToggle"'
];

let htmlOk = true;
for (const elem of requiredElements) {
  if (indexHtml.includes(elem)) {
    console.log(`  ✓ ${elem} found`);
  } else {
    console.log(`  ✗ ${elem} not found`);
    htmlOk = false;
    allPassed = false;
  }
}

if (htmlOk) {
  console.log('✓ All required HTML elements found');
}

// Test 9: Check if CSS has required styles
console.log('\nTest 9: Checking if CSS has required styles...');
const styleCss = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'css', 'style.css'), 'utf8');

const requiredStyles = [
  '.modal.active',
  '.modal-close',
  '.modal-footer',
  '.toggle-switch'
];

let cssOk = true;
for (const style of requiredStyles) {
  if (styleCss.includes(style)) {
    console.log(`  ✓ ${style} found`);
  } else {
    console.log(`  ✗ ${style} not found`);
    cssOk = false;
    allPassed = false;
  }
}

if (cssOk) {
  console.log('✓ All required CSS styles found');
}

// Test 10: Check server API endpoint
console.log('\nTest 10: Checking server API endpoint...');
const restEndpointsPath = path.join(__dirname, '..', 'server', 'endpoints', 'rest', 'config.js');
const restEndpointsCode = fs.readFileSync(restEndpointsPath, 'utf8');

if (restEndpointsCode.includes("app.get('/api/config'") && restEndpointsCode.includes("app.post('/api/config'")) {
  console.log('✓ Server has GET and POST /api/config endpoints');
} else {
  console.log('✗ Server missing /api/config endpoints');
  allPassed = false;
}

console.log('\n========================================');
if (allPassed) {
  console.log('✓ All code structure tests passed!');
  console.log('========================================');
  process.exit(0);
} else {
  console.log('✗ Some tests failed');
  console.log('========================================');
  process.exit(1);
}