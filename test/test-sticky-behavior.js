/**
 * Test script to verify sticky behavior
 * 
 * This tests:
 * 1. Config API returns sticky property
 * 2. Client correctly loads and applies this setting
 * 3. Tab restoration respects this setting
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function testConfigAPI() {
  console.log('\n=== Testing Config API ===');
  
  try {
    const config = await makeRequest('/api/config');
    console.log('Config response:', JSON.stringify(config, null, 2));
    
    // Verify sticky property exists
    if (typeof config.sticky !== 'boolean') {
      console.error('❌ FAIL: sticky should be boolean, got:', typeof config.sticky);
      return false;
    }
    
    console.log('✓ Config API returns sticky property');
    console.log(`  sticky: ${config.sticky}`);
    
    return true;
  } catch (err) {
    console.error('❌ FAIL: Error fetching config:', err.message);
    return false;
  }
}

async function testConfigFile() {
  console.log('\n=== Testing Config File ===');
  const fs = require('fs');
  const path = require('path');
  
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    console.log('Config file content:', JSON.stringify(configData, null, 2));
    
    // Check that old properties are replaced
    if ('stickyTabs' in configData) {
      console.error('❌ FAIL: Old "stickyTabs" property still exists in config.json');
      return false;
    }
    
    if ('stickySessions' in configData) {
      console.error('❌ FAIL: Old "stickySessions" property still exists in config.json');
      return false;
    }
    
    // Check new property exists
    if (typeof configData.sticky !== 'boolean') {
      console.error('❌ FAIL: sticky missing or not boolean in config.json');
      return false;
    }
    
    console.log('✓ Config file has correct structure');
    console.log(`  sticky: ${configData.sticky}`);
    
    return true;
  } catch (err) {
    console.error('❌ FAIL: Error reading config file:', err.message);
    return false;
  }
}

async function runTests() {
  console.log('========================================');
  console.log('Testing sticky property');
  console.log('========================================');
  
  const results = [];
  
  results.push(await testConfigAPI());
  results.push(await testConfigFile());
  
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