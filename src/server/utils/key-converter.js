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

function convertPPKViaPuttygen(ppkContent, passphrase) {
  return new Promise((resolve, reject) => {
    const tmpDir = os.tmpdir();
    const inputFile = path.join(tmpDir, `sshift-ppk-${Date.now()}-${Math.random().toString(36).slice(2)}.ppk`);
    const outputFile = inputFile + '.openssh';

    const doConvert = (passphraseFile) => {
      const args = [inputFile, '-O', 'private-openssh-new', '-o', outputFile];
      if (passphraseFile) {
        args.push('--old-passphrase', passphraseFile);
      }

      execFile('puttygen', args, (err, stdout, stderr) => {
        const filesToClean = passphraseFile
          ? [inputFile, outputFile, passphraseFile]
          : [inputFile, outputFile];

        if (err) {
          for (const f of filesToClean) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
          const stderrStr = (stderr || '').trim();
          const errMsg = stderrStr || err.message;

          if (stderrStr.toLowerCase().includes('wrong passphrase') || stderrStr.toLowerCase().includes('unable to read')) {
            return reject(new Error(
              'PPK passphrase is incorrect. Please check the passphrase and try again.'
            ));
          }

          return reject(new Error('puttygen conversion failed: ' + errMsg));
        }

        fs.readFile(outputFile, 'utf8', (readErr, data) => {
          if (passphraseFile) {
            try { fs.unlinkSync(passphraseFile); } catch (e) { /* ignore */ }
          }
          try { fs.unlinkSync(inputFile); } catch (e) { /* ignore */ }
          try { fs.unlinkSync(outputFile); } catch (e) { /* ignore */ }
          if (readErr) {
            return reject(new Error('Failed to read converted key: ' + readErr.message));
          }
          resolve(data);
        });
      });
    };

    fs.writeFile(inputFile, ppkContent, (writeErr) => {
      if (writeErr) {
        try { fs.unlinkSync(inputFile); } catch (e) { /* ignore */ }
        return reject(new Error('Failed to write temporary PPK file: ' + writeErr.message));
      }

      const passphraseFile = path.join(tmpDir, `sshift-ppk-pass-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
      fs.writeFile(passphraseFile, passphrase || '', { mode: 0o600 }, (passWriteErr) => {
        if (passWriteErr) {
          try { fs.unlinkSync(inputFile); } catch (e) { /* ignore */ }
          return reject(new Error('Failed to write passphrase file: ' + passWriteErr.message));
        }
        doConvert(passphraseFile);
      });
    });
  });
}

function convertPPKV2ToOpenSSH(ppkContent, passphrase) {
  const lines = ppkContent.split('\n');

  const headers = {};
  const publicLines = [];
  const privateLines = [];
  let macLine = null;
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
      macLine = line.substring('Private-MAC:'.length).trim();
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim();
      if (key.match(/^PuTTY-User-Key-File-/i) ||
          key === 'Encryption' || key === 'Comment' || key === 'Key-Derivation' ||
          key === 'Argon2-Memory' || key === 'Argon2-Passes' ||
          key === 'Argon2-Parallelism' || key === 'Argon2-Salt') {
        headers[key] = value;
        continue;
      }
    }

    if (section === 'public') {
      publicLines.push(line);
    } else if (section === 'private') {
      privateLines.push(line);
    }
  }

  const encType = headers['Encryption'] || 'none';
  const ppkVersion = Object.keys(headers).find(k => k.match(/^PuTTY-User-Key-File-/i));
  const keyType = ppkVersion ? headers[ppkVersion] : null;
  if (!keyType) {
    throw new Error('Could not determine PPK key type. Is this a valid PPK file?');
  }

  if (ppkVersion && !ppkVersion.match(/^PuTTY-User-Key-File-2$/i)) {
    throw new Error(
      `PPK ${ppkVersion.replace('PuTTY-User-Key-File-', 'v')} format is not supported by the built-in converter. ` +
      `Only PPK v2 is supported. Install puttygen (PuTTY 0.71+) to convert this key.`
    );
  }

  const keyDerivation = headers['Key-Derivation'] || '';
  if (keyDerivation && keyDerivation.toLowerCase() !== 'sha1') {
    throw new Error(
      `PPK v2 key derivation "${keyDerivation}" is not supported by the built-in converter. ` +
      `Only SHA-1 key derivation is supported. Install puttygen to convert this key.`
    );
  }

  let privateData = Buffer.from(privateLines.join(''), 'base64');

  if (encType === 'aes256-cbc') {
    if (!passphrase) {
      throw new Error(
        'This PPK key is encrypted. Please enter the passphrase for this key.'
      );
    }
    try {
      privateData = decryptPPKV2Private(privateData, passphrase, encType);
    } catch (e) {
      throw new Error(
        'Failed to decrypt PPK key. The passphrase may be incorrect. ' +
        'Please verify the passphrase and try again.'
      );
    }
  } else if (encType !== 'none') {
    throw new Error(
      `PPK v2 encryption "${encType}" is not supported by the built-in converter. ` +
      `Supported: none, aes256-cbc. Try installing puttygen for broader format support.`
    );
  }

  if (privateData.length < 8) {
    throw new Error('PPK private data is too short. The key file may be corrupt or the passphrase may be wrong.');
  }

  if (encType !== 'none' && macLine) {
    const publicData = Buffer.from(publicLines.join(''), 'base64');
    if (!verifyPPKV2MAC(headers, publicData, privateData, passphrase, macLine)) {
      throw new Error(
        'The passphrase is incorrect or the key is corrupted. ' +
        'Please verify the passphrase and try again.'
      );
    }
  }

  const check1 = privateData.readUInt32BE(0);
  const check2 = privateData.readUInt32BE(4);
  if (check1 !== check2) {
    throw new Error(
      'PPK integrity check failed. The key may be corrupted or the passphrase may be wrong.'
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

function decryptPPKV2Private(encData, passphrase, encType) {
  if (encType === 'aes256-cbc') {
    const keyIv = derivePPKV2Key(passphrase, 48);
    const aesKey = keyIv.slice(0, 32);
    const iv = keyIv.slice(32, 48);

    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);
    let decrypted = decipher.update(encData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    const padLen = decrypted[decrypted.length - 1];
    if (padLen > 0 && padLen <= 16) {
      let valid = true;
      for (let i = 1; i <= padLen; i++) {
        if (decrypted[decrypted.length - i] !== padLen) {
          valid = false;
          break;
        }
      }
      if (valid) {
        decrypted = decrypted.slice(0, decrypted.length - padLen);
      }
    }

    return decrypted;
  }

  throw new Error(`Unsupported PPK v2 encryption type: ${encType}`);
}

function derivePPKV2Key(passphrase, keyLen) {
  const passBuf = Buffer.from(passphrase, 'utf-8');
  const derived = Buffer.alloc(keyLen);

  for (let i = 0; i < keyLen; i++) {
    const hash = crypto.createHash('sha1');
    hash.update(passBuf);
    if (i > 0) {
      hash.update(derived.slice(0, i));
    }
    derived[i] = hash.digest()[0];
  }

  return derived;
}

function verifyPPKV2MAC(headers, publicData, privateData, passphrase, macLine) {
  const macKeyBase = crypto.createHash('sha1');
  macKeyBase.update(Buffer.from('putty-private-key-file-mac-key', 'ascii'));
  if (passphrase) {
    macKeyBase.update(Buffer.from(passphrase, 'utf-8'));
  }
  const macKey = macKeyBase.digest();

  const keyType = Object.keys(headers).find(k => k.match(/^PuTTY-User-Key-File-/i));
  const keyTypeValue = keyType ? headers[keyType] : '';
  const encType = headers['Encryption'] || 'none';
  const comment = headers['Comment'] || '';

  const macData = Buffer.concat([
    sshString(keyTypeValue),
    sshString(encType),
    sshString(comment),
    sshBuffer(publicData),
    sshBuffer(privateData)
  ]);

  const computed = crypto.createHmac('sha1', macKey).update(macData).digest('hex');
  return computed === macLine.toLowerCase();
}

function sshString(str) {
  const buf = Buffer.from(str, 'utf-8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length);
  return Buffer.concat([len, buf]);
}

function sshBuffer(data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, data]);
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

async function convertPPKToOpenSSH(ppkContent, passphrase) {
  const info = detectKeyFormat(ppkContent);

  if (info.format !== 'ppk') {
    throw new Error('Not a PPK key');
  }

  // Try built-in converter first (works for v2 encrypted/unencrypted, no puttygen dependency)
  try {
    const result = convertPPKV2ToOpenSSH(ppkContent, passphrase);
    if (result) return result;
  } catch (e) {
    if (!e.message.includes('not supported by the built-in converter')) {
      throw e;
    }
  }

  // Fall back to puttygen (handles v3 and encryption types the built-in converter doesn't support)
  try {
    const result = await convertPPKViaPuttygen(ppkContent, passphrase);
    if (result && result.includes('BEGIN')) {
      return result;
    }
  } catch (e) {
    throw new Error(
      'Could not convert PPK key: ' + e.message +
      '. If puttygen is not available, ensure the key uses PPK v2 format with AES-256-CBC encryption (or no encryption).'
    );
  }

  throw new Error('Failed to convert PPK key: no conversion method available.');
}

async function convertKeyIfNeeded(keyContent, passphrase) {
  if (!keyContent || !keyContent.trim()) {
    return keyContent;
  }

  const info = detectKeyFormat(keyContent);
  if (info.format !== 'ppk') {
    return keyContent;
  }

  try {
    const converted = await convertPPKToOpenSSH(keyContent, passphrase);
    return converted;
  } catch (e) {
    throw new Error('PPK key conversion failed: ' + e.message);
  }
}

module.exports = { detectKeyFormat, convertPPKToOpenSSH, convertKeyIfNeeded };