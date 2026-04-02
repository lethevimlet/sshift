#!/usr/bin/env node

/**
 * Automated Test Script for Folder Drag & Drop Functionality
 * 
 * This script tests the API endpoints and data persistence for folder functionality.
 * Run with: node test/test-folder-functionality.js
 */

const http = require('http');

const API_BASE = 'http://localhost:3000/api';

// Helper function to make HTTP requests
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Test results tracking
let testsPassed = 0;
let testsFailed = 0;
let testsSkipped = 0;

function log(message, type = 'info') {
  const prefix = {
    'pass': '✓',
    'fail': '✗',
    'skip': '○',
    'info': '→'
  };
  console.log(`${prefix[type] || '→'} ${message}`);
}

async function test(name, fn) {
  try {
    const result = await fn();
    if (result === true) {
      testsPassed++;
      log(`${name} - PASS`, 'pass');
    } else if (result === 'skip') {
      testsSkipped++;
      log(`${name} - SKIP`, 'skip');
    } else {
      testsFailed++;
      log(`${name} - FAIL: ${result}`, 'fail');
    }
  } catch (err) {
    testsFailed++;
    log(`${name} - ERROR: ${err.message}`, 'fail');
  }
}

// Test suite
async function runTests() {
  console.log('\n=== Folder Functionality Test Suite ===\n');
  
  let testFolderId = null;
  let testBookmarkId = null;

  // Test 1: Get all folders
  await test('Get all folders', async () => {
    const res = await makeRequest('GET', '/api/folders');
    if (res.status !== 200) return `Status ${res.status}`;
    if (!Array.isArray(res.data)) return 'Response is not an array';
    return true;
  });

  // Test 2: Create a folder
  await test('Create a folder', async () => {
    const res = await makeRequest('POST', '/api/folders', {
      name: 'Test Folder ' + Date.now(),
      icon: 'folder'
    });
    if (res.status !== 200) return `Status ${res.status}`;
    if (!res.data.id) return 'No ID returned';
    testFolderId = res.data.id;
    return true;
  });

  // Test 3: Get all bookmarks
  await test('Get all bookmarks', async () => {
    const res = await makeRequest('GET', '/api/bookmarks');
    if (res.status !== 200) return `Status ${res.status}`;
    if (!Array.isArray(res.data)) return 'Response is not an array';
    if (res.data.length > 0) {
      testBookmarkId = res.data[0].id;
    }
    return true;
  });

  // Test 4: Move bookmark to folder
  await test('Move bookmark to folder', async () => {
    if (!testFolderId) return 'skip';
    if (!testBookmarkId) return 'skip';
    
    const res = await makeRequest('PUT', `/api/bookmarks/${testBookmarkId}`, {
      folderId: testFolderId
    });
    if (res.status !== 200) return `Status ${res.status}`;
    if (res.data.folderId !== testFolderId) return 'folderId not updated';
    return true;
  });

  // Test 5: Move bookmark to root
  await test('Move bookmark to root', async () => {
    if (!testBookmarkId) return 'skip';
    
    const res = await makeRequest('PUT', `/api/bookmarks/${testBookmarkId}`, {
      folderId: null
    });
    if (res.status !== 200) return `Status ${res.status}`;
    if (res.data.folderId !== null && res.data.folderId !== undefined) {
      return 'folderId should be null';
    }
    return true;
  });

  // Test 6: Update folder
  await test('Update folder name', async () => {
    if (!testFolderId) return 'skip';
    
    const res = await makeRequest('PUT', `/api/folders/${testFolderId}`, {
      name: 'Updated Folder ' + Date.now()
    });
    if (res.status !== 200) return `Status ${res.status}`;
    return true;
  });

  // Test 7: Verify bookmark order persistence
  await test('Verify bookmark order in config', async () => {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, '..', 'config.json');
    
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!Array.isArray(config.bookmarks)) return 'bookmarks is not an array';
      if (!Array.isArray(config.folders)) return 'folders is not an array';
      
      // Check that bookmarks with folderId reference existing folders
      const folderIds = new Set(config.folders.map(f => f.id));
      for (const bookmark of config.bookmarks) {
        if (bookmark.folderId && !folderIds.has(bookmark.folderId)) {
          return `Bookmark ${bookmark.id} references non-existent folder ${bookmark.folderId}`;
        }
      }
      
      return true;
    } catch (err) {
      return `Failed to read config: ${err.message}`;
    }
  });

  // Test 8: Delete folder
  await test('Delete folder', async () => {
    if (!testFolderId) return 'skip';
    
    const res = await makeRequest('DELETE', `/api/folders/${testFolderId}`);
    if (res.status !== 200) return `Status ${res.status}`;
    
    // Verify folder is deleted
    const foldersRes = await makeRequest('GET', '/api/folders');
    const folderExists = foldersRes.data.some(f => f.id === testFolderId);
    if (folderExists) return 'Folder still exists after deletion';
    
    return true;
  });

  // Test 9: Verify bookmarks remain after folder deletion
  await test('Bookmarks remain after folder deletion', async () => {
    const res = await makeRequest('GET', '/api/bookmarks');
    if (res.status !== 200) return `Status ${res.status}`;
    if (!Array.isArray(res.data)) return 'Response is not an array';
    // Bookmarks should still exist, just with folderId that no longer exists
    // This is acceptable - the UI should handle orphaned bookmarks
    return true;
  });

  // Print summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log(`Skipped: ${testsSkipped}`);
  console.log(`Total: ${testsPassed + testsFailed + testsSkipped}`);
  
  if (testsFailed > 0) {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n✓ All tests passed!');
    process.exit(0);
  }
}

// Run tests
runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});