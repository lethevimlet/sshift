---
layout: page
title: Docker
---

# Docker

Deploy SSHIFT using Docker containers for easy installation and isolation.

## Quick Start

### Pull and Run

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
# Download docker-compose.yml
curl -O https://raw.githubusercontent.com/lethevimlet/sshift/main/docker/docker-compose.yml

# Start the service
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the service
docker-compose down
```

## Configuration

### Environment Variables

Configure SSHIFT using environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8022` | Port to bind the server |
| `BIND` | `0.0.0.0` | Address to bind (use `127.0.0.1` for localhost only) |
| `NODE_ENV` | `production` | Node environment |

```bash
# Run with custom port
docker run -d \
  -p 9000:8022 \
  -e PORT=8022 \
  ghcr.io/lethevimlet/sshift:latest

# Bind to localhost only
docker run -d \
  -p 127.0.0.1:8022:8022 \
  -e BIND=127.0.0.1 \
  ghcr.io/lethevimlet/sshift:latest
```

### Volumes

The Docker image uses volumes for persistent data:

- **`/app/config`**: Configuration files (bookmarks, settings)
- **`/app/data`**: Data files (certificates, keys)

```bash
# Use named volumes
docker run -d \
  -p 8022:8022 \
  -v sshift-config:/app/config \
  -v sshift-data:/app/data \
  ghcr.io/lethevimlet/sshift:latest

# Use host directories
docker run -d \
  -p 8022:8022 \
  -v /path/to/config:/app/config \
  -v /path/to/data:/app/data \
  ghcr.io/lethevimlet/sshift:latest
```

### Custom Configuration File

Mount a custom configuration file:

```bash
docker run -d \
  -p 8022:8022 \
  -v /path/to/config.json:/app/config.json:ro \
  ghcr.io/lethevimlet/sshift:latest
```

### Environment File

Create a `.env` file:

```env
PORT=8022
BIND=0.0.0.0
NODE_ENV=production
```

Use with Docker Compose:

```bash
docker-compose --env-file .env up -d
```

## Docker Compose

Complete `docker-compose.yml` example:

```yaml
version: '3.8'

services:
  sshift:
    image: ghcr.io/lethevimlet/sshift:latest
    container_name: sshift
    ports:
      - "${PORT:-8022}:8022"
    environment:
      - NODE_ENV=production
      - PORT=8022
      - BIND=0.0.0.0
    volumes:
      - sshift-config:/app/config
      - sshift-data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:8022/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp

volumes:
  sshift-config:
    driver: local
  sshift-data:
    driver: local
```

## Image Variants

### Latest Version

```bash
docker pull ghcr.io/lethevimlet/sshift:latest
```

### Specific Version

```bash
docker pull ghcr.io/lethevimlet/sshift:0.2.0
```

### Version Tags

- `latest` - Latest stable release
- `0.2.0` - Specific version
- `0.2` - Latest patch version for 0.2.x

## Multi-Architecture Support

The Docker images are built for multiple architectures:

- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64/Apple Silicon)
- `linux/arm/v7` (ARM32/Raspberry Pi)

Docker automatically pulls the correct image for your architecture.

```bash
# Pull for your architecture (automatic)
docker pull ghcr.io/lethevimlet/sshift:latest

# Pull specific architecture
docker pull --platform linux/amd64 ghcr.io/lethevimlet/sshift:latest
docker pull --platform linux/arm64 ghcr.io/lethevimlet/sshift:latest
docker pull --platform linux/arm/v7 ghcr.io/lethevimlet/sshift:latest
```

## Security Features

The Docker image includes several security features:

### Non-Root User

The container runs as a non-root user (`sshift:sshift`):

```bash
# Verify user
docker exec sshift whoami
# Output: sshift
```

### Read-Only Filesystem

The container uses a read-only filesystem with tmpfs for `/tmp`:

```yaml
security_opt:
  - no-new-privileges:true
read_only: true
tmpfs:
  - /tmp
```

### No New Privileges

