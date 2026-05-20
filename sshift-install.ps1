# sshift Installation Script for Windows
# Installs Node.js (if not present) and installs sshift via npm
# Checks for updates and restarts the app if needed
#
# Usage: ./sshift-install.ps1 [OPTIONS]
#   -installDir DIR   Installation directory (default: ~/.local/share/sshift)
#   -port PORT        Server port (default: 8022)
#   -start            Start sshift after installation/update
#   -stop             Stop running sshift instance
#   -restart          Restart sshift
#   -status           Check if sshift is running
#   -update           Update existing installation (non-interactive)
#   -uninstall        Remove sshift from the system
#   -help             Show this help message

param(
    [string]$installDir = "",
    [string]$port = "",
    [switch]$start,
    [switch]$stop,
    [switch]$restart,
    [switch]$status,
    [switch]$uninstall,
    [switch]$update,
    [switch]$help
)

# Configuration (defaults, can be overridden by arguments)
$NodeVersion = "20"
$NpmPackage = "@lethevimlet/sshift"
if ($installDir -eq "") {
    $installDir = "$env:USERPROFILE\.local\share\sshift"
}
$BinDir = Split-Path $installDir -Parent
$BinDir = Join-Path $BinDir "bin"
$PidFile = Join-Path $installDir ".sshift.pid"
$ServiceName = "sshift"
$ServerPort = $port

# Show help message
function Show-Help {
    Write-Host "sshift Installation Script for Windows"
    Write-Host ""
    Write-Host "Usage: ./sshift-install.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -installDir DIR   Installation directory (default: ~/.local/share/sshift)"
    Write-Host "  -port PORT        Server port (default: 8022)"
    Write-Host "  -start            Start sshift after installation/update"
    Write-Host "  -stop             Stop running sshift instance"
    Write-Host "  -restart          Restart sshift"
    Write-Host "  -status           Check if sshift is running"
    Write-Host "  -update           Update existing installation (non-interactive)"
    Write-Host "  -uninstall        Remove sshift from the system"
    Write-Host "  -help             Show this help message"
    Write-Host ""
    Write-Host "IMPORTANT: Run PowerShell as Administrator before executing this script."
    Write-Host "           This is required for npm global installations."
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  ./sshift-install.ps1                              # Install with defaults"
    Write-Host "  ./sshift-install.ps1 -port 8080                   # Install with custom port"
    Write-Host "  ./sshift-install.ps1 -installDir C:\sshift        # Install to custom directory"
    Write-Host "  ./sshift-install.ps1 -update                      # Update existing installation"
    Write-Host "  ./sshift-install.ps1 -start                      # Start sshift"
    Write-Host "  ./sshift-install.ps1 -stop                       # Stop sshift"
    Write-Host "  ./sshift-install.ps1 -restart                    # Restart sshift"
    Write-Host "  ./sshift-install.ps1 -status                     # Check status"
    Write-Host "  ./sshift-install.ps1 -uninstall                  # Remove sshift"
    Write-Host ""
    Write-Host "One-liner installation:"
    Write-Host "  Invoke-Expression (Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.ps1' -UseBasicParsing).Content"
    exit 0
}

if ($help) {
    Show-Help
}

# Check if running in PowerShell (not just double-clicked)
if ($Host.Name -eq "ConsoleHost") {
    # Running in console, good
} else {
    Write-Host ""
    Write-Host "Note: This script is designed to run in PowerShell console." -ForegroundColor Yellow
    Write-Host "If you double-clicked the .ps1 file, you may need to:" -ForegroundColor Yellow
    Write-Host "  1. Right-click the file -> 'Run with PowerShell'" -ForegroundColor Cyan
    Write-Host "  2. Or open PowerShell and run: .\sshift-install.ps1" -ForegroundColor Cyan
    Write-Host ""
}

# Colors for output
function Write-Info { Write-Host "[INFO] " -ForegroundColor Blue -NoNewline; Write-Host $args }
function Write-Success { Write-Host "[SUCCESS] " -ForegroundColor Green -NoNewline; Write-Host $args }
function Write-Warning { Write-Host "[WARNING] " -ForegroundColor Yellow -NoNewline; Write-Host $args }
function Write-Error { 
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline; 
    Write-Host $args
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1 
}

# Check if command exists
function Command-Exists {
    param($Command)
    return [bool](Get-Command -Name $Command -ErrorAction SilentlyContinue)
}

