const http = require('http');

async function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function test() {
  console.log('Testing Web UI resources...\n');
  
  const tests = [
    { name: 'Main page', url: 'http://localhost:3000/' },
    { name: 'app.js', url: 'http://localhost:3000/js/app.js' },
    { name: 'style.css', url: 'http://localhost:3000/css/style.css' },
    { name: 'socket.io', url: 'http://localhost:3000/socket.io/socket.io.js' },
    { name: 'xterm.js', url: 'https://unpkg.com/xterm@5.3.0/lib/xterm.js' },
    { name: 'xterm-addon-fit', url: 'https://unpkg.com/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js' },
    { name: 'xterm-addon-web-links', url: 'https://unpkg.com/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.js' },
    { name: 'xterm-addon-search', url: 'https://unpkg.com/xterm-addon-search@0.13.0/lib/xterm-addon-search.js' },
    { name: 'xterm CSS', url: 'https://unpkg.com/xterm@5.3.0/css/xterm.css' },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await fetch(test.url);
      if (result.status === 200) {
        console.log(`✅ ${test.name}: OK (${result.data.length} bytes)`);
        passed++;
      } else {
        console.log(`❌ ${test.name}: HTTP ${result.status}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${test.name}: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

test();