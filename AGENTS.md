# Agent Instructions

This project uses a `.agents` directory for all AI-generated documentation files.

## Version Control Rules

**CRITICAL: NEVER commit or push without explicit user permission.**

- **DO NOT** commit changes locally without asking
- **DO NOT** push to remote without explicit permission
- **DO NOT** create pull requests without being asked
- Always ask the user before any git operations (commit, push, PR)
- The user will handle version control operations themselves when ready

## Guidelines for AI Agents

**DO NOT** create AI-related markdown files in the project root directory.

**Instead**, write all AI-generated documentation, summaries, and implementation notes to the `.agents/` directory.

### Files that belong in `.agents/`:
- Implementation summaries
- Debugging notes
- Refactoring documentation
- Test documentation
- Any AI-generated markdown files

### Files that should remain in root:
- `README.md` - Project readme for human developers
- `LICENSE` - License file
- `CHANGELOG.md` - User-facing changelog (if applicable)

## Config Files

### Config Search Paths (first match wins)

| Priority | Path | Notes |
|----------|------|-------|
| 1 | `<PACKAGE_DIR>/.env/config.json` | NPM package directory (user-managed, not written by installer) |
| 2 | `<PACKAGE_DIR>/config.json` | NPM package root (user-managed, not written by installer) |
| 3 | `~/.local/share/sshift/.env/config.json` | **Default location** — installer and `ensureConfig()` create here |
| 4 | `~/.local/share/sshift/config.json` | User install (no `.env` subdir) |

If no config file exists at any path, `ensureConfig()` creates one at `~/.local/share/sshift/.env/config.json` (user-space, survives `npm update`).

### .env File Loading (first setter wins, dotenv does not overwrite)

`.env` files are loaded from multiple locations. Since `dotenv` does not overwrite existing env vars, the first file to set a variable wins:

1. `<PACKAGE_DIR>/.env/.env.local`
2. `<PACKAGE_DIR>/.env.local`
3. `<PACKAGE_DIR>/.env/.env`
4. `<PACKAGE_DIR>/.env`
5. `~/.local/share/sshift/.env/.env.local`
6. `~/.local/share/sshift/.env.local`
7. `~/.local/share/sshift/.env/.env`
8. `~/.local/share/sshift/.env`

The CLI entry point (`sshift`) additionally loads `.env` files from its own script directory before the server's env-loader runs.

### Other Files

- `config.json.example` - Example configuration template (tracked in git)

## Installation Scripts

The project includes installation scripts for easy setup:

### sshift-install.sh (Linux/macOS)
- Installs Node.js 20+ and npm if not present
- Installs sshift globally via npm (`npm install -g @lethevimlet/sshift`)
- Creates config at `~/.local/share/sshift/.env/config.json`; merges new default properties into existing config without overwriting user values
- Configures autostart on boot (systemd on Linux, launchd on macOS)
- Starts sshift after installation
- Prints summary box with install path and URLs
- Supports arguments: `--install-dir DIR`, `--port PORT`, `--start`, `--stop`, `--restart`, `--status`, `--update`, `--uninstall`

### sshift-install.ps1 (Windows)
- Installs Node.js 20+ if not present
- Installs sshift via npm
- Creates config at `~/.local/share/sshift/.env/config.json`; merges new default properties into existing config without overwriting user values
- Configures autostart on boot via Task Scheduler
- Prints summary box with install path and URLs
- Supports arguments: `-installDir DIR`, `-port PORT`, `-start`, `-stop`, `-restart`, `-status`, `-update`, `-uninstall`, `-help`

### sshift (Executable)
- Node.js executable with hashbang (`#!/usr/bin/env node`)
- Can be symlinked to `/usr/local/bin` or run directly
- Loads environment variables from `.env` files
- Starts the server on the configured port

### Port Configuration
- **Default port**: 8022 (production)
- **Development port**: 3000 (when `NODE_ENV=development`)
- **Default protocol**: HTTPS (self-signed certificates, configurable via `enableHttps`)
- **HTTP redirect**: When HTTPS is enabled, plain HTTP requests on the same port are redirected to HTTPS via a dual-protocol listener (configurable via `httpRedirect`, default enabled)
- **Port Priority**:
  1. `--port` CLI argument (sets `PORT` env var, highest priority)
  2. `PORT` environment variable (from `.env` files or shell)
  3. `config.json` `devPort` (when `NODE_ENV=development` or `--dev`)
  4. `config.json` `port` (production)
  5. Default: 8022 (production), 3000 (development)
- **Bind address priority**:
  1. `--bind` CLI argument (sets `BIND` env var)
  2. `BIND` environment variable
  3. `config.json` `bind` property
  4. Default: `0.0.0.0`

## One-Liner Installation

```bash
# Linux/macOS
curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.sh | bash

# Windows (PowerShell)
Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.ps1" -UseBasicParsing).Content
```