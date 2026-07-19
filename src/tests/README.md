# SSHIFT Test Suite

This directory contains all tests for the SSHIFT project, using the Jest framework.

## Test Structure

```
src/tests/
├── global-setup.js           # Boots Docker SSH fixture before any tests run
├── global-teardown.js        # Tears down the Docker SSH fixture after tests
├── setup.js                  # Per-file setup (env vars, console spies)
├── helpers/
│   └── test-utils.js         # Socket.IO client + waitForEvent helpers
├── unit/                     # Pure-logic tests (no server, no SSH)
│   ├── alternate-buffer.test.js     # xterm.js headless buffer / serialization
│   ├── clipboard-streaming.test.js  # sendChunkedInput chunking
│   ├── flush-chunks.test.js         # surrogate-pair + OSC 52 cross-chunk
│   ├── save-tabs-dedup.test.js      # saveTabs debounce + signature dedup
│   ├── server-robustness.test.js    # ssh-data/ssh-resize/ssh-request-sync validation
│   ├── sticky-session.test.js
│   ├── tabs-handling.test.js        # handleTabOpened dedupe, idempotent createSSHTab
│   ├── tabs-teardown.test.js        # Phase 7 sticky-close viewer-aware teardown
│   └── terminal-worker.test.js     # Worker protocol (init/ping/data/...)
├── integration/              # Tests that hit the live dev server
│   ├── client.test.js
│   ├── server.test.js
│   ├── frontend.test.js
│   ├── sticky-keepalive.test.js
│   ├── grace-period.test.js
│   └── bookmark-sync.test.js
└── browser/                  # Puppeteer E2E tests
    ├── ui.test.js
    ├── settings-modal.test.js
    ├── console.test.js
    ├── layout-sync.test.js
    ├── mobile-terminal.test.js
    └── simple.test.js
```

## Running Tests

### Full suite (unit + integration + browser)

```bash
npm run dev              # terminal 1 — boot the dev server on HTTPS :3000
npm test                 # terminal 2 — runs all tests
```

The full suite needs the dev server up — integration and browser tests
hit `https://localhost:3000` (the server uses HTTPS with HTTP→HTTPS
redirect per `example.config.json`, so plain HTTP gets a 301 body).

### Sub-suites

```bash
npm run test:unit        # no server required
npm run test:integration
npm run test:browser
npm run test:coverage
```

## Test SSH fixture (auto)

The 18 SSH-credential-gated tests (in `src/tests/integration/client.test.js`,
`grace-period.test.js`, `src/tests/browser/ui.test.js`, `console.test.js`)
require an actual SSH server to log into. Jest's `globalSetup`
(`src/tests/global-setup.js`) handles this for you:

1. If `TEST_USER` and `TEST_PASS` env vars are already set
   (you supplied an external SSH target), use those.
2. Otherwise, boot `docker/test-ssh/docker-compose.yml` and export
   `TEST_USER=testuser`, `TEST_PASS=testpass`, `TEST_HOST=127.0.0.1`,
   `TEST_PORT=2222` for the test files.
3. If Docker isn't available, set `SKIP_SSH_TESTS=true` and log a
   clear warning. The credential-gated tests auto-downgrade to
   `describe.skip`.

### Manual fixture control

```bash
# Boot + tear down by hand (the same thing globalSetup does automatically)
docker compose -f docker/test-ssh/docker-compose.yml up -d --build
TEST_USER=testuser TEST_PASS=testpass TEST_HOST=127.0.0.1 TEST_PORT=2222 npm test
docker compose -f docker/test-ssh/docker-compose.yml down -v
```

### Opting out entirely

```bash
SKIP_SSH_TESTS=true npm test           # skips the credential-gated tests
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SERVER_URL` | `https://localhost:3000` | Dev server URL (auto-set by `setup.js`) |
| `TEST_HOST` | `127.0.0.1` (when fixture is up) | SSH target host |
| `TEST_PORT` | `2222` (when fixture is up) | SSH target port |
| `TEST_USER` | `testuser` (when fixture is up) | SSH login user |
| `TEST_PASS` | `testpass` (when fixture is up) | SSH login password |
| `SKIP_SSH_TESTS` | unset | `true` disables all SSH-credential tests |
| `JEST_INTEGRATION` | unset | `true` bumps per-test timeout to 60s |

