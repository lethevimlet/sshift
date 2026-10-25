/** Isolated fixture: never connects to or modifies the running sshift server. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer');

describe('bookmark editor navigation regression', () => {
  let browser;
  let server;
  let io;
  let url;
  let config;
  const webapp = path.join(__dirname, '../../webapp');

  beforeAll(async () => {
    config = { bookmarks: [{ id: 'url-1', name: 'Link', type: 'url', url: 'https://old.example' }] };
    jest.doMock('../../server/utils/config', () => ({
      loadConfig: () => config,
      saveConfig: () => true,
      isPasswordSet: () => false
    }));
    const app = express();
    app.use(express.json());
    app.get('/', (req, res) => res.send(fs.readFileSync(path.join(webapp, 'index.html'), 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')));
    app.use(express.static(webapp));
    server = http.createServer(app);
    io = new Server(server);
    const { registerBookmarkHandlers } = require('../../server/endpoints/ws/bookmarks');
    io.on('connection', socket => registerBookmarkHandlers(socket, io));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (io) await new Promise(resolve => io.close(resolve));
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    jest.dontMock('../../server/utils/config');
  });

  test.each(['click', 'Enter'])('%s saves a URL without HTTPS fetch, page navigation or certificate dialog', async action => {
    const page = await browser.newPage();
    try {
      await page.setRequestInterception(true);
      page.on('request', request => request.url().startsWith(url + '/') ? request.continue() : request.abort());
      await page.goto(url);
      await page.addScriptTag({ url: `${url}/socket.io/socket.io.js` });
      await page.addScriptTag({ path: path.join(webapp, 'js/app.js') });
      await page.evaluate(() => {
        SSHIFTClient.prototype.init = () => {};
        const client = window.app = new SSHIFTClient();
        document.getElementById('lockScreen').style.display = 'none';
        for (const method of ['initSettingsModalHandlers', 'initPasswordToggle', 'initDebugInfoDialog',
          'initSessionsModalHandlers', 'setupMobileOverflowMenu', 'setupMobileTabsDropdown',
          'initLayoutSelector', 'updateTerminalColorOverrideUI', 'updateTabActionButtons']) {
          client[method] = () => {};
        }
        client.getAllPanels = () => [];
        client.setupEventListeners();
        client.bookmarks = [{ id: 'url-1', name: 'Link', type: 'url', url: 'https://old.example' }];
        client.openBookmarkModal(client.bookmarks[0]);
        // Reproduce failed HTTPS API requests while the existing socket works.
        window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
        window._swStatus = 'failed';
        window._swError = 'SSL certificate error';
      });
      await page.waitForFunction(() => window.app.socket.connected);
      let navigations = 0;
      page.on('framenavigated', () => { navigations++; });
      await page.$eval('#bookmarkUrl', (input, action) => { input.value = `https://${action.toLowerCase()}.example`; }, action);
      if (action === 'click') await page.click('#saveBookmarkBtn');
      else {
        await page.focus('#bookmarkUrl');
        await page.keyboard.press('Enter');
      }
      await page.waitForFunction(() => !document.getElementById('bookmarkModal').classList.contains('active'));
      expect(config.bookmarks[0].url).toBe(`https://${action.toLowerCase()}.example`);
      expect(navigations).toBe(0);
      expect(await page.$eval('#securityInfoModal', modal => modal.classList.contains('active'))).toBe(false);
      expect(await page.evaluate(() => window.app.bookmarks[0].url)).toBe(config.bookmarks[0].url);
    } finally {
      await page.close();
    }
  });
});
