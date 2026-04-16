#!/bin/bash
# sshift Installation Script for Linux/macOS
# Installs Node.js (if not present) and installs sshift via npm
# Checks for updates and restarts the app if needed
#
# Usage: ./sshift-install.sh [OPTIONS]
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

NODE_VERSION="20"
NPM_PACKAGE="@lethevimlet/sshift"
INSTALL_DIR="$HOME/.local/share/sshift"
PID_FILE="/tmp/sshift.pid"
SERVICE_NAME="sshift"
SERVER_PORT=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

prompt_user() {
    local prompt="$1"
    local default="${2:-}"

    if [ -t 0 ]; then
        # stdin is a terminal, read normally
        read -p "$prompt" -n 1 -r
        echo
        PROMPT_RESPONSE="$REPLY"
    else
        # No interactive terminal (piped or non-interactive, e.g. curl | bash)
        # Try /dev/tty first so the user can still interact
        local prompted=false
        if [ -e /dev/tty ]; then
            printf "%s" "$prompt" > /dev/tty 2>/dev/null && prompted=true
        fi
        if $prompted; then
            IFS= read -n 1 -r < /dev/tty 2>/dev/null
            echo > /dev/tty 2>/dev/null
            PROMPT_RESPONSE="${REPLY:-$default}"
        elif [ -n "$default" ]; then
            # No terminal available at all, use default
            info "$prompt(default: $default)"
            PROMPT_RESPONSE="$default"
        else
            error "Cannot read user input (no terminal available) and no default value"
        fi
    fi
}

