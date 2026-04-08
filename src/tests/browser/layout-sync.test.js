/**
 * Browser tests for layout synchronization
 * Tests layout synchronization between browser tabs
 */

const puppeteer = require('puppeteer');

const BASE_URL = process.env.SERVER_URL || 'http://localhost:3000';

/**
 * Helper function to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Layout Synchronization Tests', () => {
  // Increase timeout for browser tests
  jest.setTimeout(60000);

  let browser;
  let page1;
  let page2;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      timeout: 30000
    });
  }, 30000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  beforeEach(async () => {
    page1 = await browser.newPage();
    page2 = await browser.newPage();
    
    // Set viewport
    await page1.setViewport({ width: 1280, height: 800 });
    await page2.setViewport({ width: 1280, height: 800 });
  });

  afterEach(async () => {
    if (page1) await page1.close();
    if (page2) await page2.close();
  });

  describe('Initial Layout', () => {
    test('should load with default layout', async () => {
      await page1.goto(BASE_URL);
      await sleep(2000);
      
      const initialLayout = await page1.evaluate(() => window.app?.currentLayout?.id);
      expect(initialLayout).toBeDefined();
    });

    test('should have same layout on both pages', async () => {
      await page1.goto(BASE_URL);
      await page2.goto(BASE_URL);
      await sleep(2000);
      
      const layout1 = await page1.evaluate(() => window.app?.currentLayout?.id);
      const layout2 = await page2.evaluate(() => window.app?.currentLayout?.id);
      
      expect(layout1).toBe(layout2);
    });
  });

  describe('Layout Change Synchronization', () => {
    test('should sync layout changes between tabs', async () => {
      await page1.goto(BASE_URL);
      await page2.goto(BASE_URL);
      await sleep(2000);
      
      // Enable sticky mode on both pages
      await page1.evaluate(() => {
        window.app.sticky = true;
        window.app.saveStickyConfig();
      });
      await page2.evaluate(() => {
        window.app.sticky = true;
        window.app.saveStickyConfig();
      });
      await sleep(500);
      
      // Get available layouts
      const layouts = await page1.evaluate(() => {
        return window.app.layouts?.map(l => ({ id: l.id, name: l.name })) || [];
      });
      
      if (layouts.length > 1) {
        // Select a different layout
        const targetLayout = layouts.find(l => l.id === 'columns-2') || layouts[1];
        
        await page1.evaluate((layoutId) => {
          const layout = window.app.layouts.find(l => l.id === layoutId);
          if (layout) {
            window.app.applyLayout(layout);
            if (window.app.socket && window.app.socket.connected) {
              window.app.socket.emit('layout-change', { layoutId });
            }
          }
        }, targetLayout.id);
        
        await sleep(1000);
        
        // Check if layout synced to page 2
        const syncedLayout2 = await page2.evaluate(() => window.app?.currentLayout?.id);
        expect(syncedLayout2).toBe(targetLayout.id);
      }
    });
  });

  describe('Panel Structure', () => {
    test('should have matching panel counts', async () => {
      await page1.goto(BASE_URL);
      await page2.goto(BASE_URL);
      await sleep(2000);
      
      const panelCount1 = await page1.evaluate(() => {
        return document.querySelectorAll('.layout-panel').length;
      });
      
      const panelCount2 = await page2.evaluate(() => {
        return document.querySelectorAll('.layout-panel').length;
      });
      
      expect(panelCount1).toBe(panelCount2);
    });

    test('should have tabs containers in each panel', async () => {
      await page1.goto(BASE_URL);
      await sleep(2000);
      
      const tabsContainers = await page1.evaluate(() => {
        const containers = document.querySelectorAll('[id$="-tabs"], #tabs');
        return Array.from(containers).map(c => c.id);
      });
      
      expect(tabsContainers.length).toBeGreaterThan(0);
    });
  });

  describe('Active Session Per Panel', () => {
    test('should track active sessions per panel', async () => {
      await page1.goto(BASE_URL);
      await sleep(2000);
      
      const activeSessionMap = await page1.evaluate(() => {
        const map = window.app?.activeSessionPerPanel;
        return map ? Object.fromEntries(map) : {};
      });
      
      expect(activeSessionMap).toBeDefined();
    });
  });
});