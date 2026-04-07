const puppeteer = require('puppeteer');

async function testSettingsModal() {
  console.log('========================================');
  console.log('Testing Settings Modal Functionality');
  console.log('========================================\n');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  try {
    // Enable console logging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('Browser console error:', msg.text());
      }
    });
    
    // Navigate to the app
    console.log('Navigating to process.env.SERVER_URL || 'http://localhost:8022'...');
    await page.goto('process.env.SERVER_URL || 'http://localhost:8022'', { waitUntil: 'networkidle2' });
    
    // Wait for app to initialize
    await page.waitForTimeout(1000);
    
    // Test 1: Check if settings button exists
    console.log('\nTest 1: Checking if settings button exists...');
    const settingsBtn = await page.$('#settingsBtn');
    if (settingsBtn) {
      console.log('✓ Settings button found');
    } else {
      console.log('✗ Settings button not found');
      return false;
    }
    
    // Test 2: Click settings button to open modal
    console.log('\nTest 2: Opening settings modal...');
    await settingsBtn.click();
    await page.waitForTimeout(500);
    
    const modalVisible = await page.evaluate(() => {
      const modal = document.getElementById('settingsModal');
      return modal && modal.classList.contains('active');
    });
    
    if (modalVisible) {
      console.log('✓ Settings modal opened successfully');
    } else {
      console.log('✗ Settings modal did not open');
      return false;
    }
    
    // Test 3: Check if close button (X) exists and works
    console.log('\nTest 3: Testing close button (X)...');
    const closeBtn = await page.$('#closeSettingsModal');
    if (closeBtn) {
      console.log('✓ Close button found');
      await closeBtn.click();
      await page.waitForTimeout(500);
      
      const modalClosed = await page.evaluate(() => {
        const modal = document.getElementById('settingsModal');
        return !modal || !modal.classList.contains('active');
      });
      
      if (modalClosed) {
        console.log('✓ Close button works - modal closed');
      } else {
        console.log('✗ Close button did not close modal');
        return false;
      }
    } else {
      console.log('✗ Close button not found');
      return false;
    }
    
    // Test 4: Open modal again and test cancel button
    console.log('\nTest 4: Testing cancel button...');
    await settingsBtn.click();
    await page.waitForTimeout(500);
    
    const cancelBtn = await page.$('#cancelSettings');
    if (cancelBtn) {
      console.log('✓ Cancel button found');
      await cancelBtn.click();
      await page.waitForTimeout(500);
      
      const modalClosed = await page.evaluate(() => {
        const modal = document.getElementById('settingsModal');
        return !modal || !modal.classList.contains('active');
      });
      
      if (modalClosed) {
        console.log('✓ Cancel button works - modal closed');
      } else {
        console.log('✗ Cancel button did not close modal');
        return false;
      }
    } else {
      console.log('✗ Cancel button not found');
      return false;
    }
    
    // Test 5: Test save button
    console.log('\nTest 5: Testing save button...');
    await settingsBtn.click();
    await page.waitForTimeout(500);
    
    // Get current sticky state
    const initialSticky = await page.evaluate(() => {
      const toggle = document.getElementById('stickyToggle');
      return toggle ? toggle.checked : null;
    });
    console.log(`Initial sticky state: ${initialSticky}`);
    
    // Toggle the checkbox
    await page.evaluate(() => {
      const toggle = document.getElementById('stickyToggle');
      if (toggle) toggle.checked = !toggle.checked;
    });
    
    const toggledSticky = await page.evaluate(() => {
      const toggle = document.getElementById('stickyToggle');
      return toggle ? toggle.checked : null;
    });
    console.log(`Toggled sticky state: ${toggledSticky}`);
    
    // Click save
    const saveBtn = await page.$('#saveSettings');
    if (saveBtn) {
      console.log('✓ Save button found');
      await saveBtn.click();
      await page.waitForTimeout(1000);
      
      const modalClosed = await page.evaluate(() => {
        const modal = document.getElementById('settingsModal');
        return !modal || !modal.classList.contains('active');
      });
      
      if (modalClosed) {
        console.log('✓ Save button works - modal closed');
      } else {
        console.log('✗ Save button did not close modal');
        return false;
      }
      
      // Verify the setting was saved
      await settingsBtn.click();
      await page.waitForTimeout(500);
      
      const savedSticky = await page.evaluate(() => {
        const toggle = document.getElementById('stickyToggle');
        return toggle ? toggle.checked : null;
      });
      console.log(`Saved sticky state: ${savedSticky}`);
      
      if (savedSticky === toggledSticky) {
        console.log('✓ Sticky setting was saved correctly');
      } else {
        console.log('✗ Sticky setting was not saved correctly');
        return false;
      }
      
      // Close modal
      await cancelBtn.click();
      await page.waitForTimeout(500);
    } else {
      console.log('✗ Save button not found');
      return false;
    }
    
    // Test 6: Verify persistence via API
    console.log('\nTest 6: Verifying persistence via API...');
    const configResponse = await page.evaluate(async () => {
      const response = await fetch('/api/config');
      return await response.json();
    });
    
    console.log(`API config sticky: ${configResponse.sticky}`);
    
    if (configResponse.sticky === toggledSticky) {
      console.log('✓ Setting persisted correctly via API');
    } else {
      console.log('✗ Setting did not persist correctly via API');
      return false;
    }
    
    // Restore original state
    console.log('\nRestoring original state...');
    await page.evaluate(async (originalState) => {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sticky: originalState })
      });
      return await response.json();
    }, initialSticky);
    
    console.log(`✓ Restored sticky to: ${initialSticky}`);
    
    console.log('\n========================================');
    console.log('✓ All tests passed!');
    console.log('========================================');
    
    return true;
    
  } catch (error) {
    console.error('\n✗ Test failed with error:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

testSettingsModal().then(success => {
  process.exit(success ? 0 : 1);
});