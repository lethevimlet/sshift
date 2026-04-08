/**
 * Simple browser test to debug Puppeteer issues
 */

const puppeteer = require('puppeteer');

describe('Simple Browser Test', () => {
  jest.setTimeout(30000);
  
  let browser;
  
  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      timeout: 10000
    });
  }, 15000);
  
  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });
  
  test('should launch browser', async () => {
    const page = await browser.newPage();
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 10000 });
    const title = await page.title();
    expect(title).toContain('SSHIFT');
    await page.close();
  });
});