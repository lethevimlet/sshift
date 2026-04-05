#!/bin/bash

# sshift Installation Script for Linux and macOS
# Installs Node.js (if not present) and clones the project
# Checks for updates and restarts the app if needed
#
# Usage: ./install.sh [OPTIONS]
#   --install-dir DIR   Installation directory (default: ~/.local/share/sshift)
#   --port PORT         Server port (default: 8022)
#   -h, --help          Show this help message

set -e

# Configuration (defaults, can be overridden by arguments)
NODE_VERSION="18"  # Minimum LTS version
REPO_URL="https://github.com/lethevimlet/sshift.git"
REPO_API_URL="https://api.github.com/repos/lethevimlet/sshift/contents/package.json"
INSTALL_DIR="${HOME}/.local/share/sshift"
BIN_DIR="${HOME}/.local/bin"
PID_FILE="/tmp/sshift.pid"
SERVICE_NAME="sshift"
SERVER_PORT=""
UNINSTALL=false
UPDATE_ONLY=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Show help message
show_help() {
    echo "sshift Installation Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --install-dir DIR   Installation directory (default: ~/.local/share/sshift)"
    echo "  --port PORT         Server port (default: 8022)"
    echo "  --update            Update existing installation (non-interactive)"
    echo "  --uninstall         Remove sshift from the system"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                              # Install with defaults"
    echo "  $0 --port 8080                  # Install with custom port"
    echo "  $0 --install-dir /opt/sshift     # Install to custom directory"
    echo "  $0 --update                     # Update existing installation"
    echo "  $0 --uninstall                   # Remove sshift"
    exit 0
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --install-dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            --port)
                SERVER_PORT="$2"
                shift 2
                ;;
            --uninstall)
                UNINSTALL=true
                shift
                ;;
            --update)
                UPDATE_ONLY=true
                shift
                ;;
            -h|--help)
                show_help
                ;;
            *)
                error "Unknown option: $1\nUse --help for usage information"
                ;;
        esac
    done
    
    # Update BIN_DIR based on INSTALL_DIR
    BIN_DIR="${INSTALL_DIR%/*}/bin"
}

# Get local version from package.json
get_local_version() {
    if [ -f "$INSTALL_DIR/package.json" ]; then
        grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$INSTALL_DIR/package.json" | cut -d'"' -f4
    else
        echo "0.0.0"
    fi
}

