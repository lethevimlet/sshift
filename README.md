# SSHIFT - Web-based SSH/SFTP Terminal Client for the AI Stack

[![Documentation](https://img.shields.io/badge/docs-GitHub%20Pages-blue.svg)](https://lethevimlet.github.io/sshift/)
[![npm version](https://img.shields.io/npm/v/@lethevimlet/sshift.svg)](https://www.npmjs.com/package/@lethevimlet/sshift)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io/lethevimlet/sshift-blue.svg)](https://github.com/lethevimlet/sshift/pkgs/container/sshift)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, responsive web-based SSH and SFTP terminal client built with Node.js, Express, and xterm.js. Designed for the AI coding workflow — featuring tab flash notifications that alert you when AI tools like OpenCode or Claude are waiting for your input, so you never miss a prompt while multitasking. Also features excellent TUI support, tabbed sessions, bookmarks, and mobile-friendly design.

![SSHIFT Logo](media/logo.jpg)

## 📸 Screenshots

<div align="center">
  <img src="media/desktop_light.png" alt="SSHIFT Desktop (Light)" width="45%">
  <img src="media/desktop_dark.png" alt="SSHIFT Desktop (Dark)" width="45%">
</div>
<br>
<div align="center">
  <img src="media/mobile.png" alt="SSHIFT Mobile" width="30%">
</div>

## ✨ Features

- 🔐 **SSH Terminal** - Full xterm.js emulation with TUI support (vim, nano, htop, tmux)
- 📁 **SFTP Browser** - File manager interface with upload/download
- 🤖 **AI Attention Alerts** - Tab flash notifications when AI tools (OpenCode, Claude) need your input
- 🗂️ **Tabbed Interface** - Multiple concurrent sessions
- 🔖 **Bookmarks** - Save connection details for quick access
- 🔒 **Password Protection** - Optional password lock for app access
- ⌨️ **Mobile-Friendly** - Special keys popup for mobile devices
- 🎨 **Modern UI** - GitHub-inspired dark theme, fully responsive

## 🚀 Quick Start

```bash
# Install globally
npm install -g @lethevimlet/sshift

# Start the server
sshift
```

The application will be available at `https://localhost:8022`

## 📖 Documentation

Full documentation is available at [GitHub Pages](https://lethevimlet.github.io/sshift/).

- **[Installation](docs/installation.md)** - Detailed installation options
- **[Docker](docs/docker.md)** - Docker deployment and usage
- **[Configuration](docs/configuration.md)** - Configuration files and options
- **[Plugins](docs/configuration.md#plugins)** - AI attention alerts and plugin system
- **[API Reference](docs/api-reference.md)** - Socket.IO events and API
- **[Testing](docs/testing.md)** - Running and writing tests
- **[Contributing](docs/contributing.md)** - How to contribute

## 📦 Installation

### One-Liner Installation (Recommended)

The recommended way to install sshift - automatically handles updates and autostart configuration:

**Linux/macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.sh | bash
```

**Windows (PowerShell):**

```powershell
Set-ExecutionPolicy Bypass -Scope Process
Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.ps1" -UseBasicParsing).Content
```

> **Note:** The Windows installer requires PowerShell to be run as Administrator for npm global installations.

The installer will:
- Install Node.js 20+ if not present
- Install sshift globally via npm
- Start sshift after installation
- Configure autostart (optional, systemd on Linux, launchd on macOS, Task Scheduler on Windows)
- Create config at `~/.local/share/sshift/.env/config.json` with HTTPS enabled
- Print summary with HTTPS access links

### Docker

```bash
docker run -d -p 8022:8022 --name sshift ghcr.io/lethevimlet/sshift:latest

# Or with docker-compose
curl -O https://raw.githubusercontent.com/lethevimlet/sshift/main/docker/docker-compose.yml
docker-compose up -d
```

See [Docker README](docker/README.md) for detailed instructions.

### npm

```bash
npm install -g @lethevimlet/sshift
sshift
```

### From Source (GitHub)

```bash
git clone https://github.com/lethevimlet/sshift.git
cd sshift
npm install
npm start
```

## ⚙️ Configuration

SSHIFT uses a priority-based configuration system. Config files are searched in order; the first match wins.

### Config File Search (first match wins)

| Priority | Path | Notes |
|----------|------|-------|
| 1 | `~/.local/share/sshift/.env/config.json` | Primary user install location |
| 2 | `~/.local/share/bin/.env/config.json` | Alternative install location |
| 3 | `~/.local/share/sshift/config.json` | User install (no `.env` subdir) |
| 4 | `~/.local/share/bin/config.json` | Alternative location (no `.env` subdir) |
| 5 | `<PACKAGE_DIR>/.env/config.json` | NPM package directory |
| 6 | `<PACKAGE_DIR>/config.json` | NPM package root (fallback) |

### Port Priority

1. `--port` CLI argument (highest priority)
2. `PORT` environment variable
3. `config.json` `devPort` (when `NODE_ENV=development` or `--dev`)
4. `config.json` `port` (production)
5. Default: 8022 (production), 3000 (development)

### Bind Address Priority

1. `--bind` CLI argument
2. `BIND` environment variable
3. `config.json` `bind` setting
4. Default: `0.0.0.0`

See [Configuration](docs/configuration.md) for details.

## 🔒 HTTPS on Local Network (PWA / "Not Secure" Warnings)

When accessing sshift from a LAN IP (e.g., `https://192.168.1.50:8022`), browsers show "Not Secure" warnings because the self-signed certificate is untrusted. This also blocks PWA installation.

### Quick Fix: Chrome Flag

1. Go to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Enter your LAN URL: `https://192.168.1.50:8022`
3. Set to **Enabled** → **Relaunch**

### Permanent: Custom Trusted Certificate

Generate a cert for your LAN IP and configure sshift to use it:

```json
{
  "enableHttps": true,
  "certPath": "/path/to/sshift-lan-cert.pem",
  "keyPath": "/path/to/sshift-lan-key.pem"
}
```

Then add the certificate to your device's trusted root store. See [Configuration > HTTPS on Local Network](docs/configuration.md) for full instructions including nginx reverse proxy and mDNS options.

## 🤖 AI Attention Plugins

SSHIFT includes built-in plugins that detect when AI coding tools are waiting for user input and flash the browser tab to get your attention — perfect for when you're multitasking across tabs.

### OpenCode Attention

Detects when [OpenCode](https://opencode.ai) is waiting for input by tracking its spinner characters (⬝ ■ ▣) and prompt patterns. When the spinner stops or a prompt appears, the tab flashes.

### Claude Attention

Detects when [Claude Code](https://claude.ai) is waiting for input by tracking its spinner characters (⠋⠙⠹ braille patterns, ·✢✳✶✻✽) and prompt patterns like "❯", "Do you want", "Allow", and "Esc to cancel".

### Enabling Plugins

Add plugins to your `config.json`:

```json
{
  "plugins": [
    {
      "name": "opencode-attention",
      "enabled": true,
      "config": {
        "debounceMs": 300,
        "flashDuration": 0,
        "idleThreshold": 3000
      }
    },
    {
      "name": "claude-attention",
      "enabled": true,
      "config": {
        "debounceMs": 300,
        "flashDuration": 0,
        "idleThreshold": 3000,
        "cooldownMs": 1000
      }
    }
  ]
}
```

See [Configuration > Plugins](docs/configuration.md#plugins) for full details.

## 🛠️ Technology Stack

**Backend:** Node.js, Express, Socket.IO, ssh2  
**Frontend:** xterm.js, xterm addons  
**Development:** ESLint, Puppeteer

## 🤝 Contributing

Contributions are welcome! See [Contributing](docs/contributing.md) for guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [xterm.js](https://xtermjs.org/) - Terminal emulator for the web
- [ssh2](https://github.com/mscdex/ssh2) - SSH2 client and server modules
- [Socket.IO](https://socket.io/) - Real-time bidirectional event-based communication

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/lethevimlet/sshift/issues)
- **Discussions**: [GitHub Discussions](https://github.com/lethevimlet/sshift/discussions)

---

**Made with ❤️ by the SSHIFT Team**
