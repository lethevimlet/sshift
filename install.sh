#!/bin/bash
# sshift Installation Script for Linux/macOS
# Installs Node.js (if not present) and installs sshift via npm
# Checks for updates and restarts the app if needed
#
# Usage: ./install.sh [OPTIONS]
#   --install-dir DIR   Installation directory (default: ~/.local/share/sshift)
#   --port PORT         Server port (default: 8022)
#   --start             Start sshift after installation/update
#   --stop              Stop running sshift instance
#   --restart           Restart sshift
#   --status            Check if sshift is running
#   --update            Update existing installation (non-interactive)
#   --uninstall         Remove sshift from the system
#   --help              Show this help message

set -e

# Configuration (defaults, can be overridden by arguments)
NODE_VERSION="20"  # Minimum LTS version
NPM_PACKAGE="@lethevimlet/sshift"
INSTALL_DIR="$HOME/.local/share/sshift"
BIN_DIR="$HOME/.local/bin"
PID_FILE="/tmp/sshift.pid"
SERVICE_NAME="sshift"
SERVER_PORT=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored messages
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Show help message
show_help() {
    cat << EOF
sshift Installation Script for Linux/macOS

Usage: ./install.sh [OPTIONS]

Options:
  --install-dir DIR   Installation directory (default: ~/.local/share/sshift)
  --port PORT         Server port (default: 8022)
  --start             Start sshift after installation/update
  --stop              Stop running sshift instance
  --restart           Restart sshift
  --status            Check if sshift is running
  --update            Update existing installation (non-interactive)
  --uninstall         Remove sshift from the system
  --help              Show this help message

Examples:
  ./install.sh                              # Install with defaults
  ./install.sh --port 8080                  # Install with custom port
  ./install.sh --install-dir /opt/sshift    # Install to custom directory
  ./install.sh --update                     # Update existing installation
  ./install.sh --start                      # Start sshift
  ./install.sh --stop                       # Stop sshift
  ./install.sh --restart                    # Restart sshift
  ./install.sh --status                     # Check status
  ./install.sh --uninstall                  # Remove sshift

One-liner installation:
  curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/install.sh | bash
  wget -qO- https://raw.githubusercontent.com/lethevimlet/sshift/main/install.sh | bash
EOF
    exit 0
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Get installed version from npm
get_installed_version() {
    if command_exists sshift; then
        npm list -g @lethevimlet/sshift --depth=0 2>/dev/null | grep sshift | sed 's/.*sshift@//' | tr -d ' '
    else
        echo "0.0.0"
    fi
}

# Get latest version from npm
get_latest_version() {
    npm view @lethevimlet/sshift version 2>/dev/null || echo "0.0.0"
}

# Compare versions (returns 0 if equal, 1 if local < remote, 2 if local > remote)
compare_versions() {
    local local_version="$1"
    local remote_version="$2"
    
    if [ "$local_version" = "$remote_version" ]; then
        return 0
    fi
    
    local IFS='.'
    local i local_parts remote_parts
    read -ra local_parts <<< "$local_version"
    read -ra remote_parts <<< "$remote_version"
    
    for ((i=0; i<3; i++)); do
        local local_num="${local_parts[i]:-0}"
        local remote_num="${remote_parts[i]:-0}"
        
        if [ "$local_num" -lt "$remote_num" ]; then
            return 1  # local < remote
        elif [ "$local_num" -gt "$remote_num" ]; then
            return 2  # local > remote
        fi
    done
    
    return 0
}

# Check if sshift is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" >/dev/null 2>&1; then
            return 0
        else
            # Clean up stale PID file
            rm -f "$PID_FILE"
        fi
    fi
    return 1
}

# Stop running instance
stop_app() {
    # Check if running via systemd
    if command_exists systemctl && systemctl --user is-active "$SERVICE_NAME" >/dev/null 2>&1; then
        info "Stopping sshift via systemd..."
        systemctl --user stop "$SERVICE_NAME"
        sleep 2
        return
    fi
    
    # Otherwise, stop via PID file
    if is_running; then
        local pid=$(cat "$PID_FILE")
        info "Stopping sshift (PID: $pid)..."
        
        # Try graceful shutdown first
        kill "$pid" 2>/dev/null || true
        sleep 2
        
        # Force kill if still running
        if ps -p "$pid" >/dev/null 2>&1; then
            warn "Process did not stop gracefully, force killing..."
            kill -9 "$pid" 2>/dev/null || true
            sleep 1
        fi
        
        rm -f "$PID_FILE"
        success "sshift stopped"
    else
        # Clean up stale PID file if it exists
        if [ -f "$PID_FILE" ]; then
            rm -f "$PID_FILE"
            info "Removed stale PID file"
        fi
    fi
}