# Get installed version from npm
function Get-InstalledVersion {
    if (Command-Exists "sshift") {
        try {
            $result = npm list -g @lethevimlet/sshift --depth=0 --json 2>$null | ConvertFrom-Json
            if ($result.dependencies -and $result.dependencies.'@lethevimlet/sshift') {
                return $result.dependencies.'@lethevimlet/sshift'.version
            }
        } catch {
            try {
                $result = npm list -g @lethevimlet/sshift --depth=0 2>$null
                if ($result -match "@lethevimlet/sshift@(\d+\.\d+\.\d+)") {
                    return $matches[1]
                }
            } catch {
                # Ignore errors
            }
        }
    }
    return "0.0.0"
}

# Get latest version from npm
function Get-LatestVersion {
    try {
        $result = npm view @lethevimlet/sshift version 2>$null
        if ($result) {
            return $result.Trim()
        }
    } catch {
        # Ignore errors
    }
    return "0.0.0"
}

# Compare versions (returns 0 if equal, 1 if local < remote, 2 if local > remote)
function Compare-Versions {
    param($LocalVersion, $RemoteVersion)
    
    if ($LocalVersion -eq $RemoteVersion) {
        return 0
    }
    
    $localParts = $LocalVersion -split '\.'
    $remoteParts = $RemoteVersion -split '\.'
    
    for ($i = 0; $i -lt 3; $i++) {
        $local = [int]($localParts[$i] -as [int])
        $remote = [int]($remoteParts[$i] -as [int])
        
        if ($local -lt $remote) {
            return 1
        } elseif ($local -gt $remote) {
            return 2
        }
    }
    
    return 0
}

# Check if sshift is running
function Test-IsRunning {
    # Check PID file (direct start instances)
    if (Test-Path $PidFile) {
        try {
            $pid = Get-Content $PidFile -ErrorAction SilentlyContinue
            $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($process) {
                return $true
            }
        } catch {
            # Process not running
        }
        # Clean up stale PID file
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }

    # Check for running sshift node processes (handles autostart / Task Scheduler which uses no PID file)
    $nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
    foreach ($nodeProc in $nodeProcesses) {
        try {
            $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($nodeProc.Id)" -ErrorAction SilentlyContinue).CommandLine
            if ($cmdLine -and $cmdLine -match "sshift") {
                return $true
            }
        } catch {
            # Ignore errors accessing process info
        }
    }

    return $false
}

