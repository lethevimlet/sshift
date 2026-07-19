/**
 * Jest globalTeardown — tears down the Docker SSH fixture started by
 * global-setup.js if we started it.
 */

const { execSync } = require('child_process');
const path = require('path');

const COMPOSE_FILE = path.join(__dirname, '..', '..', 'docker', 'test-ssh', 'docker-compose.yml');

function hasDockerCompose() {
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

async function globalTeardown() {
  if (process.env._SSHIFT_TEST_FIXTURE_STARTED !== '1') return;
  const compose = hasDockerCompose();
  if (!compose) return;
  try {
    console.log('[globalTeardown] Tearing down test SSH fixture...');
    execSync(`${compose} -f ${COMPOSE_FILE} down -v`, { stdio: 'inherit' });
    console.log('[globalTeardown] Test SSH fixture removed.');
  } catch (err) {
    console.warn('[globalTeardown] Failed to tear down test SSH fixture:', err.message);
    console.warn('[globalTeardown] You may need to manually run:');
    console.warn(`[globalTeardown]   ${compose} -f ${COMPOSE_FILE} down -v`);
  }
}

module.exports = globalTeardown;