# Start the app
start_app() {
    info "Starting sshift..."
    
    # Check if already running
    if is_running; then
        local pid=$(cat "$PID_FILE")
        warn "sshift is already running (PID: $pid)"
        return
    fi
    
    # Start sshift in background
    nohup sshift > "$INSTALL_DIR/sshift.log" 2>&1 &
    local pid=$!
    
    # Save PID
    mkdir -p "$(dirname "$PID_FILE")"
    echo "$pid" > "$PID_FILE"
    
    sleep 2
    
    # Check if process is still running
    if ps -p "$pid" >/dev/null 2>&1; then
        success "sshift started (PID: $pid)"
        info "Logs: $INSTALL_DIR/sshift.log"
    else
        error "sshift failed to start. Check logs at $INSTALL_DIR/sshift.log"
    fi
}

# Install Node.js if not present
install_nodejs() {
    if command_exists node; then
        local node_version=$(node -v 2>/dev/null | sed 's/v//')
        
        # Check if node actually works (may fail due to glibc mismatch on Arch)
        if [ -z "$node_version" ]; then
            warn "Node.js is installed but not working. This may be a glibc version issue."
            warn "On Arch-based systems, please run: sudo pacman -Syu"
            warn "Then re-run this installer."
            error "Node.js is not functional. Please fix the issue and try again."
        fi
        
        local major_version=$(echo "$node_version" | cut -d. -f1)
        
        if [ "$major_version" -ge "$NODE_VERSION" ]; then
            success "Node.js $(node -v) is already installed"
            return
        else
            warn "Node.js version $(node -v) is too old, upgrading..."
        fi
    fi
    
    info "Installing Node.js $NODE_VERSION..."
    
    # Detect OS
    if [ "$(uname)" = "Darwin" ]; then
        # macOS
        if command_exists brew; then
            brew install node@${NODE_VERSION}
        else
            error "Homebrew is not installed. Please install Homebrew first: https://brew.sh/"
        fi
    else
        # Linux - detect distro more accurately
        if [ -f /etc/arch-release ] || command_exists pacman; then
            # Arch Linux/Manjaro/EndeavourOS
            # Arch's nodejs requires the latest glibc - system must be fully updated
            info "Detected Arch-based system"
            info "Updating system packages (required for Node.js compatibility)..."
            
            # Check current glibc version
            local glibc_version=$(ldd --version 2>/dev/null | head -n1 | grep -oP '\d+\.\d+' | head -1)
            info "Current glibc version: $glibc_version"
            
            # Update system
            if ! sudo pacman -Syu --noconfirm; then
                warn "System update failed or was cancelled"
                warn "If you're on an Arch-based system, please run: sudo pacman -Syu"
                warn "Then re-run this installer."
                error "System update required for Node.js compatibility"
            fi
            
            # Install nodejs and npm
            if ! sudo pacman -S --noconfirm nodejs npm; then
                error "Failed to install Node.js via pacman"
            fi
            
            # Verify node works after installation
            if ! node -v >/dev/null 2>&1; then
                error "Node.js installed but not working. Your system may need a reboot after glibc update."
            fi
        elif command_exists apt-get; then
            # Debian/Ubuntu
            curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command_exists yum; then
            # RHEL/CentOS
            curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
            sudo yum install -y nodejs
        elif command_exists dnf; then
            # Fedora
            curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
            sudo dnf install -y nodejs
        else
            error "Unsupported package manager. Please install Node.js $NODE_VERSION manually"
        fi
    fi
    
    # Verify installation
    if command_exists node && node -v >/dev/null 2>&1; then
        success "Node.js $(node -v) installed successfully"
    else
        error "Failed to install Node.js or Node.js is not functional"
    fi
}

