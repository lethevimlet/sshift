---
layout: page
title: Installation
---

## Prerequisites

- **Node.js** >= 20.0.0 (installed automatically by the installer if not present)
- **npm** or **yarn**

## One-Liner Installation (Recommended)

The recommended way to install sshift - automatically handles updates and autostart configuration:

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.sh | bash
```

Or with wget:

```bash
wget -qO- https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.sh | bash
```

### Windows (PowerShell)

```powershell
Set-ExecutionPolicy Bypass -Scope Process
Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.ps1" -UseBasicParsing).Content
```

### What the Installer Does

1. **Checks for Node.js** - Installs Node.js 20+ if not present
2. **Installs via npm** - Installs sshift globally using npm
3. **Creates configuration** - Sets up config at `~/.local/share/sshift/.env/config.json` with HTTPS enabled
4. **Configures autostart** (optional) - Sets up sshift to start on boot
5. **Starts the service** - Automatically starts sshift after installation
6. **Checks for updates** - Compares local and remote versions

### Custom Installation Options

You can customize the installation with command-line arguments:

#### Linux / macOS

```bash
# Install with custom port
curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.sh | bash -s -- --port 8080

# Show help
./sshift-install.sh --help
```

#### Windows (PowerShell)

```powershell
# Install with custom port
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.ps1" -OutFile "sshift-install.ps1"
.\sshift-install.ps1 -port 8080

# Show help
.\sshift-install.ps1 -help
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

See [Docker documentation]({{ site.baseurl }}/docker.html) for detailed instructions.

## npm Installation

Install globally via npm:

```bash
# Install globally
npm install -g @lethevimlet/sshift

# Start the server
sshift
```

The application will be available at `https://localhost:8022`

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

The application will be available at `https://localhost:8022` (default production port)

## Development Mode

```bash
# Start in development mode (port 3000)
npm run dev
```

## Port Configuration

SSHIFT uses a flexible port configuration system with the following priority (highest to lowest):

1. **`--port` CLI argument** (sets `PORT` env var; highest priority)
2. **`PORT` environment variable** (from `.env` files or shell)
3. **`config.json` `devPort`** (when `NODE_ENV=development` or `--dev`)
4. **`config.json` `port`** (production)
5. **Default ports**: 8022 (production), 3000 (development)

```bash
# Run on custom port (CLI argument)
sshift --port 9000

# Run on custom port (environment variable)
PORT=9000 ./sshift

# Run in development mode (uses devPort from config or 3000)
sshift --dev

# Or configure in config.json
{
  "port": 8022,      # Production port
  "devPort": 3000    # Development port
}
```

## Bind Address Configuration

SSHIFT can bind to a specific network interface. By default, it binds to `0.0.0.0` (all interfaces).

1. **`--bind` CLI argument** (sets `BIND` env var; highest priority)
2. **`BIND` environment variable** (from `.env` files or shell)
3. **`config.json` `bind`** setting
4. **Default**: `0.0.0.0` (all interfaces)

```bash
# Bind to localhost only (CLI argument)
sshift --bind 127.0.0.1

# Bind to localhost only (environment variable)
BIND=127.0.0.1 ./sshift

# Bind to specific interface
sshift --bind 192.168.1.100

# Or configure in config.json
{
  "bind": "0.0.0.0"  # Bind to all interfaces (default)
}
```