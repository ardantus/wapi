# Multi-stage build for whatsapp-web.js API server
# Supports both arm64 (Apple Silicon) and amd64 (Intel) architectures

FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3 compilation
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

# Copy package files
COPY package*.json ./

# Install dependencies (use npm install for flexibility; Docker has enough space/time)
# Skip Puppeteer download since we'll use system Chromium
RUN PUPPETEER_SKIP_DOWNLOAD=true npm install

# Final stage
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies (Chromium/Puppeteer, cairo for QR code rendering)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    cairo \
    jpeg \
    pango \
    giflib

# Copy built node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy app source files
COPY . .

# Create directories for connection session and message persistence
RUN mkdir -p sessions data && \
    chmod 755 sessions data

EXPOSE 3000

# Set environment defaults for Docker
ENV NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    UI_CREDENTIALS=${UI_CREDENTIALS:-} \
    SESSION_SECRET=${SESSION_SECRET:-docker-default-secret-change-in-prod} \
    REDIS_URL=${REDIS_URL:-} \
    RATE_LIMIT_PER_MINUTE=${RATE_LIMIT_PER_MINUTE:-120}

# Start server
CMD ["node", "server.js"]
