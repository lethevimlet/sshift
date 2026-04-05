# sshift Installation Script for Windows
# Installs Node.js (if not present) and clones the project
# Checks for updates and restarts the app if needed
#
# Usage: ./install.ps1 [OPTIONS]
#   -InstallDir DIR   Installation directory (default: ~/.local/share/sshift)
#   -Port PORT        Server port (default: 8022)
#   -Uninstall        Remove sshift from the system
#   -Help             Show this help message

param(
    [string]$InstallDir = "",
    [string]$Port = "",
    [switch]$Uninstall,
    [switch]$Update,
    [switch]$Help
)

# Configuration (defaults, can be overridden by arguments)
$NodeVersion = "18"  # Minimum LTS version
$RepoUrl = "https://github.com/lethevimlet/sshift.git"
$RepoApiUrl = "https://api.github.com/repos/lethevimlet/sshift/contents/package.json"
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
    Write-Host "  -Update           Update existing installation (non-interactive)"
    Write-Host "  -Uninstall        Remove sshift from the system"
    Write-Host "  -Help             Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  ./install.ps1                              # Install with defaults"
    Write-Host "  ./install.ps1 -Port 8080                   # Install with custom port"
    Write-Host "  ./install.ps1 -InstallDir C:\sshift        # Install to custom directory"
    Write-Host "  ./install.ps1 -Update                      # Update existing installation"
    Write-Host "  ./install.ps1 -Uninstall                   # Remove sshift"
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

# Get local version from package.json
function Get-LocalVersion {
    $packageJsonPath = Join-Path $InstallDir "package.json"
    if (Test-Path $packageJsonPath) {
        $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
        return $packageJson.version
    }
    return "0.0.0"
}

# Get remote version from GitHub API
function Get-RemoteVersion {
    try {
        $response = Invoke-RestMethod -Uri $RepoApiUrl -Method Get -UseBasicParsing
        # GitHub API returns base64 encoded content
        $content = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($response.content))
        $packageJson = $content | ConvertFrom-Json
        return $packageJson.version
    } catch {
        Write-Warning "Could not fetch remote version: $_"
        return "0.0.0"
    }
}

# Compare versions (returns 0 if equal, -1 if local < remote, 1 if local > remote)
function Compare-Versions {
    param($LocalVersion, $RemoteVersion)
    
    if ($LocalVersion -eq $RemoteVersion) {
        return 0
    }
    
    $localParts = $LocalVersion -split '\.'
    $remoteParts = $RemoteVersion -split '\.'
    
    for ($i = 0; $i -lt 3; $i++) {
        $local = [int]($localParts[$i] -as [int] -replace '[^0-9]', '0')
        $remote = [int]($remoteParts[$i] -as [int] -replace '[^0-9]', '0')
        
        if ($local -lt $remote) {
            return -1  # local < remote
        } elseif ($local -gt $remote) {
            return 1   # local > remote
        }
    }
    
    return 0
}

# Check if sshift is running
function Test-IsRunning {
    if (Test-Path $PidFile) {
        $pid = Get-Content $PidFile -ErrorAction SilentlyContinue
        if ($pid) {
            $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($process) {
                return $true
            }
        }
    }
    return $false
}

