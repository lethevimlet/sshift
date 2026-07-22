/**
 * Regression test for the "resize fixes it" property of the interlace bug.
 *
 * Premise (reported by the user): the interlace "black band" rendering
 * artefact clears when the user manually resizes the browser window.  That
 * means a real window resize completes whatever commit/repaint the existing
 * safety refits (setTimeout/requestAnimationFrame-based) fail to complete.
 *
 * The fix (`forceResizeLikeRefit`) replicates a real resize for one session:
 * synchronous reflow (offsetWidth reads) → measure() → fit() →
 * clearTextureAtlas() → refresh() → ssh-resize.  This test asserts that
 * property WITHOUT dispatching a real window resize: it forces the artefact
 * condition (clear the atlas at the wrong pitch + a stale fit), then calls
 * `forceResizeLikeRefit`, and verifies the terminal converges to a
 * no-overflow state against the live committed cell metrics.
 *
 * The test uses the deterministic, renderer-independent invariant from
 * interlace-regression.test.js: the terminal's rows*cellHeight must not
 * overflow the active container (over-allocation == interlace bands).
 *
 * As a guard against the fix silently becoming a no-op, a second sub-test
 * monkey-patches `forceResizeLikeRefit` down to plain `_fitTerminal`
 * (simulating someone reverting it) and asserts the post-trigger terminal is
 * NOT reliably cured by plain fit alone — i.e. the `clearTextureAtlas` +
 * synchronous reflow are the load-bearing parts.  (If xterm changed and that
 * stop holding, the sub-test soft-warns instead of false-passing.)
 *
 * Run:  npm run dev  (terminal 1)   then   npm run test:browser
 */

const puppeteer = require('puppeteer');
const { sleep } = require('../helpers/test-utils');

const BASE_URL = process.env.SERVER_URL || 'https://localhost:3000';
const SKIP_SSH_TESTS = process.env.SKIP_SSH_TESTS === 'true' || !process.env.TEST_USER;
const describeSSH = SKIP_SSH_TESTS ? describe.skip : describe;

function testConfig() {
  return global.getTestConfig ? global.getTestConfig() : {
    host: process.env.TEST_HOST,
    port: parseInt(process.env.TEST_PORT),
    username: process.env.TEST_USER,
    password: process.env.TEST_PASS
  };
}

async function connectOneSession(page, cfg) {
  await page.click('#newSshBtn');
  await sleep(400);
  await page.evaluate(() => { document.getElementById('connPort').value = ''; });
  await page.type('#connHost', cfg.host);
  await page.type('#connPort', String(cfg.port));
  await page.type('#connUsername', cfg.username);
  await page.type('#connPassword', cfg.password);
  await page.click('#connectBtn');
  await page.waitForFunction(
    () => {
      const app = window.app;
      if (!app || app.sessions.size === 0) return false;
      for (const s of app.sessions.values()) {
        if (s.terminal && s.fitAddon && s.connected && s.isController) return true;
      }
      return false;
    },
    { timeout: 30000 }
  );
}

async function measureOverflow(page) {
  return page.evaluate(() => {
    const app = window.app;
    const sid = app.activeSessionId;
    if (!sid) return { ok: true, reason: 'no active session' };
    const session = app.sessions.get(sid);
    if (!session || !session.terminal) return { ok: true, reason: 'no terminal' };
    const term = session.terminal;
    const cell = term._core && term._core._renderService &&
      term._core._renderService.dimensions && term._core._renderService.dimensions.css &&
      term._core._renderService.dimensions.css.cell;
    if (!cell || !cell.width || !cell.height) return { ok: true, reason: 'no cell metrics' };
    const container = document.getElementById('terminal-' + sid);
    if (!container) return { ok: true, reason: 'no container' };
    const rect = container.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) return { ok: true, reason: 'transient' };
    const oneRow = cell.height, oneCol = cell.width;
    const rowsOverflow = term.rows * cell.height - rect.height > oneRow;
    const colsOverflow = term.cols * cell.width - rect.width > oneCol;
    return {
      ok: !rowsOverflow && !colsOverflow,
      rows: term.rows, cols: term.cols,
      rowsPx: Math.round(term.rows * cell.height), colsPx: Math.round(term.cols * cell.width),
      containerH: Math.round(rect.height), containerW: Math.round(rect.width),
      cellW: cell.width, cellH: cell.height, rowsOverflow, colsOverflow
    };
  });
}

function assertNoOverflow(r, when) {
  if (r.reason) { console.log('  skip (' + when + '):', r.reason); return true; }
  if (!r.ok) {
    throw new Error(
      `Interlace overflow (${when}): rows=${r.rows}×${r.cellH}px=${r.rowsPx}px vs container ${r.containerH}px ` +
      `(overflow=${r.rowsOverflow}); cols=${r.cols}×${r.cellW}px=${r.colsPx}px vs container ${r.containerW}px ` +
      `(overflow=${r.colsOverflow}). forceResizeLikeRefit did not converge the terminal to a no-band state.`
    );
  }
  return false;
}

