# Agent Instructions

This project uses a `.agents` directory for all AI-generated documentation files.

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

- `.env/config.json` - User-specific configuration (gitignored, contains sensitive data)
- `config.json` - Default/example configuration (gitignored)
- `config.json.example` - Example configuration template (tracked in git)

## Installation Scripts

The project includes installation scripts for easy setup:

### install.sh (Linux/macOS)
- Installs Node.js 18+ if not present
- Clones the repository to `~/.local/share/sshift` (or custom directory)
- Creates executable symlink in `~/.local/bin/sshift`
- Configures autostart (systemd on Linux, launchd on macOS)
- Supports arguments: `--install-dir DIR`, `--port PORT`

### install.ps1 (Windows)
- Installs Node.js 18+ if not present
- Clones the repository to `~/.local/share/sshift` (or custom directory)
- Creates executable wrappers in `~/.local/bin/` (sshift.cmd and sshift.ps1)
- Configures autostart (Task Scheduler)
- Supports arguments: `-InstallDir DIR`, `-Port PORT`

### sshift (Executable)
- Node.js executable with hashbang (`#!/usr/bin/env node`)
- Can be symlinked to `/usr/local/bin` or run directly
- Loads environment variables from `.env` files
- Starts the server on the configured port

### Port Configuration
- **Default port**: 8022 (production)
- **Development port**: 3000 (when `NODE_ENV=development`)
- **Port Priority**:
  1. `PORT` environment variable (highest priority)
  2. `config.json` `port`/`devPort` based on `NODE_ENV`
  3. Default: 8022 (production), 3000 (development)
- **Bind address**: Configurable via `config.json` (`bind` property, default: `0.0.0.0`)

## One-Liner Installation

```bash
# Linux/macOS
curl -fsSL https://raw.githubusercontent.com/lethevimlet/sshift/main/install.sh | bash

# Windows (PowerShell)
Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lethevimlet/sshift/main/install.ps1" -UseBasicParsing).Content
```