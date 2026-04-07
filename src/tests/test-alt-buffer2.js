const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

async function test() {
  // Test alternate buffer handling
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(serializeAddon);

  // Write some normal buffer content
  await new Promise(resolve => {
    terminal.writeln('Normal buffer line 1');
    terminal.writeln('Normal buffer line 2');
    resolve();
  });

  console.log('=== Normal Buffer ===');
  console.log('Buffer type:', terminal.buffer.active.type);
  const normalState = serializeAddon.serialize({ mode: 'all' });
  console.log('Serialized length:', normalState.length);
  console.log('Line 0:', terminal.buffer.active.getLine(0).translateToString(false).trim());
  console.log('Line 1:', terminal.buffer.active.getLine(1).translateToString(false).trim());

  // Switch to alternate buffer (like vim/htop do)
  await new Promise(resolve => {
    terminal.write('\x1b[?1049h', resolve); // Enable alternate buffer
  });

  // Write to alternate buffer
  await new Promise(resolve => {
    terminal.writeln('Alternate buffer line 1');
    terminal.writeln('Alternate buffer line 2');
    terminal.writeln('This is like vim/htop');
    resolve();
  });

  console.log('\n=== Alternate Buffer ===');
  console.log('Buffer type:', terminal.buffer.active.type);
  const altState = serializeAddon.serialize({ mode: 'all' });
  console.log('Serialized state length:', altState.length);
  console.log('Line 0:', terminal.buffer.active.getLine(0).translateToString(false).trim());
  console.log('Line 1:', terminal.buffer.active.getLine(1).translateToString(false).trim());
  console.log('Line 2:', terminal.buffer.active.getLine(2).translateToString(false).trim());

  // Create a new terminal to test deserialization
  const terminal2 = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const serializeAddon2 = new SerializeAddon();
  terminal2.loadAddon(serializeAddon2);

  // Reset and write the serialized state
  await new Promise(resolve => {
    terminal2.reset();
    terminal2.write(altState, resolve);
  });
  
  console.log('\n=== Deserialized Terminal ===');
  console.log('Buffer type:', terminal2.buffer.active.type);
  console.log('Line 0:', terminal2.buffer.active.getLine(0).translateToString(false).trim());
  console.log('Line 1:', terminal2.buffer.active.getLine(1).translateToString(false).trim());
  console.log('Line 2:', terminal2.buffer.active.getLine(2).translateToString(false).trim());

  // Switch back to normal buffer
  await new Promise(resolve => {
    terminal.write('\x1b[?1049l', resolve); // Disable alternate buffer
  });
  console.log('\n=== Back to Normal Buffer ===');
  console.log('Buffer type:', terminal.buffer.active.type);
  console.log('Line 0:', terminal.buffer.active.getLine(0).translateToString(false).trim());
  console.log('Line 1:', terminal.buffer.active.getLine(1).translateToString(false).trim());
}

test().catch(console.error);
