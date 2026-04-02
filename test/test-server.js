#!/usr/bin/env node

const http = require('http');

const BASE_URL = 'http://localhost:3000';

function fetch(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function test() {
  console.log('=== Testing SSHIFT Server ===\n');
  
  // Test 1: Main page
  console.log('1. Testing main page...');
  try {
    const result = await fetch('/');
    if (result.status === 200) {
      console.log('   ✓ Main page served (status: 200)');
      if (result.data.includes('SSHIFT')) {
        console.log('   ✓ Contains SSHIFT branding');
      } else {
        console.log('   ✗ Missing SSHIFT branding');
      }
    } else {
      console.log(`   ✗ Failed with status: ${result.status}`);
    }
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }
  
  // Test 2: xterm.js
  console.log('\n2. Testing xterm.js...');
  try {
    const result = await fetch('/libs/xterm/xterm.js');
    if (result.status === 200) {
      console.log('   ✓ xterm.js served (status: 200)');
      if (result.data.includes('Terminal')) {
        console.log('   ✓ Contains Terminal class');
      }
      if (result.data.includes('module.exports')) {
        console.log('   ✓ Uses UMD pattern');
      }
    } else {
      console.log(`   ✗ Failed with status: ${result.status}`);
    }
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }
  
  // Test 3: xterm-addon-fit.js
  console.log('\n3. Testing xterm-addon-fit.js...');
  try {
    const result = await fetch('/libs/xterm/xterm-addon-fit.js');
    if (result.status === 200) {
      console.log('   ✓ xterm-addon-fit.js served (status: 200)');
      if (result.data.includes('FitAddon')) {
        console.log('   ✓ Contains FitAddon class');
      }
    } else {
      console.log(`   ✗ Failed with status: ${result.status}`);
    }
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }
  
  // Test 4: xterm.css
  console.log('\n4. Testing xterm.css...');
  try {
    const result = await fetch('/libs/xterm/xterm.css');
    if (result.status === 200) {
      console.log('   ✓ xterm.css served (status: 200)');
    } else {
      console.log(`   ✗ Failed with status: ${result.status}`);
    }
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }
  
  // Test 5: app.js
  console.log('\n5. Testing app.js...');
  try {
    const result = await fetch('/js/app.js');
    if (result.status === 200) {
      console.log('   ✓ app.js served (status: 200)');
      if (result.data.includes('SSHIFTClient')) {
        console.log('   ✓ Contains SSHIFTClient class');
      }
    } else {
      console.log(`   ✗ Failed with status: ${result.status}`);
    }
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }
  
  // Test 6: Socket.IO
  console.log('\n6. Testing Socket.IO...');
  try {
    const result = await fetch('/socket.io/socket.io.js');
    if (result.status === 200) {
      console.log('   ✓ socket.io.js served (status: 200)');
    } else {
      console.log(`   ✗ Failed with status: ${result.status}`);
    }
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }
  
  // Test 7: Test pages
  console.log('\n7. Testing test pages...');
  try {
    const result = await fetch('/test-xterm.html');
    if (result.status === 200) {
      console.log('   ✓ test-xterm.html served (status: 200)');
    } else {
      console.log(`   ✗ Failed with status: ${result.status}`);
    }
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }
  
  try {
    const result = await fetch('/test-connection.html');
    if (result.status === 200) {
      console.log('   ✓ test-connection.html served (status: 200)');
    } else {
      console.log(`   ✗ Failed with status: ${result.status}`);
    }
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }
  
  console.log('\n=== Test Complete ===');
  console.log('\nNext steps:');
  console.log('1. Open http://localhost:3000/ in a browser');
  console.log('2. Open browser developer tools (F12)');
  console.log('3. Check console for [SSHIFT] messages');
  console.log('4. If issues persist, try http://localhost:3000/test-connection.html');
}

test().catch(console.error);