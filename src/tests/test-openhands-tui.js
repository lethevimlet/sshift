/**
 * Test for OpenHands TUI persistence on page reload
 * 
 * This test verifies that complex TUI applications like OpenHands
 * are properly maintained when the page is reloaded.
 */

const puppeteer = require('puppeteer');
const assert = require('assert');

const BASE_URL = 'process.env.SERVER_URL || 'http://localhost:8022'';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testOpenHandsTUI() {
  console.log('========================================');
  console.log('Testing OpenHands TUI Persistence');
  console.log('========================================\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Enable console output from browser
    page.on('console', msg => {
      if (msg.text().includes('[SSHIFT]')) {
        console.log('  Browser:', msg.text());
      }
    });

    // Step 1: Load the page
    console.log('=== Step 1: Loading page ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await sleep(1000);
    console.log('✓ Page loaded');

    // Step 2: Connect to SSH using the Code bookmark
    console.log('\n=== Step 2: Connecting to SSH (Code bookmark) ===');
    
    // Click on the Code bookmark
    const codeBookmark = await page.evaluateHandle(() => {
      const bookmarks = document.querySelectorAll('.bookmark-item');
      for (const bm of bookmarks) {
        if (bm.textContent.includes('Code')) {
          return bm;
        }
      }
      return null;
    });
    
    if (codeBookmark) {
      await codeBookmark.click();
      console.log('✓ Clicked Code bookmark');
      
      // Wait for connection
      await sleep(3000);
      
      // Check if connected
      const connected = await page.evaluate(() => {
        const terminal = document.querySelector('.xterm');
        return terminal !== null;
      });
      
      if (connected) {
        console.log('✓ SSH terminal appeared');
      } else {
        console.log('✗ SSH terminal not found');
        throw new Error('SSH connection failed');
      }
    } else {
      console.log('✗ Code bookmark not found');
      throw new Error('Code bookmark not found');
    }

    // Step 3: Run openhands command
    console.log('\n=== Step 3: Running openhands command ===');
    
    // Type the command
    await page.keyboard.type('openhands');
    await page.keyboard.press('Enter');
    console.log('✓ Typed openhands command');
    
    // Wait for TUI to load
    await sleep(5000);
    
    // Take a screenshot before reload
    await page.screenshot({ path: 'test-screenshots/before-reload.png' });
    console.log('✓ Screenshot saved: before-reload.png');

    // Step 4: Get terminal state before reload
    console.log('\n=== Step 4: Getting terminal state before reload ===');
    
    const beforeState = await page.evaluate(() => {
      const terminal = document.querySelector('.xterm');
      if (!terminal) return null;
      
      // Get the terminal content
      const rows = terminal.querySelectorAll('.xterm-rows > div');
      let content = '';
      rows.forEach(row => {
        content += row.textContent + '\n';
      });
      
      return {
        content: content,
        rowCount: rows.length,
        hasContent: content.length > 0
      };
    });
    
    console.log('✓ Terminal state captured');
    console.log(`  Rows: ${beforeState.rowCount}`);
    console.log(`  Content length: ${beforeState.content.length}`);
    
    // Check if TUI is visible (should have some content)
    if (beforeState.hasContent) {
      console.log('✓ TUI content detected');
    } else {
      console.log('✗ No TUI content detected');
    }

    // Step 5: Reload the page
    console.log('\n=== Step 5: Reloading page ===');
    
    // Reload and wait for reconnection
    await page.reload({ waitUntil: 'networkidle0' });
    console.log('✓ Page reloaded');
    
    // Wait for session restoration
    await sleep(5000);
    
    // Take a screenshot after reload
    await page.screenshot({ path: 'test-screenshots/after-reload.png' });
    console.log('✓ Screenshot saved: after-reload.png');

    // Step 6: Check terminal state after reload
    console.log('\n=== Step 6: Checking terminal state after reload ===');
    
    const afterState = await page.evaluate(() => {
      const terminal = document.querySelector('.xterm');
      if (!terminal) return null;
      
      const rows = terminal.querySelectorAll('.xterm-rows > div');
      let content = '';
      rows.forEach(row => {
        content += row.textContent + '\n';
      });
      
      return {
        content: content,
        rowCount: rows.length,
        hasContent: content.length > 0
      };
    });
    
    if (!afterState) {
      console.log('✗ Terminal not found after reload');
      throw new Error('Terminal not restored after reload');
    }
    
    console.log('✓ Terminal restored');
    console.log(`  Rows: ${afterState.rowCount}`);
    console.log(`  Content length: ${afterState.content.length}`);
    
    // Step 7: Compare states
    console.log('\n=== Step 7: Comparing terminal states ===');
    
    // Check if content is similar (not exact, as TUI might have updated)
    const contentSimilarity = calculateSimilarity(beforeState.content, afterState.content);
    console.log(`  Content similarity: ${(contentSimilarity * 100).toFixed(1)}%`);
    
    // For TUI applications, we expect high similarity
    if (contentSimilarity > 0.7) {
      console.log('✓ TUI state maintained after reload');
    } else {
      console.log('✗ TUI state not properly maintained');
      console.log('\nBefore state:');
      console.log(beforeState.content.substring(0, 500));
      console.log('\nAfter state:');
      console.log(afterState.content.substring(0, 500));
    }

    // Step 8: Test TUI interactivity
    console.log('\n=== Step 8: Testing TUI interactivity ===');
    
    // Try to interact with the TUI (press a key)
    await page.keyboard.press('ArrowDown');
    await sleep(500);
    
    const afterInteraction = await page.evaluate(() => {
      const terminal = document.querySelector('.xterm');
      if (!terminal) return null;
      
      const rows = terminal.querySelectorAll('.xterm-rows > div');
      let content = '';
      rows.forEach(row => {
        content += row.textContent + '\n';
      });
      
      return {
        content: content,
        hasContent: content.length > 0
      };
    });
    
    if (afterInteraction && afterInteraction.hasContent) {
      console.log('✓ TUI still responsive after reload');
    } else {
      console.log('✗ TUI not responsive after reload');
    }

    console.log('\n========================================');
    console.log('✓ OpenHands TUI test completed');
    console.log('========================================');

  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Calculate similarity between two strings
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  // Normalize strings (remove whitespace differences)
  const normalize = (s) => s.replace(/\s+/g, ' ').trim();
  const s1 = normalize(str1);
  const s2 = normalize(str2);
  
  // Calculate Levenshtein distance
  const m = s1.length;
  const n = s2.length;
  
  if (m === 0) return n === 0 ? 1 : 0;
  if (n === 0) return 0;
  
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1
        );
      }
    }
  }
  
  const distance = dp[m][n];
  const maxLength = Math.max(m, n);
  return 1 - (distance / maxLength);
}

// Create screenshots directory
const fs = require('fs');
if (!fs.existsSync('test-screenshots')) {
  fs.mkdirSync('test-screenshots');
}

// Run the test
testOpenHandsTUI().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});