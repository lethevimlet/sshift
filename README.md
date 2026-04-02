# SSHIFT - Web-based SSH & SFTP Terminal Client

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, responsive web-based SSH and SFTP terminal client built with Node.js, Express, and xterm.js. Features excellent TUI support, tabbed sessions, bookmarks, and mobile-friendly design.

![SSHIFT Logo](media/logo.jpg)

## 📸 Screenshots

<div align="center">
  <img src="media/screenshot1.png" alt="SSH Terminal" width="45%">
  <img src="media/screenshot2.png" alt="SFTP Browser" width="45%">
</div>

## ✨ Features

### 🔐 SSH Terminal
- Full-featured terminal emulation with **xterm.js**
- Excellent **TUI support** (vim, nano, htop, tmux, etc.)
- **256-color** and **true color** support
- Proper terminal resizing
- Clickable web links
- Alternate buffer support (for TUI applications)

### 📁 SFTP Browser
- Browse remote directories with a file manager interface
- **Download files** (click to download)
- **Upload files** (drag & drop or file picker)
- Create directories
- Delete files and directories
- File size and permissions display

### 🗂️ Tabbed Interface
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
- **GitHub-inspired dark theme**
- Easy on the eyes
- High contrast for readability
- Fully responsive design
- Works on desktop, tablet, and mobile

## 📦 Installation

### Prerequisites
- **Node.js** >= 14.0.0
- **npm** or **yarn**

### Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd sshift

# Install dependencies
npm install

# Start the server
npm start
```

The application will be available at `http://localhost:3000`

### Development Mode

```bash
# Start with auto-reload on file changes
npm run dev
```

## ⚙️ Configuration

### Configuration Files

SSHIFT uses a **priority-based configuration system** with multiple config file locations:

#### Environment Variables (`.env` files)

Environment variables are loaded from the following locations in **priority order** (highest to lowest):

1. `.env/.env.local` - **User-specific, private config** (highest priority)
2. `.env.local` - User-specific config in root (backward compatibility)
3. `.env/.env` - Shared environment config
4. `.env` - Default environment config (lowest priority)

**Example `.env/.env.local`:**
```env
# SSH Test Credentials
SSH_HOST=192.168.1.100
SSH_PORT=22
SSH_USER=myuser
SSH_PASS=mypassword

# Or use TEST_* variables
TEST_HOST=192.168.1.100
TEST_PORT=22
TEST_USER=testuser
TEST_PASS=testpassword
```

#### Configuration File (`config.json`)

The application configuration (bookmarks, settings) is loaded from:

1. `.env/config.json` - **User-specific, private config** (highest priority)
2. `config.json` - Default config in root (lowest priority)

**Example `.env/config.json`:**
```json
{
  "bookmarks": [
    {
      "id": "1701234567890",
      "name": "Production Server",
      "host": "prod.example.com",
      "port": 22,
      "username": "deploy",
      "type": "ssh"
    },
    {
      "id": "1701234567891",
      "name": "Development Server",
      "host": "dev.example.com",
      "port": 22,
      "username": "developer",
      "type": "ssh"
    }
  ],
  "settings": {
    "fontSize": 14,
    "fontFamily": "'Courier New', monospace",
    "theme": "dark"
  }
}
```

### Why Multiple Config Locations?

- **`.env/` directory** - Git-ignored, perfect for sensitive data (passwords, keys, production credentials)
- **Root config files** - Can be committed to git for shared team settings
- **Priority system** - User-specific settings override shared defaults

### Git Ignore

The `.gitignore` file automatically excludes:
```
.env/
.env.local
.env.*.local
config.json
```

This ensures sensitive credentials never get committed to version control.

## 🚀 Usage

### SSH Connection

1. Click the **"SSH"** button in the header
2. Enter connection details:
   - **Host** (hostname or IP address)
   - **Port** (default: 22)
   - **Username**
   - **Password** or **Private Key**
3. Click **"Connect"**

### SFTP Connection

1. Click the **"SFTP"** button in the header
2. Enter connection details (same as SSH)
3. Use the file browser to:
   - **Navigate** directories (double-click)
   - **Download files** (click on file)
   - **Upload files** (upload button)
   - **Create directories** (folder button)
   - **Delete** files/folders (trash icon)

### Bookmarks

