# SSHIFT Docker

[![Docker Image Size](https://img.shields.io/docker/image-size/ghcr.io/lethevimlet/sshift/latest)](https://github.com/lethevimlet/sshift/pkgs/container/sshift)
[![Docker Pulls](https://img.shields.io/badge/ghcr.io-lethevimlet%2Fsshift-blue)](https://github.com/lethevimlet/sshift/pkgs/container/sshift)

This directory contains Docker-related files for running SSHIFT in a container.

## Quick Start

### Using Docker

```bash
# Pull the image from GitHub Packages
docker pull ghcr.io/lethevimlet/sshift:latest

# Run the container
docker run -d \
  --name sshift \
  -p 8022:8022 \
  ghcr.io/lethevimlet/sshift:latest

# Access the application
# Open http://localhost:8022 in your browser
```

### Using Docker Compose

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8022` | Port to bind the server |
| `BIND` | `0.0.0.0` | Address to bind (use `127.0.0.1` for localhost only) |
| `NODE_ENV` | `production` | Node environment |

### Volumes

The Docker image uses two volumes for persistent data:

- **`sshift-config`**: Configuration files (bookmarks, settings)
- **`sshift-data`**: Data files (certificates, keys)

### Custom Configuration

Mount a custom configuration file:

```bash
docker run -d \
  --name sshift \
  -p 8022:8022 \
  -v /path/to/config.json:/app/config.json:ro \
  lethevimlet/sshift:latest
```

### Environment File

Create a `.env` file:

```env
PORT=8022
BIND=0.0.0.0
```

Use with Docker Compose:

```bash
docker-compose --env-file .env up -d
```

## Building the Image

### Build Locally

```bash
# From the project root
docker build -f docker/Dockerfile -t sshift:local .

# Or using docker-compose
docker-compose build
```

### Build Arguments

The Dockerfile supports the following build arguments:

- `NODE_VERSION` (default: `20`): Node.js version to use

```bash
docker build --build-arg NODE_VERSION=22 -f docker/Dockerfile -t sshift:local .
```

## Security Considerations

### Non-Root User

The container runs as a non-root user (`sshift:sshift`) for enhanced security.

### Read-Only Filesystem

The container uses a read-only filesystem with a tmpfs for `/tmp` to prevent modifications.

### No New Privileges

The container is configured with `no-new-privileges` to prevent privilege escalation.

### Health Checks

The container includes a health check that verifies the HTTP server is responding:

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' sshift
```

## Advanced Usage

### Custom Port

```bash
docker run -d \
  --name sshift \
  -p 9000:8022 \
  -e PORT=8022 \
  lethevimlet/sshift:latest

# Access at http://localhost:9000
```

### Localhost Only

```bash
docker run -d \
  --name sshift \
  -p 127.0.0.1:8022:8022 \
  lethevimlet/sshift:latest

# Only accessible from localhost
```

### Persistent Configuration

```bash
docker run -d \
  --name sshift \
  -p 8022:8022 \
  -v sshift-config:/app/config \
  -v sshift-data:/app/data \
  lethevimlet/sshift:latest
```

### Using with Reverse Proxy

Example nginx configuration:

```nginx
server {
    listen 80;
    server_name sshift.example.com;

    location / {
        proxy_pass http://localhost:8022;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs sshift

# Check health status
docker inspect sshift | grep -A 10 Health
```

### Permission Issues

```bash
# Fix volume permissions
docker exec -u root sshift chown -R sshift:sshift /app/config /app/data
```

### Connection Refused

```bash
# Verify port binding
docker port sshift

# Check if port is already in use
netstat -tulpn | grep 8022
```

## Image Variants

### `ghcr.io/lethevimlet/sshift:latest`

Latest stable release from the main branch.

### `ghcr.io/lethevimlet/sshift:<version>`

Specific version (e.g., `ghcr.io/lethevimlet/sshift:0.2.0`).

### `ghcr.io/lethevimlet/sshift:<version>-alpine`

Alpine-based image (smaller size).

## Multi-Architecture Support

The Docker images are built for multiple architectures:

- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64)
- `linux/arm/v7` (ARM32)

Docker will automatically pull the correct image for your architecture.

## CI/CD Integration

The Docker image is automatically built and published to GitHub Packages when:

1. A new version is published to npm
2. The GitHub Actions workflow completes successfully

See `.github/workflows/docker-publish.yml` for details.

## Authentication (Optional)

For private repositories or rate limiting, you may need to authenticate with GitHub Packages:

```bash
# Create a PAT (Personal Access Token) with read:packages scope
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Pull the image
docker pull ghcr.io/lethevimlet/sshift:latest
```

For public repositories, no authentication is required for pulling images.