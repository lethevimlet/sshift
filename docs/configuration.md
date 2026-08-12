---
layout: page
title: Configuration
---

## Configuration Files

SSHIFT uses a **priority-based configuration system** with multiple config file locations.

### Environment Variables (`.env` files)

Environment variables are loaded from multiple locations. Since `dotenv` does not overwrite existing variables, **the first file to set a variable wins**:

| Priority | Path | Notes |
|----------|------|-------|
| 1 | `<PACKAGE_DIR>/.env/.env.local` | Package directory (local override) |
| 2 | `<PACKAGE_DIR>/.env.local` | Package directory (local) |
| 3 | `<PACKAGE_DIR>/.env/.env` | Package directory (shared) |
| 4 | `<PACKAGE_DIR>/.env` | Package directory (base) |
| 5 | `~/.local/share/sshift/.env/.env.local` | User install (local override) |
| 6 | `~/.local/share/sshift/.env.local` | User install (local) |
| 7 | `~/.local/share/sshift/.env/.env` | User install (shared) |
| 8 | `~/.local/share/sshift/.env` | User install (base) |

The CLI entry point (`sshift`) additionally loads `.env` files from its own script directory before the server's env-loader runs.

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

### Configuration File (`config.json`)

The application configuration (bookmarks, settings) is searched in the following locations. **The first match wins; remaining paths are ignored.**

| Priority | Path | Notes |
|----------|------|-------|
| 1 | `<PACKAGE_DIR>/.env/config.json` | NPM package directory |
| 2 | `<PACKAGE_DIR>/config.json` | NPM package root (created by `ensureConfig()` if no config found) |
| 3 | `~/.local/share/sshift/.env/config.json` | User install location |
| 4 | `~/.local/share/sshift/config.json` | User install (no `.env` subdir) |

If no config file exists at any path, `ensureConfig()` creates one at `<PACKAGE_DIR>/config.json`.

**Example `.env/config.json`:**

```json
{
  "port": 8022,
  "devPort": 3000,
  "bind": "0.0.0.0",
  "enableHttps": true,
  "sticky": true,
  "sshKeepaliveInterval": 15000,
  "sshKeepaliveCountMax": 500,
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

## Configuration Options

### Server Settings

- **`port`** (number): Server port (default: `8022`)
- **`devPort`** (number): Development server port (default: `3000`)
- **`bind`** (string): Bind address (default: `"0.0.0.0"`)
- **`enableHttps`** (boolean): Enable HTTPS with self-signed certificates (default: `true`)
- **`httpRedirect`** (boolean): When HTTPS is enabled, redirect plain HTTP requests on the same port to HTTPS (default: `true`)
- **`certPath`** (string|null): Absolute path to a custom TLS certificate file (PEM format). Both `certPath` and `keyPath` must be set together (default: `null`)
- **`keyPath`** (string|null): Absolute path to a custom TLS private key file (PEM format). Both `certPath` and `keyPath` must be set together (default: `null`)
- **`sticky`** (boolean): Enable sticky sessions (default: `true`)

### SSH Settings

- **`sshKeepaliveInterval`** (number): SSH keepalive interval in milliseconds (default: `15000`)
- **`sshKeepaliveCountMax`** (number): Maximum keepalive count (default: `500`)

### Password Protection

- **`passwordHash`** (string|null): SHA-256 hash of a password to restrict access to the application. When set, all API endpoints and WebSocket connections require authentication. Set to `null` (default) to disable password protection.

> **Note:** Password protection is intended as a basic access restriction for local/private networks. It is **not** a replacement for proper authentication. If you expose sshift to a public network, use additional security measures such as a reverse proxy with authentication, a VPN, or firewall rules.

Password protection can also be enabled/disabled through the Settings UI in the application. When enabling, you will be prompted to set a password; when disabling, you must provide the current password.

### HTTPS Configuration

By default, sshift uses HTTPS with self-signed certificates. This provides:
- Secure WebSocket connections (WSS)
- Better mobile device support for text selection
- Encrypted communication

When HTTPS is enabled, sshift automatically generates a self-signed certificate valid for:
- `localhost`
- Your machine's hostname
- All local IP addresses

The certificate is stored at `~/.local/share/sshift/ssl-cert.pem` and reused on subsequent starts. You can also download it at any time from `https://<your-sshift-host>:8022/api/cert`.