1. Click the **"+"** button in the sidebar
2. Enter bookmark details
3. Click **"Save"**
4. Click on a bookmark to quick-connect

### Special Keys (Mobile)

- Click the **keyboard icon** in the tabs bar
- On mobile, **tap on a tab** to show special keys
- Click any key to send it to the active session

## 🔒 Security & Multi-User Setup

### ⚠️ Important Security Notes

**SSHIFT is designed for single-user or trusted environments.** It does NOT include built-in authentication or multi-user support.

### Single User / Trusted Environment

For personal use or trusted networks:
- Run on `localhost` only (default)
- Use behind a firewall
- No additional setup needed

### Multi-User or Production Deployment

**If you need multi-user access or authentication, you MUST use a reverse proxy with authentication.**

Recommended authentication solutions:
- **Nginx + HTTP Basic Auth** - Simple password protection
- **Authelia** - Full-featured SSO with 2FA/MFA support
- **Cloudflare Access** - Zero-trust authentication (no server config needed)
- **OAuth2 Proxy** - Google, GitHub, or other OAuth providers
- **Keycloak** - Enterprise SSO solution

For detailed setup instructions, see the documentation of your chosen authentication solution.

### Production Checklist

- [ ] Use **HTTPS/WSS** (SSL/TLS required)
- [ ] Configure **reverse proxy** with authentication
- [ ] Set up **firewall rules** (limit access by IP)
- [ ] Use **strong passwords** for SSH connections
- [ ] Consider **SSH key authentication** instead of passwords
- [ ] Enable **rate limiting** in your reverse proxy
- [ ] Set up **logging** and monitoring
- [ ] Keep **Node.js** and dependencies updated

## 🧪 Testing

SSHIFT includes comprehensive test suites for SSH and SFTP functionality.

### Test Setup

Tests use environment variables from `.env` files (see Configuration section).

```bash
# Create test environment file
cp .env/config.json.example .env/config.json
# Edit with your test server credentials
nano .env/.env.local
```

### Run Tests

```bash
# Run all tests
npm test

# Run specific test file
node test/test-client.js

# Run with verbose output
DEBUG=* npm test
```

### Test Files

- `test/test-client.js` - Socket.IO and SSH connection tests
- `test/test-server.js` - HTTP server tests
- `test/test-helper.js` - Test utilities and configuration

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

## 📝 API Reference

### Socket.IO Events

#### Client → Server

```javascript
// SSH Connection
socket.emit('ssh-connect', {
  sessionId: 'unique-session-id',
  host: 'example.com',
  port: 22,
  username: 'user',
  password: 'pass',
  cols: 80,
  rows: 24
});

// SSH Data
socket.emit('ssh-data', {
  sessionId: 'session-id',
  data: 'ls -la\n'
});

// SSH Resize
socket.emit('ssh-resize', {
  sessionId: 'session-id',
  cols: 120,
  rows: 40
});

// SSH Disconnect
socket.emit('ssh-disconnect', {
  sessionId: 'session-id'
});

// SFTP Connection
socket.emit('sftp-connect', {
  sessionId: 'unique-session-id',
  host: 'example.com',
  port: 22,
  username: 'user',
  password: 'pass'
});

// SFTP List Directory
socket.emit('sftp-list', {
  sessionId: 'session-id',
  path: '/home/user'
});
```

#### Server → Client

```javascript
// SSH Connected
socket.on('ssh-connected', (data) => {
  console.log('Session ID:', data.sessionId);
});

// SSH Data
socket.on('ssh-data', (data) => {
  console.log('Output:', data.data);
});

// SSH Error
socket.on('ssh-error', (data) => {
  console.error('Error:', data.message);
});

// SFTP Connected
socket.on('sftp-connected', (data) => {
  console.log('SFTP Session ID:', data.sessionId);
});

// SFTP List Result
socket.on('sftp-list-result', (data) => {
  console.log('Files:', data.files);
});
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [xterm.js](https://xtermjs.org/) - Terminal emulator for the web
- [ssh2](https://github.com/mscdex/ssh2) - SSH2 client and server modules
- [Socket.IO](https://socket.io/) - Real-time bidirectional event-based communication

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/sshift/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/sshift/discussions)

---

**Made with ❤️ by the SSHIFT Team**