show_help() {
    cat << EOF
sshift Installation Script for Linux/macOS

Usage: ./sshift-install.sh [OPTIONS]

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
  ./sshift-install.sh                              # Install with defaults
  ./sshift-install.sh --port 8080                   # Install with custom port
  ./sshift-install.sh --install-dir /opt/sshift     # Install to custom directory
  ./sshift-install.sh --update                      # Update existing installation
  ./sshift-install.sh --start                       # Start sshift
  ./sshift-install.sh --stop                        # Stop sshift
  ./sshift-install.sh --restart                     # Restart sshift
  ./sshift-install.sh --status                      # Check status
  ./sshift-install.sh --uninstall                   # Remove sshift

One-liner installation:
  curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.sh | bash
  wget -qO- https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.sh | bash
EOF
    exit 0
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

get_installed_version() {
    if command_exists sshift; then
        local version=$(npm list -g @lethevimlet/sshift --depth=0 --json 2>/dev/null | grep -oP '"version":\s*"\K[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        if [ -n "$version" ]; then
            echo "$version"
        else
            npm list -g @lethevimlet/sshift --depth=0 2>/dev/null | grep -oP '@lethevimlet/sshift@\K[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0"
        fi
    else
        echo "0.0.0"
    fi
}

get_latest_version() {
    npm view @lethevimlet/sshift version 2>/dev/null || echo "0.0.0"
}

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
            return 1
        elif [ "$local_num" -gt "$remote_num" ]; then
            return 2
        fi
    done

    return 0
}

get_lan_ip() {
    local ip=""
    if command_exists ip; then
        ip=$(ip route get 1 2>/dev/null | grep -oP 'src \K[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    fi
    if [ -z "$ip" ] && command_exists hostname; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi
    if [ -z "$ip" ] && command_exists ifconfig; then
        ip=$(ifconfig 2>/dev/null | grep -E 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -1)
    fi
    if [ -z "$ip" ]; then
        ip="0.0.0.0"
    fi
    echo "$ip"
}

get_effective_port() {
    local port="${SERVER_PORT:-8022}"
    local config_path="$INSTALL_DIR/.env/config.json"
    if [ -z "$SERVER_PORT" ] && [ -f "$config_path" ]; then
        local config_port=$(grep -oP '"port"\s*:\s*\K[0-9]+' "$config_path" 2>/dev/null | head -1)
        if [ -n "$config_port" ]; then
            port="$config_port"
        fi
    fi
    echo "$port"
}

is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" >/dev/null 2>&1; then
            return 0
        else
            rm -f "$PID_FILE"
        fi
    fi
    return 1
}

stop_app() {
    if command_exists systemctl && systemctl --user is-active "$SERVICE_NAME" >/dev/null 2>&1; then
        info "Stopping sshift via systemd..."
        systemctl --user stop "$SERVICE_NAME"
        sleep 2
        return
    fi

    if is_running; then
        local pid=$(cat "$PID_FILE")
        info "Stopping sshift (PID: $pid)..."

        kill "$pid" 2>/dev/null || true
        sleep 2

        if ps -p "$pid" >/dev/null 2>&1; then
            warn "Process did not stop gracefully, force killing..."
            kill -9 "$pid" 2>/dev/null || true
            sleep 1
        fi

        rm -f "$PID_FILE"
        success "sshift stopped"
    else
        if [ -f "$PID_FILE" ]; then
            rm -f "$PID_FILE"
            info "Removed stale PID file"
        fi
    fi
}

start_app() {
    info "Starting sshift..."

    if is_running; then
        local pid=$(cat "$PID_FILE")
        warn "sshift is already running (PID: $pid)"
        return
    fi

    mkdir -p "$INSTALL_DIR/.env"

    local sshift_path=$(which sshift 2>/dev/null || echo "sshift")

    cd "$INSTALL_DIR"
    nohup "$sshift_path" > "$INSTALL_DIR/sshift.log" 2>&1 &
    local pid=$!

    mkdir -p "$(dirname "$PID_FILE")"
    echo "$pid" > "$PID_FILE"

    sleep 2

    if ps -p "$pid" >/dev/null 2>&1; then
        success "sshift started (PID: $pid)"
        info "Logs: $INSTALL_DIR/sshift.log"
    else
        error "sshift failed to start. Check logs at $INSTALL_DIR/sshift.log"
    fi
}

install_nodejs() {
    if command_exists node; then
        local node_version=$(node -v 2>/dev/null | sed 's/v//')

        if [ -z "$node_version" ]; then
            warn "Node.js is installed but not working. This may be a glibc version issue."
            warn "On Arch-based systems, please run: sudo pacman -Syu"
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

    if ! command_exists npm; then
        info "npm not found, will be installed with Node.js"
    fi

    info "Installing Node.js $NODE_VERSION..."

    if [ "$(uname)" = "Darwin" ]; then
        if command_exists brew; then
            brew install node@${NODE_VERSION}
        else
            error "Homebrew is not installed. Please install Homebrew first: https://brew.sh/"
        fi
    else
        if [ -f /etc/arch-release ] || command_exists pacman; then
            info "Detected Arch-based system"
            info "Updating system packages (required for Node.js compatibility)..."

            local glibc_version=$(ldd --version 2>/dev/null | head -n1 | grep -oP '\d+\.\d+' | head -1)
            info "Current glibc version: $glibc_version"

            if ! sudo pacman -Syu --noconfirm; then
                warn "System update failed or was cancelled"
                warn "If you're on an Arch-based system, please run: sudo pacman -Syu"
                error "System update required for Node.js compatibility"
            fi

            if ! sudo pacman -S --noconfirm nodejs npm; then
                error "Failed to install Node.js via pacman"
            fi

            if ! node -v >/dev/null 2>&1; then
                error "Node.js installed but not working. Your system may need a reboot after glibc update."
            fi
        elif command_exists apt-get; then
            info "Detected Debian/Ubuntu system"
            if ! command_exists curl; then
                sudo apt-get update
                sudo apt-get install -y curl
            fi
            curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command_exists yum; then
            info "Detected RHEL/CentOS system"
            curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
            sudo yum install -y nodejs
        elif command_exists dnf; then
            info "Detected Fedora system"
            curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
            sudo dnf install -y nodejs
        else
            error "Unsupported package manager. Please install Node.js $NODE_VERSION manually from https://nodejs.org/"
        fi
    fi

    if command_exists node && node -v >/dev/null 2>&1; then
        success "Node.js $(node -v) installed successfully"
    else
        error "Failed to install Node.js or Node.js is not functional"
    fi

    if command_exists npm; then
        success "npm $(npm -v) installed successfully"
    else
        error "npm was not installed. Please install npm manually."
    fi
}

install_sshift() {
    info "Installing sshift via npm..."

    if [ "$(id -u)" -eq 0 ]; then
        npm install -g @lethevimlet/sshift
    elif [ -w /usr/lib/node_modules ] 2>/dev/null || [ -w /usr/local/lib/node_modules ] 2>/dev/null; then
        npm install -g @lethevimlet/sshift
    else
        sudo npm install -g @lethevimlet/sshift
    fi

    if [ $? -eq 0 ]; then
        success "sshift installed successfully"
    else
        error "Failed to install sshift"
    fi
}

update_sshift() {
    info "Updating sshift..."

    if is_running; then
        stop_app
    fi

    if [ "$(id -u)" -eq 0 ]; then
        npm update -g @lethevimlet/sshift
    elif [ -w /usr/lib/node_modules ] 2>/dev/null || [ -w /usr/local/lib/node_modules ] 2>/dev/null; then
        npm update -g @lethevimlet/sshift
    else
        sudo npm update -g @lethevimlet/sshift
    fi

    if [ $? -eq 0 ]; then
        success "sshift updated successfully"
    else
        error "Failed to update sshift"
    fi
}

create_config() {
    info "Creating configuration..."

    mkdir -p "$INSTALL_DIR/.env"

    local port="${SERVER_PORT:-8022}"
    local config_content="{
  \"port\": $port,
  \"devPort\": 3000,
  \"bind\": \"0.0.0.0\",
  \"enableHttps\": true,
  \"sticky\": true,
  \"sshKeepaliveInterval\": 15000,
  \"sshKeepaliveCountMax\": 500,
  \"bookmarks\": [],
  \"folders\": []
}"

    # Write config to user install directory (preferred by updated config loader)
    echo "$config_content" > "$INSTALL_DIR/.env/config.json"

    # Also write config to the npm package directory so the older config loader finds it
    local sshift_bin_path=$(which sshift 2>/dev/null)
    if [ -n "$sshift_bin_path" ]; then
        local real_path="$sshift_bin_path"
        # Resolve symlinks portably (readlink -f is not available on macOS BSD)
        while [ -L "$real_path" ]; do
            local target=$(readlink "$real_path" 2>/dev/null)
            if [ -z "$target" ]; then break; fi
            # Handle relative symlinks
            case "$target" in
                /*) real_path="$target" ;;
                *) real_path="$(dirname "$real_path")/$target" ;;
            esac
        done
        local pkg_dir=$(dirname "$real_path")
        if [ -d "$pkg_dir" ]; then
            if mkdir -p "$pkg_dir/.env" 2>/dev/null; then
                echo "$config_content" > "$pkg_dir/.env/config.json"
                echo "$config_content" > "$pkg_dir/config.json"
            else
                # Package directory may be root-owned (e.g. Homebrew npm global installs on macOS)
                # The user-space config at INSTALL_DIR is already written, so this is just a
                # backwards-compat fallback — skip silently if we lack permissions.
                warn "Cannot write to package directory $pkg_dir (permission denied). Using config at $INSTALL_DIR/.env/config.json instead."
            fi
        fi
    fi

    success "Configuration created with HTTPS enabled on port $port"
}

add_to_path() {
    local sshift_bin_path=$(which sshift 2>/dev/null)

    # Check if sshift command is already accessible
    if [ -n "$sshift_bin_path" ]; then
        local bin_dir=$(dirname "$sshift_bin_path")
        # The command works - check if its directory is in PATH
        if echo "$PATH" | grep -q "$bin_dir"; then
            success "sshift command available at $sshift_bin_path"
            return
        fi
        # Command works but dir not in PATH (unlikely but handle it)
        success "sshift command available at $sshift_bin_path"
        return
    fi

    # sshift not found in PATH - need to add its bin directory
    # Determine the npm global bin directory
    local npm_bin_dir=$(npm config get prefix 2>/dev/null)/bin
    if [ ! -d "$npm_bin_dir" ]; then
        # Some npm setups use prefix directly as the bin dir
        local npm_prefix=$(npm config get prefix 2>/dev/null)
        if [ -f "$npm_prefix/sshift" ]; then
            npm_bin_dir="$npm_prefix"
        fi
    fi

    # Fall back to common locations
    if [ -z "$npm_bin_dir" ] || [ ! -d "$npm_bin_dir" ]; then
        for candidate in "/usr/local/bin" "/usr/bin" "$HOME/.local/bin" "$HOME/.npm-global/bin"; do
            if [ -f "$candidate/sshift" ]; then
                npm_bin_dir="$candidate"
                break
            fi
        done
    fi

    if [ -z "$npm_bin_dir" ]; then
        warn "Could not determine sshift binary location. You may need to add it to PATH manually."
        return
    fi

    local shell_rc=""
    if [ -n "$ZSH_VERSION" ]; then
        shell_rc="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        shell_rc="$HOME/.bashrc"
    else
        shell_rc="$HOME/.profile"
    fi

    if ! grep -q "$npm_bin_dir" "$shell_rc" 2>/dev/null; then
        echo "" >> "$shell_rc"
        echo "# sshift" >> "$shell_rc"
        echo "export PATH=\"$npm_bin_dir:\$PATH\"" >> "$shell_rc"
        success "Added $npm_bin_dir to PATH in $shell_rc"
        info "Run: source $shell_rc  (or restart your terminal)"
    fi
}

setup_autostart() {
    info "Setting up autostart..."

    local env_dir="$INSTALL_DIR/.env"
    mkdir -p "$env_dir"

    local sshift_path=$(which sshift 2>/dev/null || echo "sshift")
    local node_path=$(which node 2>/dev/null || echo "node")

    if [ "$(uname)" = "Darwin" ]; then
        local plist_path="$HOME/Library/LaunchAgents/com.sshift.plist"

        # Resolve symlinks to get the real sshift script path
        local real_sshift_path="$sshift_path"
        while [ -L "$real_sshift_path" ]; do
            local target=$(readlink "$real_sshift_path" 2>/dev/null)
            if [ -z "$target" ]; then break; fi
            case "$target" in
                /*) real_sshift_path="$target" ;;
                *) real_sshift_path="$(dirname "$real_sshift_path")/$target" ;;
            esac
        done

        # Resolve node path
        local real_node_path="$node_path"
        while [ -L "$real_node_path" ]; do
            local target=$(readlink "$real_node_path" 2>/dev/null)
            if [ -z "$target" ]; then break; fi
            case "$target" in
                /*) real_node_path="$target" ;;
                *) real_node_path="$(dirname "$real_node_path")/$target" ;;
            esac
        done

        # Build PATH from common macOS node locations
        local path_dirs=""
        local bin_dirs=("/opt/homebrew/bin" "/usr/local/bin" "/usr/bin" "$HOME/.local/bin")
        for d in "${bin_dirs[@]}"; do
            if [ -d "$d" ]; then
                if [ -n "$path_dirs" ]; then
                    path_dirs="$path_dirs:$d"
                else
                    path_dirs="$d"
                fi
            fi
        done

        # Unload existing plist if present
        if [ -f "$plist_path" ]; then
            launchctl bootout gui/$(id -u) "$plist_path" 2>/dev/null || \
            launchctl unload "$plist_path" 2>/dev/null || true
        fi

        cat > "$plist_path" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sshift</string>
    <key>ProgramArguments</key>
    <array>
        <string>$real_node_path</string>
        <string>$real_sshift_path</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$path_dirs</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
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

        launchctl bootstrap gui/$(id -u) "$plist_path" 2>/dev/null || \
        launchctl load "$plist_path" 2>/dev/null || true
        success "Autostart configured via launchd"
        info "Config directory: $env_dir"
        info "To start now: launchctl start com.sshift"
        info "To stop: launchctl bootout gui/$(id -u) $plist_path"
    else
        local service_dir="$HOME/.config/systemd/user"
        local service_path="$service_dir/$SERVICE_NAME.service"

        mkdir -p "$service_dir"

        cat > "$service_path" << EOF
[Unit]
Description=sshift - Web-based SSH Terminal
After=network.target

[Service]
Type=simple
ExecStart=$sshift_path
WorkingDirectory=$INSTALL_DIR
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

        systemctl --user daemon-reload
        systemctl --user enable "$SERVICE_NAME"

        success "Autostart configured via systemd"
        info "Config directory: $env_dir"
        info "To start now: systemctl --user start $SERVICE_NAME"
    fi
}

remove_autostart() {
    if [ "$(uname)" = "Darwin" ]; then
        local plist_path="$HOME/Library/LaunchAgents/com.sshift.plist"
        if [ -f "$plist_path" ]; then
            launchctl bootout gui/$(id -u) "$plist_path" 2>/dev/null || \
            launchctl unload "$plist_path" 2>/dev/null || true
            rm -f "$plist_path"
        fi
    else
        systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
        systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
        rm -f "$HOME/.config/systemd/user/$SERVICE_NAME.service"
        systemctl --user daemon-reload 2>/dev/null || true
    fi
}

print_summary() {
    local port=$(get_effective_port)
    local lan_ip=$(get_lan_ip)
    local version=$(get_installed_version)
    local config_path="$INSTALL_DIR/.env/config.json"
    local sshift_path=$(which sshift 2>/dev/null || echo "sshift")

    echo ""
    echo -e "${BOLD}=========================================="
    echo -e "  sshift installed successfully!"
    echo -e "==========================================${NC}"
    echo ""
    echo -e "  ${CYAN}Version:${NC}       $version"
    echo -e "  ${CYAN}Installed:${NC}     $sshift_path"
    echo -e "  ${CYAN}Config:${NC}        $config_path"
    echo -e "  ${CYAN}Data dir:${NC}      $INSTALL_DIR"
    echo ""
    echo -e "  ${BOLD}${GREEN}Access sshift at:${NC}"
    echo -e "  ${BOLD}    https://localhost:$port${NC}"
    echo -e "  ${BOLD}    https://$lan_ip:$port${NC}"
    echo ""
    echo -e "  ${CYAN}Commands:${NC}"
    echo "    sshift              Start server"
    echo "    sshift --stop       Stop server"
    echo "    sshift --restart    Restart server"
    echo "    sshift --status     Check status"
    echo ""
    echo -e "  ${YELLOW}You may need to restart your terminal for PATH changes to take effect${NC}"
    echo ""
}

uninstall_sshift() {
    echo ""
    echo -e "${BOLD}=========================================="
    echo -e "       sshift Uninstallation Script"
    echo -e "==========================================${NC}"
    echo ""

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

    prompt_user "Continue with uninstallation? [y/N] " "n"
    if [[ ! $PROMPT_RESPONSE =~ ^[Yy]$ ]]; then
        info "Uninstallation cancelled"
        return
    fi

    if is_running; then
        info "Stopping running instance..."
        stop_app
    fi

    info "Removing autostart configuration..."
    remove_autostart

    info "Uninstalling sshift..."
    if [ "$(id -u)" -eq 0 ]; then
        npm uninstall -g @lethevimlet/sshift
    elif [ -w /usr/lib/node_modules ] 2>/dev/null || [ -w /usr/local/lib/node_modules ] 2>/dev/null; then
        npm uninstall -g @lethevimlet/sshift
    else
        sudo npm uninstall -g @lethevimlet/sshift
    fi

    if [ -d "$INSTALL_DIR" ]; then
        info "Removing configuration directory..."
        rm -rf "$INSTALL_DIR"
        success "Configuration directory removed"
    fi

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
        sed -i.bak '/# sshift/d' "$shell_rc"
        sed -i.bak "/sshift/d" "$shell_rc"
        rm -f "${shell_rc}.bak"
    fi

    echo ""
    echo -e "${GREEN}sshift uninstalled successfully!${NC}"
    echo ""
    info "You may need to restart your terminal for PATH changes to take effect"
}

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
        return 1
    elif [ $result -eq 2 ]; then
        info "Local version is newer than remote (development version?)"
        return 0
    else
        success "Already up to date (version $local_version)"
        return 0
    fi
}

main() {
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
                if ! command_exists sshift; then
                    error "sshift is not installed"
                fi

                echo ""
                echo -e "${BOLD}=========================================="
                echo -e "       sshift Update Script"
                echo -e "==========================================${NC}"
                echo ""

                info "Updating sshift..."
                update_sshift
                print_summary
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
    echo -e "${BOLD}=========================================="
    echo -e "       sshift Installation Script"
    echo -e "==========================================${NC}"
    echo ""

    info "Installation method: npm"
    if [ -n "$SERVER_PORT" ]; then
        info "Server port: $SERVER_PORT"
    fi

    if command_exists sshift; then
        info "sshift is already installed"

        if ! check_updates; then
            prompt_user "Update sshift? [Y/n] " "y"
            if [[ ! $PROMPT_RESPONSE =~ ^[Nn]$ ]]; then
                update_sshift
            fi
        else
            if is_running; then
                local pid=$(cat "$PID_FILE")
                info "sshift is already running (PID: $pid)"
            fi
        fi
    else
        install_nodejs
        install_sshift
        create_config
    fi

    echo ""
    info "Configuration options:"
    echo ""

    prompt_user "Add sshift to PATH? [Y/n] " "y"
    if [[ ! $PROMPT_RESPONSE =~ ^[Nn]$ ]]; then
        add_to_path
    fi

    local autostart_configured=false
    prompt_user "Start sshift automatically on login? [y/N] " "n"
    if [[ $PROMPT_RESPONSE =~ ^[Yy]$ ]]; then
        setup_autostart
        autostart_configured=true
    fi

    # Start sshift if not already running
    # Skip if autostart was configured — launchd/systemd already started it
    if ! $autostart_configured && ! is_running; then
        start_app
    fi

    print_summary
}

main "$@"