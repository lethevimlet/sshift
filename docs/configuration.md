---
layout: page
title: Configuration
---

# Configuration

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