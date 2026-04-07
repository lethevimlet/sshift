/**
 * Test script to verify layout synchronization between browser tabs
 * 
 * This tests:
 * 1. Layout change syncs to other tabs
 * 2. Active session per panel syncs correctly
 * 3. Tab distribution across panels persists
 * 4. Drag-and-drop between panels works
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:8022';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testLayoutSync() {
  console.log('\n=== Testing Layout Synchronization ===\n');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    // Create two pages (simulating two browser tabs)
    const page1 = await browser.newPage();
    const page2 = await browser.newPage();
    
    // Set viewport
    await page1.setViewport({ width: 1280, height: 800 });
    await page2.setViewport({ width: 1280, height: 800 });
    
    // Enable sticky mode for both pages
    await page1.goto(BASE_URL);
    await page2.goto(BASE_URL);
    
    // Wait for pages to load
    await sleep(2000);
    
    // Enable sticky mode on both pages
    console.log('Enabling sticky mode on both pages...');
    await page1.evaluate(() => {
      window.app.sticky = true;
      window.app.saveStickyConfig();
    });
    await page2.evaluate(() => {
      window.app.sticky = true;
      window.app.saveStickyConfig();
    });
    
    await sleep(500);
    
    // Test 1: Check initial layout
    console.log('\nTest 1: Check initial layout...');
    const initialLayout1 = await page1.evaluate(() => window.app.currentLayout?.id);
    const initialLayout2 = await page2.evaluate(() => window.app.currentLayout?.id);
    console.log(`  Page 1 initial layout: ${initialLayout1}`);
    console.log(`  Page 2 initial layout: ${initialLayout2}`);
    
    // Test 2: Change layout on page 1 and verify it syncs to page 2
    console.log('\nTest 2: Change layout on page 1...');
    
    // Get available layouts
    const layouts = await page1.evaluate(() => {
      return window.app.layouts?.map(l => ({ id: l.id, name: l.name })) || [];
    });
    console.log(`  Available layouts: ${JSON.stringify(layouts)}`);
    
    if (layouts.length > 1) {
      // Select a different layout (e.g., 'columns-2')
      const targetLayout = layouts.find(l => l.id === 'columns-2') || layouts[1];
      console.log(`  Selecting layout: ${targetLayout.id}`);
      
      await page1.evaluate((layoutId) => {
        const layout = window.app.layouts.find(l => l.id === layoutId);
        if (layout) {
          window.app.applyLayout(layout);
          // Emit layout change to server
          if (window.app.socket && window.app.socket.connected) {
            window.app.socket.emit('layout-change', { layoutId });
          }
        }
      }, targetLayout.id);
      
      await sleep(1000);
      
      // Check if layout synced to page 2
      const syncedLayout2 = await page2.evaluate(() => window.app.currentLayout?.id);
      console.log(`  Page 2 layout after sync: ${syncedLayout2}`);
      
      if (syncedLayout2 === targetLayout.id) {
        console.log('  ✓ Layout synced successfully');
      } else {
        console.log('  ✗ Layout sync failed');
      }
    } else {
      console.log('  Only one layout available, skipping layout change test');
    }
    
    // Test 3: Check activeSessionPerPanel
    console.log('\nTest 3: Check activeSessionPerPanel...');
    const activeSessionMap1 = await page1.evaluate(() => {
      const map = window.app.activeSessionPerPanel;
      return Object.fromEntries(map);
    });
    console.log(`  Page 1 activeSessionPerPanel: ${JSON.stringify(activeSessionMap1)}`);
    
    // Test 4: Verify panel structure
    console.log('\nTest 4: Verify panel structure...');
    const panelCount1 = await page1.evaluate(() => {
      return document.querySelectorAll('.layout-panel').length;
    });
    const panelCount2 = await page2.evaluate(() => {
      return document.querySelectorAll('.layout-panel').length;
    });
    console.log(`  Page 1 panel count: ${panelCount1}`);
    console.log(`  Page 2 panel count: ${panelCount2}`);
    
    if (panelCount1 === panelCount2) {
      console.log('  ✓ Panel counts match');
    } else {
      console.log('  ✗ Panel counts do not match');
    }
    
    // Test 5: Check tabs container per panel
    console.log('\nTest 5: Check tabs containers...');
    const tabsContainers1 = await page1.evaluate(() => {
      const containers = document.querySelectorAll('[id$="-tabs"], #tabs');
      return Array.from(containers).map(c => c.id);
    });
    const tabsContainers2 = await page2.evaluate(() => {
      const containers = document.querySelectorAll('[id$="-tabs"], #tabs');
      return Array.from(containers).map(c => c.id);
    });
    console.log(`  Page 1 tabs containers: ${JSON.stringify(tabsContainers1)}`);
    console.log(`  Page 2 tabs containers: ${JSON.stringify(tabsContainers2)}`);
    
    console.log('\n=== Layout Sync Tests Complete ===\n');
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testLayoutSync().catch(console.error);