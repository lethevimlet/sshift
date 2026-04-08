/**
 * Browser test setup - checks if Puppeteer can run
 */

let browserAvailable = false;

async function checkBrowserAvailable() {
  try {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      timeout: 5000
    });
    await browser.close();
    browserAvailable = true;
    return true;
  } catch (error) {
    console.warn('Puppeteer browser not available, skipping browser tests:', error.message);
    browserAvailable = false;
    return false;
  }
}

module.exports = {
  checkBrowserAvailable,
  isBrowserAvailable: () => browserAvailable
};