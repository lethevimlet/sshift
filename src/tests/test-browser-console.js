/**
 * Browser test to check console errors
 */

const puppeteer = require('puppeteer');
const { getTestConfig } = require('./test-helper');

// Test configuration - loaded from .env files
const testConfig = getTestConfig();

async function testBrowser() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Collect console messages
  const consoleMessages = [];
  const errors = [];
  
  page.on('console', msg => {
    consoleMessages.push({
      type: msg.type(),
      text: msg.text()
    });
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    }
  });
  
  page.on('pageerror', error => {
    errors.push(error.toString());
    console.log('PAGE ERROR:', error.toString());
  });
  
  try {
    console.log('Navigating to process.env.SERVER_URL || 'http://localhost:8022'...');
    await page.goto('process.env.SERVER_URL || 'http://localhost:8022'', { waitUntil: 'networkidle2', timeout: 10000 });
    
    console.log('Page loaded, waiting for initialization...');
    await page.waitForTimeout(2000);
    
    // Check if xterm is loaded
    const xtermLoaded = await page.evaluate(() => {
      return {
        hasTerminal: typeof window.Terminal !== 'undefined',
        hasFitAddon: typeof window.FitAddon !== 'undefined',
        hasWebLinks: typeof window.WebLinksAddon !== 'undefined',
        hasSearch: typeof window.SearchAddon !== 'undefined',
        terminalType: typeof window.Terminal,
        fitAddonType: typeof window.FitAddon
      };
    });
    
    console.log('xterm.js libraries loaded:', xtermLoaded);
    
    // Try to create a test connection
    console.log('Attempting SSH connection...');
    await page.evaluate(() => {
      // Fill in connection form
      const hostInput = document.querySelector('input[name="host"]');
      const portInput = document.querySelector('input[name="port"]');
      const userInput = document.querySelector('input[name="username"]');
      const passInput = document.querySelector('input[name="password"]');
      const connectBtn = document.querySelector('button[type="submit"]');
      
      if (hostInput) hostInput.value = testConfig.host;
      if (portInput) portInput.value = testConfig.port;
      if (userInput) userInput.value = testConfig.username;
      if (passInput) passInput.value = testConfig.password;
      
      if (connectBtn) {
        console.log('Clicking connect button...');
        connectBtn.click();
      }
    });
    
    // Wait for connection
    await page.waitForTimeout(3000);
    
    // Check terminal state
    const terminalState = await page.evaluate(() => {
      const terminalWrappers = document.querySelectorAll('.terminal-wrapper');
      const terminals = document.querySelectorAll('.xterm');
      const activeTerminal = document.querySelector('.terminal-wrapper.active');
      
      return {
        wrapperCount: terminalWrappers.length,
        xtermCount: terminals.length,
        hasActiveTerminal: !!activeTerminal,
        activeTerminalId: activeTerminal ? activeTerminal.id : null,
        activeTerminalDisplay: activeTerminal ? getComputedStyle(activeTerminal).display : null,
        activeTerminalHeight: activeTerminal ? activeTerminal.offsetHeight : null,
        activeTerminalWidth: activeTerminal ? activeTerminal.offsetWidth : null
      };
    });
    
    console.log('Terminal state:', terminalState);
    
    // Get all console errors
    console.log('\n=== Console Messages ===');
    consoleMessages.forEach(msg => {
      if (msg.type === 'error' || msg.type === 'warning') {
        console.log(`${msg.type.toUpperCase()}: ${msg.text}`);
      }
    });
    
    if (errors.length > 0) {
      console.log('\n=== Page Errors ===');
      errors.forEach(err => console.log(err));
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testBrowser().catch(console.error);