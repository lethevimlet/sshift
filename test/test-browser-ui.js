const puppeteer = require('puppeteer');
const { getTestConfig } = require('./test-helper');

// Test configuration - loaded from .env files
const testConfig = getTestConfig();

async function testWebUI() {
  console.log('Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Collect console messages
  const consoleMessages = [];
  const errors = [];
  
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleMessages.push(text);
    console.log('Console:', text);
  });
  
  page.on('pageerror', error => {
    errors.push(error.message);
    console.error('Page Error:', error.message);
  });
  
  page.on('error', error => {
    console.error('Page Error:', error);
  });
  
  // Collect network errors
  page.on('requestfailed', request => {
    console.error('Request failed:', request.url(), request.failure().errorText);
  });
  
  try {
    console.log('\n=== Loading page http://localhost:3000 ===\n');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 10000 });
    
    // Wait a bit for JS to execute
    await page.waitForTimeout(2000);
    
    // Check if app loaded
    const appExists = await page.evaluate(() => {
      return typeof window.app !== 'undefined';
    });
    console.log('\nApp initialized:', appExists);
    
    // Check socket connection
    const socketConnected = await page.evaluate(() => {
      if (window.app && window.app.socket) {
        return window.app.socket.connected;
      }
      return false;
    });
    console.log('Socket connected:', socketConnected);
    
    // Check for xterm loaded
    const xtermLoaded = await page.evaluate(() => {
      return typeof Terminal !== 'undefined';
    });
    console.log('xterm.js loaded:', xtermLoaded);
    
    // Try to open connection modal
    console.log('\n=== Opening SSH connection modal ===\n');
    await page.click('#newSshBtn');
    await page.waitForTimeout(500);
    
    // Fill in connection form
    console.log('Filling connection form...');
    await page.type('#connHost', testConfig.host);
    await page.type('#connUsername', testConfig.username);
    await page.type('#connPassword', testConfig.password);
    
    // Click connect
    console.log('Clicking connect button...');
    await page.click('#connectBtn');
    
    // Wait for connection attempt
    await page.waitForTimeout(5000);
    
    // Check for terminal
    const terminalExists = await page.evaluate(() => {
      const terminals = document.querySelectorAll('.terminal-wrapper');
      return terminals.length;
    });
    console.log('Terminal wrappers found:', terminalExists);
    
    // Check sessions
    const sessions = await page.evaluate(() => {
      if (window.app && window.app.sessions) {
        return Array.from(window.app.sessions.entries()).map(([id, s]) => ({
          id,
          name: s.name,
          type: s.type,
          connected: s.connected,
          connecting: s.connecting
        }));
      }
      return [];
    });
    console.log('Sessions:', JSON.stringify(sessions, null, 2));
    
    // Take screenshot
    await page.screenshot({ path: '/home/code/projects/project/shhift/test/screenshot.png', fullPage: true });
    console.log('\nScreenshot saved to test/screenshot.png');
    
    // Get page content
    const html = await page.content();
    console.log('\n=== Page HTML (first 2000 chars) ===\n');
    console.log(html.substring(0, 2000));
    
  } catch (error) {
    console.error('Test error:', error);
  }
  
  console.log('\n=== Summary ===');
  console.log('Console messages:', consoleMessages.length);
  console.log('Page errors:', errors.length);
  
  if (errors.length > 0) {
    console.log('\n=== Page Errors ===');
    errors.forEach(e => console.log('  -', e));
  }
  
  await browser.close();
}

testWebUI().catch(console.error);