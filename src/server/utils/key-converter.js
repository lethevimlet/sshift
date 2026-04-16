const crypto = require('crypto');
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

function detectKeyFormat(keyContent) {
  if (!keyContent || !keyContent.trim()) return { format: 'unknown', type: 'unknown' };

  const trimmed = keyContent.trim();

  if (/^PuTTY-User-Key-File-/im.test(trimmed)) {
    const lines = trimmed.split('\n');
    let type = 'ssh-rsa';
    let isEncrypted = false;
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();
        if (key.match(/^PuTTY-User-Key-File-/i)) {
          type = value;
        }
        if (key === 'Encryption') {
          isEncrypted = value !== 'none';
        }
      }
    }
    return { format: 'ppk', type, encrypted: isEncrypted };
  }

  if (trimmed.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    return { format: 'pem-rsa', type: 'ssh-rsa', encrypted: trimmed.includes('ENCRYPTED') };
  }
  if (trimmed.includes('-----BEGIN EC PRIVATE KEY-----')) {
    return { format: 'pem-ec', type: 'ecdsa', encrypted: trimmed.includes('ENCRYPTED') };
  }
  if (trimmed.includes('-----BEGIN DSA PRIVATE KEY-----')) {
    return { format: 'pem-dsa', type: 'ssh-dss', encrypted: trimmed.includes('ENCRYPTED') };
  }
  if (trimmed.includes('-----BEGIN PRIVATE KEY-----')) {
    return { format: 'pkcs8', type: 'generic', encrypted: trimmed.includes('ENCRYPTED') };
  }
  if (trimmed.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
    return { format: 'pkcs8-encrypted', type: 'generic', encrypted: true };
  }
  if (trimmed.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) {
    return { format: 'openssh', type: 'openssh-generic', encrypted: false };
  }

  return { format: 'unknown', type: 'unknown' };
}

function convertPPKViaPuttygen(ppkContent) {
  return new Promise((resolve, reject) => {
    const tmpDir = os.tmpdir();
    const inputFile = path.join(tmpDir, `sshift-ppk-${Date.now()}-${Math.random().toString(36).slice(2)}.ppk`);
    const outputFile = inputFile + '.openssh';

    fs.writeFile(inputFile, ppkContent, (writeErr) => {
      if (writeErr) {
        try { fs.unlinkSync(inputFile); } catch (e) { /* ignore */ }
        return reject(new Error('Failed to write temporary PPK file: ' + writeErr.message));
      }

      execFile('puttygen', [inputFile, '-O', 'private-openssh-new', '-o', outputFile], (err, stdout, stderr) => {
        try { fs.unlinkSync(inputFile); } catch (e) { /* ignore */ }

        if (err) {
          try { fs.unlinkSync(outputFile); } catch (e) { /* ignore */ }
          return reject(new Error(
            'puttygen conversion failed: ' + (stderr || err.message) +
            '. If the PPK file is encrypted, decrypt it first using PuTTYgen.'
          ));
        }

        fs.readFile(outputFile, 'utf8', (readErr, data) => {
          try { fs.unlinkSync(outputFile); } catch (e) { /* ignore */ }
          if (readErr) {
            return reject(new Error('Failed to read converted key: ' + readErr.message));
          }
          resolve(data);
        });
      });
    });
  });
}

