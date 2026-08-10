/**
 * Unit tests for clipboard paste streaming (chunked input)
 * Tests that sendChunkedInput:
 *   1. Converts \n to \r for PTY compatibility
 *   2. Wraps text in bracketed paste sequences ONLY when the remote
 *      application enabled bracketed paste mode (DECSET 2004) — real
 *      terminals never send \x1b[200~/\x1b[201~ unconditionally; apps that
 *      haven't opted in (plain read()/input() prompts such as
 *      `gcloud auth login --no-browser`) would receive the markers as
 *      literal "200~...201~" garbage around the pasted text
 *   3. Produces correct chunks that preserve line boundaries
 *   4. Reassembles to the original text (with \n→\r conversion)
 */

const BP_START = '\x1b[200~';
const BP_END = '\x1b[201~';

function generateTestData(lines = 500, lineLen = 100) {
  const lines_arr = [];
  for (let i = 1; i <= lines; i++) {
    lines_arr.push(`${i} ${'x'.repeat(lineLen - i.toString().length - 2)}`);
  }
  return lines_arr.join('\n') + '\n';
}

// Replicate sendChunkedInput logic as a pure function for testing.
// `bracketed` mirrors terminal.modes.bracketedPasteMode — the wrap is only
// applied when the remote app actually enabled the mode.
function chunkInput(data, chunkSize = 2048, bracketed = true) {
  data = data.replace(/\r\n/g, '\r').replace(/\n/g, '\r');

  const bpStart = bracketed ? BP_START : '';
  const bpEnd = bracketed ? BP_END : '';

  const wrapped = bpStart + data + bpEnd;
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
      chunk = bpStart + chunk;
      isFirst = false;
    }
    chunks.push(chunk);
    offset = end;
  }

  if (bpEnd) chunks.push(bpEnd);
  return chunks;
}

function reassemble(chunks) {
  const joined = chunks.join('');
  if (joined.startsWith(BP_START) && joined.endsWith(BP_END)) {
    return joined.slice(BP_START.length, joined.length - BP_END.length);
  }
  return joined;
}

describe('Clipboard streaming chunking', () => {
  let testData;

  beforeAll(() => {
    testData = generateTestData();
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

  test('performance: 50KB chunked in under 50ms', () => {
    const start = process.hrtime.bigint();
    const chunks = chunkInput(testData, 2048);
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1e6;
    expect(ms).toBeLessThan(50);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe('Clipboard streaming without bracketed paste mode (DECSET 2004 off)', () => {
  test('paste is NOT wrapped when the app has not enabled bracketed paste', () => {
    // Regression: pasting a gcloud auth token into a plain input() prompt
    // showed "200~<token>201~" — the markers were sent unconditionally and
    // echoed as literal input by the non-bracketed-paste-aware app.
    const token = '4/0AeanS0bkFake-Token_string-1234567890';
    const chunks = chunkInput(token, 2048, false);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(token);
    expect(chunks[0]).not.toContain('200~');
    expect(chunks[0]).not.toContain('201~');
  });

  test('multi-chunk paste has no bracket markers and no trailing empty chunk', () => {
    const data = generateTestData();
    const chunks = chunkInput(data, 2048, false);
    for (const chunk of chunks) {
      expect(chunk).not.toContain(BP_START);
      expect(chunk).not.toContain(BP_END);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  test('unbracketed reassembly matches original with \\n→\\r conversion', () => {
    const data = generateTestData();
    const chunks = chunkInput(data, 2048, false);
    const expected = data.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    expect(chunks.join('')).toBe(expected);
  });

  test('newline conversion still applies without bracketed paste', () => {
    const chunks = chunkInput('hello\nworld\r\n!', 2048, false);
    expect(chunks.join('')).toBe('hello\rworld\r!');
  });
});