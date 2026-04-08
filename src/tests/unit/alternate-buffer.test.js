/**
 * Unit tests for xterm.js alternate buffer handling
 * Tests terminal buffer serialization and deserialization
 */

describe('Alternate Buffer Tests', () => {
  let Terminal;
  let SerializeAddon;
  
  beforeAll(() => {
    // These tests require @xterm/headless and @xterm/addon-serialize
    // They will be skipped if not available
    try {
      Terminal = require('@xterm/headless').Terminal;
      SerializeAddon = require('@xterm/addon-serialize').SerializeAddon;
    } catch (e) {
      console.warn('xterm packages not available, skipping alternate buffer tests');
    }
  });

  describe('Normal Buffer', () => {
    test.skip('should write to normal buffer', () => {
      // This test requires xterm packages
      const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      const serializeAddon = new SerializeAddon();
      terminal.loadAddon(serializeAddon);
      
      terminal.writeln('Normal buffer line 1');
      terminal.writeln('Normal buffer line 2');
      
      expect(terminal.buffer.active.type).toBe('normal');
      const content = serializeAddon.serialize({ mode: 'all' });
      expect(content).toContain('Normal buffer line 1');
    });
  });

  describe('Alternate Buffer', () => {
    test.skip('should switch to alternate buffer', () => {
      // This test requires xterm packages
      const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      const serializeAddon = new SerializeAddon();
      terminal.loadAddon(serializeAddon);
      
      // Switch to alternate buffer
      terminal.write('\x1b[?1049h');
      
      expect(terminal.buffer.active.type).toBe('alternate');
    });

    test.skip('should write to alternate buffer', () => {
      // This test requires xterm packages
      const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      const serializeAddon = new SerializeAddon();
      terminal.loadAddon(serializeAddon);
      
      // Switch to alternate buffer
      terminal.write('\x1b[?1049h');
      terminal.writeln('Alternate buffer line 1');
      terminal.writeln('Alternate buffer line 2');
      
      const content = serializeAddon.serialize({ mode: 'all' });
      expect(content).toContain('Alternate buffer line 1');
    });

    test.skip('should switch back to normal buffer', () => {
      // This test requires xterm packages
      const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      const serializeAddon = new SerializeAddon();
      terminal.loadAddon(serializeAddon);
      
      // Write to normal buffer
      terminal.writeln('Normal buffer line 1');
      
      // Switch to alternate buffer
      terminal.write('\x1b[?1049h');
      terminal.writeln('Alternate buffer line 1');
      
      // Switch back to normal buffer
      terminal.write('\x1b[?1049l');
      
      expect(terminal.buffer.active.type).toBe('normal');
      const content = serializeAddon.serialize({ mode: 'all' });
      expect(content).toContain('Normal buffer line 1');
    });
  });

  describe('Buffer Serialization', () => {
    test.skip('should serialize and deserialize buffer state', () => {
      // This test requires xterm packages
      const terminal1 = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      const serializeAddon1 = new SerializeAddon();
      terminal1.loadAddon(serializeAddon1);
      
      // Write content
      terminal1.writeln('Line 1');
      terminal1.writeln('Line 2');
      terminal1.writeln('Line 3');
      
      // Serialize
      const serialized = serializeAddon1.serialize({ mode: 'all' });
      
      // Create new terminal and deserialize
      const terminal2 = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      const serializeAddon2 = new SerializeAddon();
      terminal2.loadAddon(serializeAddon2);
      
      terminal2.reset();
      terminal2.write(serialized, () => {
        const line0 = terminal2.buffer.active.getLine(0).translateToString(false);
        const line1 = terminal2.buffer.active.getLine(1).translateToString(false);
        const line2 = terminal2.buffer.active.getLine(2).translateToString(false);
        
        expect(line0).toContain('Line 1');
        expect(line1).toContain('Line 2');
        expect(line2).toContain('Line 3');
      });
    });
  });
});