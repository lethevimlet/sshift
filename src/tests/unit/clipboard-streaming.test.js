/**
 * Unit tests for clipboard paste streaming (chunked input)
 * Tests that sendChunkedInput:
 *   1. Converts \n to \r for PTY compatibility
 *   2. Wraps text in bracketed paste sequences
 *   3. Produces correct chunks that preserve line boundaries
 *   4. Reassembles to the original text (with \n→\r conversion)
 */

const fs = require('fs');
const path = require('path');

const BP_START = '\x1b[200~';
const BP_END = '\x1b[201~';

// Replicate sendChunkedInput logic as a pure function for testing
function chunkInput(data, chunkSize = 2048) {
  // \n → \r conversion (same as the real code)
  data = data.replace(/\r\n/g, '\r').replace(/\n/g, '\r');

  const wrapped = BP_START + data + BP_END;
  if (wrapped.length <= chunkSize) return [wrapped];

  const chunks = [];
  let offset = 0;
  let isFirst = true;

  while (offset < data.length) {
    let end = Math.min(offset + chunkSize, data.length);
    if (end < data.length) {
      const lastCr = data.lastIndexOf('\r', end);
      if (lastCr > offset) {
        end = lastCr + 1;
      }
    }
    let chunk = data.substring(offset, end);
    if (isFirst) {
      chunk = BP_START + chunk;
      isFirst = false;
    }
    chunks.push(chunk);
    offset = end;
  }

  chunks.push(BP_END);
  return chunks;
}

// Reassemble chunks and strip bracketed paste markers
function reassemble(chunks) {
  const joined = chunks.join('');
  if (joined.startsWith(BP_START) && joined.endsWith(BP_END)) {
    return joined.slice(BP_START.length, joined.length - BP_END.length);
  }
  return joined;
}

describe('Clipboard streaming chunking', () => {
  const testFilePath = path.join(__dirname, '..', '..', '..', 'test_text.txt');
  let testData;

  beforeAll(() => {
    testData = fs.readFileSync(testFilePath, 'utf8');
  });

  test('\\n is converted to \\r in pasted output', () => {
    const input = 'hello\nworld\n';
    const chunks = chunkInput(input, 2048);
    const reassembled = reassemble(chunks);
    expect(reassembled).toBe('hello\rworld\r');
    expect(reassembled).not.toContain('\n');
  });

  test('\\r\\n is converted to \\r (not \\r\\r)', () => {
    const input = 'hello\r\nworld\r\n';
    const chunks = chunkInput(input, 2048);
    const reassembled = reassemble(chunks);
    expect(reassembled).toBe('hello\rworld\r');
    expect(reassembled).not.toContain('\n');
  });

  test('mixed \\n and \\r\\n convert correctly', () => {
    const input = 'line1\nline2\r\nline3\n';
    const chunks = chunkInput(input, 2048);
    const reassembled = reassemble(chunks);
    expect(reassembled).toBe('line1\rline2\rline3\r');
  });

  test('small data is wrapped in bracketed paste and sent as single chunk', () => {
    const small = 'hello world\n';
    const chunks = chunkInput(small, 2048);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('\x1b[200~hello world\r\x1b[201~');
  });

  test('bracketed paste start is on first chunk only', () => {
    const chunks = chunkInput(testData, 2048);
    expect(chunks[0]).toMatch(/^\x1b\[200~/);
    for (let i = 1; i < chunks.length - 1; i++) {
      expect(chunks[i]).not.toContain('\x1b[200~');
    }
  });

  test('bracketed paste end is on last chunk only', () => {
    const chunks = chunkInput(testData, 2048);
    const last = chunks[chunks.length - 1];
    expect(last).toBe('\x1b[201~');
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i]).not.toContain('\x1b[201~');
    }
  });

  test('reassembled content matches original with \\n→\\r conversion', () => {
    const chunks = chunkInput(testData, 2048);
    const reassembled = reassemble(chunks);
    const expected = testData.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    expect(reassembled).toBe(expected);
  });

  test('every content chunk (not first/last) ends with \\r', () => {
    const chunks = chunkInput(testData, 2048);
    for (let i = 0; i < chunks.length - 1; i++) {
      const content = i === 0 ? chunks[i].slice(BP_START.length) : chunks[i];
      expect(content.endsWith('\r')).toBe(true);
    }
  });

  test('every line in original maps to correct line in output', () => {
    const chunks = chunkInput(testData, 2048);
    const reassembled = reassemble(chunks);
    const originalLines = testData.split('\n');
    const resultLines = reassembled.split('\r');
    expect(resultLines).toEqual(originalLines);
  });

  test('various chunk sizes preserve content with \\n→\\r conversion', () => {
    for (const size of [1024, 2048, 4096, 8192]) {
      const chunks = chunkInput(testData, size);
      const reassembled = reassemble(chunks);
      const expected = testData.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
      expect(reassembled).toBe(expected);
    }
  });

  test('performance: 100KB chunked in under 50ms', () => {
    const start = process.hrtime.bigint();
    const chunks = chunkInput(testData, 2048);
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1e6;
    expect(ms).toBeLessThan(50);
    expect(chunks.length).toBeGreaterThan(0);
  });
});