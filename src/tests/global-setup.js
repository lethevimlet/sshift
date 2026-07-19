/**
 * Jest globalSetup — boots the test SSH fixture before any tests run.
 *
 * Behavior:
 *   1. If SKIP_SSH_TESTS=true is already set, do nothing (the credential-
 *      gated tests will down-grade to describe.skip themselves).
 *   2. If TEST_USER/TEST_PASS/TEST_HOST/TEST_PORT are already set
 *      (caller supplied an external SSH target), do nothing — use those.
 *   3. Otherwise, try to boot docker/test-ssh/docker-compose.yml.
 *      On success, set TEST_USER/TEST_PASS/TEST_HOST/TEST_PORT so the
 *      credential-gated integration + browser tests run.
 *      On failure (Docker not installed / not running / sandboxed CI),
 *      set SKIP_SSH_TESTS=true and log a clear warning.
 *
 * Why a globalSetup and not per-file setup:
 *   - `describeSSH = describe.skip ? describe.skip : describe` is
 *     evaluated at module-load time, so the env vars must be set BEFORE
 *     any test file is imported. globalSetup runs before file imports.
 *   - Booting the container once for the whole suite is ~5s; booting
 *     once per file would multiply to ~60s+ across the integration suite.
 */

const { execSync, spawn } = require('child_process');
const net = require('net');
const path = require('path');

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'docker', 'test-ssh');
const COMPOSE_FILE = path.join(FIXTURE_DIR, 'docker-compose.yml');
const SSH_PORT = 2222;

function envIsSet(name) {
  return process.env[name] !== undefined && process.env[name] !== '';
}

function hasDocker() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function hasDockerCompose() {
  // `docker compose` (v2 plugin) or `docker-compose` (v1 standalone)
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return 'docker compose';
  } catch (_) {}
  try {
    execSync('docker-compose --version', { stdio: 'ignore' });
    return 'docker-compose';
  } catch (_) {}
  return null;
}

function waitForPort(port, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryConnect = () => {
      const sock = net.createConnection({ port, host });
      sock.once('connect', () => { sock.end(); resolve(); });
      sock.once('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Port ${host}:${port} not reachable after ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
    };
    tryConnect();
  });
}

async function bootFixture() {
  const compose = hasDockerCompose();
  if (!compose) throw new Error('Neither `docker compose` nor `docker-compose` is installed');
  const composeCmd = compose.split(' '); // ['docker','compose'] or ['docker-compose']

  // Build + up. -d runs detached. --build ensures Dockerfile changes
  // are picked up (cheap on a no-op rebuild thanks to BuildKit cache).
  execSync(`${compose} -f ${COMPOSE_FILE} up -d --build`, {
    stdio: 'inherit'
  });

  // Wait for sshd to accept TCP connections. ~30s is generous; the
  // LinuxServer image boots in ~3-5s on a warm cache.
  await waitForPort(SSH_PORT, '127.0.0.1', 30000);

  // Probe a real SSH handshake by attempting a connection. We don't
  // log in — just confirm SSH version banner is returned by the port
  // so a misconfigured sshd (PAM failure loop etc.) doesn't silently
  // make every test time out for 30s each.
  await new Promise((resolve, reject) => {
    const sock = net.createConnection({ port: SSH_PORT, host: '127.0.0.1' });
    let buf = '';
    sock.once('data', (d) => {
      buf += d.toString('utf8');
      if (buf.startsWith('SSH-')) {
        sock.end();
        resolve();
      } else {
        reject(new Error(`Unexpected SSH banner: ${buf.slice(0, 50)}`));
      }
    });
    sock.once('error', reject);
    setTimeout(() => { sock.destroy(); reject(new Error('SSH banner timeout')); }, 5000);
  });
}

async function teardownFixture() {
  // Only tear down if WE started it. The presence of the marker env
  // var `_SSHIFT_TEST_FIXTURE_STARTED` indicates we did.
  if (!envIsSet('_SSHIFT_TEST_FIXTURE_STARTED')) return;
  const compose = hasDockerCompose();
  if (!compose) return;
  try {
    execSync(`${compose} -f ${COMPOSE_FILE} down -v`, { stdio: 'inherit' });
  } catch (err) {
    console.warn('[globalTeardown] Failed to tear down test SSH fixture:', err.message);
  }
}

async function globalSetup() {
  // Case 1: caller opts out entirely.
  if (process.env.SKIP_SSH_TESTS === 'true') {
    console.log('[globalSetup] SKIP_SSH_TESTS=true — SSH credential tests will be skipped');
    return;
  }

  // Case 2: caller supplied external SSH target. Use as-is.
  if (envIsSet('TEST_USER') && envIsSet('TEST_PASS')) {
    console.log('[globalSetup] Using external SSH target:',
      process.env.TEST_HOST || 'localhost', ':', process.env.TEST_PORT || '22',
      'as', process.env.TEST_USER);
    return;
  }

  // Case 3: try Docker.
  if (!hasDocker()) {
    console.warn('[globalSetup] Docker not available. Setting SKIP_SSH_TESTS=true.');
    console.warn('[globalSetup] To run the SSH credential tests locally:');
    console.warn('[globalSetup]   - install Docker and re-run, OR');
    console.warn('[globalSetup]   - export TEST_USER=... TEST_PASS=... TEST_HOST=... TEST_PORT=...');
    process.env.SKIP_SSH_TESTS = 'true';
    return;
  }

  try {
    console.log('[globalSetup] Booting test SSH fixture (docker/test-ssh)...');
    await bootFixture();
    process.env.TEST_USER = 'testuser';
    process.env.TEST_PASS = 'testpass';
    process.env.TEST_HOST = '127.0.0.1';
    process.env.TEST_PORT = String(SSH_PORT);
    process.env._SSHIFT_TEST_FIXTURE_STARTED = '1';
    console.log(`[globalSetup] SSH fixture ready at ${process.env.TEST_HOST}:${process.env.TEST_PORT} as ${process.env.TEST_USER}`);
  } catch (err) {
    console.warn('[globalSetup] Failed to boot SSH fixture:', err.message);
    console.warn('[globalSetup] Setting SKIP_SSH_TESTS=true.');
    process.env.SKIP_SSH_TESTS = 'true';
  }
}

module.exports = globalSetup;
module.exports.teardown = teardownFixture;
module.exports._internal = { bootFixture, teardownFixture, waitForPort };
