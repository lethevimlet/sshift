#!/usr/bin/env node
/**
 * Visual + metric repro harness for the "interlacing black lines" bug.
 *
 * The bug: after a tab-grab to another panel (split layout) / taking control
 * of an SSH session, the terminal shows interlaced black bands until the
 * window is resized.  Resizing fixes it, which points at the xterm WebGL
 * renderer's atlas/cell metrics desyncing from the committed cell layout.
 *
 * This script boots nothing — it assumes `npm run dev` is already running on
 * https://localhost:3000 (or SERVER_URL) and an SSH target is reachable
 * (TEST_HOST/TEST_PORT/TEST_USER/TEST_PASS env vars; the docker test fixture
 * or any throwaway sshd works).
 *
 * Run:
 *   npm run dev                       # terminal 1
 *   node src/tests/browser/repro-interlace.js
 *
 * Env:
 *   SERVER_URL  (default https://localhost:3000)
 *   TEST_HOST/TEST_PORT/TEST_USER/TEST_PASS
 *   OUT_DIR     (default ./repro-out)
 *
 * Outputs PNG screenshots + a JSON dump of cell metrics to OUT_DIR so you can
 * see whether the WebGL renderer's cell dimensions match the committed cell
 * layout (the desync = interlace).  Also captures a WebGL-OFF control shot
 * to confirm whether the artifact is WebGL-specific.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE_URL = process.env.SERVER_URL || 'https://localhost:3000';
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'repro-out');
const SSH = {
  host: process.env.TEST_HOST || '127.0.0.1',
  port: parseInt(process.env.TEST_PORT || '2222'),
  user: process.env.TEST_USER || 'sshifttest',
  pass: process.env.TEST_PASS || 'testpass'
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function connectSession(page, n) {
  await page.click('#newSshBtn');
  await sleep(400);
  await page.evaluate(() => { document.getElementById('connPort').value = ''; });
  await page.type('#connHost', SSH.host);
  await page.type('#connPort', String(SSH.port));
  await page.type('#connUsername', SSH.user);
  await page.type('#connPassword', SSH.pass);
  await page.click('#connectBtn');
  await page.waitForFunction(
    (want) => {
      const app = window.app;
      let connected = 0;
      for (const s of (app ? app.sessions.values() : [])) {
        if (s.terminal && s.connected && s.isController) connected++;
      }
      return connected >= want;
    },
    { timeout: 30000 },
    n
  );
}

// Dump the metrics that, when desynced, produce the interlace artifact.
async function dumpMetrics(page, tag) {
  return page.evaluate((tag) => {
    const out = { tag, sessions: [] };
    for (const [id, s] of (window.app ? window.app.sessions.entries() : [])) {
      const t = s.terminal;
      if (!t) continue;
      const core = t._core;
      const dims = core && core._renderService && core._renderService.dimensions;
      const css = dims && dims.css;
      const cell = css && css.cell;
      const container = document.getElementById(`terminal-${id}`);
      const wrapper = document.getElementById(`terminal-wrapper-${id}`);
      const canvas = t.element && t.element.querySelector('canvas');
      let proposed = null;
      try { proposed = s.fitAddon ? s.fitAddon.proposeDimensions() : null; } catch (_) {}
      out.sessions.push({
        id, active: !!(wrapper && wrapper.classList.contains('active')),
        cols: t.cols, rows: t.rows,
        proposedCols: proposed ? proposed.cols : null,
        cellWidth: cell ? cell.width : null,
        cellHeight: cell ? cell.height : null,
        cssWidth: css ? css.device ? null : null : null, // placeholder
        containerW: container ? container.getBoundingClientRect().width : null,
        containerH: container ? container.getBoundingClientRect().height : null,
        canvasW: canvas ? canvas.width : null,
        canvasH: canvas ? canvas.height : null,
        canvasCssW: canvas ? canvas.getBoundingClientRect().width : null,
        webglOn: !!s.webglAddon,
        fontSize: t.options.fontSize,
        fontFamily: t.options.fontFamily
      });
    }
    return out;
  }, tag);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      // Real-ish WebGL via SwiftShader so we can exercise the WebglAddon path.
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-certificate-errors'
    ],
    ignoreHTTPSErrors: true
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('[pageerror]', e.message));

  console.log('[repro] goto', BASE_URL);
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1200);

  console.log('[repro] connecting two SSH sessions...');
  await connectSession(page, 1);
  await sleep(500);
  await connectSession(page, 2);
  await sleep(500);

  const ids = await page.evaluate(() => [...window.app.sessions.keys()]);
  console.log('[repro] sessions:', ids);

  // Switch to a 2-panel split layout so a panel-grab is meaningful.
  await page.evaluate(() => {
    const split = window.app.layouts.find(l => l.id === 'columns-2') ||
                  window.app.layouts.find(l => l.panels && l.panels.length === 2);
    if (split) window.app.applyLayout(split);
  });
  await sleep(700);

  // Move session B to panel-1, activate panel-0's session, then panel-grab
  // back to panel-1 (the reported trigger).
  const [a, b] = ids;
  await page.evaluate(([a, b]) => {
    window.app.moveTabToPanel(b, 'panel-1');
    window.app.switchTab(a, 'panel-0');
  }, [a, b]);
  await sleep(600);

  await page.screenshot({ path: path.join(OUT_DIR, '01-split-before-grab.png') });
  await dumpMetrics(page, 'before-grab').then(m => console.log(JSON.stringify(m, null, 2)));

  // The trigger: tab-grab B from panel-1 by activating it (simulates clicking
  // the tab in the other panel / grabbing focus to that panel).
  await page.evaluate(([b]) => window.app.switchTab(b, 'panel-1'), [b]);
  await sleep(120);
  await page.evaluate(([a]) => window.app.switchTab(a, 'panel-0'), [a]);
  await sleep(120);
  await page.evaluate(([b]) => window.app.switchTab(b, 'panel-1'), [b]);
  await sleep(500);

  await page.screenshot({ path: path.join(OUT_DIR, '02-after-grab-webgl-on.png') });
  const mAfter = await dumpMetrics(page, 'after-grab');
  console.log('[repro] metrics after grab:\n' + JSON.stringify(mAfter, null, 2));

  // Also capture the active terminal canvas alone for a zoomed-in view,
  // which makes horizontal/vertical banding easiest to see.
  const activeId = await page.evaluate(() => window.app.activeSessionId);
  if (activeId) {
    const elHandle = await page.$(`#terminal-${activeId} canvas`);
    if (elHandle) await elHandle.screenshot({ path: path.join(OUT_DIR, '03-active-canvas-webgl.png') });
  }

  // Control shot with the WebGL renderer disabled (forces the DOM/canvas
  // fallback renderer). If the bands disappear here but appear above, the
  // artifact is confirmed WebGL-renderer-specific.
  console.log('[repro] control: disabling WebGL renderer reconnect...');
  await page.evaluate(async () => {
    localStorage.setItem('webglRenderer', 'false');
    // Dispose existing WebGL addons so the fallback renderer takes over.
    for (const s of window.app.sessions.values()) {
      if (s.webglAddon) { try { s.webglAddon.dispose(); } catch (_) {} s.webglAddon = null; }
      if (s.terminal) s.terminal.refresh(0, s.terminal.rows - 1);
    }
    window.app.webglRenderer = false;
  });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT_DIR, '04-after-grab-webgl-off.png') });

  fs.writeFileSync(
    path.join(OUT_DIR, 'metrics.json'),
    JSON.stringify({ afterGrabWebglOn: mAfter }, null, 2)
  );

  console.log('[repro] done. artfacts in', OUT_DIR);
  await browser.close();
})().catch(async (e) => {
  console.error('[repro] FAILED:', e);
  process.exit(1);
});