# Wait for a process to fully terminate and release file handles
function Wait-ProcessTerminated {
    param(
        [int]$ProcessId,
        [int]$TimeoutSeconds = 15
    )
    
    $startTime = Get-Date
    while (((Get-Date) - $startTime).TotalSeconds -lt $TimeoutSeconds) {
        $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if (-not $process) {
            Write-Info "Process $ProcessId has terminated"
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    
    # Process still running after timeout
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) {
        Write-Warning "Process $ProcessId did not terminate within $TimeoutSeconds seconds"
        return $false
    }
    return $true
}

# Kill all node processes running sshift (handles orphaned processes)
function Stop-AllSshiftProcesses {
    $sshiftScript = $null
    $npmPrefix = npm config get prefix 2>$null
    if ($npmPrefix) {
        $candidateScripts = @(
            (Join-Path $npmPrefix "node_modules\@lethevimlet\sshift\sshift"),
            (Join-Path $npmPrefix "node_modules\@lethevimlet\sshift\src\server\index.js")
        )
        foreach ($candidate in $candidateScripts) {
            if (Test-Path $candidate) {
                $sshiftScript = $candidate
                break
            }
        }
    }
    
    if (-not $sshiftScript) {
        $sshiftCmd = (Get-Command -Name "sshift" -ErrorAction SilentlyContinue).Source
        if ($sshiftCmd) {
            $shimDir = Split-Path $sshiftCmd -Parent
            $pkgDir = Join-Path $shimDir "node_modules\@lethevimlet\sshift"
            if (Test-Path (Join-Path $pkgDir "sshift")) {
                $sshiftScript = Join-Path $pkgDir "sshift"
            } elseif (Test-Path (Join-Path $pkgDir "src\server\index.js")) {
                $sshiftScript = Join-Path $pkgDir "src\server\index.js"
            }
        }
    }
    
    # Find node processes that are running the sshift script
    $killedAny = $false
    $nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
    foreach ($nodeProc in $nodeProcesses) {
        try {
            $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($nodeProc.Id)" -ErrorAction SilentlyContinue).CommandLine
            if ($cmdLine -and $cmdLine -match "sshift") {
                Write-Info "Stopping sshift node process (PID: $($nodeProc.Id))..."
                Stop-Process -Id $nodeProc.Id -Force -ErrorAction SilentlyContinue
                $killedAny = $true
            }
        } catch {
            # Ignore errors accessing process info
        }
    }
    
    if ($killedAny) {
        Start-Sleep -Seconds 2
    }
    
    return $killedAny
}

# Stop running instance
function Stop-App {
    # Check if running via Task Scheduler
    $task = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq "Running") {
        Write-Info "Stopping sshift via Task Scheduler..."
        Stop-ScheduledTask -TaskName $ServiceName
        Start-Sleep -Seconds 3
        
        # Verify task stopped
        $task = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
        if ($task -and $task.State -eq "Running") {
            Write-Warning "Task Scheduler task did not stop, will force kill process..."
        }
    }
    
    # Stop via PID file
    if (Test-IsRunning) {
        $pid = Get-Content $PidFile
        Write-Info "Stopping sshift (PID: $pid)..."
        
        try {
            # Try graceful stop first
            Stop-Process -Id $pid -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
            
            # Check if still running
            $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($process) {
                Write-Warning "Process did not stop gracefully, force killing..."
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
            }
            
            # Wait for process to fully terminate and release file handles
            $terminated = Wait-ProcessTerminated -ProcessId $pid -TimeoutSeconds 10
            
            if (-not $terminated) {
                Write-Warning "Attempting to kill any remaining sshift node processes..."
                Stop-AllSshiftProcesses
                Start-Sleep -Seconds 3
            }
            
            Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
            Write-Success "sshift stopped"
        } catch {
            Write-Error "Failed to stop sshift"
        }
    } else {
        # Check for orphaned processes (no PID file but process may still be running)
        $orphaned = Stop-AllSshiftProcesses
        if (-not $orphaned) {
            if (Test-Path $PidFile) {
                Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
                Write-Info "Removed stale PID file"
            }
        }
    }
}

# Start the app
function Start-App {
    Write-Info "Starting sshift..."
    
    # Check if already running
    if (Test-IsRunning) {
        $pid = Get-Content $PidFile
        Write-Warning "sshift is already running (PID: $pid)"
        return
    }
    
    # Find node executable
    $nodeExe = (Get-Command -Name "node" -ErrorAction SilentlyContinue).Source
    if (-not $nodeExe) {
        Write-Error "Could not find node executable."
        return
    }
    
    # npm creates .cmd and .ps1 shims on Windows that can't be run directly by Start-Process
    # Always resolve the actual entry point in node_modules
    $sshiftScript = $null
    $npmPrefix = npm config get prefix 2>$null
    if ($npmPrefix) {
        $candidateScripts = @(
            (Join-Path $npmPrefix "node_modules\@lethevimlet\sshift\sshift"),
            (Join-Path $npmPrefix "node_modules\@lethevimlet\sshift\src\server\index.js")
        )
        foreach ($candidate in $candidateScripts) {
            if (Test-Path $candidate) {
                $sshiftScript = $candidate
                break
            }
        }
    }
    
    if (-not $sshiftScript) {
        # Fallback: try to resolve from the sshift command location
        $sshiftCmd = (Get-Command -Name "sshift" -ErrorAction SilentlyContinue).Source
        if ($sshiftCmd) {
            # Walk up from shim to find the package directory
            $shimDir = Split-Path $sshiftCmd -Parent
            $pkgDir = Join-Path $shimDir "node_modules\@lethevimlet\sshift"
            if (Test-Path (Join-Path $pkgDir "sshift")) {
                $sshiftScript = Join-Path $pkgDir "sshift"
            } elseif (Test-Path (Join-Path $pkgDir "src\server\index.js")) {
                $sshiftScript = Join-Path $pkgDir "src\server\index.js"
            }
        }
    }
    
    if (-not $sshiftScript) {
        Write-Error "Could not resolve sshift script path. Make sure sshift is installed."
        return
    }
    
    # Ensure config directory exists
    $envDir = Join-Path $installDir ".env"
    if (-not (Test-Path $envDir)) {
        New-Item -ItemType Directory -Force -Path $envDir | Out-Null
    }
    
    # Start sshift in background using node directly
    try {
        $process = Start-Process -FilePath $nodeExe -ArgumentList "`"$sshiftScript`"" -WorkingDirectory $installDir -WindowStyle Hidden -PassThru
        
        # Save PID
        New-Item -ItemType Directory -Force -Path (Split-Path $PidFile -Parent) | Out-Null
        $process.Id | Out-File -FilePath $PidFile -Encoding ASCII
        
        Start-Sleep -Seconds 4
        
        # Check if process is still running
        $running = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
        if ($running) {
            $effectivePort = Get-EffectivePort
            Write-Success "sshift started (PID: $($process.Id))"
            Write-Info "Access: https://localhost:$effectivePort"
        } else {
            # Process crashed - try to provide useful diagnostics
            Write-Error "sshift failed to start."
            Write-Host ""
            Write-Host "Diagnostic information:" -ForegroundColor Yellow
            Write-Host "  Node path: $nodeExe" -ForegroundColor Yellow
            Write-Host "  Script path: $sshiftScript" -ForegroundColor Yellow
            Write-Host "  Working dir: $installDir" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "Try running manually to see the error:" -ForegroundColor Cyan
            Write-Host "  node `"$sshiftScript`"" -ForegroundColor Cyan
        }
    } catch {
        Write-Error "Failed to start sshift: $_"
    }
}