# Get remote version from GitHub API
get_remote_version() {
    local version
    if command_exists curl; then
        version=$(curl -s "$REPO_API_URL" 2>/dev/null | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
    elif command_exists wget; then
        version=$(wget -qO- "$REPO_API_URL" 2>/dev/null | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
    else
        warn "Neither curl nor wget available, cannot check remote version"
        echo "0.0.0"
        return
    fi
    
    if [ -z "$version" ]; then
        warn "Could not parse remote version"
        echo "0.0.0"
    else
        echo "$version"
    fi
}

# Compare versions (returns 0 if equal, 1 if local < remote, 2 if local > remote)
compare_versions() {
    local local_ver="$1"
    local remote_ver="$2"
    
    if [ "$local_ver" = "$remote_ver" ]; then
        return 0
    fi
    
    # Split versions into arrays
    IFS='.' read -ra local_parts <<< "$local_ver"
    IFS='.' read -ra remote_parts <<< "$remote_ver"
    
    # Compare each part
    for i in 0 1 2; do
        local l=${local_parts[$i]:-0}
        local r=${remote_parts[$i]:-0}
        
        if [ "$l" -lt "$r" ]; then
            return 1  # local < remote
        elif [ "$l" -gt "$r" ]; then
            return 2  # local > remote
        fi
    done
    
    return 0
}

# Check if sshift is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Stop running instance
stop_app() {
    if is_running; then
        local pid=$(cat "$PID_FILE")
        info "Stopping sshift (PID: $pid)..."
        kill "$pid" 2>/dev/null || true
        rm -f "$PID_FILE"
        sleep 1
    fi
}

# Ensure sshift executable exists
ensure_sshift_executable() {
    if [ ! -f "$INSTALL_DIR/sshift" ]; then
        warn "sshift executable not found, creating it..."
        cat > "$INSTALL_DIR/sshift" << 'EOFSHIFT'
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
EOFSHIFT
        chmod +x "$INSTALL_DIR/sshift"
        success "Created sshift executable"
    fi
}

# Start the app
start_app() {
    info "Starting sshift..."
    
    # Ensure sshift executable exists
    ensure_sshift_executable
    
    # Make sure it's executable
    chmod +x "$INSTALL_DIR/sshift"
    
    # Check if already running
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            warn "sshift is already running (PID: $pid)"
            return 0
        fi
    fi
    
    # Get port from config or use default
    local port="${SERVER_PORT:-8022}"
    if [ -f "$INSTALL_DIR/.env/config.json" ]; then
        local config_port=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$INSTALL_DIR/.env/config.json" | grep -o '[0-9]*$')
        [ -n "$config_port" ] && port="$config_port"
    elif [ -f "$INSTALL_DIR/config.json" ]; then
        local config_port=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$INSTALL_DIR/config.json" | grep -o '[0-9]*$')
        [ -n "$config_port" ] && port="$config_port"
    fi
    
    # Start using nohup to properly daemonize (detaches from terminal)
    cd "$INSTALL_DIR"
    nohup node "$INSTALL_DIR/sshift" > "$INSTALL_DIR/sshift.log" 2>&1 &
    local pid=$!
    
    # Give it a moment to start
    sleep 1
    
    # Verify it started successfully
    if kill -0 "$pid" 2>/dev/null; then
        echo $pid > "$PID_FILE"
        success "sshift started in background (PID: $pid)"
        info "Logs: $INSTALL_DIR/sshift.log"
        info "View logs: tail -f $INSTALL_DIR/sshift.log"
        echo ""
        echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║                                                          ║${NC}"
        echo -e "${GREEN}║  sshift is now running!                                  ║${NC}"
        echo -e "${GREEN}║                                                          ║${NC}"
        # OSC 8 hyperlink with proper padding (box width = 58 chars)
        local url="http://localhost:${port}"
        local text="  Click to open: ${url}"
        local padding=$((58 - ${#text}))
        printf "${GREEN}║${NC}  Click to open: \x1b]8;;%s\x07%s\x1b]8;;\x07${GREEN}%*s║${NC}\n" "$url" "$url" "$padding" ""
        echo -e "${GREEN}║                                                          ║${NC}"
        echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
        echo ""
    else
        error "Failed to start sshift. Check logs: $INSTALL_DIR/sshift.log"
        return 1
    fi
}

# Update the project
update_project() {
    info "Updating sshift..."
    stop_app
    
    cd "$INSTALL_DIR"
    git fetch origin
    git reset --hard origin/main 2>/dev/null || git reset --hard origin/master 2>/dev/null
    
    # Install/update dependencies
    npm install
    
    success "sshift updated successfully"
    
    # Restart the app if it was running before
    start_app
}

# Detect shell configuration file
detect_shell_config() {
    local shell_config=""
    case "$SHELL" in
        */bash)
            if [ -f "$HOME/.bashrc" ]; then
                shell_config="$HOME/.bashrc"
            elif [ -f "$HOME/.bash_profile" ]; then
                shell_config="$HOME/.bash_profile"
            fi
            ;;
        */zsh)
            shell_config="$HOME/.zshrc"
            ;;
        */fish)
            shell_config="$HOME/.config/fish/config.fish"
            ;;
        *)
            # Fallback to .profile
            if [ -f "$HOME/.profile" ]; then
                shell_config="$HOME/.profile"
            fi
            ;;
    esac
    echo "$shell_config"
}

# Add to PATH
add_to_path() {
    # Check if already in PATH
    if [[ ":$PATH:" == *":$BIN_DIR:"* ]]; then
        success "Already in PATH: $BIN_DIR"
        return 0
    fi
    
    info "Adding $BIN_DIR to PATH..."
    
    # Create bin directory if it doesn't exist
    mkdir -p "$BIN_DIR"
    
    # Detect shell configuration file
    local shell_config=$(detect_shell_config)
    
    if [ -z "$shell_config" ]; then
        warn "Could not detect shell configuration file"
        warn "Please add the following to your shell configuration manually:"
        echo ""
        echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
        echo ""
        return 1
    fi
    
    # Check if already in shell config
    if grep -q "export PATH=\"\$HOME/.local/bin:\$PATH\"" "$shell_config" 2>/dev/null; then
        success "PATH already configured in $shell_config"
        # Still add to current session
        export PATH="$BIN_DIR:$PATH"
        return 0
    fi
    
    # Add to shell config
    echo "" >> "$shell_config"
    echo "# Added by sshift installer" >> "$shell_config"
    echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$shell_config"
    
    # Add to current session
    export PATH="$BIN_DIR:$PATH"
    
    success "Added to PATH in $shell_config"
    info "Restart your terminal or run: source $shell_config"
}

# Create systemd service (Linux)
create_systemd_service() {
    local service_file="$HOME/.config/systemd/user/$SERVICE_NAME.service"
    local service_dir=$(dirname "$service_file")
    
    mkdir -p "$service_dir"
    
    cat > "$service_file" << 'EOF'
[Unit]
Description=sshift - Web-based SSH/SFTP Terminal
After=network.target

[Service]
Type=simple
ExecStart=%h/.local/bin/sshift
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF
    
    # Reload systemd daemon
    systemctl --user daemon-reload
    
    # Enable the service
    systemctl --user enable "$SERVICE_NAME.service"
    
    success "Created and enabled systemd service"
}

# Create launchd service (macOS)
create_launchd_service() {
    local plist_file="$HOME/Library/LaunchAgents/com.$SERVICE_NAME.plist"
    local plist_dir=$(dirname "$plist_file")
    
    mkdir -p "$plist_dir"
    
    cat > "$plist_file" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.$SERVICE_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BIN_DIR/sshift</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/sshift.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/sshift.log</string>
</dict>
</plist>
EOF
    
    # Load the service
    launchctl load "$plist_file" 2>/dev/null || true
    
    success "Created and loaded launchd service"
}

# Setup autostart
setup_autostart() {
    case "$OS" in
        linux)
            # Check if systemd user sessions are available
            # On Debian and many systems, systemd --user runs as a user instance
            if command_exists systemctl && systemctl --user --quiet is-active default.target 2>/dev/null; then
                # Create systemd user directory if it doesn't exist
                mkdir -p "$HOME/.config/systemd/user"
                create_systemd_service
            elif command_exists systemctl && [ -d "/run/systemd/system" ]; then
                # Fallback: systemd is installed but user session might not be running
                # Try to enable user sessions
                info "Enabling systemd user session..."
                mkdir -p "$HOME/.config/systemd/user"
                create_systemd_service
            else
                warn "systemd user sessions not available, autostart not configured"
                info "To enable systemd user sessions, you may need to run: loginctl enable-linger $USER"
                return 1
            fi
            ;;
        macos)
            create_launchd_service
            ;;
        *)
            warn "Autostart not supported on this OS"
            return 1
            ;;
    esac
}

