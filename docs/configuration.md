---
layout: page
title: Configuration
---

## Configuration Files

SSHIFT uses a **priority-based configuration system** with multiple config file locations.

### Environment Variables (`.env` files)

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

### Configuration File (`config.json`)

The application configuration (bookmarks, settings) is loaded from:

1. `.env/config.json` - **User-specific, private config** (highest priority)
2. `config.json` - Default config in root (lowest priority)

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

> **Note:** Your browser will show a security warning for self-signed certificates. This is normal for development/local use. Click "Advanced" → "Proceed to localhost (unsafe)" to continue.

#### Custom Certificate Paths

You can specify your own trusted certificates in `config.json` using `certPath` and `keyPath`:

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

There are several ways to resolve this:

#### Option 1: Chrome "Insecure Origins Treated as Secure" Flag (Quick)

This is the fastest method for development or personal use. It tells Chrome to treat a specific origin as secure, enabling PWA features.

1. Open Chrome and navigate to:
   ```
   chrome://flags/#unsafely-treat-insecure-origin-as-secure
   ```
2. In the text box, enter your sshift LAN URL, e.g.:
   ```
   https://192.168.1.50:8022
   ```
   Include the protocol (`https://`) and port number.
3. Set the dropdown to **Enabled**.
4. Click the **Relaunch** button at the bottom to restart Chrome.

After relaunching, Chrome will treat that origin as a secure context — the "Not Secure" warning will disappear, and you can install sshift as a PWA.

> **Note:** This flag is per-device and per-browser. Each device on your LAN needs its own configuration. It is intended for development and personal use, not production.

#### Option 2: Custom Trusted Certificate

For a more permanent solution, create a certificate for your LAN IP and add it to your device's trusted root store.

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

Assign a `.local` hostname to your machine using mDNS, then use that hostname in your browser. Combined with Option 2 or 3, this provides a clean URL like `https://sshift.local` instead of an IP address.

```bash
# Install avahi (Linux)
sudo apt install avahi-daemon

# Verify your .local hostname
avahi-resolve -4 --name your-hostname.local
```

### Comparison of HTTPS/LAN Options

| Method | Ease | Per-Device Setup | PWA Support | Trust Level |
|--------|------|-------------------|-------------|-------------|
| Chrome flag | Easiest | Yes (each browser) | Yes | Dev/personal only |
| Trusted cert | Moderate | Yes (each OS) | Yes | Full |
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

1. **Environment variables** (e.g., `PORT`, `BIND`)
2. **`.env/.env.local`** - User-specific private config
3. **`.env/config.json`** - User-specific application config
4. **`config.json`** - Default application config
5. **Built-in defaults**

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

#### OpenCode Attention (`opencode-attention`)

Detects when [OpenCode](https://opencode.ai) is waiting for user input and flashes the browser tab. Tracks OpenCode's spinner characters (⬝ ■ ▣) and prompt patterns. When the spinner stops or a prompt is detected, the tab flashes until you focus it.

**Configuration options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debounceMs` | number | `300` | Milliseconds between full-state checks |
| `flashDuration` | number | `0` | Flash duration in ms. `0` = flash until focused |
| `checkInterval` | number | `2000` | Milliseconds between periodic terminal state checks |
| `idleThreshold` | number | `3000` | Milliseconds without spinner before considered idle |
| `patterns` | string[] | — | Additional regex patterns to detect attention |
| `excludePatterns` | string[] | — | Regex patterns to exclude from detection |

**Example:**

```json
{
  "name": "opencode-attention",
  "enabled": true,
  "config": {
    "debounceMs": 300,
    "flashDuration": 0,
    "idleThreshold": 3000
  }
}
```

#### Claude Attention (`claude-attention`)

Detects when [Claude Code](https://claude.ai) is waiting for user input and flashes the browser tab. Tracks Claude's spinner characters (braille spinners ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠽⠛ and v2 spinners ·✢✳✶✻✽) and prompt patterns like "❯", "Do you want", "Allow", and "Esc to cancel". Only activates detection once a Claude session is confirmed. While Claude is actively working (spinner active), all flashing is suppressed to avoid false positives.

**Configuration options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debounceMs` | number | `300` | Milliseconds between full-state checks |
| `flashDuration` | number | `0` | Flash duration in ms. `0` = flash until focused |
| `checkInterval` | number | `2000` | Milliseconds between periodic terminal state checks |
| `idleThreshold` | number | `3000` | Milliseconds without spinner before considered idle |
| `cooldownMs` | number | `1000` | Milliseconds to suppress re-flash after spinner stops a flash |
| `patterns` | string[] | — | Additional regex patterns to detect attention |
| `excludePatterns` | string[] | — | Regex patterns to exclude from detection |

**Example:**

```json
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
```

### Full Plugin Configuration Example

```json
{
  "plugins": [
    {
      "name": "opencode-attention",
      "enabled": true,
      "config": {
        "debounceMs": 300,
        "flashDuration": 0
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

### Disabling a Plugin

Set `"enabled": false` to disable a plugin without removing its configuration:

```json
{
  "name": "opencode-attention",
  "enabled": false,
  "config": { }
}
```