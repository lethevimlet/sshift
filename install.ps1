# sshift Installation Script for Windows
# Installs Node.js (if not present) and installs sshift via npm
# Checks for updates and restarts the app if needed
#
# Usage: ./install.ps1 [OPTIONS]
#   -InstallDir DIR   Installation directory (default: ~/.local/share/sshift)
#   -Port PORT        Server port (default: 8022)
#   -Start            Start sshift after installation/update
#   -Stop             Stop running sshift instance
#   -Restart          Restart sshift
#   -Status           Check if sshift is running
#   -Update           Update existing installation (non-interactive)
#   -Uninstall        Remove sshift from the system
#   -Help             Show this help message

param(
    [string]$InstallDir = "",
    [string]$Port = "",
    [switch]$Start,
    [switch]$Stop,
    [switch]$Restart,
    [switch]$Status,
    [switch]$Uninstall,
    [switch]$Update,
    [switch]$Help
)

# Configuration (defaults, can be overridden by arguments)
$NodeVersion = "20"  # Minimum LTS version
$NpmPackage = "@lethevimlet/sshift"
if ($InstallDir -eq "") {
    $InstallDir = "$env:USERPROFILE\.local\share\sshift"
}
$BinDir = Split-Path $InstallDir -Parent
$BinDir = Join-Path $BinDir "bin"
$PidFile = "$env:TEMP\sshift.pid"
$ServiceName = "sshift"
$ServerPort = $Port

# Show help message
function Show-Help {
    Write-Host "sshift Installation Script for Windows"
    Write-Host ""
    Write-Host "Usage: ./install.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -InstallDir DIR   Installation directory (default: ~/.local/share/sshift)"
    Write-Host "  -Port PORT        Server port (default: 8022)"
    Write-Host "  -Start            Start sshift after installation/update"
    Write-Host "  -Stop             Stop running sshift instance"
    Write-Host "  -Restart          Restart sshift"
    Write-Host "  -Status           Check if sshift is running"
    Write-Host "  -Update           Update existing installation (non-interactive)"
    Write-Host "  -Uninstall        Remove sshift from the system"
    Write-Host "  -Help             Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  ./install.ps1                              # Install with defaults"
    Write-Host "  ./install.ps1 -Port 8080                   # Install with custom port"
    Write-Host "  ./install.ps1 -InstallDir C:\sshift        # Install to custom directory"
    Write-Host "  ./install.ps1 -Update                      # Update existing installation"
    Write-Host "  ./install.ps1 -Start                      # Start sshift"
    Write-Host "  ./install.ps1 -Stop                       # Stop sshift"
    Write-Host "  ./install.ps1 -Restart                    # Restart sshift"
    Write-Host "  ./install.ps1 -Status                    # Check status"
    Write-Host "  ./install.ps1 -Uninstall                  # Remove sshift"
    Write-Host ""
    Write-Host "One-liner installation:"
    Write-Host "  Invoke-Expression (Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/lethevimlet/sshift/main/install.ps1' -UseBasicParsing).Content"
    exit 0
}

if ($Help) {
    Show-Help
}

# Colors for output
function Write-Info { Write-Host "[INFO] " -ForegroundColor Blue -NoNewline; Write-Host $args }
function Write-Success { Write-Host "[SUCCESS] " -ForegroundColor Green -NoNewline; Write-Host $args }
function Write-Warning { Write-Host "[WARNING] " -ForegroundColor Yellow -NoNewline; Write-Host $args }
function Write-Error { Write-Host "[ERROR] " -ForegroundColor Red -NoNewline; Write-Host $args; exit 1 }

# Check if command exists
function Command-Exists {
    param($Command)
    return [bool](Get-Command -Name $Command -ErrorAction SilentlyContinue)
}

# Get installed version from npm
function Get-InstalledVersion {
    if (Command-Exists "sshift") {
        try {
            $result = npm list -g @lethevimlet/sshift --depth=0 2>$null
            if ($result -match "sshift@(\d+\.\d+\.\d+)") {
                return $matches[1]
            }
        } catch {
            # Ignore errors
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
            return 1  # local < remote
        } elseif ($local -gt $remote) {
            return 2  # local > remote
        }
    }
    
    return 0
}

# Check if sshift is running
function Test-IsRunning {
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
    return $false
}

# Stop running instance
function Stop-App {
    # Check if running via Task Scheduler
    $task = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq "Running") {
        Write-Info "Stopping sshift via Task Scheduler..."
        Stop-ScheduledTask -TaskName $ServiceName
        Start-Sleep -Seconds 2
        return
    }
    
    # Otherwise, stop via PID file
    if (Test-IsRunning) {
        $pid = Get-Content $PidFile
        Write-Info "Stopping sshift (PID: $pid)..."
        
        try {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            
            # Force kill if still running
            $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($process) {
                Write-Warning "Process did not stop gracefully, force killing..."
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 1
            }
            
            Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
            Write-Success "sshift stopped"
        } catch {
            Write-Error "Failed to stop sshift"
        }
    } else {
        # Clean up stale PID file if it exists
        if (Test-Path $PidFile) {
            Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
            Write-Info "Removed stale PID file"
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
    
    # Start sshift in background
    try {
        $process = Start-Process -FilePath "sshift" -WindowStyle Hidden -PassThru -RedirectStandardOutput "$InstallDir\sshift.log" -RedirectStandardError "$InstallDir\sshift-error.log"
        
        # Save PID
        New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir -Parent) | Out-Null
        $process.Id | Out-File -FilePath $PidFile -Encoding ASCII
        
        Start-Sleep -Seconds 2
        
        # Check if process is still running
        $running = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
        if ($running) {
            Write-Success "sshift started (PID: $($process.Id))"
            Write-Info "Logs: $InstallDir\sshift.log"
        } else {
            Write-Error "sshift failed to start. Check logs at $InstallDir\sshift-error.log"
        }
    } catch {
        Write-Error "Failed to start sshift: $_"
    }
}