# Remove autostart
remove_autostart() {
    case "$OS" in
        linux)
            if command_exists systemctl; then
                systemctl --user disable "$SERVICE_NAME.service" 2>/dev/null || true
                systemctl --user stop "$SERVICE_NAME.service" 2>/dev/null || true
                rm -f "$HOME/.config/systemd/user/$SERVICE_NAME.service"
                systemctl --user daemon-reload
                success "Removed systemd service"
            fi
            ;;
        macos)
            launchctl unload "$HOME/Library/LaunchAgents/com.$SERVICE_NAME.plist" 2>/dev/null || true
            rm -f "$HOME/Library/LaunchAgents/com.$SERVICE_NAME.plist"
            success "Removed launchd service"
            ;;
    esac
}

# Ask about autostart
ask_autostart() {
    echo ""
    info "Would you like to start sshift automatically on boot?"
    echo "    This will create a system service that starts sshift when you log in."
    echo ""
    read -p "Enable autostart? [y/N] " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        setup_autostart
        # Start the app immediately after enabling autostart
        start_app
    else
        info "Skipping autostart configuration"
    fi
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)     OS="linux";;
        Darwin*)    OS="macos";;
        *)          error "Unsupported operating system: $(uname -s)";;
    esac
}

# Detect Linux distribution
detect_distro() {
    if [ "$OS" = "linux" ]; then
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            DISTRO="${ID,,}"
        elif [ -f /etc/debian_version ]; then
            DISTRO="debian"
        elif [ -f /etc/redhat-release ]; then
            DISTRO="rhel"
        elif [ -f /etc/arch-release ]; then
            DISTRO="arch"
        else
            DISTRO="unknown"
        fi
    fi
}

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Get Node.js major version
get_node_major_version() {
    if command_exists node; then
        node --version | cut -d'.' -f1 | tr -d 'v'
    else
        echo "0"
    fi
}

