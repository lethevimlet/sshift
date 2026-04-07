const fs = require('fs');
const path = require('path');
const { getTestConfig } = require('./test-helper');

const TEST_CONFIG = getTestConfig();

const SERVER_URL = 'process.env.SERVER_URL || 'http://localhost:8022'';
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// Test functions
async function testStickyProperty() {
  console.log('🧪 Running: Sticky property in config');
  
  try {
    const response = await fetch(`${SERVER_URL}/api/config`);
    const config = await response.json();
    
    console.log('   Config received:', JSON.stringify(config).substring(0, 100) + '...');
    
    if ('sticky' in config) {
      console.log('   ✅ Sticky property found');
      console.log('   Value:', config.sticky);
      
      // Verify it's a boolean
      if (typeof config.sticky === 'boolean') {
        console.log('   ✅ Sticky is boolean type');
      } else {
        console.log('   ❌ Sticky is not boolean:', typeof config.sticky);
        return false;
      }
      
      // Verify old properties don't exist
      if ('stickyTabs' in config || 'stickySessions' in config) {
        console.log('   ❌ Old properties still present');
        return false;
      } else {
        console.log('   ✅ Old properties removed');
      }
      
      return true;
    } else {
      console.log('   ❌ Sticky property not found');
      return false;
    }
  } catch (err) {
    console.log('   ❌ Error:', err.message);
    return false;
  }
}

async function testStickyToggle() {
  console.log('\n🧪 Running: Sticky toggle in settings');
  
  try {
    // Read config file
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const originalSticky = config.sticky;
    
    console.log('   Original sticky value:', originalSticky);
    
    // Toggle sticky value
    const newSticky = !originalSticky;
    
    const response = await fetch(`${SERVER_URL}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sticky: newSticky })
    });
    
    if (!response.ok) {
      console.log('   ❌ Failed to save config');
      return false;
    }
    
    console.log('   ✅ Config saved');
    
    // Verify the change
    const updatedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    
    if (updatedConfig.sticky === newSticky) {
      console.log('   ✅ Sticky toggled successfully to:', newSticky);
      
      // Restore original value
      await fetch(`${SERVER_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sticky: originalSticky })
      });
      
      console.log('   ✅ Original value restored');
      return true;
    } else {
      console.log('   ❌ Sticky not toggled correctly');
      console.log('   Expected:', newSticky, 'Got:', updatedConfig.sticky);
      return false;
    }
  } catch (err) {
    console.log('   ❌ Error:', err.message);
    return false;
  }
}

async function testKeepaliveWithSticky() {
  console.log('\n🧪 Running: Keepalive settings with sticky');
  
  try {
    // Test saving both sticky and keepalive settings
    const testConfig = {
      sticky: false,
      sshKeepaliveInterval: 15000,
      sshKeepaliveCountMax: 500
    };
    
    const saveResponse = await fetch(`${SERVER_URL}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testConfig)
    });
    
    if (!saveResponse.ok) {
      console.log('   ❌ Failed to save config');
      return false;
    }
    
    console.log('   ✅ Config saved');
    
    // Verify all settings
    const getResponse = await fetch(`${SERVER_URL}/api/config`);
    const config = await getResponse.json();
    
    let success = true;
    
    if (config.sticky !== testConfig.sticky) {
      console.log('   ❌ Sticky not saved correctly');
      success = false;
    } else {
      console.log('   ✅ Sticky saved correctly:', config.sticky);
    }
    
    if (config.sshKeepaliveInterval !== testConfig.sshKeepaliveInterval) {
      console.log('   ❌ Keepalive interval not saved correctly');
      success = false;
    } else {
      console.log('   ✅ Keepalive interval saved correctly:', config.sshKeepaliveInterval);
    }
    
    if (config.sshKeepaliveCountMax !== testConfig.sshKeepaliveCountMax) {
      console.log('   ❌ Keepalive count max not saved correctly');
      success = false;
    } else {
      console.log('   ✅ Keepalive count max saved correctly:', config.sshKeepaliveCountMax);
    }
    
    return success;
  } catch (err) {
    console.log('   ❌ Error:', err.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('========================================');
  console.log('Sticky Property & Keepalive Tests');
  console.log('========================================\n');
  
  const results = [];
  
  results.push(await testStickyProperty());
  results.push(await testStickyToggle());
  results.push(await testKeepaliveWithSticky());
  
  console.log('\n========================================');
  console.log('Test Results');
  console.log('========================================');
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  if (passed === total) {
    console.log(`✅ All tests passed: ${passed}/${total}`);
    process.exit(0);
  } else {
    console.log(`❌ Some tests failed: ${passed}/${total}`);
    process.exit(1);
  }
}

runTests();