/**
 * System REST endpoints (version, update)
 */

const fs = require('fs');
const path = require('path');
const { getDataDir, getCertPath, getKeyPath, getConfigPath } = require('../../utils/config');

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
  // NOTE: Do NOT delete the update log here — the client needs to read it
  // to detect errors. The log is cleaned up separately after a short delay.
  const dataDir = getDataDir();
  const staleUpdateMarker = path.join(dataDir, UPDATE_MARKER_FILE);
  const staleUpdateScript = path.join(dataDir, '.sshift-update.sh');
  const stalePsScript = path.join(dataDir, '.sshift-update.ps1');
  const staleUpdateLog = path.join(dataDir, '.sshift-update.log');
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
    if (fs.existsSync(staleUpdateLog)) {
      const logContent = fs.readFileSync(staleUpdateLog, 'utf8');
      console.log('[UPDATE] Previous update log:\n' + logContent);
      // Delay log deletion so the client can read error status
      setTimeout(() => {
        try { fs.unlinkSync(staleUpdateLog); } catch (e) { /* ignore */ }
      }, 30000);
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
    const updateLogPath = path.join(dataDir, '.sshift-update.log');
    
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

    // Check for update error log
    let updateError = null;
    let updateLog = null;
    if (!isUpdating && fs.existsSync(updateLogPath)) {
      try {
        const logContent = fs.readFileSync(updateLogPath, 'utf8');
        if (logContent.includes('npm install failed')) {
          updateError = 'Update failed: npm install exited with an error.';
        }
        // Return the last 4KB of the log for debugging
        const lastLines = logContent.slice(-4096);
        const relevantLines = lastLines.split('\n').filter(l => l.trim()).slice(-10);
        updateLog = relevantLines.join('\n');
      } catch (e) {
        // Ignore log read errors
      }
    }
    
    res.json({
      version,
      updating: isUpdating,
      ready: !isUpdating,
      updateError,
      updateLog
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
    const selfSignedCertPath = path.join(dataDir, SSL_CERT_FILE);
    const hasCert = fs.existsSync(selfSignedCertPath);
    const protocol = req.protocol;
    const isSecure = req.secure || protocol === 'https';
    const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1' || req.hostname === '::1';
    const usesCustomCert = !!(getCertPath() && getKeyPath());

    res.json({
      isSecure,
      isLocalhost,
      protocol,
      certAvailable: hasCert,
      usesCustomCert,
      hostname: req.hostname
    });
  });

  // API: Debug info (paths and config)
  app.get('/api/debug-info', (req, res) => {
    const dataDir = getDataDir();
    const selfSignedCertPath = path.join(dataDir, SSL_CERT_FILE);
    const selfSignedKeyPath = path.join(dataDir, SSL_KEY_FILE);
    const customCertPath = getCertPath();
    const customKeyPath = getKeyPath();
    const usesCustomCert = !!(customCertPath && customKeyPath);

    res.json({
      configPath: getConfigPath(),
      dataDir,
      certPath: usesCustomCert ? customCertPath : selfSignedCertPath,
      keyPath: usesCustomCert ? customKeyPath : selfSignedKeyPath,
      usesCustomCert
    });
  });

  // API: Trigger update
  app.post('/api/update', async (req, res) => {
    try {
      const { spawn, execSync } = require('child_process');
      const platform = process.platform;
      const dataDir = getDataDir();
      
      // Write update marker to indicate update in progress
      const updateMarker = path.join(dataDir, UPDATE_MARKER_FILE);
      let oldVersion = 'unknown';
      try {
        const pkg = require('../../../../package.json');
        oldVersion = pkg.version;
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(updateMarker, JSON.stringify({
          startTime: Date.now(),
          oldVersion: pkg.version
        }));
      } catch (e) {
        console.error('[UPDATE] Failed to write update marker:', e.message);
      }

      // Resolve the npm and sshift binary paths
      let npmBinPath;
      let sshiftBinPath;
      try {
        npmBinPath = execSync('command -v npm || which npm', { encoding: 'utf8' }).trim();
      } catch (e) {
        // Fallback: try common locations
        const nodeDir = path.dirname(process.execPath);
        npmBinPath = path.join(nodeDir, 'npm');
      }

      try {
        sshiftBinPath = execSync('command -v sshift || which sshift', { encoding: 'utf8' }).trim();
      } catch (e) {
        sshiftBinPath = null;
      }

      // If sshift isn't in PATH, try to resolve it relative to npm's global bin dir
      if (!sshiftBinPath) {
        try {
          const npmGlobalBinDir = execSync('npm bin -g', { encoding: 'utf8' }).trim();
          sshiftBinPath = path.join(npmGlobalBinDir, 'sshift');
        } catch (e) {
          sshiftBinPath = null;
        }
      }

      // Fallback: derive from process.argv[1] if available
      if (!sshiftBinPath && process.argv[1]) {
        sshiftBinPath = process.argv[1];
      }

      if (!sshiftBinPath) {
        console.error('[UPDATE] Cannot determine sshift binary path for restart');
        try { fs.unlinkSync(updateMarker); } catch (e) { /* ignore */ }
        return res.status(500).json({ error: 'Cannot determine sshift binary path for restart' });
      }

      const nodeExe = process.execPath;
      const updateScriptPath = path.join(dataDir, '.sshift-update.sh');
      const updateLogPath = path.join(dataDir, '.sshift-update.log');

      // Detect if running under systemd (moved before script template so the
      // isSystemdManaged and systemdUnit variables are available for interpolation)
      let isSystemdManaged = false;
      let systemdUnit = '';
      try {
        // Check if this process is managed by systemd via cgroup
        const myCgroup = fs.readFileSync(`/proc/${process.pid}/cgroup`, 'utf8');
        if (myCgroup.includes('sshift')) {
          isSystemdManaged = true;
          systemdUnit = 'sshift.service';
          console.log('[UPDATE] Detected systemd-managed process, unit:', systemdUnit);
        } else if (process.ppid === 1) {
          // Parent is init (systemd), check for sshift service
          try {
            require('child_process').execSync('systemctl is-enabled sshift.service 2>/dev/null', { encoding: 'utf8' });
            isSystemdManaged = true;
            systemdUnit = 'sshift.service';
            console.log('[UPDATE] Detected systemd service:', systemdUnit);
          } catch (e) {
            // Not a systemd service
          }
        }
      } catch (e) {
        // /proc not available (non-Linux), ignore
      }

      // Build PATH for the update script to ensure npm and node are findable
      const pathDirs = [];
      if (process.env.PATH) pathDirs.push(...process.env.PATH.split(':'));
      const nodeDir = path.dirname(process.execPath);
      if (!pathDirs.includes(nodeDir)) pathDirs.unshift(nodeDir);
      ['/usr/local/bin', '/usr/bin', '/usr/sbin', '/bin', '/sbin'].forEach((d) => {
        if (!pathDirs.includes(d)) pathDirs.push(d);
      });
      const scriptPath = pathDirs.join(':');

      // Send response immediately, then update in background
      res.json({ message: 'Update started. Server will restart automatically.' });

      if (platform === 'win32') {
        const sshiftCmd = sshiftBinPath.includes(' ') ? `& '${sshiftBinPath}'` : `sshift`;
        const psScript = `$ErrorActionPreference = 'Continue'
$MarkerPath = '${updateMarker}'
$LogPath = '${updateLogPath}'
$NodeExe = '${nodeExe}'
$SshiftBin = '${sshiftBinPath}'

# Check if running under Task Scheduler
$TaskName = "sshift"
$IsScheduled = $false
try {
  $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($Task -ne $null) {
    $IsScheduled = $true
    Write-Output "Detected Task Scheduler task: $TaskName" | Out-File -FilePath $LogPath -Append
    Write-Output "Stopping scheduled task..." | Out-File -FilePath $LogPath -Append
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
} catch {}

try {
  & npm install -g @lethevimlet/sshift@latest 2>&1 | Out-File -FilePath $LogPath -Append
  if ($LASTEXITCODE -ne 0) {
    Write-Output "npm install failed with exit code $LASTEXITCODE" | Out-File -FilePath $LogPath -Append
    Remove-Item -Path $MarkerPath -Force -ErrorAction SilentlyContinue
    if ($IsScheduled) {
      Write-Output "Starting scheduled task (old version)" | Out-File -FilePath $LogPath -Append
      Start-ScheduledTask -TaskName $TaskName
    } else {
      & $NodeExe $SshiftBin
    }
    exit 1
  }
} catch {
  Write-Output $_.Exception.Message | Out-File -FilePath $LogPath -Append
  Remove-Item -Path $MarkerPath -Force -ErrorAction SilentlyContinue
  if ($IsScheduled) {
    Write-Output "Starting scheduled task (old version)" | Out-File -FilePath $LogPath -Append
    Start-ScheduledTask -TaskName $TaskName
  } else {
    & $NodeExe $SshiftBin
  }
  exit 1
}
Remove-Item -Path $MarkerPath -Force -ErrorAction SilentlyContinue
if ($IsScheduled) {
  Write-Output "Starting scheduled task" | Out-File -FilePath $LogPath -Append
  Start-ScheduledTask -TaskName $TaskName
} else {
  & $NodeExe $SshiftBin
}
`;
        const psScriptPath = updateScriptPath.replace('.sh', '.ps1');
        fs.writeFileSync(psScriptPath, psScript, 'utf8');
      } else {
const updateScript = `#!/bin/sh
LOG="${updateLogPath}"
MARKER="${updateMarker}"
NPM_BIN="${npmBinPath}"
SSHIFT_FALLBACK="${sshiftBinPath}"
NODE_BIN="${nodeExe}"
OLD_VERSION="${oldVersion}"
SYSTEMD_MANAGED="${isSystemdManaged ? '1' : '0'}"
SYSTEMD_UNIT="${systemdUnit}"

echo "$(date): Starting sshift update (from v${oldVersion})..." > "$LOG"
echo "$(date): npm path: $NPM_BIN" >> "$LOG"
echo "$(date): node path: $NODE_BIN" >> "$LOG"
echo "$(date): sshift fallback: $SSHIFT_FALLBACK" >> "$LOG"
echo "$(date): systemd_managed: $SYSTEMD_MANAGED" >> "$LOG"

# Find the current sshift binary before npm changes anything
CURRENT_SSHIFT="$(command -v sshift 2>/dev/null || which sshift 2>/dev/null || echo "$SSHIFT_FALLBACK")"

# Run npm install
echo "$(date): Running npm install..." >> "$LOG"
if ! "$NPM_BIN" install -g @lethevimlet/sshift@latest >> "$LOG" 2>&1; then
  echo "$(date): npm install failed" >> "$LOG"
  echo "npm install failed" >> "$LOG"
  rm -f "$MARKER"
  # Always restart the server — the old version is still installed
  if [ "$SYSTEMD_MANAGED" = "1" ]; then
    echo "$(date): Restarting via systemd (old version)" >> "$LOG"
    systemctl start "$SYSTEMD_UNIT" >> "$LOG" 2>&1
  else
    echo "$(date): Restarting sshift (old version) from: $CURRENT_SSHIFT" >> "$LOG"
    exec "$NODE_BIN" "$CURRENT_SSHIFT"
  fi
  exit 1
fi
echo "$(date): npm install completed successfully" >> "$LOG"

# Remove the update marker before restart
rm -f "$MARKER"

if [ "$SYSTEMD_MANAGED" = "1" ]; then
  echo "$(date): Restarting via systemd" >> "$LOG"
  systemctl restart "$SYSTEMD_UNIT" >> "$LOG" 2>&1
else
  # Find the sshift binary — prefer PATH lookup since npm just updated it
  SSHIFT_BIN="$(command -v sshift 2>/dev/null || which sshift 2>/dev/null || echo "$SSHIFT_FALLBACK")"
  if [ ! -x "$SSHIFT_BIN" ]; then
    echo "$(date): ERROR: sshift binary not found or not executable at: $SSHIFT_BIN" >> "$LOG"
    echo "$(date): Attempting to restart with fallback path" >> "$LOG"
    SSHIFT_BIN="$SSHIFT_FALLBACK"
  fi

  echo "$(date): Restarting sshift from: $SSHIFT_BIN" >> "$LOG"
  exec "$NODE_BIN" "$SSHIFT_BIN"
fi
`;
        fs.writeFileSync(updateScriptPath, updateScript, 'utf8');
        fs.chmodSync(updateScriptPath, 0o755);
      }
      
      console.log('[UPDATE] Starting update process...');
      console.log('[UPDATE] npm path:', npmBinPath);
      console.log('[UPDATE] sshift restart path:', sshiftBinPath);
      console.log('[UPDATE] Log file:', updateLogPath);

      let spawnFailed = false;
      let spawnCommand, spawnArgs;
      if (platform === 'win32') {
        spawnCommand = 'powershell';
        spawnArgs = ['-ExecutionPolicy', 'Bypass', '-File', updateScriptPath.replace('.sh', '.ps1')];
      } else {
        spawnCommand = '/bin/sh';
        spawnArgs = [updateScriptPath];
      }
      
      const updateEnv = { ...process.env };
      updateEnv.PATH = scriptPath;

      // When running under systemd, spawn the update script in a transient scope
      // so it survives `systemctl restart` of the sshift service. Without this,
      // the script is in the same cgroup as sshift and gets killed when the
      // service restarts.
      if (isSystemdManaged && platform !== 'win32') {
        try {
          const systemdRunCheck = require('child_process').execSync('command -v systemd-run', { encoding: 'utf8' }).trim();
          if (systemdRunCheck) {
            console.log('[UPDATE] Using systemd-run to isolate update script from service');
            spawnCommand = systemdRunCheck;
            spawnArgs = ['--scope', '--unit=sshift-update', '/bin/sh', updateScriptPath];
          }
        } catch (e) {
          // systemd-run not available, fall through to default spawn
        }
      }

      const updateProcess = spawn(spawnCommand, spawnArgs, {
        cwd: dataDir,
        detached: true,
        stdio: 'ignore',
        env: updateEnv
      });
      
      updateProcess.on('error', (err) => {
        console.error('[UPDATE] Failed to start update process:', err.message);
        spawnFailed = true;
        try { fs.unlinkSync(updateMarker); } catch (e) { /* ignore */ }
      });
      
      updateProcess.unref();
      
      // Give the update script enough time to start before exiting.
      // Under systemd: we exit so the service can be restarted by `systemctl
      // restart` in the script. The script runs in a separate systemd scope
      // so it survives the service restart.
      // Non-systemd: we exit so the script can exec the new binary.
      const exitDelay = isSystemdManaged ? 1000 : 2000;
      setTimeout(() => {
        if (spawnFailed) {
          console.error('[UPDATE] Update process failed to start. Keeping server running.');
          return;
        }
        console.log('[UPDATE] Exiting for update...');
        process.exit(0);
      }, exitDelay);
    } catch (err) {
      console.error('Error triggering update:', err);
      res.status(500).json({ error: 'Failed to trigger update' });
    }
  });
}

module.exports = { registerSystemEndpoints };