function convertPPKV2ToOpenSSH(ppkContent) {
  const lines = ppkContent.split('\n');

  const headers = {};
  const publicLines = [];
  const privateLines = [];
  let section = 'header';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith(':')) continue;

    if (line.startsWith('Public-Lines:')) {
      section = 'public';
      continue;
    }
    if (line.startsWith('Private-Lines:')) {
      section = 'private';
      continue;
    }
    if (line.startsWith('Private-MAC:')) {
      section = 'mac';
      continue;
    }

    if (section === 'public') {
      publicLines.push(line);
    } else if (section === 'private') {
      privateLines.push(line);
    } else if (section === 'header') {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        headers[line.substring(0, colonIdx).trim()] = line.substring(colonIdx + 1).trim();
      }
    }
  }

  const encType = headers['Encryption'] || 'none';
  if (encType !== 'none') {
    throw new Error(
      `PPK key is encrypted with "${encType}". Please decrypt it first using PuTTYgen: ` +
      `load the PPK, enter the passphrase, then export as OpenSSH key.`
    );
  }

  const ppkVersion = Object.keys(headers).find(k => k.match(/^PuTTY-User-Key-File-/i));
  const keyType = ppkVersion ? headers[ppkVersion] : null;
  if (!keyType) {
    throw new Error('Could not determine PPK key type. Is this a valid PPK file?');
  }

  if (ppkVersion && ppkVersion.match(/^PuTTY-User-Key-File-3$/i)) {
    throw new Error(
      'PPK v3 format is not supported by the built-in converter. ' +
      'The key will be converted using puttygen on the server instead.'
    );
  }

  const publicData = Buffer.from(publicLines.join(''), 'base64');
  const privateData = Buffer.from(privateLines.join(''), 'base64');

  if (privateData.length < 8) {
    throw new Error('PPK private data is too short. The key file may be corrupt.');
  }

  const check1 = privateData.readUInt32BE(0);
  const check2 = privateData.readUInt32BE(4);
  if (check1 !== check2) {
    throw new Error(
      'PPK integrity check failed. The key may be encrypted or corrupted. ' +
      'If it has a passphrase, convert using PuTTYgen first.'
    );
  }

  const privReader = new SSHBufferReader(privateData.slice(8));
  const privKeyType = privReader.readString().toString('ascii');

  if (privKeyType !== keyType) {
    throw new Error(`PPK key type mismatch: expected ${keyType}, got ${privKeyType}`);
  }

  const keyParts = [Buffer.from(keyType)];

  if (keyType === 'ssh-rsa') {
    const n = privReader.readMPInt();
    const e = privReader.readMPInt();
    const d = privReader.readMPInt();
    const iqmp = privReader.readMPInt();
    const p = privReader.readMPInt();
    const q = privReader.readMPInt();

    keyParts.push(writeSSHString(n));
    keyParts.push(writeSSHString(e));
    keyParts.push(writeSSHString(d));
    keyParts.push(writeSSHString(iqmp));
    keyParts.push(writeSSHString(p));
    keyParts.push(writeSSHString(q));
  } else if (keyType === 'ssh-ed25519') {
    const pubKeyBlob = privReader.readString();
    const privKeyBlob = privReader.readString();
    keyParts.push(pubKeyBlob);
    keyParts.push(privKeyBlob);
  } else if (keyType.startsWith('ecdsa-sha2-')) {
    const curveName = privReader.readString();
    const pubPoint = privReader.readString();
    const privD = privReader.readMPInt();
    keyParts.push(curveName);
    keyParts.push(pubPoint);
    keyParts.push(writeSSHString(privD));
  } else if (keyType === 'ssh-dss') {
    const p = privReader.readMPInt();
    const q = privReader.readMPInt();
    const g = privReader.readMPInt();
    const y = privReader.readMPInt();
    const x = privReader.readMPInt();
    keyParts.push(writeSSHString(p));
    keyParts.push(writeSSHString(q));
    keyParts.push(writeSSHString(g));
    keyParts.push(writeSSHString(y));
    keyParts.push(writeSSHString(x));
  } else {
    throw new Error(`Unsupported PPK v2 key type: ${keyType}. Supported: ssh-rsa, ssh-ed25519, ecdsa-sha2-*, ssh-dss`);
  }

  return encodeOpenSSHPrivateKey(keyParts);
}

class SSHBufferReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  readString() {
    if (this.offset + 4 > this.buffer.length) {
      throw new Error('Buffer underflow reading string length');
    }
    const len = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    if (this.offset + len > this.buffer.length) {
      throw new Error('Buffer underflow reading string data');
    }
    const str = this.buffer.slice(this.offset, this.offset + len);
    this.offset += len;
    return str;
  }

  readMPInt() {
    if (this.offset + 4 > this.buffer.length) {
      throw new Error('Buffer underflow reading MPInt length');
    }
    const len = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    if (this.offset + len > this.buffer.length) {
      throw new Error('Buffer underflow reading MPInt data');
    }
    const data = this.buffer.slice(this.offset, this.offset + len);
    this.offset += len;
    let start = 0;
    while (start < data.length && data[start] === 0) start++;
    return data.slice(start);
  }
}

function writeSSHString(buf) {
  let padded = buf;
  if (buf.length > 0 && (buf[0] & 0x80)) {
    padded = Buffer.concat([Buffer.alloc(1), buf]);
  }
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(padded.length);
  return Buffer.concat([lenBuf, padded]);
}

function encodeOpenSSHPrivateKey(keyParts) {
  const prefix = Buffer.from('openssh-key-v1\0', 'binary');

  const cipherName = Buffer.from('none');
  const kdfName = Buffer.from('none');
  const kdfOptions = Buffer.alloc(0);

  const pubParts = [];
  for (const part of keyParts) {
    pubParts.push(writeSSHString(part));
  }
  const pubBlob = Buffer.concat(pubParts);

  const checkVal = crypto.randomBytes(4).readUInt32BE(0);
  const check1 = Buffer.alloc(4);
  check1.writeUInt32BE(checkVal);
  const check2 = Buffer.alloc(4);
  check2.writeUInt32BE(checkVal);

  const privParts = [check1, check2];
  for (const part of keyParts) {
    privParts.push(writeSSHString(part));
  }
  privParts.push(writeSSHString(Buffer.alloc(0)));

  const currentLen = privParts.reduce((sum, p) => sum + p.length, 0);
  const blockSize = 8;
  const padLen = (blockSize - (currentLen % blockSize)) % blockSize;
  if (padLen > 0) {
    const padding = Buffer.alloc(padLen);
    for (let i = 0; i < padLen; i++) {
      padding[i] = (i + 1) & 0xff;
    }
    privParts.push(padding);
  }

  const privBlob = Buffer.concat(privParts);

  const nKeys = Buffer.alloc(4);
  nKeys.writeUInt32BE(1);

  function sshBuf(buf) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(buf.length);
    return Buffer.concat([len, buf]);
  }

  const serialized = Buffer.concat([
    prefix,
    sshBuf(cipherName),
    sshBuf(kdfName),
    sshBuf(kdfOptions),
    nKeys,
    sshBuf(pubBlob),
    sshBuf(privBlob)
  ]);

  const b64 = serialized.toString('base64');
  const lines = b64.match(/.{1,70}/g) || [];

  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

async function convertPPKToOpenSSH(ppkContent) {
  const info = detectKeyFormat(ppkContent);

  if (info.format !== 'ppk') {
    throw new Error('Not a PPK key');
  }

  if (info.encrypted) {
    throw new Error(
      'This PPK key is encrypted. Please decrypt it first using PuTTYgen: ' +
      'load the PPK, enter the passphrase, then export as OpenSSH key.'
    );
  }

  // Try puttygen first (handles all PPK versions including v3)
  try {
    const result = await convertPPKViaPuttygen(ppkContent);
    if (result && result.includes('BEGIN OPENSSH PRIVATE KEY')) {
      return result;
    }
  } catch (e) {
    // puttygen not available or failed, try built-in v2 parser
  }

  // Fall back to built-in PPK v2 converter
  try {
    return convertPPKV2ToOpenSSH(ppkContent);
  } catch (e) {
    throw new Error(
      'Could not convert PPK key: ' + e.message +
      '. Please convert the key manually using PuTTYgen: ' +
      'load the PPK file, then export as OpenSSH key (Conversions > Export OpenSSH key).'
    );
  }
}

module.exports = { detectKeyFormat, convertPPKToOpenSSH };