Prevents privilege escalation:

```yaml
security_opt:
  - no-new-privileges:true
```

### Health Checks

Built-in health checks monitor the application:

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' sshift

# View health check logs
docker inspect --format='{{json .State.Health}}' sshift | jq
```

## Reverse Proxy

### Nginx

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

### Traefik

```yaml
version: '3.8'

services:
  sshift:
    image: ghcr.io/lethevimlet/sshift:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.sshift.rule=Host(`sshift.example.com`)"
      - "traefik.http.routers.sshift.entrypoints=web"
      - "traefik.http.services.sshift.loadbalancer.server.port=8022"
```

### Caddy

```
sshift.example.com {
    reverse_proxy localhost:8022
}
```

## Building from Source

### Build Locally

```bash
# Clone the repository
git clone https://github.com/lethevimlet/sshift.git
cd sshift

# Build the image
docker build -f docker/Dockerfile -t sshift:local .

# Run the image
docker run -d -p 8022:8022 --name sshift sshift:local
```

### Build Arguments

```bash
# Build with specific Node.js version
docker build --build-arg NODE_VERSION=22 -f docker/Dockerfile -t sshift:local .
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs sshift

# Run interactively for debugging
docker run -it --rm -p 8022:8022 ghcr.io/lethevimlet/sshift:latest sh

# Check health status
docker inspect --format='{{.State.Health.Status}}' sshift
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

# Try different port
docker run -d -p 9000:8022 ghcr.io/lethevimlet/sshift:latest
```

### Image Pull Errors

```bash
# For private repositories, authenticate first
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Pull the image
docker pull ghcr.io/lethevimlet/sshift:latest
```

## Advanced Usage

### Custom Port Mapping

```bash
# Map to different port
docker run -d \
  -p 9000:8022 \
  -e PORT=8022 \
  ghcr.io/lethevimlet/sshift:latest

# Access at http://localhost:9000
```

### Multiple Instances

```bash
# Instance 1
docker run -d \
  --name sshift-1 \
  -p 8022:8022 \
  ghcr.io/lethevimlet/sshift:latest

# Instance 2
docker run -d \
  --name sshift-2 \
  -p 8023:8022 \
  ghcr.io/lethevimlet/sshift:latest
```

### Resource Limits

```bash
# Limit CPU and memory
docker run -d \
  -p 8022:8022 \
  --cpus="0.5" \
  --memory="512m" \
  ghcr.io/lethevimlet/sshift:latest
```

### Network Isolation

```bash
# Create isolated network
docker network create sshift-network

# Run container in isolated network
docker run -d \
  --name sshift \
  --network sshift-network \
  -p 8022:8022 \
  ghcr.io/lethevimlet/sshift:latest
```

## Updates

### Update to Latest Version

```bash
# Pull latest image
docker pull ghcr.io/lethevimlet/sshift:latest

# Stop and remove old container
docker stop sshift
docker rm sshift

# Start new container
docker run -d \
  --name sshift \
  -p 8022:8022 \
  -v sshift-config:/app/config \
  -v sshift-data:/app/data \
  ghcr.io/lethevimlet/sshift:latest
```

### Update with Docker Compose

```bash
# Pull latest image
docker-compose pull

# Restart services
docker-compose up -d
```

## Backup and Restore

### Backup Volumes

```bash
# Backup config
docker run --rm \
  -v sshift-config:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/sshift-config-backup.tar.gz -C /data .

# Backup data
docker run --rm \
  -v sshift-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/sshift-data-backup.tar.gz -C /data .
```

### Restore Volumes

```bash
# Restore config
docker run --rm \
  -v sshift-config:/data \
  -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/sshift-config-backup.tar.gz"

# Restore data
docker run --rm \
  -v sshift-data:/data \
  -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/sshift-data-backup.tar.gz"
```

## See Also

- [Installation Guide](installation.md) - Other installation methods
- [Configuration Guide](configuration.md) - Detailed configuration options
- [API Reference](api-reference.md) - API documentation