# Install Node.js if not present
function Install-NodeJS {
    if (Command-Exists "node") {
        $installedNodeVersion = (node -v) -replace 'v', ''
        $majorVersion = $installedNodeVersion.Split('.')[0]
        
        if ([int]$majorVersion -ge [int]$NodeVersion) {
            Write-Success "Node.js $(node -v) is already installed"
            return
        } else {
            Write-Warning "Node.js version $(node -v) is too old, upgrading..."
        }
    }
    
    Write-Info "Installing Node.js $NodeVersion..."
    
    # Use Chocolatey if available
    if (Command-Exists "choco") {
        choco install nodejs-lts -y
    } else {
        Write-Host ""
        Write-Host "[ERROR] Chocolatey is not installed." -ForegroundColor Red
        Write-Host ""
        Write-Host "To install Node.js on Windows, you have several options:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Option 1: Install Chocolatey (recommended)" -ForegroundColor Cyan
        Write-Host "  Visit: https://chocolatey.org/install"
        Write-Host "  Then run this script again"
        Write-Host ""
        Write-Host "Option 2: Install Node.js directly" -ForegroundColor Cyan
        Write-Host "  Visit: https://nodejs.org/"
        Write-Host "  Download and install Node.js LTS version"
        Write-Host "  Then run this script again"
        Write-Host ""
        Write-Host "Option 3: Use nvm-windows" -ForegroundColor Cyan
        Write-Host "  Visit: https://github.com/coreybutler/nvm-windows"
        Write-Host "  Install nvm-windows, then: nvm install lts"
        Write-Host ""
        Write-Host "Press any key to exit..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 1
    }
    
    # Verify installation
    if (Command-Exists "node") {
        Write-Success "Node.js $(node -v) installed successfully"
    } else {
        Write-Error "Failed to install Node.js"
    }
}

# Install sshift via npm
function Install-Sshift {
    Write-Info "Installing sshift via npm..."
    
    # Install globally (may require admin privileges on Windows)
    npm install -g @lethevimlet/sshift
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "sshift installed successfully"
        $script:installSucceeded = $true
    } else {
        Write-Host ""
        Write-Host "[ERROR] Failed to install sshift" -ForegroundColor Red
        Write-Host ""
        Write-Host "Common solutions:" -ForegroundColor Yellow
        Write-Host "  1. Run PowerShell as Administrator and try again" -ForegroundColor Cyan
        Write-Host "  2. Check your internet connection" -ForegroundColor Cyan
        Write-Host "  3. Try: npm cache clean --force" -ForegroundColor Cyan
        Write-Host "  4. Check npm logs for details" -ForegroundColor Cyan
        Write-Host ""
        $script:installSucceeded = $false
    }
}

