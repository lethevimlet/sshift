const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

// Test alternate buffer handling
const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
const serializeAddon = new SerializeAddon();
terminal.loadAddon(serializeAddon);

// Write some normal buffer content
terminal.writeln('Normal buffer line 1');
terminal.writeln('Normal buffer line 2');

console.log('=== Normal Buffer ===');
console.log('Buffer type:', terminal.buffer.active.type);
console.log('Content:', serializeAddon.serialize({ mode: 'all' }));

// Switch to alternate buffer (like vim/htop do)
terminal.write('\x1b[?1049h'); // Enable alternate buffer

// Write to alternate buffer
terminal.writeln('Alternate buffer line 1');
terminal.writeln('Alternate buffer line 2');
terminal.writeln('This is like vim/htop');

console.log('\n=== Alternate Buffer ===');
console.log('Buffer type:', terminal.buffer.active.type);
const altState = serializeAddon.serialize({ mode: 'all' });
console.log('Serialized state length:', altState.length);
console.log('Serialized state preview:', altState.substring(0, 200));

// Create a new terminal to test deserialization
const terminal2 = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
const serializeAddon2 = new SerializeAddon();
terminal2.loadAddon(serializeAddon2);

// Reset and write the serialized state
terminal2.reset();
terminal2.write(altState, () => {
  console.log('\n=== Deserialized Terminal ===');
  console.log('Buffer type:', terminal2.buffer.active.type);
  console.log('Line 0:', terminal2.buffer.active.getLine(0).translateToString(false));
  console.log('Line 1:', terminal2.buffer.active.getLine(1).translateToString(false));
  console.log('Line 2:', terminal2.buffer.active.getLine(2).translateToString(false));
});

// Switch back to normal buffer
terminal.write('\x1b[?1049l'); // Disable alternate buffer
console.log('\n=== Back to Normal Buffer ===');
console.log('Buffer type:', terminal.buffer.active.type);
console.log('Content:', serializeAddon.serialize({ mode: 'all' }).substring(0, 100));
