/**
 * Regression tests for the legacy package-directory config migration.
 *
 * Versions before ~v1.3.x (pre May 2026) created config.json INSIDE the
 * npm package directory. `npm install -g` (GUI update / manual update)
 * replaces that directory wholesale, destroying such configs — users
 * lost bookmarks/folders/settings on update. The search order still
 * prefers package-dir paths, so legacy installs keep working until the
 * very update that deletes them.
 *
 * migrateLegacyPackageConfig() rescues them: on server startup it
 * copies a package-dir config to the user install directory (which
 * survives npm updates) before an update can destroy it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// The repo's own <package>/.env/config.json doubles as the "legacy
// package-dir config" fixture — it has top search priority, exactly like
// an old npm install's config. It is only ever READ by these tests.
const PACKAGE_ENV_CONFIG = path.join(__dirname, '..', '..', '..', '.env', 'config.json');

function loadConfigModule(userDataDir) {
  jest.resetModules();
  process.env.SSHIFT_DATA_DIR = userDataDir;
  return require('../../server/utils/config');
}

function makeTempUserDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sshift-migration-test-'));
}

describe('migrateLegacyPackageConfig (legacy npm package-dir configs)', () => {
  let tmpDir;
  let config;

  beforeEach(() => {
    tmpDir = makeTempUserDir();
  });

  afterEach(() => {
    delete process.env.SSHIFT_DATA_DIR;
    jest.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // The migration only has a package-dir config to find when the repo
  // has one (real installs pre-May-2026 always did). Skip the
  // copy-semantics tests in environments without it (e.g. CI checkouts
  // where .env/ is absent — it is gitignored).
  const hasPackageConfig = fs.existsSync(PACKAGE_ENV_CONFIG) || fs.existsSync(path.join(__dirname, '..', '..', '..', 'config.json'));

  (hasPackageConfig ? test : test.skip)('copies a package-dir config to the user data dir when none exists there', () => {
    config = loadConfigModule(tmpDir);
    const userConfigPath = path.join(tmpDir, '.env', 'config.json');
    expect(fs.existsSync(userConfigPath)).toBe(false);

    const migratedTo = config.migrateLegacyPackageConfig();

    expect(migratedTo).toBe(userConfigPath);
    expect(fs.existsSync(userConfigPath)).toBe(true);

    // The copy must contain exactly what the package-dir config held —
    // a partial or default copy would silently drop bookmarks.
    const packageConfigPath = fs.existsSync(PACKAGE_ENV_CONFIG)
      ? PACKAGE_ENV_CONFIG
      : path.join(__dirname, '..', '..', '..', 'config.json');
    const copied = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
    const source = JSON.parse(fs.readFileSync(packageConfigPath, 'utf8'));
    expect(copied).toEqual(source);
  });

  test('is a no-op when a user-space config already exists', () => {
    config = loadConfigModule(tmpDir);
    const userEnvDir = path.join(tmpDir, '.env');
    fs.mkdirSync(userEnvDir, { recursive: true });
    const userConfigPath = path.join(userEnvDir, 'config.json');
    fs.writeFileSync(userConfigPath, JSON.stringify({ port: 9999, bookmarks: [{ id: 'mine' }] }));

    const result = config.migrateLegacyPackageConfig();

    expect(result).toBeNull();
    // Existing user config untouched — never overwritten by a migration.
    const content = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
    expect(content.bookmarks).toEqual([{ id: 'mine' }]);
  });

  (hasPackageConfig ? test : test.skip)('is idempotent — running twice does not recopy or overwrite', () => {
    config = loadConfigModule(tmpDir);
    const first = config.migrateLegacyPackageConfig();
    expect(first).not.toBeNull();

    // Second run: user-space config now exists → no-op.
    const second = config.migrateLegacyPackageConfig();
    expect(second).toBeNull();
  });
});
