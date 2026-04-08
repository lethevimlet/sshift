---
layout: page
title: Testing
---

# Testing

## Prerequisites

### Chrome/Chromium for Browser Tests

Browser tests require Chrome or Chromium with system dependencies.

#### Linux (Debian/Ubuntu)

```bash
# Install Chrome dependencies
sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2

# Install Chrome for Puppeteer
npx puppeteer browsers install chrome
```

#### Windows

```powershell
# Chrome is typically already installed
# If not, install Chrome or run:
npx puppeteer browsers install chrome
```

## Running Tests

### Important: Test Requirements

**Unit tests** run without any prerequisites.

**Integration and Browser tests** require a running server:

```bash
# Terminal 1: Start development server
npm run dev

# Terminal 2: Run tests
npm test
```

### Run All Tests

```bash
# Run all test suites (requires running server for integration/browser tests)
npm test

# Run with verbose output
npm test -- --verbose

# Run with debug output
DEBUG=* npm test
```

### Run Specific Test Suites

```bash
# Unit tests only (no server required)
npm run test:unit

# Integration tests only (requires running server)
npm run test:integration

# Browser/UI tests only (requires running server)
npm run test:browser

# Alternative: Run specific test paths
npm test -- tests/unit/
npm test -- tests/integration/
npm test -- tests/browser/

# Specific test file
npm test -- tests/browser/ui.test.js

# Run tests matching a pattern
npm test -- --testNamePattern="should load"
```

### Quick Test Commands

```bash
# Run only unit tests (fast, no server needed)
npm run test:unit

# Run integration tests (requires: npm run dev in another terminal)
npm run test:integration

# Run browser tests (requires: npm run dev in another terminal)
npm run test:browser
```

## Test Suites

### Unit Tests (`tests/unit/`)

- Test individual components in isolation
- Fast execution, no external dependencies
- Mock SSH connections and file operations

### Integration Tests (`tests/integration/`)

- Test component interactions
- Require actual SSH server connection
- Test Socket.IO communication
- Test REST API endpoints

### Browser Tests (`tests/browser/`)

- Test UI functionality with Puppeteer
- Test page loading and rendering
- Test user interactions (modals, forms)
- Test WebSocket connections
- **Requirements**: Chrome/Chromium with system dependencies

## Test Files

### Core Test Files

- `tests/unit/ssh.test.js` - SSH connection unit tests
- `tests/unit/sftp.test.js` - SFTP operations unit tests
- `tests/integration/socket.test.js` - Socket.IO integration tests
- `tests/browser/ui.test.js` - Browser UI tests
- `tests/browser/console.test.js` - Console error detection
- `tests/browser/settings-modal.test.js` - Settings modal tests

### Test Utilities

- `tests/helpers/test-utils.js` - Test utilities and helpers
- `tests/setup.js` - Jest setup configuration

## Continuous Integration

For CI/CD pipelines, ensure:

1. **Environment variables** are set in CI config
2. **Chrome dependencies** are installed
3. **Test server** is running for integration tests

### Example GitHub Actions

```yaml
- name: Install Chrome dependencies
  run: |
    sudo apt-get update
    sudo apt-get install -y \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libgbm1 \
      libasound2 libpango-1.0-0 libcairo2

- name: Install Chrome for Puppeteer
  run: npx puppeteer browsers install chrome

- name: Run tests
  run: npm test
```

## Troubleshooting Tests

### Tests Hang or Timeout

**Problem**: Tests hang indefinitely or timeout

**Cause**: Integration and browser tests require a running development server

**Solution**: Start the development server before running tests:

```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Run tests
npm test

# Or run only unit tests (no server needed)
npm run test:unit
```

### Browser Tests Fail with "Code: 127"

**Problem**: Chrome fails to launch with error code 127

**Solution**: Install Chrome dependencies:

```bash
# Linux (Debian/Ubuntu)
sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2

# Install Chrome for Puppeteer
npx puppeteer browsers install chrome
```

### Tests Fail with "waitForTimeout is not a function"

**Problem**: Puppeteer v21+ removed `page.waitForTimeout()`

**Solution**: The codebase uses the `sleep()` utility function from `tests/helpers/test-utils.js`. If you see this error, ensure you're using the latest test files.

### SSH Connection Tests Fail

**Problem**: Cannot connect to SSH server

**Solutions**:

1. Verify SSH credentials in `.env/.env.local`
2. Ensure SSH server is running and accessible
3. Check firewall rules allow SSH connections
4. Verify SSH server supports password authentication

### Browser Tests Timeout

**Problem**: Tests timeout waiting for page load

**Solutions**:

1. Increase Jest timeout: `jest.setTimeout(60000)`
2. Ensure development server is running on correct port
3. Check `SERVER_URL` environment variable matches server

### Module Not Found Errors

**Problem**: Test files can't find modules

**Solution**: Install dependencies:

```bash
npm install
```

## Test Coverage

Generate test coverage reports:

```bash
# Run tests with coverage
npm test -- --coverage

# View coverage report
open coverage/lcov-report/index.html
```