---
layout: page
title: Installation
---

# Installation

## Prerequisites

- **Node.js** >= 20.0.0 (installed automatically by the installer if not present)
- **npm** or **yarn**

## One-Liner Installation (Recommended)

The recommended way to install sshift - automatically handles updates and autostart configuration:

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/install.sh | bash
```

Or with wget:

```bash
wget -qO- https://raw.githubusercontent.com/lethevimlet/sshift/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lethevimlet/sshift/main/install.ps1" -UseBasicParsing).Content
```

### What the Installer Does

1. **Checks for Node.js** - Installs Node.js 18+ if not present
2. **Installs via npm** - Installs sshift globally using npm
3. **Creates executable** - Sets up `sshift` command in your PATH
4. **Configures autostart** (optional) - Sets up sshift to start on boot
5. **Checks for updates** - Compares local and remote versions

### Custom Installation Options

You can customize the installation with command-line arguments:

#### Linux / macOS

```bash
# Install with custom port
curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/install.sh | bash -s -- --port 8080

# Show help
./install.sh --help
```

#### Windows (PowerShell)

```powershell
# Install with custom port
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lethevimlet/sshift/main/install.ps1" -OutFile "install.ps1"
.\install.ps1 -Port 8080

# Show help
.\install.ps1 -Help
```

## Docker

Run sshift using Docker:

```bash
docker run -d -p 8022:8022 --name sshift ghcr.io/lethevimlet/sshift:latest
```

Or with docker-compose:

```bash
curl -O https://raw.githubusercontent.com/lethevimlet/sshift/main/docker/docker-compose.yml
docker-compose up -d
```

See [Docker documentation](docker.html) for detailed instructions.

## npm Installation

Install globally via npm:

```bash
# Install globally
npm install -g @lethevimlet/sshift

# Start the server
sshift
```

The application will be available at `http://localhost:8022`

### Updating

```bash
npm update -g @lethevimlet/sshift
```

### Uninstallation

```bash
npm uninstall -g @lethevimlet/sshift
```

## Manual Installation from Source

If you prefer to install from source:

```bash
# Clone the repository
git clone https://github.com/lethevimlet/sshift.git
cd sshift

# Install dependencies
npm install

# Start the server
npm start
```

The application will be available at `http://localhost:8022` (default production port)

## Development Mode

```bash
# Start in development mode (port 3000)
npm run dev
```

## Port Configuration

SSHIFT uses a flexible port configuration system with the following priority:

1. **PORT environment variable** (highest priority)
2. **config.json** `port`/`devPort` settings
3. **Default ports**: 8022 (production), 3000 (development)

```bash
# Run on custom port
PORT=9000 ./sshift

# Run in development mode (uses devPort from config or 3000)
NODE_ENV=development ./sshift

# Or configure in config.json
{
  "port": 8022,      # Production port
  "devPort": 3000    # Development port
}
```

## Bind Address Configuration

SSHIFT can bind to a specific network interface. By default, it binds to `0.0.0.0` (all interfaces).

1. **BIND environment variable** (highest priority)
2. **config.json** `bind` setting
3. **Default**: `0.0.0.0` (all interfaces)

```bash
# Bind to localhost only (no external access)
BIND=127.0.0.1 ./sshift

# Bind to specific interface
BIND=192.168.1.100 ./sshift

# Or configure in config.json
{
  "bind": "0.0.0.0"  # Bind to all interfaces (default)
}
```