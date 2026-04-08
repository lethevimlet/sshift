# SSHIFT Test Suite

This directory contains all tests for the SSHIFT project, converted to use the Jest testing framework.

## Test Structure

```
src/tests/
├── setup.js                    # Global Jest setup
├── helpers/
│   └── test-utils.js          # Test helper utilities
├── unit/                       # Unit tests
│   ├── sticky-session.test.js
│   └── alternate-buffer.test.js
├── integration/                # Integration tests
│   ├── client.test.js
│   ├── server.test.js
│   ├── frontend.test.js
│   ├── sticky-keepalive.test.js
│   ├── grace-period.test.js
│   └── bookmark-sync.test.js
└── browser/                    # Browser/E2E tests
    ├── ui.test.js
    ├── settings-modal.test.js
    ├── console.test.js
    └── layout-sync.test.js
```

## Running Tests

### All Tests
```bash
npm test
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

### Specific Test Suites

#### Unit Tests
```bash
npm run test:unit
```

#### Integration Tests
```bash
npm run test:integration
```

#### Browser/E2E Tests
```bash
npm run test:browser
```

## Test Categories

### Unit Tests
- **sticky-session.test.js**: Tests for sticky session management logic
- **alternate-buffer.test.js**: Tests for xterm.js alternate buffer handling

### Integration Tests
- **client.test.js**: Tests for Socket.IO client and SSH connections
- **server.test.js**: Tests for HTTP server endpoints
- **frontend.test.js**: Tests for frontend resource loading
- **sticky-keepalive.test.js**: Tests for sticky sessions and keepalive settings
- **grace-period.test.js**: Tests for session grace period functionality
- **bookmark-sync.test.js**: Tests for bookmark API and synchronization

### Browser Tests
- **ui.test.js**: Tests for browser UI functionality
- **settings-modal.test.js**: Tests for settings modal interactions
- **console.test.js**: Tests for browser console errors
- **layout-sync.test.js**: Tests for layout synchronization between tabs

## Prerequisites

### For Integration and Browser Tests

1. **Server must be running**:
   ```bash
   # For development testing (port 3000)
   npm run dev
   
   # OR for production testing (port 8022)
   npm start
   ```

2. **SSH server must be accessible** (for SSH connection tests):
   - Set environment variables:
     ```bash
     export TEST_HOST=localhost
     export TEST_PORT=22
     export TEST_USER=testuser
     export TEST_PASS=testpassword
     ```

3. **Puppeteer** (for browser tests):
   - Puppeteer is included as a dev dependency
   - Tests run in headless mode by default

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVER_URL` | Server URL for tests | `http://localhost:3000` |
| `TEST_HOST` | SSH test host | `localhost` |
| `TEST_PORT` | SSH test port | `22` |
| `TEST_USER` | SSH test username | `testuser` |
| `TEST_PASS` | SSH test password | `testpassword` |

**Note**: The default `SERVER_URL` is set to port 3000, which is the development server port (`npm run dev`). For production testing, set `SERVER_URL=http://localhost:8022`.

## Test Configuration

Jest configuration is in `jest.config.js`:

```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.js'],
  testTimeout: 30000,
  // ... more config
};
```

## Writing New Tests

### Unit Test Example
```javascript
describe('My Unit Tests', () => {
  test('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected output');
  });
});
```

### Integration Test Example
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

### Browser Test Example
```javascript
const puppeteer = require('puppeteer');

describe('My Browser Tests', () => {
  jest.setTimeout(60000);
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  test('should load page', async () => {
    page = await browser.newPage();
    await page.goto('http://localhost:3000');
    expect(page).toBeDefined();
  });
});
```

## Troubleshooting

### Tests Fail with "Timeout waiting for event"
- Ensure the server is running
- Check that the correct port is configured
- Verify SSH server is accessible

### Browser Tests Fail
- Ensure Puppeteer is installed: `npm install`
- Check that the server is running
- Verify no other browser instances are blocking

### Socket.IO Connection Errors
- Check firewall settings
- Verify server is listening on the correct port
- Ensure CORS is properly configured

## Continuous Integration

For CI environments, you may need to:

1. Start the server before tests:
   ```bash
   npm start &
   sleep 2
   npm test
   ```

2. Use a test SSH server or mock SSH connections

3. Configure Puppeteer for CI:
   ```javascript
   const browser = await puppeteer.launch({
     headless: 'new',
     args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
   });
   ```