/**
 * Simple browser test to debug Puppeteer issues
 */

const puppeteer = require('puppeteer');

// Dev server runs HTTPS by default (example.config.json: enableHttps=true).
// setup.js sets process.env.SERVER_URL to https://localhost:3000.
const SERVER_URL = process.env.SERVER_URL || 'https://localhost:3000';

describe('Simple Browser Test', () => {
  jest.setTimeout(30000);

  let browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--ignore-certificate-errors'],
      timeout: 10000,
      ignoreHTTPSErrors: true
    });
  }, 15000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  test('should launch browser', async () => {
    const page = await browser.newPage();
    await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
    const title = await page.title();
    expect(title).toContain('SSHIFT');
    await page.close();
  });
});