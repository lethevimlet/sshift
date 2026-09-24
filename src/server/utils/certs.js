/**
 * Local certificate authority + CA-signed server certificate.
 *
 * Why a CA instead of a plain self-signed leaf: Android (and Brave/Chrome
 * on Android) will only install a certificate as a trust anchor when it
 * is a real CA certificate (basicConstraints CA:TRUE, keyCertSign). A
 * self-signed leaf without those extensions is rejected or silently
 * ignored by the "Install a certificate → CA certificate" flow, so the
 * "Not Secure" warning never goes away on the phone.
 *
 * Layout (all files live in the user-space data directory, which
 * survives `npm install -g` updates and Docker container recreation when
 * /data is a volume):
 *
 *   ssl-ca-cert.pem  the local CA, valid 10 years  → install THIS on devices
 *   ssl-ca-key.pem   the CA private key (0600)
 *   ssl-cert.pem     the server certificate signed by the CA
 *   ssl-key.pem      the server private key (0600)
 *
 * The CA is generated once and never rotated automatically, so devices
 * only need to trust it once. The server certificate is re-issued from
 * the same CA whenever it is missing, not signed by the CA (old
 * self-signed installs), close to expiry, or no longer lists the
 * machine's current hostname / IPs in its SANs. A re-issued server
 * certificate keeps working on every device that already trusts the CA.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { X509Certificate } = require('crypto');
const selfsigned = require('selfsigned');

const SSL_CERT_FILE = 'ssl-cert.pem';
const SSL_KEY_FILE = 'ssl-key.pem';
const SSL_CA_CERT_FILE = 'ssl-ca-cert.pem';
const SSL_CA_KEY_FILE = 'ssl-ca-key.pem';

const CA_VALID_DAYS = 3650;
// Apple (and, following it, Chrome) reject leaf certificates valid for
// longer than 825 days.
const SERVER_VALID_DAYS = 825;
// Re-issue the server certificate when it has less than this left.
const RENEW_BEFORE_DAYS = 30;
const ORG_NAME = 'sshift';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Collect the names the server certificate must be valid for.
 * @returns {{hostname: string, ips: string[]}}
 */
function collectLocalNames() {
  const ips = ['127.0.0.1'];
  const interfaces = os.networkInterfaces();
  Object.values(interfaces).forEach(iface => {
    (iface || []).forEach(addr => {
      if (addr.family === 'IPv4' && !addr.internal && !ips.includes(addr.address)) {
        ips.push(addr.address);
      }
    });
  });
  const hostname = os.hostname() || 'localhost';
  return { hostname, ips };
}

function daysUntil(dateStr) {
  return (new Date(dateStr).getTime() - Date.now()) / DAY_MS;
}

function parseCert(pem) {
  try {
    return new X509Certificate(pem);
  } catch {
    return null;
  }
}

/**
 * Returns null when the CA certificate/key pair is usable, otherwise a
 * human-readable reason it must be regenerated.
 * @param {string} caCertPem
 * @param {string} caKeyPem
 * @returns {string|null}
 */
function caProblem(caCertPem, caKeyPem) {
  const ca = parseCert(caCertPem);
  if (!ca) return 'CA certificate is not parseable';
  if (!ca.ca) return 'CA certificate is not marked as a CA (basicConstraints CA:TRUE)';
  if (daysUntil(ca.validTo) < RENEW_BEFORE_DAYS) return 'CA certificate has expired or expires soon';
  try {
    const { createPrivateKey } = require('crypto');
    const key = createPrivateKey(caKeyPem);
    if (!ca.checkPrivateKey(key)) return 'CA private key does not match the CA certificate';
  } catch (err) {
    return `CA private key is not usable: ${err.message}`;
  }
  return null;
}

/**
 * Returns null when the server certificate is usable with this CA and
 * these names, otherwise a human-readable reason it must be re-issued.
 * @param {string} certPem
 * @param {string} keyPem
 * @param {string} caCertPem
 * @param {{hostname: string, ips: string[]}} names
 * @returns {string|null}
 */
function serverCertProblem(certPem, keyPem, caCertPem, names) {
  const cert = parseCert(certPem);
  if (!cert) return 'server certificate is not parseable';
  const ca = parseCert(caCertPem);
  if (!ca) return 'CA certificate is not parseable';

  let issuedByCa = false;
  try {
    issuedByCa = cert.checkIssued(ca) && cert.verify(ca.publicKey);
  } catch {
    issuedByCa = false;
  }
  if (!issuedByCa) return 'server certificate is not signed by the local CA (old self-signed certificate)';
  if (cert.ca) return 'server certificate is marked as a CA';
  if (daysUntil(cert.validTo) < RENEW_BEFORE_DAYS) return 'server certificate has expired or expires soon';

  try {
    const { createPrivateKey } = require('crypto');
    if (!cert.checkPrivateKey(createPrivateKey(keyPem))) {
      return 'server private key does not match the server certificate';
    }
  } catch (err) {
    return `server private key is not usable: ${err.message}`;
  }

  // subjectAltName looks like "DNS:localhost, DNS:host, IP Address:127.0.0.1"
  const san = cert.subjectAltName || '';
  const missing = [];
  if (!new RegExp(`DNS:${escapeRegExp(names.hostname)}(,|$)`).test(san)) missing.push(names.hostname);
  names.ips.forEach(ip => {
    if (!new RegExp(`IP Address:${escapeRegExp(ip)}(,|$)`).test(san)) missing.push(ip);
  });
  if (missing.length) return `server certificate does not cover: ${missing.join(', ')}`;

  return null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate the local CA (10 years, RSA 2048, SHA-256).
 * @param {string} hostname - shown in the CA name so several sshift
 *   hosts can be told apart in a device's credential list
 * @returns {Promise<{cert: string, key: string}>}
 */
async function generateCA(hostname) {
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + CA_VALID_DAYS * DAY_MS);
  const pems = await selfsigned.generate(
    [
      { name: 'commonName', value: `sshift Local CA (${hostname})` },
      { name: 'organizationName', value: ORG_NAME }
    ],
    {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate: notBefore,
      notAfterDate: notAfter,
      extensions: [
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
      ]
    }
  );
  return { cert: pems.cert, key: pems.private };
}