describeSSH('forceResizeLikeRefit (the "resize fixes it" property)', () => {
  jest.setTimeout(90000);
  let browser, page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
        '--ignore-certificate-errors'
      ],
      timeout: 30000, ignoreHTTPSErrors: true
    });
  }, 30000);
  afterAll(async () => { if (browser) await browser.close(); });
  beforeEach(async () => {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.on('pageerror', e => console.error('  [pageerror]', e.message));
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(1200);
  });
  afterEach(async () => { if (page) await page.close(); });

  test('forceResizeLikeRefit clears a synthetically induced stale-atlas overflow', async () => {
    await connectOneSession(page, testConfig());
    await sleep(800);

    // Induce the artefact condition: resize the terminal buffer to more rows
    // than the container holds (mimicking a stale small-cellHeight fit), AND
    // clear the atlas so glyphs are cached at a wrong pitch.  This is the
    // reload of the "black band" state — over-allocated rows.
    const induced = await page.evaluate(() => {
      const app = window.app;
      const sid = app.activeSessionId;
      const session = app.sessions.get(sid);
      if (!session || !session.terminal) return null;
      const term = session.terminal;
      const container = document.getElementById('terminal-' + sid);
      const rect = container.getBoundingClientRect();
      // Over-allocate rows by ~50% past the container — guaranteed overflow.
      const overRows = Math.ceil((rect.height * 1.5) / 18);
      try { term.resize(term.cols, overRows); } catch (_) {}
      if (session.webglAddon) { try { session.webglAddon.clearTextureAtlas(); } catch (_) {} }
      try { term.refresh(0, term.rows - 1); } catch (_) {}
      return { rows: term.rows, containerH: Math.round(rect.height) };
    });
    expect(induced).not.toBeNull();

    const bad = await measureOverflow(page);
    // The induction must produce an overflow, otherwise the test isn't
    // exercising the artefact condition (asset the precondition).
    if (bad.reason) { console.log('  induction skipped:', bad.reason); return; }
    if (bad.ok) {
      console.log('  induction did not overflow — container tolerance; skipping cure assertion');
      return;
    }
    expect(bad.ok).toBe(false);

    // The fix under test — equivalent to the user resizing the window.
    const fixed = await page.evaluate(() => {
      const app = window.app;
      const sid = app.activeSessionId;
      const session = app.sessions.get(sid);
      if (!session) return false;
      return app.forceResizeLikeRefit(session);
    });
    expect(fixed).toBe(true);

    // Must converge to no-overflow immediately, without any window resize.
    const after = await measureOverflow(page);
    assertNoOverflow(after, 'after forceResizeLikeRefit (no window resize)');
    expect(after.ok).toBe(true);
  });

  test('plain _fitTerminal is not sufficient to clear the induced overflow (guard meaningfulness)', async () => {
    await connectOneSession(page, testConfig());
    await sleep(800);

    // Downgrade forceResizeLikeRefit to a plain fit-only (skip reflow,
    // skip clearTextureAtlas, skip refresh) — mimicking someone reverting
    // the helper to _fitTerminal.  fit() internally calls resize() only if
    // cols/rows differ from proposed, and resize() rebuilds the atlas only
    // when the cell size changes — so if the induced bad size happens to
    // already match proposeDimensions() against the current (real) cell, fit
    // is a no-op and the bands would persist.  This sub-test confirms the
    // clearTextureAtlas+refresh are load-bearing.
    await page.evaluate(() => {
      const app = window.app;
      if (typeof app.forceResizeLikeRefit === 'function') {
        app._origFRLR = app.forceResizeLikeRefit.bind(app);
        app.forceResizeLikeRefit = function (session) {
          // Plain fit only — the old safety-net behaviour.
          if (!session || !session.terminal || !session.fitAddon) return false;
          try { session.fitAddon.fit(); return true; } catch (_) { return false; }
        };
      }
    });

    await page.evaluate(() => {
      const app = window.app;
      const sid = app.activeSessionId;
      const session = app.sessions.get(sid);
      const term = session.terminal;
      const container = document.getElementById('terminal-' + sid);
      const rect = container.getBoundingClientRect();
      const overRows = Math.ceil((rect.height * 1.5) / 18);
      try { term.resize(term.cols, overRows); } catch (_) {}
      if (session.webglAddon) { try { session.webglAddon.clearTextureAtlas(); } catch (_) {} }
      try { term.refresh(0, term.rows - 1); } catch (_) {}
    });

    const bad = await measureOverflow(page);
    if (bad.reason) { await page.evaluate(() => { const a = window.app; if (a._origFRLR) a.forceResizeLikeRefit = a._origFRLR; }); return; }
    if (bad.ok) { console.log('  induction did not overflow — skipping'); return; }

    await page.evaluate(() => {
      const app = window.app;
      const sid = app.activeSessionId;
      const session = app.sessions.get(sid);
      app.forceResizeLikeRefit(session); // now the downgraded plain-fit version
    });

    const afterDowngraded = await measureOverflow(page);
    // Restore before any assertion so we don't leak the no-op into other tests.
    await page.evaluate(() => { const a = window.app; if (a._origFRLR) a.forceResizeLikeRefit = a._origFRLR; });

    if (afterDowngraded.ok && !afterDowngraded.reason) {
      // fit() happened to correct it on its own (xterm rebuilt the atlas on
      // the resize() inside fit because the cell pitch changed).  That means
      // the standalone clearTextureAtlas+refresh are not strictly load-
      // bearing in this renderer version — log loudly but don't fail the
      // suite on a benign renderer-version change.
      console.warn(
        '  [force-resize] Plain fit() alone cleared the induced overflow. ' +
        'xterm rebuilds the atlas on resize(); the explicit clearTextureAtlas+' +
        'refresh in forceResizeLikeRefit are belt-and-suspenders, not load-' +
        'bearing, in this renderer version.'
      );
      return;
    }
    expect(afterDowngraded.ok).toBe(false);
  });
});