> **Note:** Your browser will show a security warning for self-signed certificates until you add the certificate to your device's trusted root store (see below). To proceed past the warning, click "Advanced" → "Proceed to localhost (unsafe)".

#### HTTP → HTTPS Redirect

When HTTPS is enabled, sshift listens on a single port and automatically redirects any plain HTTP requests to HTTPS. This means you can access sshift via `http://` and you'll be seamlessly upgraded to `https://`. This behavior is enabled by default via the `httpRedirect` setting.

To disable the redirect (serving only HTTPS, rejecting HTTP):

```json
{
  "enableHttps": true,
  "httpRedirect": false
}
```

#### Custom Certificate Paths

You can specify your own TLS certificate in `config.json` using `certPath` and `keyPath`:

```json
{
  "enableHttps": true,
  "certPath": "/path/to/your/certificate.pem",
  "keyPath": "/path/to/your/private-key.pem"
}
```

Both `certPath` and `keyPath` must be set together; if only one is provided, sshift will fall back to its self-signed certificate. Use absolute paths for reliability.

### HTTPS on Local Network (LAN) — PWA and "Not Secure" Warnings

When accessing sshift from a device on your local network (e.g., `https://192.168.1.50:8022`), browsers will display a "Not Secure" warning because the self-signed certificate is not trusted. This also prevents Progressive Web App (PWA) installation, which requires a trusted secure context.

#### Option 1: Trust the Auto-Generated Certificate (Recommended)

The simplest approach is to add sshift's auto-generated certificate to your device's trusted root store. This requires no custom certificate generation — just download and trust the one sshift already created.

**Step 1: Get the certificate**

Either:
- Visit `https://<your-sshift-host>:8022/api/cert` in your browser to download it, or
- Copy it from the server at `~/.local/share/sshift/ssl-cert.pem`

**Step 2: Trust the certificate on your devices**

- **Windows:** Double-click the `.pem` file → Install Certificate → Local Machine → Place all certificates in "Trusted Root Certification Authorities"
- **macOS:** Double-click the `.pem` file → Add to Keychain → Set to "Always Trust" in Keychain Access
- **Linux:** Copy to `/usr/local/share/ca-certificates/` and run `sudo update-ca-certificates`
- **Android:** Settings → Security → Install from storage → Select the `.pem` file
- **iOS:** Send the file via AirDrop/email → Open → Install profile → Go to Settings → General → About → Certificate Trust Settings → Enable full trust

After trusting the certificate, the "Not Secure" warning will disappear and PWA installation will work.

> **Note:** Each device on your LAN needs to trust the certificate independently.

#### Option 2: Custom Trusted Certificate

For scenarios where you need a certificate with specific Subject Alternative Names (e.g., a static IP or domain), generate your own certificate, configure sshift to use it, and then trust it on your devices.

**Step 1: Generate a certificate for your LAN IP**

Using OpenSSL:
```bash
# Create a config file for the certificate
cat > sshift-lan.cnf <<EOF
[req]
default_bits = 2048
prompt = no
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = sshift

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = your-hostname
IP.1 = 192.168.1.50
IP.2 = 127.0.0.1
EOF

# Generate the certificate and private key
openssl req -new -x509 -days 3650 -nodes \
  -keyout sshift-lan-key.pem \
  -out sshift-lan-cert.pem \
  -config sshift-lan.cnf
```

Replace `192.168.1.50` with your actual LAN IP and `your-hostname` with your machine's hostname.

**Step 2: Configure sshift to use the certificate**

Add the certificate paths to your `config.json`:
```json
{
  "enableHttps": true,
  "certPath": "/path/to/sshift-lan-cert.pem",
  "keyPath": "/path/to/sshift-lan-key.pem"
}
```

