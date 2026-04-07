# Test Files

This directory contains test files for the SSHIFT project.

## Running Tests

Some tests require SSH credentials. Set environment variables before running:

```bash
export TEST_HOST=localhost
export TEST_PORT=22
export TEST_USER=testuser
export TEST_PASS=testpassword

# Or for SSH-specific tests
export SSH_HOST=localhost
export SSH_PORT=22
export SSH_USER=testuser
export SSH_PASS=testpassword
```

## Test Files

- `test-client.js` - Socket.IO and SSH functionality tests
- `test-browser-console.js` - Browser console error tests
- `test-browser-ui.js` - Browser UI tests
- `test-grace-period.js` - Grace period functionality tests
- `test-keepalive-config.js` - Keepalive configuration tests
- `test-sticky-keepalive.js` - Sticky session keepalive tests
- `test-sticky-page-reload.js` - Sticky session page reload tests
- `test-e2e-sticky.js` - End-to-end sticky session tests

## Security Note

All test files use environment variables for credentials. No hardcoded passwords or sensitive information should be present in test files.
