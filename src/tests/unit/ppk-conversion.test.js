/**
 * PPK v2 import used to fail for every real key ("integrity check failed").
 * Fixtures are PuTTY keys shipped with the ssh2 package.
 */
const fs = require('fs');
const path = require('path');
const { utils } = require('ssh2');
const { convertPPKToOpenSSH } = require('../../server/utils/key-converter');

const fixtures = path.join(path.dirname(require.resolve('ssh2/package.json')), 'test', 'fixtures');
const read = (rel) => fs.readFileSync(path.join(fixtures, rel), 'utf8');
const have = (rel) => fs.existsSync(path.join(fixtures, rel));

const cases = [
  ['id_rsa.ppk', undefined, 'ssh-rsa'],
  ['keyParser/ppk_rsa', undefined, 'ssh-rsa'],
  ['keyParser/ppk_rsa_enc', 'node.js', 'ssh-rsa'],
  ['keyParser/ppk_dsa_enc', 'node.js', 'ssh-dss'],
].filter(([rel]) => have(rel));

describe('PPK v2 conversion', () => {
  test.each(cases)('%s converts to a key ssh2 accepts', async (rel, pass, type) => {
    const out = await convertPPKToOpenSSH(read(rel), pass);
    expect(out).toContain('BEGIN');
    const key = utils.parseKey(out);
    expect(key instanceof Error).toBe(false);
    expect(key.type).toBe(type);
  });

  test('wrong or missing passphrase gives a clear error', async () => {
    if (!have('keyParser/ppk_rsa_enc')) return;
    await expect(convertPPKToOpenSSH(read('keyParser/ppk_rsa_enc'), 'wrong')).rejects.toThrow(/passphrase/);
    await expect(convertPPKToOpenSSH(read('keyParser/ppk_rsa_enc'))).rejects.toThrow(/encrypted/);
  });
});