**Step 3: Trust the certificate on your devices**

- **Windows:** Double-click the `.pem` file → Install Certificate → Local Machine → Place all certificates in "Trusted Root Certification Authorities"
- **macOS:** Double-click the `.pem` file → Add to Keychain → Set to "Always Trust" in Keychain Access
- **Linux:** Copy to `/usr/local/share/ca-certificates/` and run `sudo update-ca-certificates`
- **Android:** Settings → Security → Install from storage → Select the `.pem` file
- **iOS:** Send the file via AirDrop/email → Open → Install profile → Go to Settings → General → About → Certificate Trust Settings → Enable full trust

After trusting the certificate, the "Not Secure" warning will disappear and PWA installation will work.

#### Option 3: Reverse Proxy with nginx

For production or multi-device deployments, use nginx as a reverse proxy with a trusted certificate (e.g., from Let's Encrypt or a self-signed CA).

**Example nginx configuration:**

```nginx
server {
    listen 443 ssl;
    server_name sshift.lan;

    ssl_certificate     /etc/nginx/ssl/sshift-cert.pem;
    ssl_certificate_key /etc/nginx/ssl/sshift-key.pem;

    location / {
        proxy_pass https://127.0.0.1:8022;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_ssl_verify off;
    }
}
```

Then configure sshift to listen on localhost only:

```json
{
  "bind": "127.0.0.1",
  "port": 8022,
  "enableHttps": true
}
```

> **Note:** If you use nginx with HTTPS in front, you can also set `"enableHttps": false` in sshift's config to have nginx handle all TLS termination. Configure nginx to proxy to `http://127.0.0.1:8022` in that case.

#### Option 4: Local DNS with mDNS/Avahi

Assign a `.local` hostname to your machine using mDNS, then use that hostname in your browser. Combined with Option 1 or 2, this provides a clean URL like `https://sshift.local` instead of an IP address.

```bash
# Install avahi (Linux)
sudo apt install avahi-daemon

# Verify your .local hostname
avahi-resolve -4 --name your-hostname.local
```

### Comparison of HTTPS/LAN Options

| Method | Ease | Per-Device Setup | PWA Support | Trust Level |
|--------|------|-------------------|-------------|-------------|
| Trust auto-generated cert | Easiest | Yes (each OS) | Yes | Full |
| Custom trusted cert | Moderate | Yes (each OS) | Yes | Full |
| nginx reverse proxy | Advanced | No (trust once) | Yes | Full |
| mDNS hostname | Moderate | No | Yes (with cert) | Full |

## Custom Layouts

SSHIFT supports custom terminal layouts that can be defined in `config.json`. Layouts allow you to split your terminal into multiple panels for multitasking.

### Layout Structure

Each layout consists of:
- `id` - Unique identifier
- `name` - Display name shown in the UI
- `icon` - Lucide icon name (e.g., "square", "columns-2", "grid-2x2")
- `columns` - Array of column definitions

Each column has:
- `width` - Column width (percentage string, e.g., "50%", "33.33%")
- `rows` - Array of row definitions within the column

Each row has:
- `height` - Row height (percentage string, e.g., "100%", "50%")

### Example Custom Layouts

```json
{
  "layouts": [
    {
      "id": "single",
      "name": "Single",
      "icon": "square",
      "columns": [
        {
          "width": "100%",
          "rows": [{ "height": "100%" }]
        }
      ]
    },
    {
      "id": "horizontal-split",
      "name": "Horizontal Split",
      "icon": "columns-2",
      "columns": [
        {
          "width": "50%",
          "rows": [{ "height": "100%" }]
        },
        {
          "width": "50%",
          "rows": [{ "height": "100%" }]
        }
      ]
    },
    {
      "id": "vertical-split",
      "name": "Vertical Split",
      "icon": "rows-2",
      "columns": [
        {
          "width": "100%",
          "rows": [
            { "height": "50%" },
            { "height": "50%" }
          ]
        }
      ]
    },
    {
      "id": "grid-2x2",
      "name": "Grid 2x2",
      "icon": "grid-2x2",
      "columns": [
        {
          "width": "50%",
          "rows": [
            { "height": "50%" },
            { "height": "50%" }
          ]
        },
        {
          "width": "50%",
          "rows": [
            { "height": "50%" },
            { "height": "50%" }
          ]
        }
      ]
    }
  ]
}
```

## Configuration Priority

When the same setting is defined in multiple places, SSHIFT uses this priority (highest to lowest):

### Port Priority

1. **`--port` CLI argument** (highest priority; sets `PORT` env var)
2. **`PORT` environment variable** (from `.env` files or shell)
3. **`config.json` `devPort`** (when `NODE_ENV=development` or `--dev`)
4. **`config.json` `port`** (production)
5. **Built-in defaults** — 8022 (production), 3000 (development)

> **Tip:** Use `sshift --dev` (`-d`) to start in development mode. This sets `NODE_ENV=development` and uses a separate PID file, allowing a dev instance to run alongside production. See [Installation > CLI Reference]({{ site.baseurl }}/installation.html) for all CLI options.

### Bind Address Priority

1. **`--bind` CLI argument** (highest priority; sets `BIND` env var)
2. **`BIND` environment variable** (from `.env` files or shell)
3. **`config.json` `bind`** setting
4. **Built-in default** — `"0.0.0.0"`

### .env File Priority (first setter wins)

See the [Environment Variables](#environment-vars) table above. Since `dotenv` does not overwrite existing variables, the first `.env` file to set a variable takes precedence.

### Config File Priority (first match wins)

See the [Configuration File](#configuration-file-configjson) table above. The first `config.json` found in the search path is used.

## Security Considerations

### Sensitive Data

**Never commit sensitive data to version control!**

- Use `.env/.env.local` for passwords and credentials
- Add `.env/` to your `.gitignore` file
- Use `config.json.example` as a template (without real credentials)

### File Permissions

```bash
# Set appropriate permissions for config files
chmod 600 .env/.env.local
chmod 600 .env/config.json
```

### Example `.gitignore`

```gitignore
# Environment files
.env/
.env.local

# Config files with sensitive data
config.json

# Keep example config
!config.json.example
```

## Plugins

SSHIFT supports a plugin system that can observe SSH session data and terminal output, and react to events like tab flashing. Plugins are configured in `config.json` under the `plugins` array.

### Built-in Plugins

Both attention plugins share the same state-transition engine: the tab flashes **only when the agent transitions from working to idle** (reply finished, or a permission/question dialog is waiting). Detection is verified against the live terminal viewport — there are no default prompt-text patterns (strings like `(y/n)`, `press enter` or `❯` appear routinely in chat prose, code and shell prompts and used to cause false flashes). App detection is non-sticky: while the app is off screen (you exited to the shell) no new working episode can start. User keystrokes end the current episode, stop an active flash immediately and suppress flashing while you're typing — a running agent re-arms the episode with its next spinner frame. A flash is also suppressed client-side when the terminal is already visible in a focused browser window, and the client tells the server it was seen so the next event still flashes.

How the engine avoids getting stuck (missed flashes):

- The screen is read through a **viewport-only** serialization. The full-scrollback state used previously returns nothing past its 1MB guard, which made busy sessions — exactly the ones worth watching — invisible to the plugins.
- Full-screen TUIs are read from the **alternate screen buffer**, not from the shell scrollback sitting below it.
- A transition that lands inside the post-keystroke cooldown is **queued and retried** instead of dropped.
- Losing the app signature (a permission dialog can cover the status bar and footer hints) no longer discards an armed episode — it only prevents new ones.
- A bare spinner glyph counts as "working" only while output is actually flowing (`spinnerStaleMs`), and a screen that produces nothing at all for `workStaleMs` is never considered working. Leftover status lines therefore can't pin a session in the working state forever.

#### OpenCode Attention (`opencode-attention`)

Flashes the browser tab when [OpenCode](https://opencode.ai) finishes working and is waiting for you. OpenCode is detected by its wordmark in the status bar (case-sensitive `OpenCode`); the working state is tracked via spinner glyphs (any braille spinner, legacy ⬝ ■ ▣) and `esc to interrupt` hints in the viewport footer, plus sustained agent-driven output.

**Configuration options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `flashDuration` | number | `0` | Flash duration in ms. `0` = flash until focused |
| `checkInterval` | number | `2000` | Milliseconds between periodic viewport checks |
| `idleThreshold` | number | `2500` | Milliseconds without a work signal before OpenCode is considered idle/finished |
| `cooldownMs` | number | `3000` | Milliseconds to suppress flashing after user input or after a flash stops |
| `debounceMs` | number | `300` | Debounce for output-driven evaluations |
| `footerLines` | number | `8` | Viewport bottom lines scanned for working indicators / custom patterns |
| `userEchoWindowMs` | number | `1200` | Output arriving within this window after a keystroke counts as echo, not agent work |
| `minWorkBytes` | number | `600` | Agent-driven bytes within `workWindowMs` that mark the session as working |
| `workWindowMs` | number | `2000` | Rolling window for `minWorkBytes` |
| `appMissLimit` | number | `3` | Consecutive checks without the app signature before new episodes are blocked |
| `spinnerStaleMs` | number | `2000` | A bare spinner glyph only counts as working if output arrived within this window |
| `workStaleMs` | number | `60000` | A screen with no output at all for this long is never considered working |
| `appPatterns` | string[] | `OpenCode`, `ctrl+p commands`, esc-interrupt hints | Regexes replacing the default app signatures (case-sensitive) |
| `workingPatterns` | string[] | braille, ⬝■▣, ◐◓◑◒◜◝◞◟, esc-to-interrupt | Regexes replacing the default working indicators |
| `workingHintPatterns` | string[] | esc-to-interrupt hints | Run hints that count as working even on a quiet screen |
| `patterns` | string[] | — | Extra attention regexes (matched on footer lines while idle) |
| `excludePatterns` | string[] | — | Remove patterns (by regex source) from all lists |

**Example:**

```json
{
  "name": "opencode-attention",
  "enabled": true,
  "config": {
    "flashDuration": 0,
    "idleThreshold": 2500
  }
}
```

#### Claude Attention (`claude-attention`)

Flashes the browser tab when [Claude Code](https://claude.ai) finishes working and is waiting for you (reply complete, or a permission dialog such as "Do you want to make this edit?"). Claude Code is detected by its wordmark, its persistent footer hints (`? for shortcuts`, `esc to interrupt`, edit-mode hints), the `⎿` tool-result marker and the permission-dialog headline/choices (`Do you want`, `❯ 1.`) — the last two matter because a dialog can push every other signature off the screen. The working state is tracked via spinner glyphs (braille spinners, the ✢✳✶✻✽ sparkle frames — the ubiquitous `·` separator is deliberately **not** treated as a spinner) and the `esc to interrupt` hint shown for the whole duration of a run.

**Configuration options:** identical to `opencode-attention` above, with Claude-specific defaults for `appPatterns`, `workingPatterns` and `workingHintPatterns`.

**Example:**

```json
{
  "name": "claude-attention",
  "enabled": true,
  "config": {
    "flashDuration": 0,
    "idleThreshold": 2500,
    "cooldownMs": 3000
  }
}
```

### Full Plugin Configuration Example

```json
{
  "plugins": [
    {
      "name": "opencode-attention",
      "enabled": true,
      "config": {
        "flashDuration": 0,
        "idleThreshold": 2500
      }
    },
    {
      "name": "claude-attention",
      "enabled": true,
      "config": {
        "flashDuration": 0,
        "idleThreshold": 2500,
        "cooldownMs": 3000
      }
    }
  ]
}
```

### Disabling a Plugin

Set `"enabled": false` to disable a plugin without removing its configuration:

```json
{
  "name": "opencode-attention",
  "enabled": false,
  "config": { }
}
```