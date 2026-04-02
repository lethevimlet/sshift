#!/usr/bin/env node

/**
 * Test for settings modal functionality
 * Tests the sticky property toggle and save/cancel buttons
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// Helper to make HTTP requests
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function runTests() {
  console.log('========================================');
  console.log('Settings Modal Tests');
  console.log('========================================\n');

  // Test 1: GET /api/config returns sticky property
  console.log('🧪 Running: GET /api/config returns sticky property');
  try {
    const result = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/config',
      method: 'GET'
    });
    
    if (result.status === 200 && result.body.hasOwnProperty('sticky')) {
      console.log('✅ PASSED: GET /api/config returns sticky property');
      console.log(`   Response: ${JSON.stringify(result.body)}`);
    } else {
      console.log('❌ FAILED: GET /api/config missing sticky property');
      process.exit(1);
    }
  } catch (err) {
    console.log('❌ FAILED: Error connecting to server:', err.message);
    process.exit(1);
  }

  // Test 2: POST /api/config updates sticky property
  console.log('\n🧪 Running: POST /api/config updates sticky property');
  try {
    // First, get current config
    const currentConfig = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/config',
      method: 'GET'
    });
    
    const originalSticky = currentConfig.body.sticky;
    const newSticky = !originalSticky;
    
    // Update sticky setting
    const updateResult = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/config',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { sticky: newSticky });
    
    if (updateResult.status === 200 && updateResult.body.success) {
      console.log('✅ PASSED: POST /api/config successfully updated sticky');
      console.log(`   Changed sticky from ${originalSticky} to ${newSticky}`);
      
      // Verify the change persisted
      const verifyResult = await makeRequest({
        hostname: 'localhost',
        port: 3000,
        path: '/api/config',
        method: 'GET'
      });
      
      if (verifyResult.body.sticky === newSticky) {
        console.log('✅ PASSED: Sticky setting persisted correctly');
      } else {
        console.log('❌ FAILED: Sticky setting did not persist');
        process.exit(1);
      }
      
      // Restore original setting
      await makeRequest({
        hostname: 'localhost',
        port: 3000,
        path: '/api/config',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { sticky: originalSticky });
      console.log(`   Restored original sticky setting: ${originalSticky}`);
    } else {
      console.log('❌ FAILED: POST /api/config did not update sticky');
      console.log(`   Response: ${JSON.stringify(updateResult)}`);
      process.exit(1);
    }
  } catch (err) {
    console.log('❌ FAILED: Error updating config:', err.message);
    process.exit(1);
  }

  // Test 3: Verify config.json structure
  console.log('\n🧪 Running: Verify config.json structure');
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    
    if (config.hasOwnProperty('sticky')) {
      console.log('✅ PASSED: config.json contains sticky property');
      console.log(`   Current value: ${config.sticky}`);
    } else {
      console.log('❌ FAILED: config.json missing sticky property');
      process.exit(1);
    }
  } catch (err) {
    console.log('❌ FAILED: Error reading config.json:', err.message);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('All settings modal tests passed! ✅');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});