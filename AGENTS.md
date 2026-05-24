# Agent Instructions

This project uses a `.agents` directory for all AI-generated documentation files.

## Version Control Rules

**CRITICAL: NEVER commit or push without explicit user permission.**

- **DO NOT** commit changes locally without asking
- **DO NOT** push to remote without explicit permission
- **DO NOT** create pull requests without being asked
- Always ask the user before any git operations (commit, push, PR)
- The user will handle version control operations themselves when ready

### Secret scanning (gitleaks)

Pre-commit hooks and CI scan for leaked secrets using [gitleaks](https://github.com/gitleaks/gitleaks):

- **Pre-commit hook**: Installed via [pre-commit](https://pre-commit.com) — blocks commits containing API keys, passwords, tokens, private keys, etc. Run `pre-commit install` after cloning to enable.
- **CI**: The `gitleaks` job in `.github/workflows/ci.yml` scans the full git history on every PR and push.
- **Config**: `.gitleaks.toml` extends the default ruleset with project-specific allowlists.

To bypass a false positive, add `gitleaks:allow` as a comment on the offending line.

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

## Package Manager & Supply Chain Security

### pnpm (primary)

pnpm is the **primary package manager** for development and CI. It provides:

- **1-week minimum release age** (`minimumReleaseAge: 10080` minutes = 7 days): New packages must be at least 7 days old before they can be installed. This is a time gate against supply chain attacks on newly published packages. `@lethevimlet/sshift` itself is excluded so new releases are always installable immediately.
- **Trust policy** (`trustPolicy: no-downgrade`): Blocks installation of package versions with weaker trust evidence (e.g., provenance/signatures) than previously published versions. `@lethevimlet/sshift` is excluded from this check as well.
- **Strict release age enforcement** (`minimumReleaseAgeStrict: true`): Fails resolution instead of falling back to newer versions that don't meet the age requirement.

Configuration lives in `pnpm-workspace.yaml` (pnpm v10 also reads these from `.npmrc`).

### Key files
- `pnpm-workspace.yaml` — pnpm workspace config and supply chain settings
- `.npmrc` — Registry/auth settings and pnpm overrides (also `minimum-release-age` for v10 compat)

### npm compatibility

npm users can still `npm install` — both `package-lock.json` and `pnpm-lock.yaml` are tracked. npm users bypass the time gate but get the same dependencies.

### Socket.dev

Socket.dev is not used. Supply chain security is handled entirely by pnpm's built-in gates:
- **`trustPolicy: no-downgrade`** — blocks packages that lose provenance/signatures between versions
- **`minimumReleaseAge: 10080`** — 7-day time gate on all new package releases
- **`minimumReleaseAgeStrict: true`** — fails install instead of falling back to an newer, ungated version

### Socket Firewall (sfw)

[Socket Firewall Free](https://docs.socket.dev/docs/socket-firewall-free) (`sfw`) is a command prefix that intercepts package manager network requests and blocks confirmed malware before it reaches your filesystem. It supports `npm`, `yarn`, and `pnpm`.

Usage:
- `sfw pnpm install` — Install dependencies with Socket scanning (malware blocking + AI warning)
- `pnpm install:safe` — Shortcut that runs `sfw pnpm install`
- `sfw pnpm add <pkg>` — Add a dependency with Socket scanning

Installation: `npm i -g sfw` or download from [GitHub releases](https://github.com/SocketDev/sfw-free/releases).

Note: `sfw` requires network connectivity and only works with public registries. It blocks confirmed malware and warns on AI-detected threats.

### Commands
- `pnpm install` — Install dependencies (with 1-week release age gate)
- `pnpm install:safe` or `sfw pnpm install` — Install with pnpm time gate + Socket Firewall scanning
- `sfw pnpm add <pkg>` — Add a dependency with Socket scanning
- `npm install` — Install without time gate (npm compatibility)

### GitHub Actions

All CI workflows enforce both supply chain policies:

- **`.github/workflows/ci.yml`** — Runs on PRs and pushes to main/develop:
  - Installs dependencies with `sfw pnpm install --frozen-lockfile` (Socket scanning + time gate)
  - Runs the test suite
- **`.github/workflows/npm-publish.yml`** — Runs on push to main when `package.json` changes:
  - Installs dependencies with `sfw pnpm install --frozen-lockfile` (Socket scanning + time gate)
  - Publishes to npm with provenance

Both workflows use the `socketdev/action@v1` GitHub Action to install `sfw` on the runner.

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

# Windows PowerShell (Admin)
Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lethevimlet/sshift/main/sshift-install.ps1" -UseBasicParsing).Content
```