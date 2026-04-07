/**
 * System REST endpoints (version, update)
 */

const fs = require('fs');
const path = require('path');

/**
 * Register system endpoints
 * @param {Object} app - Express app
 * @param {Object} io - Socket.IO instance
 */
function registerSystemEndpoints(app, io) {
  // API: Get version
  app.get('/api/version', (req, res) => {
    try {
      const packagePath = path.join(__dirname, '../../../package.json');
      const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      res.json({ version: packageData.version });
    } catch (err) {
      console.error('Error reading version:', err);
      res.status(500).json({ error: 'Failed to read version' });
    }
  });

  // API: Check for updates
  app.get('/api/check-update', async (req, res) => {
    try {
      const https = require('https');
      
      // Get local version
      const packagePath = path.join(__dirname, '../../../package.json');
      const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      const localVersion = packageData.version;
      
      // Get remote version from GitHub
      const options = {
        hostname: 'api.github.com',
        path: '/repos/lethevimlet/sshift/contents/package.json',
        method: 'GET',
        headers: {
          'User-Agent': 'sshift-update-checker',
          'Accept': 'application/vnd.github.v3+json'
        }
      };
      
      const githubRequest = https.request(options, (githubResponse) => {
        let data = '';
        
        githubResponse.on('data', (chunk) => {
          data += chunk;
        });
        
        githubResponse.on('end', () => {
          try {
            if (githubResponse.statusCode !== 200) {
              console.error('GitHub API error:', githubResponse.statusCode, data);
              res.status(500).json({ error: 'Failed to check for updates' });
              return;
            }
            
            const response = JSON.parse(data);
            const content = Buffer.from(response.content, 'base64').toString('utf8');
            const remotePackage = JSON.parse(content);
            const remoteVersion = remotePackage.version;
            
            // Compare versions
            const compareVersions = (v1, v2) => {
              const parts1 = v1.split('.').map(Number);
              const parts2 = v2.split('.').map(Number);
              
              for (let i = 0; i < 3; i++) {
                if (parts1[i] < parts2[i]) return -1;
                if (parts1[i] > parts2[i]) return 1;
              }
              return 0;
            };
            
            const comparison = compareVersions(localVersion, remoteVersion);
            const updateAvailable = comparison < 0;
            
            res.json({
              localVersion,
              remoteVersion,
              updateAvailable,
              checkedAt: new Date().toISOString()
            });
          } catch (err) {
            console.error('Error parsing GitHub response:', err);
            res.status(500).json({ error: 'Failed to parse update information' });
          }
        });
      });
      
      githubRequest.on('error', (err) => {
        console.error('Error checking for updates:', err);
        res.status(500).json({ error: 'Failed to check for updates' });
      });
      
      githubRequest.end();
    } catch (err) {
      console.error('Error in check-update:', err);
      res.status(500).json({ error: 'Failed to check for updates' });
    }
  });

  // API: Get update status
  app.get('/api/update-status', (req, res) => {
    const updateMarker = path.join(__dirname, '../../../.updating');
    const restartMarker = path.join(__dirname, '../../../.restart-after-update');
    
    // Read package.json for current version
    let version = 'unknown';
    try {
      const pkgPath = path.join(__dirname, '../../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      version = pkg.version;
    } catch (e) {
      console.error('[UPDATE] Failed to read version:', e.message);
    }
    
    // Check if we're in the middle of an update
    const isUpdating = fs.existsSync(updateMarker);
    const restartRequested = fs.existsSync(restartMarker);
    
    res.json({
      version,
      updating: isUpdating,
      restartRequested,
      ready: !isUpdating // Server is ready if not updating
    });
  });

  // API: Trigger update
  app.post('/api/update', async (req, res) => {
    try {
      const { spawn } = require('child_process');
      const platform = process.platform;
      
      // Determine the install script based on platform
      let installScript;
      if (platform === 'win32') {
        installScript = path.join(__dirname, '../../../install.ps1');
      } else {
        installScript = path.join(__dirname, '../../../install.sh');
      }
      
      // Check if install script exists
      if (!fs.existsSync(installScript)) {
        res.status(500).json({ error: 'Install script not found' });
        return;
      }
      
      // Write update marker to indicate update in progress
      const updateMarker = path.join(__dirname, '../../../.updating');
      try {
        const pkg = require('../../../package.json');
        fs.writeFileSync(updateMarker, JSON.stringify({
          startTime: Date.now(),
          oldVersion: pkg.version
        }));
      } catch (e) {
        console.error('[UPDATE] Failed to write update marker:', e.message);
      }
      
      // Write a restart marker file to indicate we want to restart after update
      const restartMarker = path.join(__dirname, '../../../.restart-after-update');
      try {
        fs.writeFileSync(restartMarker, 'true');
      } catch (e) {
        console.error('[UPDATE] Failed to write restart marker:', e.message);
      }
      
      // Send response immediately, then update in background
      res.json({ message: 'Update started. Server will restart automatically.' });
      
      // Execute update script with --update flag (detached from parent process)
      const updateCommand = platform === 'win32' 
        ? `powershell.exe -ExecutionPolicy Bypass -File "${installScript}" --update`
        : `"${installScript}" --update`;
      
      console.log('[UPDATE] Starting update process...');
      
      // Wait for response to be sent before spawning update process
      res.on('finish', () => {
        // Use spawn with detached mode to allow the update script to continue after parent exits
        const updateProcess = spawn(updateCommand, [], {
          cwd: path.join(__dirname, '../../..'),
          shell: true,
          detached: true,
          stdio: 'ignore'
        });
        
        // Unref the child process so the parent can exit without waiting for it
        updateProcess.unref();
        
        // Give the update script a moment to start
        setTimeout(() => {
          // Exit immediately to allow the update script to manage the restart
          console.log('[UPDATE] Exiting for update...');
          process.exit(0);
        }, 500);
      });
    } catch (err) {
      console.error('Error triggering update:', err);
      res.status(500).json({ error: 'Failed to trigger update' });
    }
  });
}

module.exports = { registerSystemEndpoints };