# Update sshift
function Update-Sshift {
    Write-Info "Updating sshift..."
    
    # Stop running instance before updating
    $script:updateSucceeded = $false
    $wasRunning = $false
    if (Test-IsRunning) {
        $wasRunning = $true
        Stop-App
    } else {
        # Check for orphaned sshift node processes
        Stop-AllSshiftProcesses
    }
    
    # Give extra time for file handles to be released after stopping
    Write-Info "Waiting for file handles to be released..."
    Start-Sleep -Seconds 3
    
    # Update via npm (may require admin privileges on Windows)
    npm update -g @lethevimlet/sshift
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "sshift updated successfully"
        $script:updateSucceeded = $true
    } else {
        Write-Host ""
        Write-Host "[ERROR] Failed to update sshift" -ForegroundColor Red
        Write-Host ""
        Write-Host "Common solutions:" -ForegroundColor Yellow
        Write-Host "  1. Run PowerShell as Administrator and try again" -ForegroundColor Cyan
        Write-Host "  2. Check your internet connection" -ForegroundColor Cyan
        Write-Host "  3. Try: npm cache clean --force" -ForegroundColor Cyan
        Write-Host "  4. Check npm logs for details" -ForegroundColor Cyan
        Write-Host "  5. If sshift was running, stop it first: ./sshift-install.ps1 -stop" -ForegroundColor Cyan
        Write-Host ""
        $script:updateSucceeded = $false
    }
}

# Create config file with port setting
function New-Config {
    Write-Info "Creating configuration..."
    
    # Create .env directory if it doesn't exist
    $envDir = Join-Path $installDir ".env"
    New-Item -ItemType Directory -Force -Path $envDir | Out-Null
    
    # Create config.json with HTTPS enabled
    $configFile = Join-Path $envDir "config.json"
    $port = if ($ServerPort -ne "") { $ServerPort } else { "8022" }
    
    # Merge default values into existing config:
    # - Preserves user's existing values
    # - Adds new default properties from newer versions
    # - If -port was explicitly set, overrides the port value
    $defaults = @{
        port = [int]$port
        devPort = 3000
        bind = "0.0.0.0"
        enableHttps = $true
        sticky = $true
        sshKeepaliveInterval = 15000
        sshKeepaliveCountMax = 500
        bookmarks = @()
        folders = @()
    }
    
    $wasNew = $true
    if (Test-Path $configFile) {
        try {
            $existing = Get-Content $configFile -Raw | ConvertFrom-Json
            $wasNew = $false
        } catch {
            Write-Warning "Could not parse existing config, using defaults"
            $existing = [PSCustomObject]@{}
        }
    } else {
        $existing = [PSCustomObject]@{}
    }
    
    # Build merged config: start with defaults, overlay existing values
    $merged = [PSCustomObject]@{}
    foreach ($key in $defaults.Keys) {
        $merged | Add-Member -NotePropertyName $key -NotePropertyValue $defaults[$key] -Force
    }
    foreach ($prop in $existing.PSObject.Properties) {
        $merged | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value -Force
    }
    
    # If -port was explicitly set, override the port value
    if ($ServerPort -ne "") {
        $merged.port = [int]$ServerPort
    }
    
    # Write merged config
    $merged | ConvertTo-Json -Depth 10 | Set-Content -Path $configFile -Encoding ASCII
    
    if ($wasNew) {
        Write-Info "Configuration created at $configFile"
    } else {
        Write-Info "Existing configuration merged with defaults at $configFile"
    }
    
    $effectivePort = $merged.port
    Write-Success "Configuration created with HTTPS enabled on port $effectivePort"
}