**Note:** Integration and browser tests use the HTTPS endpoint and
disable certificate verification (`rejectUnauthorized: false`,
`ignoreHTTPSErrors: true`, `--ignore-certificate-errors`) so the dev
server's self-signed cert doesn't trip them up.

## Test Configuration

Jest config lives in `jest.config.js`. Key bits:

```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/tests/**/*.test.js'],
  globalSetup: '<rootDir>/src/tests/global-setup.js',
  globalTeardown: '<rootDir>/src/tests/global-teardown.js',
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.js'],
  testTimeout: 30000,
  // ...
};
```

`globalSetup` runs **before** any test file is imported. This matters
because the gated test files do:

```javascript
const SKIP_SSH_TESTS = process.env.SKIP_SSH_TESTS === 'true' || !process.env.TEST_USER;
const describeSSH = SKIP_SSH_TESTS ? describe.skip : describe;
```

at module-load time. So `TEST_USER` must be set in `globalSetup` for
those `describe.skip` decisions to flip to `describe`.

## Writing New Tests

### Unit tests (pure logic, no server, fast)

```javascript
describe('My Unit Tests', () => {
  test('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected output');
  });
});
```

### Integration tests (HTTP / Socket.IO against the dev server)

```javascript
const { createSocketClient, waitForConnect } = require('../helpers/test-utils');

describe('My Integration Tests', () => {
  jest.setTimeout(30000);

  test('should connect to server', async () => {
    const socket = createSocketClient();
    await waitForConnect(socket);
    expect(socket.connected).toBe(true);
  });
});
```

### Browser tests (Puppeteer against the dev server)

```javascript
const puppeteer = require('puppeteer');

describe('My Browser Tests', () => {
  jest.setTimeout(60000);
  let browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--ignore-certificate-errors'],
      ignoreHTTPSErrors: true
    });
  });

  afterAll(async () => { if (browser) await browser.close(); });

  test('should load page', async () => {
    const page = await browser.newPage();
    await page.goto(process.env.SERVER_URL, { waitUntil: 'networkidle2' });
    expect(await page.title()).toContain('SSHIFT');
  });
});
```

## Troubleshooting

### `Tests: 18 skipped` and you want them to run

The 18 SSH-credential-gated tests only run when an SSH target is
reachable: either install Docker (the globalSetup auto-boots the
fixture), or export `TEST_USER`/`TEST_PASS`/`TEST_HOST`/`TEST_PORT`
to point to an external SSH server.

### `AggregateError` / `ECONNREFUSED` in integration tests

The dev server isn't running. Boot it: `npm run dev`. Or you hit
`http://` instead of `https://` — the dev server forces HTTPS with
HTTP→HTTPS redirect; tests must use `https://localhost:3000`.

### `net::ERR_CERT_AUTHORITY_INVALID` in browser tests

Puppeteer is rejecting the dev server's self-signed cert. All browser
test files set `ignoreHTTPSErrors: true` AND pass
`--ignore-certificate-errors` to Chromium. If you copy the test
scaffold elsewhere, keep both flags.

### Socket.IO connection errors

- Verify dev server is listening: `curl -k https://localhost:3000/`
- The `socket.io-client` helper in `src/tests/helpers/test-utils.js`
  sets `rejectUnauthorized: false` so it can use a self-signed cert.
- CORS is not required — the test client connects directly to the
  dev server origin.

## Continuous Integration

`.github/workflows/ci.yml` runs:

1. **gitleaks** — secret scanning on every PR/push.
2. **install-and-test** — installs deps, runs the unit suite, then
   boots `npm run dev`, runs integration + browser tests, uploads
   `/tmp/dev-server.log` as an artifact on failure.

The Jest `globalSetup` will auto-start the Docker SSH fixture in CI
(runner has Docker available). If for any reason Docker isn't
available the SSH-credential tests skip with a clear log message,
keeping the suite green.