# Stop running instance
function Stop-App {
    if (Test-IsRunning) {
        $pid = Get-Content $PidFile
        Write-Info "Stopping sshift (PID: $pid)..."
        Stop-Process -Id $pid -ErrorAction SilentlyContinue
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

# Ensure sshift executable exists
function Ensure-SshiftExecutable {
    $sshiftSource = Join-Path $installDir "sshift"
    
    if (-not (Test-Path $sshiftSource)) {
        Write-Warning "sshift executable not found, creating it..."
        $sshiftContent = @"
#!/usr/bin/env node

/**
 * sshift - Web-based SSH & SFTP Terminal Client
 * 
 * This is the main entry point for the sshift application.
 * Run this file to start the server.
 * 
 * Usage:
 *   ./sshift              # Start server on default port (8022, or from config.json)
 *   PORT=8080 ./sshift    # Start server on custom port (overrides config)
 *   NODE_ENV=development ./sshift  # Start in dev mode (port 3000, or from config)
 *   node sshift           # Alternative way to start
 * 
 * Port Priority:
 *   1. PORT environment variable (highest priority)
 *   2. config.json port/devPort based on NODE_ENV
 *   3. Default: 8022 (production), 3000 (development)
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Get the directory where this script is located
const scriptDir = __dirname;
const serverPath = path.join(scriptDir, 'server.js');

// Check if server.js exists
if (!fs.existsSync(serverPath)) {
  console.error('Error: server.js not found');
  console.error('Make sure you are running sshift from the installation directory');
  process.exit(1);
}

// Change to the script's directory to ensure relative paths work correctly
process.chdir(scriptDir);

// Load environment variables from .env files
// Priority: .env/.env.local > .env.local > .env/.env > .env
const envPaths = [
  path.join(scriptDir, '.env', '.env.local'),
  path.join(scriptDir, '.env.local'),
  path.join(scriptDir, '.env', '.env'),
  path.join(scriptDir, '.env')
];

// Load dotenv if available
try {
  const dotenv = require('dotenv');
  envPaths.forEach(envPath => {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  });
} catch (e) {
  // dotenv not available, environment variables will be loaded by server.js
}

// Start the server
require(serverPath);
"@
        Set-Content -Path $sshiftSource -Value $sshiftContent
        Write-Success "Created sshift executable"
    }
}

# Start the app
function Start-App {
    Write-Info "Starting sshift..."
    
    # Ensure sshift executable exists
    Ensure-SshiftExecutable
    
    # Check if already running
    if (Test-Path $PidFile) {
        $pid = Get-Content $PidFile -ErrorAction SilentlyContinue
        if ($pid -and (Get-Process -Id $pid -ErrorAction SilentlyContinue)) {
            Write-Warning "sshift is already running (PID: $pid)"
            return
        }
    }
    
    # Get port from config or use default
    $port = if ($ServerPort -ne "") { $ServerPort } else { "8022" }
    $envConfigPath = Join-Path $InstallDir ".env\config.json"
    $rootConfigPath = Join-Path $InstallDir "config.json"
    
    if (Test-Path $envConfigPath) {
        $config = Get-Content $envConfigPath -Raw | ConvertFrom-Json
        if ($config.port) { $port = $config.port }
    } elseif (Test-Path $rootConfigPath) {
        $config = Get-Content $rootConfigPath -Raw | ConvertFrom-Json
        if ($config.port) { $port = $config.port }
    }
    
    # Start using node directly (Start-Process runs in background by default)
    Set-Location $InstallDir
    $logFile = Join-Path $InstallDir "sshift.log"
    
    # Start process with output redirected to log file
    $process = Start-Process -FilePath "node" -ArgumentList "sshift" `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError $logFile `
        -NoNewWindow `
        -PassThru
    
    # Give it a moment to start
    Start-Sleep -Seconds 1
    
    # Verify it started successfully
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
        $process.Id | Out-File -FilePath $PidFile -Encoding utf8
        Write-Success "sshift started in background (PID: $($process.Id))"
        Write-Info "Logs: $logFile"
        Write-Info "View logs: Get-Content $logFile -Tail 50 -Wait"
        Write-Host ""
        Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
        Write-Host "║                                                          ║" -ForegroundColor Green
        Write-Host "║  sshift is now running!                                  ║" -ForegroundColor Green
        Write-Host "║                                                          ║" -ForegroundColor Green
        $url = "http://localhost:$port"
        $text = "  Click to open: $url"
        $padding = 58 - $text.Length
        Write-Host "║  Click to open: " -NoNewline -ForegroundColor Green
        Write-Host "$url" -NoNewline -ForegroundColor Cyan
        Write-Host (" " * $padding) -NoNewline
        Write-Host "║" -ForegroundColor Green
        Write-Host "║                                                          ║" -ForegroundColor Green
        Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Error "Failed to start sshift. Check logs: $logFile"
    }
}

# Update the project
function Update-Project {
    Write-Info "Updating sshift..."
    Stop-App
    
    Set-Location $InstallDir
    git fetch origin
    $branch = git symbolic-ref refs/remotes/origin/HEAD | ForEach-Object { $_ -replace 'refs/remotes/origin/', '' }
    if (-not $branch) { $branch = "main" }
    git reset --hard "origin/$branch"
    
    # Install/update dependencies
    npm install
    
    Write-Success "sshift updated successfully"
    
    # Restart the app
    Start-App
}

# Add to PATH
function Add-ToPath {
    # Check if already in PATH
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -like "*$BinDir*") {
        Write-Success "Already in PATH: $BinDir"
        return
    }
    
    Write-Info "Adding $BinDir to PATH..."
    
    # Create bin directory if it doesn't exist
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    
    # Add to user PATH
    $newPath = "$BinDir;$userPath"
    [System.Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    
    # Add to current session
    $env:Path = "$BinDir;$env:Path"
    
    Write-Success "Added to PATH"
    Write-Info "Restart your terminal for PATH changes to take effect"
}

# Create scheduled task for autostart
function New-AutostartTask {
    $action = New-ScheduledTaskAction -Execute "$BinDir\sshift.cmd" -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtLogon
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBattery -DontStopIfGoingOnBatteries -StartWhenAvailable
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    
    # Check if task already exists
    $existingTask = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Write-Info "Updating existing scheduled task..."
        Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false
    }
    
    Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
    
    Write-Success "Created autostart scheduled task"
}

# Remove autostart task
function Remove-AutostartTask {
    $existingTask = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false
        Write-Success "Removed autostart scheduled task"
    }
}

# Ask about autostart
function Request-Autostart {
    Write-Host ""
    Write-Info "Would you like to start sshift automatically on boot?"
    Write-Host "    This will create a scheduled task that starts sshift when you log in."
    Write-Host ""
    
    $response = Read-Host "Enable autostart? [y/N]"
    if ($response -eq "y" -or $response -eq "Y") {
        New-AutostartTask
        # Start the app immediately after enabling autostart
        Start-App
    } else {
        Write-Info "Skipping autostart configuration"
    }
}

# Get Node.js major version
function Get-NodeMajorVersion {
    if (Command-Exists "node") {
        $version = node --version
        return [int]($version -replace '^v', '' -split '\.')[0]
    }
    return 0
}

# Install Node.js using winget
function Install-NodeWinget {
    Write-Info "Installing Node.js using winget..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
}

# Install Node.js using Chocolatey
function Install-NodeChoco {
    Write-Info "Installing Node.js using Chocolatey..."
    choco install nodejs-lts -y
}

# Install Node.js using Scoop
function Install-NodeScoop {
    Write-Info "Installing Node.js using Scoop..."
    scoop install nodejs-lts
}

# Install Node.js using official installer
function Install-NodeInstaller {
    Write-Info "Downloading Node.js installer..."
    
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $installerUrl = "https://nodejs.org/dist/v${NodeVersion}.0.0/node-v${NodeVersion}.0.0-${arch}.msi"
    $installerPath = "$env:TEMP\node-installer.msi"
    
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
        Write-Info "Running Node.js installer..."
        Start-Process msiexec.exe -ArgumentList "/i `"$installerPath`" /quiet /norestart" -Wait
        Remove-Item $installerPath -Force
    } catch {
        Write-Error "Failed to download or install Node.js: $_"
    }
}

# Install Node.js if needed
function Install-Node {
    $currentVersion = Get-NodeMajorVersion
    
    if ($currentVersion -ge [int]$NodeVersion) {
        $nodeVersion = node --version
        Write-Success "Node.js version $nodeVersion is already installed"
        return
    }
    
    Write-Info "Node.js version ${NodeVersion}.x or higher is required"
    if ($currentVersion -gt 0) {
        $nodeVersion = node --version
        Write-Info "Current version: $nodeVersion"
    } else {
        Write-Info "Current version: not installed"
    }
    
    # Try different installation methods
    if (Command-Exists "winget") {
        Install-NodeWinget
    } elseif (Command-Exists "choco") {
        Install-NodeChoco
    } elseif (Command-Exists "scoop") {
        Install-NodeScoop
    } else {
        Write-Warning "No package manager found (winget, chocolatey, or scoop)"
        Write-Info "Using official Node.js installer..."
        Install-NodeInstaller
    }
    
    # Refresh environment variables
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    
    # Verify installation
    if (Command-Exists "node") {
        $nodeVersion = node --version
        Write-Success "Node.js $nodeVersion installed successfully"
    } else {
        Write-Error "Failed to install Node.js. Please install manually from https://nodejs.org/"
    }
}

# Clone the repository
function Clone-Repo {
    Write-Info "Cloning sshift repository..."
    
    # Remove existing installation if present
    if (Test-Path $InstallDir) {
        Write-Warning "Removing existing installation at $InstallDir"
        Remove-Item -Path $InstallDir -Recurse -Force
    }
    
    # Create directories
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    
    # Clone repository
    $currentDir = Get-Location
    if (Test-Path ".git") {
        Write-Info "Running from git repository, copying files..."
        Copy-Item -Path "$currentDir\*" -Destination $InstallDir -Recurse -Force
    } else {
        Write-Info "Cloning from $RepoUrl..."
        git clone $RepoUrl $InstallDir
    }
    
    Write-Success "Repository cloned to $InstallDir"
}

# Install dependencies
function Install-Dependencies {
    Write-Info "Installing npm dependencies..."
    Set-Location $InstallDir
    npm install
    Write-Success "Dependencies installed"
}

# Create symlink
function Create-Symlink {
    Write-Info "Creating executable wrappers..."
    
    # Ensure the sshift executable exists
    Ensure-SshiftExecutable
    
    # Create batch wrapper for Windows
    $batchContent = @"
@echo off
node "$InstallDir\sshift" %*
"@
    $batchPath = "$BinDir\sshift.cmd"
    Set-Content -Path $batchPath -Value $batchContent
    
    # Create PowerShell wrapper
    $psContent = @"
#!/usr/bin/env pwsh
node "$InstallDir\sshift" `$args
"@
    $psPath = "$BinDir\sshift.ps1"
    Set-Content -Path $psPath -Value $psContent
    
    # Check if bin directory is in PATH
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$BinDir*") {
        Write-Warning "$BinDir is not in your PATH"
        Write-Info "Adding $BinDir to user PATH..."
        [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$BinDir", "User")
        $env:Path += ";$BinDir"
    }
    
    Write-Success "Executable wrappers created:"
    Write-Host "    $batchPath"
    Write-Host "    $psPath"
}

# Create config file with port setting
function Create-Config {
    if ($ServerPort -ne "") {
        Write-Info "Creating configuration with port $ServerPort..."
        
        # Create .env directory if it doesn't exist
        $envDir = Join-Path $InstallDir ".env"
        if (-not (Test-Path $envDir)) {
            New-Item -ItemType Directory -Force -Path $envDir | Out-Null
        }
        
        # Create .env file with port
        $envContent = @"
# sshift configuration
PORT=$ServerPort
"@
        $envFile = Join-Path $envDir ".env.local"
        Set-Content -Path $envFile -Value $envContent
        
        Write-Success "Configuration created with port $ServerPort"
    }
}

# Print installation summary
function Print-Summary {
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "sshift installed successfully!" -ForegroundColor Green
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "Installation directory: $InstallDir"
    Write-Host "Executable: $BinDir\sshift.cmd"
    Write-Host "Version: $(Get-LocalVersion)"
    Write-Host ""
    Write-Host "To start sshift, run:"
    Write-Host "    sshift"
    Write-Host ""
    Write-Host "Note: You may need to restart your terminal for PATH changes to take effect."
    Write-Host ""
}

# Uninstall sshift
function Uninstall-App {
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "       sshift Uninstallation Script"
    Write-Host "=========================================="
    Write-Host ""
    
    # Check if installed
    if (-not (Test-Path $InstallDir)) {
        Write-Warning "sshift is not installed at $InstallDir"
        return
    }
    
    Write-Info "This will remove:"
    Write-Host "  - Installation directory: $InstallDir"
    Write-Host "  - Executable wrappers: $BinDir\sshift.cmd and $BinDir\sshift.ps1"
    Write-Host "  - Autostart scheduled task (if any)"
    Write-Host "  - PATH configuration"
    Write-Host ""
    
    $response = Read-Host "Continue with uninstallation? [y/N]"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Info "Uninstallation cancelled"
        return
    }
    
    # Stop running instance
    if (Test-IsRunning) {
        Write-Info "Stopping running instance..."
        Stop-App
    }
    
    # Remove autostart task
    Write-Info "Removing autostart configuration..."
    Remove-AutostartTask
    
    # Remove executable wrappers
    $batchPath = "$BinDir\sshift.cmd"
    $psPath = "$BinDir\sshift.ps1"
    
    if (Test-Path $batchPath) {
        Write-Info "Removing batch wrapper..."
        Remove-Item -Path $batchPath -Force
        Write-Success "Batch wrapper removed"
    }
    
    if (Test-Path $psPath) {
        Write-Info "Removing PowerShell wrapper..."
        Remove-Item -Path $psPath -Force
        Write-Success "PowerShell wrapper removed"
    }
    
    # Remove installation directory
    if (Test-Path $InstallDir) {
        Write-Info "Removing installation directory..."
        Remove-Item -Path $InstallDir -Recurse -Force
        Write-Success "Installation directory removed"
    }
    
    # Remove from PATH
    Write-Info "Removing PATH configuration..."
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -like "*$BinDir*") {
        $newPath = ($userPath -split ';' | Where-Object { $_ -ne $BinDir -and $_ -ne '' }) -join ';'
        [System.Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Success "Removed from PATH"
    }
    
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "sshift uninstalled successfully!" -ForegroundColor Green
    Write-Host "=========================================="
    Write-Host ""
    Write-Info "Note: You may need to restart your terminal for PATH changes to take effect."
}

# Check for updates
function Test-Updates {
    Write-Info "Checking for updates..."
    
    $localVersion = Get-LocalVersion
    $remoteVersion = Get-RemoteVersion
    
    Write-Info "Local version: $localVersion"
    Write-Info "Remote version: $remoteVersion"
    
    $comparison = Compare-Versions -LocalVersion $localVersion -RemoteVersion $remoteVersion
    
    if ($comparison -lt 0) {
        Write-Warning "New version available: $remoteVersion (current: $localVersion)"
        return $false  # Update available
    } elseif ($comparison -gt 0) {
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
        Uninstall-App
        return
    }
    
    # Handle update-only mode
    if ($Update) {
        # Check if installed
        if (-not (Test-Path $InstallDir)) {
            Write-Error "sshift is not installed at $InstallDir"
            return
        }
        
        Write-Host ""
        Write-Host "=========================================="
        Write-Host "       sshift Update Script"
        Write-Host "=========================================="
        Write-Host ""
        
        Write-Info "Updating sshift..."
        Update-Project
        return
    }
    
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "       sshift Installation Script"
    Write-Host "=========================================="
    Write-Host ""
    
    # Show configuration
    Write-Info "Installation directory: $InstallDir"
    if ($ServerPort -ne "") {
        Write-Info "Server port: $ServerPort"
    }
    
    # Check for administrator privileges (needed for some installations)
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Warning "Not running as administrator. Some installation methods may require elevation."
    }
    
    # Check if already installed
    if (Test-Path $InstallDir) {
        Write-Info "Existing installation found at $InstallDir"
        
        # Check for updates
        if (Test-Updates) {
            # No update needed, check if running
            if (Test-IsRunning) {
                $pid = Get-Content $PidFile
                Write-Info "sshift is already running (PID: $pid)"
            }
        } else {
            # Update available
            $response = Read-Host "Update sshift? [Y/n]"
            if ($response -ne "n" -and $response -ne "N") {
                Update-Project
            }
        }
    } else {
        # Fresh installation
        # Install Node.js if needed
        Install-Node
        
        # Clone repository
        Clone-Repo
        
        # Install dependencies
        Install-Dependencies
        
        # Create symlink
        Create-Symlink
        
        # Create config file with port (if specified)
        Create-Config
        
        # Print summary
        Print-Summary
    }
    
    # Always ask about PATH and autostart (even if already installed)
    Write-Host ""
    Write-Info "Configuration options:"
    Write-Host ""
    
    # Add to PATH
    $response = Read-Host "Add sshift to PATH? [Y/n]"
    if ($response -ne "n" -and $response -ne "N") {
        Add-ToPath
    }
    
    # Ask about autostart
    Request-Autostart
}

# Run main function
Main