# Install Node.js on Linux
install_node_linux() {
    info "Installing Node.js on Linux..."
    
    case "$DISTRO" in
        ubuntu|debian|linuxmint|pop)
            info "Detected Debian-based distribution"
            sudo apt-get update
            sudo apt-get install -y curl
            curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        fedora|rhel|centos|rocky|almalinux)
            info "Detected RHEL-based distribution"
            sudo dnf install -y curl || sudo yum install -y curl
            curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
            sudo dnf install -y nodejs || sudo yum install -y nodejs
            ;;
        arch|manjaro|endeavouros)
            info "Detected Arch-based distribution"
            sudo pacman -Sy --noconfirm nodejs npm
            ;;
        opensuse*)
            info "Detected openSUSE"
            sudo zypper install -y nodejs${NODE_VERSION}
            ;;
        alpine)
            info "Detected Alpine Linux"
            sudo apk add --no-cache nodejs npm
            ;;
        *)
            warn "Unknown distribution, using nvm (Node Version Manager)"
            install_nvm
            ;;
    esac
}

# Install Node.js on macOS
install_node_macos() {
    info "Installing Node.js on macOS..."
    
    if command_exists brew; then
        info "Using Homebrew to install Node.js"
        brew install node@${NODE_VERSION}
    elif command_exists port; then
        info "Using MacPorts to install Node.js"
        sudo port install nodejs${NODE_VERSION}
    else
        warn "Neither Homebrew nor MacPorts found, using nvm"
        install_nvm
    fi
}

# Install using NVM (Node Version Manager)
install_nvm() {
    info "Installing Node.js via nvm..."
    
    # Install nvm if not present
    if [ ! -d "$HOME/.nvm" ]; then
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi
    
    # Source nvm
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    
    # Install and use Node.js
    nvm install ${NODE_VERSION}
    nvm use ${NODE_VERSION}
    nvm alias default ${NODE_VERSION}
}

# Install Node.js if needed
install_node() {
    local current_version=$(get_node_major_version)
    
    if [ "$current_version" -ge "$NODE_VERSION" ]; then
        success "Node.js version $(node --version) is already installed"
        return 0
    fi
    
    info "Node.js version ${NODE_VERSION}.x or higher is required"
    info "Current version: $(node --version 2>/dev/null || echo 'not installed')"
    
    case "$OS" in
        linux)  install_node_linux ;;
        macos)  install_node_macos ;;
    esac
    
    # Verify installation
    if command_exists node; then
        success "Node.js $(node --version) installed successfully"
    else
        error "Failed to install Node.js"
    fi
}

