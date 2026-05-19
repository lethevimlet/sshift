![SSHIFT Logo]({{ site.baseurl }}/media/logo.jpg)

# SSHIFT - Web-based SSH/SFTP Terminal Client for the AI Stack

[![Documentation](https://img.shields.io/badge/docs-GitHub%20Pages-blue.svg)](https://lethevimlet.github.io/sshift/)
[![npm version](https://img.shields.io/npm/v/@lethevimlet/sshift.svg)](https://www.npmjs.com/package/@lethevimlet/sshift)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io/lethevimlet/sshift-blue.svg)](https://github.com/lethevimlet/sshift/pkgs/container/sshift)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, responsive web-based SSH and SFTP terminal client built with Node.js, Express, and xterm.js. Designed for the AI coding workflow — featuring tab flash notifications that alert you when AI tools like OpenCode or Claude are waiting for your input, so you never miss a prompt while multitasking. Also features excellent TUI support, tabbed sessions, bookmarks, and mobile-friendly design.

## 📸 Screenshots

<div align="center">
  <img src="{{ site.baseurl }}/media/desktop_light.png" alt="SSHIFT Desktop (Light)" width="45%">
  <img src="{{ site.baseurl }}/media/desktop_dark.png" alt="SSHIFT Desktop (Dark)" width="45%">
</div>
<br>
<div align="center">
  <img src="{{ site.baseurl }}/media/mobile.png" alt="SSHIFT Mobile" width="30%">
</div>

## ✨ Features

### 🔐 SSH Terminal
- Full-featured terminal emulation with **xterm.js**
- Excellent **TUI support** (vim, nano, htop, tmux, etc.)
- **256-color** and **true color** support
- Proper terminal resizing
- Clickable web links
- Alternate buffer support (for TUI applications)

### 🤖 AI Attention Alerts
- **OpenCode** — Detects when OpenCode is waiting for input (spinner patterns ⬝ ■ ▣)
- **Claude Code** — Detects when Claude is waiting for input (braille spinners, ·✢✳✶✻✽, prompt patterns like "❯", "Do you want", "Allow")
- Tab **flash notifications** so you never miss a prompt while multitasking across tabs
- Configurable debounce, idle threshold, and cooldown settings

### 📁 SFTP Browser
- Browse remote directories with a file manager interface
- **Download files** (click to download)
- **Upload files** (drag & drop or file picker)
- Create directories
- Delete files and directories
- File size and permissions display

### 🗂️ Tabbed Interface
- **Persistent background SSH sessions** stay alive while browsing
- Multiple concurrent SSH and SFTP sessions
- Switch between sessions with tabs
- Visual session indicators
- Easy tab management (close, reorder)
- Session persistence

### 🔖 Bookmarks
- Save connection details for quick access
- Edit and delete bookmarks
- Persistent storage in configuration file
- Quick connect from sidebar

### ⌨️ Special Keys Popup
- **Mobile-friendly** special keys input
- Ctrl+C, Ctrl+D, Ctrl+Z, etc.
- Function keys F1-F12
- Arrow keys and navigation keys
- Triggered by clicking on tabs (mobile)

### 🎨 Modern UI
- **Configurable themes** - light/dark, accent colors, terminal color schemes
- Easy on the eyes
- High contrast for readability
- Fully responsive design
- Works on desktop, tablet, and mobile

## 🚀 Quick Start

The recommended way to install sshift - automatically handles updates and autostart configuration:

**Linux/macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.sh | bash
```

**Windows (PowerShell):**
```powershell
Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.ps1" -UseBasicParsing).Content
```

The installer will:
- Install Node.js 20+ if not present
- Install sshift globally via npm
- Start sshift after installation
- Configure autostart (optional, systemd on Linux, launchd on macOS, Task Scheduler on Windows)
- Create config at `<PACKAGE_DIR>/.env/config.json`
- Print summary with HTTPS access links

For detailed installation options, see the [Installation guide]({{ site.baseurl }}/installation.html).

## 📖 Documentation

- **[Installation]({{ site.baseurl }}/installation.html)** - Installation methods and configuration
- **[Docker]({{ site.baseurl }}/docker.html)** - Docker deployment and usage
- **[Configuration]({{ site.baseurl }}/configuration.html)** - Configuration files and options
- **[Plugins]({{ site.baseurl }}/configuration.html#plugins)** - AI attention alerts and plugin system
- **[API Reference]({{ site.baseurl }}/api-reference.html)** - Socket.IO events and API
- **[Testing]({{ site.baseurl }}/testing.html)** - Running and writing tests
- **[Contributing]({{ site.baseurl }}/contributing.html)** - How to contribute

## 🛠️ Technology Stack

### Backend
- **Node.js** - JavaScript runtime
- **Express** - Web server framework
- **Socket.IO** - WebSocket communication
- **ssh2** - SSH2 client and server modules

### Frontend
- **xterm.js** - Terminal emulator
- **xterm-addon-fit** - Terminal resizing
- **xterm-addon-web-links** - Clickable links
- **xterm-addon-search** - Search in terminal

### Development
- **ESLint** - Code linting
- **Puppeteer** - Browser testing

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/lethevimlet/sshift/issues)
- **Discussions**: [GitHub Discussions](https://github.com/lethevimlet/sshift/discussions)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/lethevimlet/sshift/blob/main/LICENSE) file for details.

## 🙏 Acknowledgments

- [xterm.js](https://xtermjs.org/) - Terminal emulator for the web
- [ssh2](https://github.com/mscdex/ssh2) - SSH2 client and server modules
- [Socket.IO](https://socket.io/) - Real-time bidirectional event-based communication

---

**Made with ❤️ by the SSHIFT Team**