# Install sshift via npm
install_sshift() {
    info "Installing sshift via npm..."
    
    # Install globally
    npm install -g @lethevimlet/sshift
    
    if [ $? -eq 0 ]; then
        success "sshift installed successfully"
    else
        error "Failed to install sshift"
    fi
}

# Update sshift
update_sshift() {
    info "Updating sshift..."
    
    # Stop running instance if any
    if is_running; then
        stop_app
    fi
    
    # Update via npm
    npm update -g @lethevimlet/sshift
    
    if [ $? -eq 0 ]; then
        success "sshift updated successfully"
    else
        error "Failed to update sshift"
    fi
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

# Add to PATH
add_to_path() {
    local shell_rc=""
    
    # Detect shell
    if [ -n "$ZSH_VERSION" ]; then
        shell_rc="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        shell_rc="$HOME/.bashrc"
    else
        shell_rc="$HOME/.profile"
    fi
    
    # Check if already in PATH
    if [ -d "$BIN_DIR" ] && echo "$PATH" | grep -q "$BIN_DIR"; then
        info "$BIN_DIR is already in PATH"
        return
    fi
    
    # Create bin directory
    mkdir -p "$BIN_DIR"
    
    # Add to shell RC
    if ! grep -q "$BIN_DIR" "$shell_rc" 2>/dev/null; then
        echo "" >> "$shell_rc"
        echo "# sshift" >> "$shell_rc"
        echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$shell_rc"
        success "Added $BIN_DIR to PATH in $shell_rc"
        info "You may need to restart your terminal or run: source $shell_rc"
    fi
}

# Setup autostart via systemd (Linux) or launchd (macOS)
setup_autostart() {
    info "Setting up autostart..."
    
    if [ "$(uname)" = "Darwin" ]; then
        # macOS - use launchd
        local plist_path="$HOME/Library/LaunchAgents/com.sshift.plist"
        
        cat > "$plist_path" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sshift</string>
    <key>ProgramArguments</key>
    <array>
        <string>sshift</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$INSTALL_DIR/sshift.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_DIR/sshift-error.log</string>
</dict>
</plist>
EOF
        
        launchctl load "$plist_path" 2>/dev/null || true
        success "Autostart configured via launchd"
        info "To start now: launchctl start com.sshift"
    else
        # Linux - use systemd user service
        local service_dir="$HOME/.config/systemd/user"
        local service_path="$service_dir/$SERVICE_NAME.service"
        
        mkdir -p "$service_dir"
        
        cat > "$service_path" << EOF
[Unit]
Description=sshift - Web-based SSH Terminal
After=network.target

[Service]
Type=simple
ExecStart=$(which sshift)
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF
        
        systemctl --user daemon-reload
        systemctl --user enable "$SERVICE_NAME"
        
        success "Autostart configured via systemd"
        info "To start now: systemctl --user start $SERVICE_NAME"
    fi
}

# Remove autostart
remove_autostart() {
    if [ "$(uname)" = "Darwin" ]; then
        # macOS
        local plist_path="$HOME/Library/LaunchAgents/com.sshift.plist"
        if [ -f "$plist_path" ]; then
            launchctl unload "$plist_path" 2>/dev/null || true
            rm -f "$plist_path"
        fi
    else
        # Linux
        systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
        systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
        rm -f "$HOME/.config/systemd/user/$SERVICE_NAME.service"
        systemctl --user daemon-reload 2>/dev/null || true
    fi
}

# Print installation summary
print_summary() {
    echo ""
    echo "=========================================="
    echo -e "${GREEN}sshift installed successfully!${NC}"
    echo "=========================================="
    echo ""
    echo "Version: $(get_installed_version)"
    echo ""
    echo "To start sshift, run:"
    echo "    sshift"
    echo ""
    echo "You may need to restart your terminal for PATH changes to take effect"
    echo ""
}

# Uninstall sshift
uninstall_sshift() {
    echo ""
    echo "=========================================="
    echo "       sshift Uninstallation Script"
    echo "=========================================="
    echo ""
    
    # Check if installed
    if ! command_exists sshift; then
        warn "sshift is not installed"
        return
    fi
    
    info "This will remove:"
    echo "  - sshift npm package"
    echo "  - Configuration files in $INSTALL_DIR"
    echo "  - Autostart configuration (if any)"
    echo "  - PATH configuration"
    echo ""
    
    read -p "Continue with uninstallation? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Uninstallation cancelled"
        return
    fi
    
    # Stop running instance
    if is_running; then
        info "Stopping running instance..."
        stop_app
    fi
    
    # Remove autostart
    info "Removing autostart configuration..."
    remove_autostart
    
    # Uninstall via npm
    info "Uninstalling sshift..."
    npm uninstall -g @lethevimlet/sshift
    
    # Remove installation directory
    if [ -d "$INSTALL_DIR" ]; then
        info "Removing configuration directory..."
        rm -rf "$INSTALL_DIR"
        success "Configuration directory removed"
    fi
    
    # Remove from PATH
    info "Removing PATH configuration..."
    local shell_rc=""
    if [ -n "$ZSH_VERSION" ]; then
        shell_rc="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        shell_rc="$HOME/.bashrc"
    else
        shell_rc="$HOME/.profile"
    fi
    
    if [ -f "$shell_rc" ]; then
        # Remove sshift PATH entries
        sed -i.bak '/# sshift/d' "$shell_rc"
        sed -i.bak "/export PATH=\"$BIN_DIR/d" "$shell_rc"
        rm -f "${shell_rc}.bak"
    fi
    
    echo ""
    echo "=========================================="
    echo -e "${GREEN}sshift uninstalled successfully!${NC}"
    echo "=========================================="
    echo ""
    info "You may need to restart your terminal for PATH changes to take effect"
}

# Check for updates
check_updates() {
    info "Checking for updates..."
    
    local local_version=$(get_installed_version)
    local remote_version=$(get_latest_version)
    
    info "Installed version: $local_version"
    info "Latest version: $remote_version"
    
    compare_versions "$local_version" "$remote_version"
    local result=$?
    
    if [ $result -eq 1 ]; then
        warn "New version available: $remote_version (current: $local_version)"
        return 1  # Update available
    elif [ $result -eq 2 ]; then
        info "Local version is newer than remote (development version?)"
        return 0
    else
        success "Already up to date (version $local_version)"
        return 0
    fi
}

# Main installation process
main() {
    # Parse arguments
    while [ $# -gt 0 ]; do
        case "$1" in
            --install-dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            --port)
                SERVER_PORT="$2"
                shift 2
                ;;
            --start)
                start_app
                exit 0
                ;;
            --stop)
                stop_app
                exit 0
                ;;
            --restart)
                info "Restarting sshift..."
                stop_app
                start_app
                exit 0
                ;;
            --status)
                if is_running; then
                    local pid=$(cat "$PID_FILE")
                    success "sshift is running (PID: $pid)"
                    exit 0
                else
                    info "sshift is not running"
                    exit 1
                fi
                ;;
            --update)
                # Check if installed
                if ! command_exists sshift; then
                    error "sshift is not installed"
                fi
                
                echo ""
                echo "=========================================="
                echo "       sshift Update Script"
                echo "=========================================="
                echo ""
                
                info "Updating sshift..."
                update_sshift
                exit 0
                ;;
            --uninstall)
                uninstall_sshift
                exit 0
                ;;
            --help|-h)
                show_help
                ;;
            *)
                error "Unknown option: $1. Use --help for usage information."
                ;;
        esac
    done
    
    echo ""
    echo "=========================================="
    echo "       sshift Installation Script"
    echo "=========================================="
    echo ""
    
    # Show configuration
    info "Installation method: npm"
    if [ -n "$SERVER_PORT" ]; then
        info "Server port: $SERVER_PORT"
    fi
    
    # Check if already installed
    if command_exists sshift; then
        info "sshift is already installed"
        
        # Check for updates
        if ! check_updates; then
            # Update available
            read -p "Update sshift? [Y/n] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                update_sshift
            fi
        else
            # No update needed
            if is_running; then
                local pid=$(cat "$PID_FILE")
                info "sshift is already running (PID: $pid)"
            fi
        fi
    else
        # Fresh installation
        # Install Node.js if needed
        install_nodejs
        
        # Install sshift via npm
        install_sshift
        
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
    read -p "Start sshift automatically on login? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        setup_autostart
    fi
}

# Run main function
main "$@"