# Clone the repository
clone_repo() {
    info "Cloning sshift repository..."
    
    # Remove existing installation if present
    if [ -d "$INSTALL_DIR" ]; then
        warn "Removing existing installation at $INSTALL_DIR"
        rm -rf "$INSTALL_DIR"
    fi
    
    # Create directories
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$BIN_DIR"
    
    # Clone repository
    if [ -d ".git" ] && [ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$(pwd)" ]; then
        info "Running from git repository, copying files..."
        cp -r . "$INSTALL_DIR"
    else
        info "Cloning from $REPO_URL..."
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    
    success "Repository cloned to $INSTALL_DIR"
}

# Install dependencies
install_dependencies() {
    info "Installing npm dependencies..."
    cd "$INSTALL_DIR"
    npm install
    success "Dependencies installed"
}

# Create symlink
create_symlink() {
    info "Creating executable symlink..."
    
    # Ensure the sshift executable exists
    ensure_sshift_executable
    
    # Create symlink in user's local bin directory
    ln -sf "$INSTALL_DIR/sshift" "$BIN_DIR/sshift"
    
    # Make sure bin directory is in PATH
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        warn "$BIN_DIR is not in your PATH"
        info "Add the following to your shell configuration (~/.bashrc, ~/.zshrc, etc.):"
        echo ""
        echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
        echo ""
    fi
    
    success "Symlink created: $BIN_DIR/sshift -> $INSTALL_DIR/sshift"
}

# Create config file with port setting
create_config() {
    if [ -n "$SERVER_PORT" ]; then
        info "Creating configuration with port $SERVER_PORT..."
        
        # Create .env directory if it doesn't exist
        mkdir -p "$INSTALL_DIR/.env"
        
        # Create .env file with port
        cat > "$INSTALL_DIR/.env/.env.local" << EOF
# sshift configuration
PORT=$SERVER_PORT
EOF
        
        success "Configuration created with port $SERVER_PORT"
    fi
}

# Print installation summary
print_summary() {
    echo ""
    echo "=========================================="
    echo -e "${GREEN}sshift installed successfully!${NC}"
    echo "=========================================="
    echo ""
    echo "Installation directory: $INSTALL_DIR"
    echo "Executable: $BIN_DIR/sshift"
    echo "Version: $(get_local_version)"
    echo ""
    echo "To start sshift, run:"
    echo "    sshift"
    echo ""
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        echo "Note: Add $BIN_DIR to your PATH by adding this line to your shell config:"
        echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
        echo ""
    fi
}

# Uninstall sshift
uninstall() {
    echo ""
    echo "=========================================="
    echo "       sshift Uninstallation Script"
    echo "=========================================="
    echo ""
    
    # Detect OS
    detect_os
    
    # Check if installed
    if [ ! -d "$INSTALL_DIR" ]; then
        warn "sshift is not installed at $INSTALL_DIR"
        return 1
    fi
    
    info "This will remove:"
    echo "  - Installation directory: $INSTALL_DIR"
    echo "  - Executable symlink: $BIN_DIR/sshift"
    echo "  - Autostart configuration (if any)"
    echo "  - PATH configuration from shell config"
    echo ""
    
    read -p "Continue with uninstallation? [y/N] " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Uninstallation cancelled"
        return 0
    fi
    
    # Stop running instance
    if is_running; then
        info "Stopping running instance..."
        stop_app
    fi
    
    # Remove autostart
    info "Removing autostart configuration..."
    remove_autostart
    
    # Remove symlink
    if [ -L "$BIN_DIR/sshift" ]; then
        info "Removing symlink..."
        rm -f "$BIN_DIR/sshift"
        success "Symlink removed"
    fi
    
    # Remove installation directory
    if [ -d "$INSTALL_DIR" ]; then
        info "Removing installation directory..."
        rm -rf "$INSTALL_DIR"
        success "Installation directory removed"
    fi
    
    # Remove from PATH in shell config
    info "Removing PATH configuration..."
    local shell_config=$(detect_shell_config)
    if [ -n "$shell_config" ] && [ -f "$shell_config" ]; then
        # Remove the PATH export line added by sshift
        if grep -q "# Added by sshift installer" "$shell_config" 2>/dev/null; then
            # Create a temporary file without the sshift lines
            grep -v "# Added by sshift installer" "$shell_config" | grep -v "export PATH=\"\\\$HOME/.local/bin:\$PATH\"" > "${shell_config}.tmp"
            mv "${shell_config}.tmp" "$shell_config"
            success "PATH configuration removed from $shell_config"
        fi
    fi
    
    # Remove systemd user directory if empty
    if [ "$OS" = "linux" ]; then
        local systemd_dir="$HOME/.config/systemd/user"
        if [ -d "$systemd_dir" ] && [ -z "$(ls -A "$systemd_dir" 2>/dev/null)" ]; then
            rmdir "$systemd_dir" 2>/dev/null || true
            rmdir "$HOME/.config/systemd" 2>/dev/null || true
        fi
    fi
    
    echo ""
    echo "=========================================="
    echo -e "${GREEN}sshift uninstalled successfully!${NC}"
    echo "=========================================="
    echo ""
    info "Note: You may need to restart your terminal or run: source $shell_config"
}

# Check for updates
check_updates() {
    info "Checking for updates..."
    
    local local_ver=$(get_local_version)
    local remote_ver=$(get_remote_version)
    
    info "Local version: $local_ver"
    info "Remote version: $remote_ver"
    
    compare_versions "$local_ver" "$remote_ver"
    local result=$?
    
    if [ $result -eq 1 ]; then
        warn "New version available: $remote_ver (current: $local_ver)"
        return 1  # Update available
    elif [ $result -eq 2 ]; then
        info "Local version is newer than remote (development version?)"
        return 0
    else
        success "Already up to date (version $local_ver)"
        return 0
    fi
}

# Main installation process
main() {
    # Parse command line arguments
    parse_args "$@"
    
    # Handle uninstall
    if [ "$UNINSTALL" = true ]; then
        uninstall
        exit 0
    fi
    
    # Handle update-only mode
    if [ "$UPDATE_ONLY" = true ]; then
        # Detect OS
        detect_os
        
        # Check if installed
        if [ ! -d "$INSTALL_DIR" ]; then
            error "sshift is not installed at $INSTALL_DIR"
        fi
        
        echo ""
        echo "=========================================="
        echo "       sshift Update Script"
        echo "=========================================="
        echo ""
        
        info "Updating sshift..."
        update_project
        exit 0
    fi
    
    echo ""
    echo "=========================================="
    echo "       sshift Installation Script"
    echo "=========================================="
    echo ""
    
    # Show configuration
    info "Installation directory: $INSTALL_DIR"
    [ -n "$SERVER_PORT" ] && info "Server port: $SERVER_PORT"
    
    # Detect OS and distribution
    detect_os
    detect_distro
    info "Detected OS: $OS"
    [ "$OS" = "linux" ] && info "Detected distribution: ${DISTRO:-unknown}"
    
    # Check if already installed
    if [ -d "$INSTALL_DIR" ]; then
        info "Existing installation found at $INSTALL_DIR"
        
        # Check for updates
        if check_updates; then
            # No update needed
            if is_running; then
                info "sshift is already running (PID: $(cat $PID_FILE))"
            fi
        else
            # Update available
            read -p "Update sshift? [Y/n] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                update_project
            fi
        fi
    else
        # Fresh installation
        # Install Node.js if needed
        install_node
        
        # Clone repository
        clone_repo
        
        # Install dependencies
        install_dependencies
        
        # Create symlink
        create_symlink
        
        # Create config file with port (if specified)
        create_config
        
        # Print summary
        print_summary
    fi
    
    # Always ask about PATH and autostart (even if already installed)
    echo ""
    info "Configuration options:"
    echo ""
    
    # Add to PATH
    read -p "Add sshift to PATH? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        add_to_path
    fi
    
    # Ask about autostart
    ask_autostart
}

# Run main function
main "$@"