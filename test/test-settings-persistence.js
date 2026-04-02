const http = require('http');

const BASE_URL = 'http://localhost:3000';

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      path,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };
    
    const req = http.request(`${BASE_URL}${path}`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function testSettingsModal() {
  console.log('\n=== Testing Settings Modal Functionality ===\n');
  
  // Test 1: Get current config
  console.log('Test 1: GET /api/config');
  const getConfig = await makeRequest('/api/config');
  console.log('Status:', getConfig.status);
  console.log('Response:', JSON.stringify(getConfig.data, null, 2));
  
  if (getConfig.status !== 200) {
    console.error('❌ FAIL: Could not get config');
    return false;
  }
  console.log('✓ Config retrieved successfully\n');
  
  // Test 2: Update sticky to false
  console.log('Test 2: POST /api/config (set sticky to false)');
  const setFalse = await makeRequest('/api/config', 'POST', { sticky: false });
  console.log('Status:', setFalse.status);
  console.log('Response:', JSON.stringify(setFalse.data, null, 2));
  
  if (setFalse.status !== 200 || setFalse.data.sticky !== false) {
    console.error('❌ FAIL: Could not set sticky to false');
    return false;
  }
  console.log('✓ Sticky set to false\n');
  
  // Test 3: Verify the change persisted
  console.log('Test 3: GET /api/config (verify sticky is false)');
  const verifyFalse = await makeRequest('/api/config');
  console.log('Status:', verifyFalse.status);
  console.log('Response:', JSON.stringify(verifyFalse.data, null, 2));
  
  if (verifyFalse.data.sticky !== false) {
    console.error('❌ FAIL: Sticky did not persist as false');
    return false;
  }
  console.log('✓ Sticky correctly persisted as false\n');
  
  // Test 4: Update sticky to true
  console.log('Test 4: POST /api/config (set sticky to true)');
  const setTrue = await makeRequest('/api/config', 'POST', { sticky: true });
  console.log('Status:', setTrue.status);
  console.log('Response:', JSON.stringify(setTrue.data, null, 2));
  
  if (setTrue.status !== 200 || setTrue.data.sticky !== true) {
    console.error('❌ FAIL: Could not set sticky to true');
    return false;
  }
  console.log('✓ Sticky set to true\n');
  
  // Test 5: Verify the change persisted
  console.log('Test 5: GET /api/config (verify sticky is true)');
  const verifyTrue = await makeRequest('/api/config');
  console.log('Status:', verifyTrue.status);
  console.log('Response:', JSON.stringify(verifyTrue.data, null, 2));
  
  if (verifyTrue.data.sticky !== true) {
    console.error('❌ FAIL: Sticky did not persist as true');
    return false;
  }
  console.log('✓ Sticky correctly persisted as true\n');
  
  console.log('========================================');
  console.log('✓ All settings modal tests passed!');
  console.log('========================================');
  
  return true;
}

testSettingsModal().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});