/**
 * System REST endpoints (version, update)
 */

const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../../utils/config');

const SSL_CERT_FILE = 'ssl-cert.pem';
const SSL_KEY_FILE = 'ssl-key.pem';
const UPDATE_MARKER_FILE = '.updating';

/**
 * Register system endpoints
 * @param {Object} app - Express app
 * @param {Object} io - Socket.IO instance
 */
function registerSystemEndpoints(app, io) {
  // Clean up stale update marker from previous update attempt
  const dataDir = getDataDir();
  const staleUpdateMarker = path.join(dataDir, UPDATE_MARKER_FILE);
  const staleUpdateScript = path.join(dataDir, '.sshift-update.sh');
  const stalePsScript = path.join(dataDir, '.sshift-update.ps1');
  try {
    if (fs.existsSync(staleUpdateMarker)) {
      fs.unlinkSync(staleUpdateMarker);
      console.log('[UPDATE] Cleaned up stale update marker');
    }
    if (fs.existsSync(staleUpdateScript)) {
      fs.unlinkSync(staleUpdateScript);
    }
    if (fs.existsSync(stalePsScript)) {
      fs.unlinkSync(stalePsScript);
    }
  } catch (e) {
    console.error('[UPDATE] Failed to clean up marker file:', e.message);
  }

  // API: Get version
  app.get('/api/version', (req, res) => {
    try {
      const packagePath = path.join(__dirname, '../../../../package.json');
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
      const packagePath = path.join(__dirname, '../../../../package.json');
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
    const dataDir = getDataDir();
    const updateMarker = path.join(dataDir, UPDATE_MARKER_FILE);
    
    // Read package.json for current version
    let version = 'unknown';
    try {
      const pkgPath = path.join(__dirname, '../../../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      version = pkg.version;
    } catch (e) {
      console.error('[UPDATE] Failed to read version:', e.message);
    }
    
    // Check if we're in the middle of an update
    const isUpdating = fs.existsSync(updateMarker);
    
    res.json({
      version,
      updating: isUpdating,
      ready: !isUpdating
    });
  });

  // API: Download SSL certificate
  app.get('/api/cert', (req, res) => {
    const dataDir = getDataDir();
    const certPath = path.join(dataDir, SSL_CERT_FILE);

    if (!fs.existsSync(certPath)) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="sshift-ca.crt"');
    fs.createReadStream(certPath).pipe(res);
  });

  // API: Get security context info
  app.get('/api/security-info', (req, res) => {
    const dataDir = getDataDir();
    const certPath = path.join(dataDir, SSL_CERT_FILE);
    const hasCert = fs.existsSync(certPath);
    const protocol = req.protocol;
    const isSecure = req.secure || protocol === 'https';
    const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1' || req.hostname === '::1';

    res.json({
      isSecure,
      isLocalhost,
      protocol,
      certAvailable: hasCert,
      hostname: req.hostname
    });
  });

  // API: Trigger update
  app.post('/api/update', async (req, res) => {
    try {
      const { spawn } = require('child_process');
      const platform = process.platform;
      const dataDir = getDataDir();
      
      // Write update marker to indicate update in progress
      const updateMarker = path.join(dataDir, UPDATE_MARKER_FILE);
      try {
        const pkg = require('../../../../package.json');
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(updateMarker, JSON.stringify({
          startTime: Date.now(),
          oldVersion: pkg.version
        }));
      } catch (e) {
        console.error('[UPDATE] Failed to write update marker:', e.message);
      }
      
      // Send response immediately, then update in background
      res.json({ message: 'Update started. Server will restart automatically.' });
      
      // Write a temporary update script and run it detached
      const nodeExe = process.execPath;
      const sshiftScript = process.argv[1];
      const updateScriptPath = path.join(dataDir, '.sshift-update.sh');

      if (platform === 'win32') {
        const psScript = `npm install -g @lethevimlet/sshift@latest; & '${nodeExe}' '${sshiftScript}'`;
        fs.writeFileSync(updateScriptPath.replace('.sh', '.ps1'), psScript, 'utf8');
      } else {
        const updateScript = `#!/bin/sh
npm install -g @lethevimlet/sshift@latest
exec "${nodeExe}" "${sshiftScript}"
`;
        fs.writeFileSync(updateScriptPath, updateScript, 'utf8');
        fs.chmodSync(updateScriptPath, 0o755);
      }
      
      console.log('[UPDATE] Starting update process...');
      
      let spawnFailed = false;
      let spawnCommand, spawnArgs;
      if (platform === 'win32') {
        spawnCommand = 'powershell';
        spawnArgs = ['-ExecutionPolicy', 'Bypass', '-File', updateScriptPath.replace('.sh', '.ps1')];
      } else {
        spawnCommand = '/bin/sh';
        spawnArgs = [updateScriptPath];
      }
      
      const updateProcess = spawn(spawnCommand, spawnArgs, {
        cwd: dataDir,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env }
      });
      
      updateProcess.on('error', (err) => {
        console.error('[UPDATE] Failed to start update process:', err.message);
        spawnFailed = true;
        // Clean up marker since update failed
        try { fs.unlinkSync(updateMarker); } catch (e) { /* ignore */ }
      });
      
      updateProcess.unref();
      
      setTimeout(() => {
        if (spawnFailed) {
          console.error('[UPDATE] Update process failed to start. Keeping server running.');
          return;
        }
        console.log('[UPDATE] Exiting for update...');
        process.exit(0);
      }, 500);
    } catch (err) {
      console.error('Error triggering update:', err);
      res.status(500).json({ error: 'Failed to trigger update' });
    }
  });
}

module.exports = { registerSystemEndpoints };