# Add to PATH
function Add-ToPath {
    # Check if sshift command is already accessible
    $sshiftPath = (Get-Command -Name "sshift" -ErrorAction SilentlyContinue).Source
    
    if ($sshiftPath) {
        Write-Success "sshift command available at $sshiftPath"
        
        # Check if its directory is in user PATH
        $sshiftDir = Split-Path $sshiftPath -Parent
        $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($userPath -like "*$sshiftDir*") {
            return
        }
        
        # Add to user PATH if not already there
        $newPath = "$sshiftDir;$userPath"
        [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
        Write-Success "Added $sshiftDir to PATH"
        Write-Info "Restart your terminal for PATH changes to take effect"
        return
    }
    
    # sshift not found - add npm global bin directory to PATH
    $npmPrefix = npm config get prefix 2>$null
    if ($npmPrefix) {
        $npmBinDir = Join-Path $npmPrefix ""
        $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        
        if ($userPath -notlike "*$npmBinDir*") {
            $newPath = "$npmBinDir;$userPath"
            [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
            Write-Success "Added $npmBinDir to PATH"
            Write-Info "Restart your terminal for PATH changes to take effect"
        }
    } else {
        Write-Warning "Could not determine sshift binary location. You may need to add it to PATH manually."
    }
}

# Setup autostart via Task Scheduler
function Enable-Autostart {
    Write-Info "Setting up autostart (on boot) via Task Scheduler..."
    
    # Find node executable
    $nodeExe = (Get-Command -Name "node" -ErrorAction SilentlyContinue).Source
    if (-not $nodeExe) {
        Write-Error "Could not find node executable."
        return
    }
    
    # Resolve the actual entry point (npm shims can't be used directly in Task Scheduler)
    $sshiftScript = $null
    $npmPrefix = npm config get prefix 2>$null
    if ($npmPrefix) {
        $candidateScripts = @(
            (Join-Path $npmPrefix "node_modules\@lethevimlet\sshift\sshift"),
            (Join-Path $npmPrefix "node_modules\@lethevimlet\sshift\src\server\index.js")
        )
        foreach ($candidate in $candidateScripts) {
            if (Test-Path $candidate) {
                $sshiftScript = $candidate
                break
            }
        }
    }
    
    if (-not $sshiftScript) {
        $sshiftCmd = (Get-Command -Name "sshift" -ErrorAction SilentlyContinue).Source
        if ($sshiftCmd) {
            $shimDir = Split-Path $sshiftCmd -Parent
            $pkgDir = Join-Path $shimDir "node_modules\@lethevimlet\sshift"
            if (Test-Path (Join-Path $pkgDir "sshift")) {
                $sshiftScript = Join-Path $pkgDir "sshift"
            } elseif (Test-Path (Join-Path $pkgDir "src\server\index.js")) {
                $sshiftScript = Join-Path $pkgDir "src\server\index.js"
            }
        }
    }
    
    if (-not $sshiftScript) {
        Write-Error "Could not resolve sshift script path."
        return
    }
    
    # Ensure config directory exists
    $envDir = Join-Path $installDir ".env"
    if (-not (Test-Path $envDir)) {
        New-Item -ItemType Directory -Force -Path $envDir | Out-Null
    }
    
    # Create a VBS wrapper script to run sshift without a visible window.
    # Task Scheduler running node.exe directly shows a console window; wscript
    # with Run(...,0) launches it completely hidden.
    $vbsPath = Join-Path $installDir "sshift-launcher.vbs"
    $vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$installDir"
WshShell.Run """$nodeExe"" ""$sshiftScript""", 0, False
"@
    Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII
    
    # Create task action using wscript to run the VBS launcher (no console window)
    $wscriptExe = Join-Path $env:SystemRoot "System32\wscript.exe"
    $action = New-ScheduledTaskAction -Execute $wscriptExe -Argument "//B `"$vbsPath`"" -WorkingDirectory $installDir
    
    # Create task trigger (at startup)
    $trigger = New-ScheduledTaskTrigger -AtStartup
    
    # Create task settings
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    
    # Register the task
    Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
    
    Write-Success "Autostart configured via Task Scheduler"
}

# Remove autostart
function Remove-Autostart {
    # Unregister scheduled task
    Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false -ErrorAction SilentlyContinue
    
    # Remove VBS launcher script
    $vbsPath = Join-Path $installDir "sshift-launcher.vbs"
    if (Test-Path $vbsPath) {
        Remove-Item -Path $vbsPath -Force -ErrorAction SilentlyContinue
    }
}

# Get LAN IP address
function Get-LANIP {
    try {
        $ip = (Get-NetIPConfiguration | Where-Object {
            $_.IPv4DefaultGateway -ne $null -and
            $_.NetAdapter.Status -eq "Up"
        } | Select-Object -First 1).IPv4Address.IPAddress
        
        if (-not $ip) {
            $ip = (Test-Connection -ComputerName (hostname) -Count 1 -ErrorAction SilentlyContinue).IPV4Address.IPAddressToString
        }
        
        if (-not $ip) {
            $ip = "0.0.0.0"
        }
    } catch {
        $ip = "0.0.0.0"
    }
    return $ip
}

# Get effective port from config or default
function Get-EffectivePort {
    $port = if ($ServerPort -ne "") { $ServerPort } else { "8022" }
    if ($ServerPort -eq "") {
        $configFile = Join-Path $installDir ".env\config.json"
        if (Test-Path $configFile) {
            try {
                $config = Get-Content $configFile -Raw | ConvertFrom-Json
                if ($config.port) {
                    $port = $config.port
                }
            } catch {
                # Use default
            }
        }
    }
    return $port
}

# Print installation summary
function Show-Summary {
    $effectivePort = Get-EffectivePort
    $lanIP = Get-LANIP

    $url1 = "https://localhost:$effectivePort"
    $url2 = "https://${lanIP}:$effectivePort"
    $dataDir = $installDir

    $content = @(
        " sshift installed (Task Scheduler)",
        "",
        " Path: $dataDir",
        "",
        " URLs:",
        "   $url1",
        "   $url2"
    )

    $maxW = 0
    foreach ($line in $content) {
        if ($line.Length -gt $maxW) { $maxW = $line.Length }
    }
    $maxW += 2

    $border = [string]::new('-', $maxW)

    Write-Host ""
    Write-Host "  +$border+" -ForegroundColor Green
    foreach ($line in $content) {
        $padded = $line.PadRight($maxW)
        Write-Host "  |" -ForegroundColor Green -NoNewline
        Write-Host "$padded" -NoNewline
        Write-Host "|" -ForegroundColor Green
    }
    Write-Host "  +$border+" -ForegroundColor Green
    Write-Host ""
}

# Uninstall sshift
function Uninstall-Sshift {
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "       sshift Uninstallation Script"
    Write-Host "=========================================="
    Write-Host ""
    
    # Check if installed
    if (-not (Command-Exists "sshift")) {
        Write-Warning "sshift is not installed"
        return
    }
    
    Write-Info "This will remove:"
    Write-Host "  - sshift npm package"
    Write-Host "  - Configuration files in $installDir"
    Write-Host "  - Autostart configuration (if any)"
    Write-Host "  - PATH configuration"
    Write-Host ""
    
    $confirm = Read-Host "Continue with uninstallation? [y/N]"
    if ($confirm -notmatch "^[Yy]$") {
        Write-Info "Uninstallation cancelled"
        return
    }
    
    Write-Host ""
    
    # Stop running instance
    if (Test-IsRunning) {
        Write-Info "Stopping running instance..."
        Stop-App
    } else {
        # Check for orphaned sshift node processes
        Stop-AllSshiftProcesses
    }
    
    # Give extra time for file handles to be released
    Write-Info "Waiting for file handles to be released..."
    Start-Sleep -Seconds 3
    
    # Remove autostart
    Write-Info "Removing autostart configuration..."
    Remove-Autostart
    
    # Uninstall via npm
    Write-Info "Uninstalling sshift..."
    npm uninstall -g @lethevimlet/sshift
    
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "npm uninstall failed. If you see permission errors, try running PowerShell as Administrator"
        
        # Retry once after a longer wait if it failed (file may still be locked)
        Write-Info "Retrying uninstall after waiting for file handles to be released..."
        Start-Sleep -Seconds 5
        npm uninstall -g @lethevimlet/sshift
        
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Uninstall still failed. You may need to close any applications using sshift and try again"
        } else {
            Write-Success "sshift uninstalled successfully on retry"
        }
    }
    
    # Remove installation directory
    if (Test-Path $installDir) {
        Write-Info "Removing configuration directory..."
        Remove-Item -Path $installDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Success "Configuration directory removed"
    }
    
    # Remove from PATH
    Write-Info "Removing PATH configuration..."
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    $newPath = ($userPath -split ';' | Where-Object { $_ -ne $BinDir }) -join ';'
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "sshift uninstalled successfully!" -ForegroundColor Green
    Write-Host "=========================================="
    Write-Host ""
    Write-Info "You may need to restart your terminal for PATH changes to take effect"
}

# Check for updates
function Test-Updates {
    Write-Info "Checking for updates..."
    
    $localVersion = Get-InstalledVersion
    $remoteVersion = Get-LatestVersion
    
    Write-Info "Installed version: $localVersion"
    Write-Info "Latest version: $remoteVersion"
    
    $result = Compare-Versions -LocalVersion $localVersion -RemoteVersion $remoteVersion
    
    if ($result -eq 1) {
        Write-Warning "New version available: $remoteVersion (current: $localVersion)"
        return $false
    } elseif ($result -eq 2) {
        Write-Info "Local version is newer than remote (development version?)"
        return $true
    } else {
        Write-Success "Already up to date (version $localVersion)"
        return $true
    }
}

# Main installation process
function Main {
    # Check if running as Administrator
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host ""
        Write-Host "=========================================="
        Write-Host "       sshift Installation Script"
        Write-Host "=========================================="
        Write-Host ""
        Write-Host "[ERROR] This script requires Administrator privileges." -ForegroundColor Red
        Write-Host ""
        Write-Host "Please run PowerShell as Administrator and try again:" -ForegroundColor Yellow
        Write-Host "  1. Right-click PowerShell -> 'Run as Administrator'" -ForegroundColor Cyan
        Write-Host "  2. Run the installation command again" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Press any key to exit..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 1
    }
    
    # Handle uninstall
    if ($uninstall) {
        Uninstall-Sshift
        Write-Host ""
        Write-Host "Press any key to exit..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 0
    }
    
    # Handle status check
    if ($status) {
        if (Test-IsRunning) {
            $pid = Get-Content $PidFile
            Write-Success "sshift is running (PID: $pid)"
        } else {
            Write-Info "sshift is not running"
        }
        Write-Host ""
        Write-Host "Press any key to exit..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 0
    }
    
    # Handle stop
    if ($stop) {
        Stop-App
        Write-Host ""
        Write-Host "Press any key to exit..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 0
    }
    
    # Handle restart
    if ($restart) {
        Write-Info "Restarting sshift..."
        Stop-App
        Start-App
        Write-Host ""
        Write-Host "Press any key to exit..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 0
    }
    
    # Handle start
    if ($start) {
        Start-App
        Write-Host ""
        Write-Host "Press any key to exit..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 0
    }
    
    # Handle update-only mode
    if ($update) {
        # Check if installed
        if (-not (Command-Exists "sshift")) {
            Write-Error "sshift is not installed"
        }
        
        Write-Host ""
        Write-Host "=========================================="
        Write-Host "       sshift Update Script"
        Write-Host "=========================================="
        Write-Host ""
        
        Update-Sshift
        
        # Restart the app if .restart-after-update marker exists (triggered from UI)
        # Always check markers regardless of update result to ensure cleanup
        $restartMarker = Join-Path $installDir ".restart-after-update"
        $updateMarker = Join-Path $installDir ".updating"
        if (Test-Path $restartMarker) {
            Remove-Item -Force $restartMarker -ErrorAction SilentlyContinue
            Remove-Item -Force $updateMarker -ErrorAction SilentlyContinue
            if ($script:updateSucceeded) {
                Write-Info "Restarting sshift..."
            } else {
                Write-Warning "Update failed, restarting with previous version..."
            }
            Start-App
        } elseif (Test-Path $updateMarker) {
            Remove-Item -Force $updateMarker -ErrorAction SilentlyContinue
        }
        
        Show-Summary
        
        Write-Host ""
        Write-Host "Press any key to exit..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 0
    }
    
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "       sshift Installation Script"
    Write-Host "=========================================="
    Write-Host ""
    
    # Show configuration
    Write-Info "Installation method: npm"
    if ($ServerPort -ne "") {
        Write-Info "Server port: $ServerPort"
    }
    
    # Check if already installed
    if (Command-Exists "sshift") {
        Write-Info "sshift is already installed"
        
        # Check for updates
        $upToDate = Test-Updates
        if ($upToDate) {
            # No update needed
            if (Test-IsRunning) {
                $pid = Get-Content $PidFile
                Write-Info "sshift is already running (PID: $pid)"
            }
        } else {
            # Update available
            $confirm = Read-Host "Update sshift? [Y/n]"
            if ($confirm -notmatch "^[Nn]$") {
                Update-Sshift
            }
        }
    } else {
        # Fresh installation
        # Install Node.js if needed
        Install-NodeJS
        
        # Install sshift via npm
        Install-Sshift
        
        # Create config file with port (if specified)
        New-Config
    }
    
    # Always ask about PATH and autostart (even if already installed)
    Write-Host ""
    Write-Info "Configuration options:"
    Write-Host ""
    
    # Add to PATH
    $addToPath = Read-Host "Add sshift to PATH? [Y/n]"
    if ($addToPath -notmatch "^[Nn]$") {
        Add-ToPath
    }
    
    # Ask about autostart
    $enableAutostart = Read-Host "Start sshift automatically on boot? [y/N]"
    if ($enableAutostart -match "^[Yy]$") {
        Enable-Autostart
    }
    
    # Start sshift if not already running
    if (-not (Test-IsRunning)) {
        Start-App
    }
    
    # Print summary
    Show-Summary
    
    # Pause before exit
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

# Run main function
try {
    Main
} catch {
    Write-Host ""
    Write-Host "[ERROR] An unexpected error occurred:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}