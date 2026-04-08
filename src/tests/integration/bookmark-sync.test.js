/**
 * Integration tests for bookmark synchronization
 * Tests bookmark API endpoints and synchronization
 */

const fs = require('fs');
const path = require('path');

const TEST_URL = process.env.SERVER_URL || 'http://localhost:3000';
const TEST_CONFIG_PATH = path.join(__dirname, '..', '..', '..', '.env', 'config.json');
const BACKUP_CONFIG_PATH = path.join(__dirname, '..', '..', '..', '.env', 'config.json.test-backup');

/**
 * Helper function to make HTTP requests
 */
async function httpRequest(url, options = {}) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Helper to create test config
 */
function createTestConfig() {
  return {
    sticky: true,
    bookmarks: [],
    folders: []
  };
}

describe('Bookmark Synchronization Tests', () => {
  // Increase timeout for integration tests
  jest.setTimeout(30000);

  let hadExistingConfig = false;
  let originalConfig = null;

  beforeAll(async () => {
    // Backup existing config if it exists
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      hadExistingConfig = true;
      const configData = fs.readFileSync(TEST_CONFIG_PATH, 'utf8');
      originalConfig = configData;
      fs.writeFileSync(BACKUP_CONFIG_PATH, configData);
    }
    
    // Setup test config
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(createTestConfig(), null, 2));
    
    // Wait for server to reload config
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    // Restore backup if it existed
    try {
      if (hadExistingConfig && originalConfig) {
        fs.writeFileSync(TEST_CONFIG_PATH, originalConfig);
        if (fs.existsSync(BACKUP_CONFIG_PATH)) {
          fs.unlinkSync(BACKUP_CONFIG_PATH);
        }
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Bookmark API', () => {
    let createdBookmark1;
    let createdBookmark2;

    test('should create a bookmark', async () => {
      const bookmark = {
        name: 'Test Server 1',
        type: 'ssh',
        host: 'test1.example.com',
        port: 22,
        username: 'user1'
      };
      
      const response = await httpRequest(`${TEST_URL}/api/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookmark)
      });
      
      expect(response.status).toBe(200);
      expect(response.data.id).toBeDefined();
      expect(response.data.name).toBe(bookmark.name);
      
      createdBookmark1 = response.data;
    });

    test('should get all bookmarks', async () => {
      const response = await httpRequest(`${TEST_URL}/api/bookmarks`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBe(1);
      expect(response.data[0].id).toBe(createdBookmark1.id);
    });

    test('should update a bookmark', async () => {
      const updateData = { name: 'Updated Test Server 1' };
      
      const response = await httpRequest(`${TEST_URL}/api/bookmarks/${createdBookmark1.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      
      expect(response.status).toBe(200);
      expect(response.data.id).toBe(createdBookmark1.id);
      expect(response.data.name).toBe('Updated Test Server 1');
    });

    test('should create second bookmark', async () => {
      const bookmark = {
        name: 'Test Server 2',
        type: 'ssh',
        host: 'test2.example.com',
        port: 22,
        username: 'user2'
      };
      
      const response = await httpRequest(`${TEST_URL}/api/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookmark)
      });
      
      expect(response.status).toBe(200);
      createdBookmark2 = response.data;
      
      // Verify both bookmarks exist
      const getResponse = await httpRequest(`${TEST_URL}/api/bookmarks`);
      expect(getResponse.data.length).toBe(2);
    });

    test('should delete a bookmark', async () => {
      const response = await httpRequest(`${TEST_URL}/api/bookmarks/${createdBookmark1.id}`, {
        method: 'DELETE'
      });
      
      expect(response.status).toBe(200);
      
      // Verify deletion
      const getResponse = await httpRequest(`${TEST_URL}/api/bookmarks`);
      expect(getResponse.data.length).toBe(1);
      expect(getResponse.data[0].id).toBe(createdBookmark2.id);
    });

    test('should clean up remaining bookmarks', async () => {
      await httpRequest(`${TEST_URL}/api/bookmarks/${createdBookmark2.id}`, {
        method: 'DELETE'
      });
      
      const response = await httpRequest(`${TEST_URL}/api/bookmarks`);
      expect(response.data.length).toBe(0);
    });
  });
});