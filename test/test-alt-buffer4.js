const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

// Test alternate buffer handling
const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
const serializeAddon = new SerializeAddon();
terminal.loadAddon(serializeAddon);

// Write some normal buffer content with callback
terminal.write('Normal buffer line 1\r\nNormal buffer line 2\r\n', () => {
  console.log('=== Normal Buffer ===');
  console.log('Buffer type:', terminal.buffer.active.type);
  console.log('Line 0:', terminal.buffer.active.getLine(0).translateToString(false).trim());
  console.log('Line 1:', terminal.buffer.active.getLine(1).translateToString(false).trim());
  
  // Switch to alternate buffer (like vim/htop do)
  terminal.write('\x1b[?1049h', () => {
    // Write to alternate buffer
    terminal.write('Alternate buffer line 1\r\nAlternate buffer line 2\r\nThis is like vim/htop\r\n', () => {
      console.log('\n=== Alternate Buffer ===');
      console.log('Buffer type:', terminal.buffer.active.type);
      console.log('Line 0:', terminal.buffer.active.getLine(0).translateToString(false).trim());
      console.log('Line 1:', terminal.buffer.active.getLine(1).translateToString(false).trim());
      console.log('Line 2:', terminal.buffer.active.getLine(2).translateToString(false).trim());
      
      const altState = serializeAddon.serialize({ mode: 'all' });
      console.log('Serialized state length:', altState.length);
      console.log('Serialized state:', JSON.stringify(altState.substring(0, 500)));
      
      // Create a new terminal to test deserialization
      const terminal2 = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      const serializeAddon2 = new SerializeAddon();
      terminal2.loadAddon(serializeAddon2);
      
      // Reset and write the serialized state
      terminal2.reset();
      terminal2.write(altState, () => {
        console.log('\n=== Deserialized Terminal ===');
        console.log('Buffer type:', terminal2.buffer.active.type);
        console.log('Line 0:', terminal2.buffer.active.getLine(0).translateToString(false).trim());
        console.log('Line 1:', terminal2.buffer.active.getLine(1).translateToString(false).trim());
        console.log('Line 2:', terminal2.buffer.active.getLine(2).translateToString(false).trim());
        
        // Switch back to normal buffer
        terminal.write('\x1b[?1049l', () => {
          console.log('\n=== Back to Normal Buffer ===');
          console.log('Buffer type:', terminal.buffer.active.type);
          console.log('Line 0:', terminal.buffer.active.getLine(0).translateToString(false).trim());
          console.log('Line 1:', terminal.buffer.active.getLine(1).translateToString(false).trim());
        });
      });
    });
  });
});
