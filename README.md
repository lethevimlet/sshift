# SSHIFT - Web-based SSH & SFTP Terminal Client

[![npm version](https://img.shields.io/npm/v/@lethevimlet/sshift.svg)](https://www.npmjs.com/package/@lethevimlet/sshift)
[![Docker Image Size](https://img.shields.io/docker/image-size/ghcr.io/lethevimlet/sshift/latest)](https://github.com/lethevimlet/sshift/pkgs/container/sshift)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Documentation](https://img.shields.io/badge/docs-GitHub%20Pages-blue.svg)](https://lethevimlet.github.io/sshift/)

A modern, responsive web-based SSH and SFTP terminal client built with Node.js, Express, and xterm.js. Features excellent TUI support, tabbed sessions, bookmarks, and mobile-friendly design.

![SSHIFT Logo](media/logo.jpg)

## 📸 Screenshots

<div align="center">
  <img src="media/screenshot1.png" alt="SSH Terminal" width="45%">
  <img src="media/screenshot2.png" alt="SFTP Browser" width="45%">
</div>

## ✨ Features

- 🔐 **SSH Terminal** - Full xterm.js emulation with TUI support (vim, nano, htop, tmux)
- 📁 **SFTP Browser** - File manager interface with upload/download
- 🗂️ **Tabbed Interface** - Multiple concurrent sessions
- 🔖 **Bookmarks** - Save connection details for quick access
- ⌨️ **Mobile-Friendly** - Special keys popup for mobile devices
- 🎨 **Modern UI** - GitHub-inspired dark theme, fully responsive

## 🚀 Quick Start

```bash
# Install globally
npm install -g @lethevimlet/sshift

# Start the server
sshift
```

The application will be available at `http://localhost:8022`

## 📖 Documentation

Full documentation is available at [GitHub Pages](https://lethevimlet.github.io/sshift/).

- **[Installation](docs/installation.md)** - Detailed installation options
- **[Docker](docs/docker.md)** - Docker deployment and usage
- **[Configuration](docs/configuration.md)** - Configuration files and options
- **[API Reference](docs/api-reference.md)** - Socket.IO events and API
- **[Testing](docs/testing.md)** - Running and writing tests
- **[Contributing](docs/contributing.md)** - How to contribute

## 📦 Installation

### Quick Install (npm)

```bash
npm install -g @lethevimlet/sshift
sshift
```

### Docker

```bash
# Pull and run from GitHub Packages
docker pull ghcr.io/lethevimlet/sshift:latest
docker run -d -p 8022:8022 --name sshift ghcr.io/lethevimlet/sshift:latest

# Or with docker-compose
curl -O https://raw.githubusercontent.com/lethevimlet/sshift/main/docker/docker-compose.yml
docker-compose up -d
```

See [Docker README](docker/README.md) for detailed instructions.

### One-Liner Scripts

**Linux/macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lethevimlet/sshift/main/install.ps1" -UseBasicParsing).Content
```

### From Source

```bash
git clone https://github.com/lethevimlet/sshift.git
cd sshift
npm install
npm start
```

## ⚙️ Configuration

SSHIFT uses a priority-based configuration system:

1. Environment variables (`PORT`, `BIND`)
2. `.env/.env.local` - User-specific private config
3. `.env/config.json` - User-specific application config
4. `config.json` - Default application config

See [Configuration](docs/configuration.md) for details.

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