# Install Node.js if not present
function Install-NodeJS {
    if (Command-Exists "node") {
        $nodeVersion = (node -v) -replace 'v', ''
        $majorVersion = $nodeVersion.Split('.')[0]
        
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
        Write-Error "Chocolatey is not installed. Please install Chocolatey first: https://chocolatey.org/"
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
    
    # Install globally
    npm install -g @lethevimlet/sshift
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "sshift installed successfully"
    } else {
        Write-Error "Failed to install sshift"
    }
}

# Update sshift
function Update-Sshift {
    Write-Info "Updating sshift..."
    
    # Stop running instance if any
    if (Test-IsRunning) {
        Stop-App
    }
    
    # Update via npm
    npm update -g @lethevimlet/sshift
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "sshift updated successfully"
    } else {
        Write-Error "Failed to update sshift"
    }
}

# Create config file with port setting
function New-Config {
    if ($ServerPort -ne "") {
        Write-Info "Creating configuration with port $ServerPort..."
        
        # Create .env directory if it doesn't exist
        $envDir = Join-Path $InstallDir ".env"
        New-Item -ItemType Directory -Force -Path $envDir | Out-Null
        
        # Create .env file with port
        $envFile = Join-Path $envDir ".env.local"
        @"
# sshift configuration
PORT=$ServerPort
"@ | Out-File -FilePath $envFile -Encoding ASCII
        
        Write-Success "Configuration created with port $ServerPort"
    }
}

# Add to PATH
function Add-ToPath {
    # Check if already in PATH
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -like "*$BinDir*") {
        Write-Info "$BinDir is already in PATH"
        return
    }
    
    # Add to user PATH
    $newPath = "$BinDir;$userPath"
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    
    Write-Success "Added $BinDir to PATH"
    Write-Info "You may need to restart your terminal for PATH changes to take effect"
}

# Setup autostart via Task Scheduler
function Enable-Autostart {
    Write-Info "Setting up autostart via Task Scheduler..."
    
    # Create task action
    $action = New-ScheduledTaskAction -Execute "sshift" -WorkingDirectory $InstallDir
    
    # Create task trigger (at logon)
    $trigger = New-ScheduledTaskTrigger -AtLogon
    
    # Create task settings
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    
    # Register the task
    Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
    
    Write-Success "Autostart configured via Task Scheduler"
    Write-Info "To start now: Start-ScheduledTask -TaskName $ServiceName"
}

# Remove autostart
function Remove-Autostart {
    # Unregister scheduled task
    Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false -ErrorAction SilentlyContinue
}

# Print installation summary
function Show-Summary {
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "sshift installed successfully!" -ForegroundColor Green
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "Version: $(Get-InstalledVersion)"
    Write-Host ""
    Write-Host "To start sshift, run:"
    Write-Host "    sshift"
    Write-Host ""
    Write-Host "You may need to restart your terminal for PATH changes to take effect"
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
    Write-Host "  - Configuration files in $InstallDir"
    Write-Host "  - Autostart configuration (if any)"
    Write-Host "  - PATH configuration"
    Write-Host ""
    
    $confirm = Read-Host "Continue with uninstallation? [y/N]"
    if ($confirm -notmatch "^[Yy]$") {
        Write-Info "Uninstallation cancelled"
        return
    }
    
    # Stop running instance
    if (Test-IsRunning) {
        Write-Info "Stopping running instance..."
        Stop-App
    }
    
    # Remove autostart
    Write-Info "Removing autostart configuration..."
    Remove-Autostart
    
    # Uninstall via npm
    Write-Info "Uninstalling sshift..."
    npm uninstall -g @lethevimlet/sshift
    
    # Remove installation directory
    if (Test-Path $InstallDir) {
        Write-Info "Removing configuration directory..."
        Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
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
        return $false  # Update available
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
    # Handle uninstall
    if ($Uninstall) {
        Uninstall-Sshift
        exit 0
    }
    
    # Handle status check
    if ($Status) {
        if (Test-IsRunning) {
            $pid = Get-Content $PidFile
            Write-Success "sshift is running (PID: $pid)"
            exit 0
        } else {
            Write-Info "sshift is not running"
            exit 1
        }
    }
    
    # Handle stop
    if ($Stop) {
        Stop-App
        exit 0
    }
    
    # Handle restart
    if ($Restart) {
        Write-Info "Restarting sshift..."
        Stop-App
        Start-App
        exit 0
    }
    
    # Handle start
    if ($Start) {
        Start-App
        exit 0
    }
    
    # Handle update-only mode
    if ($Update) {
        # Check if installed
        if (-not (Command-Exists "sshift")) {
            Write-Error "sshift is not installed"
        }
        
        Write-Host ""
        Write-Host "=========================================="
        Write-Host "       sshift Update Script"
        Write-Host "=========================================="
        Write-Host ""
        
        Write-Info "Updating sshift..."
        Update-Sshift
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
        
        # Print summary
        Show-Summary
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
    $enableAutostart = Read-Host "Start sshift automatically on login? [y/N]"
    if ($enableAutostart -match "^[Yy]$") {
        Enable-Autostart
    }
}

# Run main function
Main