# SSHIFT Docker Image
# Multi-stage build for optimized image size

# Stage 1: Build stage
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Stage 2: Production stage
FROM node:20-alpine

# Labels for container metadata
LABEL maintainer="lethevimlet"
LABEL description="Web-based SSH & SFTP Terminal Client"
LABEL version="1.1.1"

# Install runtime dependencies
RUN apk add --no-cache \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S sshift && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G sshift -g sshift sshift

# Create app directory
WORKDIR /app

# Copy package files and pnpm lockfile (authoritative source)
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Regenerate package-lock.json from pnpm-lock.yaml so npm ci stays in sync,
# then install only production dependencies
RUN npm i -g pnpm@10 && \
    pnpm import && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    chown -R sshift:sshift /app

# Copy application files
COPY --chown=sshift:sshift sshift ./sshift
COPY --chown=sshift:sshift src/server ./src/server
COPY --chown=sshift:sshift src/webapp ./src/webapp
COPY --chown=sshift:sshift example.config.json ./example.config.json
COPY --chown=sshift:sshift README.md LICENSE ./

# Make sshift executable
RUN chmod +x ./sshift

# Switch to non-root user
USER sshift

# Expose default port
EXPOSE 8022

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('https').get('https://localhost:8022/', {rejectUnauthorized: false}, (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Environment variables
ENV NODE_ENV=production
ENV PORT=8022

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "sshift"]