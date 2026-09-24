/**
 * Local CA + CA-signed server certificate (src/server/utils/certs.js).
 *
 * Android only installs CA certificates (CA:TRUE, keyCertSign) as trust
 * anchors, so sshift keeps a persistent local CA and issues its HTTPS
 * certificate from it. These tests cover the shape of both certificates
 * and the reuse / re-issue rules.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { X509Certificate, createPrivateKey } = require('crypto');
const selfsigned = require('selfsigned');
const certs = require('../../server/utils/certs');

const NAMES = { hostname: 'testhost', ips: ['127.0.0.1', '192.168.0.12'] };

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshift-certs-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ensureLocalCertificates', () => {
  test('creates a CA:TRUE authority and a CA-signed serverAuth leaf', async () => {
    const r = await certs.ensureLocalCertificates(dir, { names: NAMES });
    expect(r.caCreated).toBe(true);
    expect(r.certIssued).toBe(true);

    const ca = new X509Certificate(r.caCert);
    expect(ca.ca).toBe(true);
    expect(ca.subject).toMatch(/CN=sshift Local CA \(testhost\)/);

    const leafPem = fs.readFileSync(path.join(dir, certs.SSL_CERT_FILE), 'utf8');
    const leaf = new X509Certificate(leafPem);
    expect(leaf.ca).toBe(false);
    // extended key usage: TLS serverAuth (Node exposes EKU OIDs as keyUsage)
    expect(leaf.keyUsage).toContain('1.3.6.1.5.5.7.3.1');
    expect(leaf.checkIssued(ca)).toBe(true);
    expect(leaf.verify(ca.publicKey)).toBe(true);
    expect(leaf.subjectAltName).toContain('DNS:localhost');
    expect(leaf.subjectAltName).toContain('DNS:testhost');
    expect(leaf.subjectAltName).toContain('IP Address:192.168.0.12');
    expect(leaf.checkPrivateKey(createPrivateKey(r.key))).toBe(true);
    // Apple/Chrome reject leaves valid for more than 825 days
    const days = (new Date(leaf.validTo) - new Date(leaf.validFrom)) / 86400000;
    expect(days).toBeLessThanOrEqual(825);

    // served chain = leaf followed by CA
    const blocks = r.cert.match(/-----BEGIN CERTIFICATE-----/g);
    expect(blocks).toHaveLength(2);
    expect(r.cert.indexOf(leafPem.trim())).toBe(0);
    expect(r.cert).toContain(r.caCert.trim());

    for (const f of [certs.SSL_CA_CERT_FILE, certs.SSL_CA_KEY_FILE, certs.SSL_CERT_FILE, certs.SSL_KEY_FILE]) {
      expect(fs.existsSync(path.join(dir, f))).toBe(true);
    }
    expect(fs.statSync(path.join(dir, certs.SSL_CA_KEY_FILE)).mode & 0o077).toBe(0);
    expect(fs.statSync(path.join(dir, certs.SSL_KEY_FILE)).mode & 0o077).toBe(0);
  });

  test('reuses both CA and server certificate on the next start', async () => {
    const a = await certs.ensureLocalCertificates(dir, { names: NAMES });
    const b = await certs.ensureLocalCertificates(dir, { names: NAMES });
    expect(b.caCreated).toBe(false);
    expect(b.certIssued).toBe(false);
    expect(b.cert).toBe(a.cert);
    expect(b.key).toBe(a.key);
  });

  test('re-issues only the server certificate when a new IP appears', async () => {
    const a = await certs.ensureLocalCertificates(dir, { names: NAMES });
    const b = await certs.ensureLocalCertificates(dir, {
      names: { hostname: 'testhost', ips: [...NAMES.ips, '10.0.0.5'] }
    });
    expect(b.caCreated).toBe(false);
    expect(b.certIssued).toBe(true);
    expect(b.caCert).toBe(a.caCert);
    expect(new X509Certificate(b.cert).subjectAltName).toContain('IP Address:10.0.0.5');
  });

  test('replaces a legacy self-signed leaf (pre-1.8.1) with a CA-signed one', async () => {
    const legacy = await selfsigned.generate(
      [{ name: 'commonName', value: 'testhost' }, { name: 'organizationName', value: 'sshift' }],
      { days: 365, keySize: 2048, algorithm: 'sha256',
        extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }] }
    );
    fs.writeFileSync(path.join(dir, certs.SSL_CERT_FILE), legacy.cert);
    fs.writeFileSync(path.join(dir, certs.SSL_KEY_FILE), legacy.private);

    const logs = [];
    const r = await certs.ensureLocalCertificates(dir, { names: NAMES, log: m => logs.push(m) });
    expect(r.caCreated).toBe(true);
    expect(r.certIssued).toBe(true);
    expect(logs.join('\n')).toMatch(/not signed by the local CA/);
    const leaf = new X509Certificate(fs.readFileSync(path.join(dir, certs.SSL_CERT_FILE), 'utf8'));
    expect(leaf.checkIssued(new X509Certificate(r.caCert))).toBe(true);
  });

  test('regenerates an unusable CA (leaf cert in the CA slot)', async () => {
    const a = await certs.ensureLocalCertificates(dir, { names: NAMES });
    // put the (CA:FALSE) server cert where the CA should be
    fs.copyFileSync(path.join(dir, certs.SSL_CERT_FILE), path.join(dir, certs.SSL_CA_CERT_FILE));
    fs.copyFileSync(path.join(dir, certs.SSL_KEY_FILE), path.join(dir, certs.SSL_CA_KEY_FILE));
    const b = await certs.ensureLocalCertificates(dir, { names: NAMES });
    expect(b.caCreated).toBe(true);
    expect(b.certIssued).toBe(true);
    expect(b.caCert).not.toBe(a.caCert);
    expect(new X509Certificate(b.caCert).ca).toBe(true);
  });
});

describe('problem detectors', () => {
  test('serverCertProblem reports missing SANs and expiry', async () => {
    const ca = await certs.generateCA('h');
    const soon = await selfsigned.generate(
      [{ name: 'commonName', value: 'h' }],
      { keySize: 2048, algorithm: 'sha256', ca, notAfterDate: new Date(Date.now() + 5 * 86400000),
        extensions: [{ name: 'basicConstraints', cA: false }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'h' }, { type: 7, ip: '127.0.0.1' }] }] }
    );
    expect(certs.serverCertProblem(soon.cert, soon.private, ca.cert, { hostname: 'h', ips: ['127.0.0.1'] }))
      .toMatch(/expires soon/);

    const ok = await certs.generateServerCert(ca, { hostname: 'h', ips: ['127.0.0.1'] });
    expect(certs.serverCertProblem(ok.cert, ok.key, ca.cert, { hostname: 'h', ips: ['127.0.0.1'] })).toBeNull();
    expect(certs.serverCertProblem(ok.cert, ok.key, ca.cert, { hostname: 'other', ips: ['127.0.0.1', '10.1.1.1'] }))
      .toMatch(/does not cover: other, 10\.1\.1\.1/);
    // signed by a different CA
    const otherCa = await certs.generateCA('x');
    expect(certs.serverCertProblem(ok.cert, ok.key, otherCa.cert, { hostname: 'h', ips: ['127.0.0.1'] }))
      .toMatch(/not signed by the local CA/);
  });

  test('caProblem rejects non-CA and mismatched key', async () => {
    const ca = await certs.generateCA('h');
    expect(certs.caProblem(ca.cert, ca.key)).toBeNull();
    const leaf = await certs.generateServerCert(ca, { hostname: 'h', ips: ['127.0.0.1'] });
    expect(certs.caProblem(leaf.cert, leaf.key)).toMatch(/not marked as a CA/);
    expect(certs.caProblem(ca.cert, leaf.key)).toMatch(/does not match/);
    expect(certs.caProblem('garbage', ca.key)).toMatch(/not parseable/);
  });
});