/**
 * Issue a server certificate signed by the local CA.
 * @param {{cert: string, key: string}} ca
 * @param {{hostname: string, ips: string[]}} names
 * @returns {Promise<{cert: string, key: string}>}
 */
async function generateServerCert(ca, names) {
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + SERVER_VALID_DAYS * DAY_MS);
  const dnsNames = ['localhost'];
  if (names.hostname && names.hostname !== 'localhost') dnsNames.push(names.hostname);
  const altNames = [
    ...dnsNames.map(value => ({ type: 2, value })),
    ...names.ips.map(ip => ({ type: 7, ip }))
  ];
  const pems = await selfsigned.generate(
    [
      { name: 'commonName', value: names.hostname },
      { name: 'organizationName', value: ORG_NAME }
    ],
    {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate: notBefore,
      notAfterDate: notAfter,
      ca: { cert: ca.cert, key: ca.key },
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames }
      ]
    }
  );
  return { cert: pems.cert, key: pems.private };
}

function readPair(certPath, keyPath) {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return null;
  try {
    return {
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8')
    };
  } catch {
    return null;
  }
}

function writePair(certPath, keyPath, pair) {
  fs.mkdirSync(path.dirname(certPath), { recursive: true });
  // Certificates are public (they are served by /api/cert); keys are not.
  fs.writeFileSync(certPath, pair.cert, { mode: 0o644 });
  fs.writeFileSync(keyPath, pair.key, { mode: 0o600 });
}

/**
 * Make sure a usable local CA and a CA-signed server certificate exist in
 * dataDir, creating or re-issuing whatever is missing or stale.
 *
 * @param {string} dataDir
 * @param {object} [opts]
 * @param {{hostname: string, ips: string[]}} [opts.names] - override the
 *   names the certificate must cover (tests)
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{cert: string, key: string, caCert: string,
 *   caCreated: boolean, certIssued: boolean}>}
 *   `cert` is the full chain (server certificate followed by the CA) so
 *   TLS clients receive the issuer too.
 */
async function ensureLocalCertificates(dataDir, opts = {}) {
  const log = opts.log || (() => {});
  const names = opts.names || collectLocalNames();

  const caCertPath = path.join(dataDir, SSL_CA_CERT_FILE);
  const caKeyPath = path.join(dataDir, SSL_CA_KEY_FILE);
  const certPath = path.join(dataDir, SSL_CERT_FILE);
  const keyPath = path.join(dataDir, SSL_KEY_FILE);

  let ca = readPair(caCertPath, caKeyPath);
  let caCreated = false;
  if (ca) {
    const problem = caProblem(ca.cert, ca.key);
    if (problem) {
      log(`Local CA in ${dataDir} is unusable (${problem}); generating a new one`);
      ca = null;
    }
  }
  if (!ca) {
    log('Generating local certificate authority (valid 10 years)...');
    ca = await generateCA(names.hostname);
    writePair(caCertPath, caKeyPath, ca);
    caCreated = true;
    log(`Local CA saved to ${caCertPath} — install this file on your devices (also served at /api/cert)`);
  }

  let server = readPair(certPath, keyPath);
  let certIssued = false;
  if (server) {
    const problem = serverCertProblem(server.cert, server.key, ca.cert, names);
    if (problem) {
      log(`Re-issuing server certificate: ${problem}`);
      server = null;
    }
  }
  if (!server) {
    log(`Issuing server certificate for ${names.hostname}, ${names.ips.join(', ')} (signed by the local CA)`);
    server = await generateServerCert(ca, names);
    writePair(certPath, keyPath, server);
    certIssued = true;
    if (!caCreated) {
      log('The local CA is unchanged: devices that already trust it need no action');
    }
  }

  return {
    cert: `${server.cert.trim()}\n${ca.cert.trim()}\n`,
    key: server.key,
    caCert: ca.cert,
    caCreated,
    certIssued
  };
}

module.exports = {
  SSL_CERT_FILE,
  SSL_KEY_FILE,
  SSL_CA_CERT_FILE,
  SSL_CA_KEY_FILE,
  collectLocalNames,
  caProblem,
  serverCertProblem,
  generateCA,
  generateServerCert,
  ensureLocalCertificates
};
