/**
 * Version string baked into index.html / sw.js (cache keys, ?v= URLs) and
 * reported by /api/version for the stale-page check.
 *
 * In development (NODE_ENV=development, the --dev port) the package version
 * does not change when files are edited, so the service worker kept serving
 * the old JS/CSS from its version-keyed cache. There, every server start
 * gets its own suffix: restart the dev server and pages pick up the edits
 * (one automatic reload via the stale-page check).
 */
const path = require('path');
const fs = require('fs');

const bootStamp = Date.now().toString(36);

function getPackageVersion() {
  const pkgPath = path.join(__dirname, '../../../package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
}

function getAssetVersion() {
  const version = getPackageVersion();
  return process.env.NODE_ENV === 'development' ? `${version}-dev.${bootStamp}` : version;
}

module.exports = { getAssetVersion, getPackageVersion };
