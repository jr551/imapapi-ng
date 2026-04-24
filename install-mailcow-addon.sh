#!/bin/bash
#
#
# Install IMAP API as a mailcow addon service
# This script adds IMAP API to your mailcow-dockerized setup
#
# Usage: ./install-mailcow-addon.sh [mailcow-dockerized-directory]
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
MAILCOW_DIR="${1:-/opt/mailcow-dockerized}"
IMAPAPI_PORT="3001"
IMAPAPI_DB="8"
IMAPAPI_DBHOST="redis-mailcow"
IMAPAPI_DBPORT="6379"
IMAPAPI_LOG_LEVEL="info"

function print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

function print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

function print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

function print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

function check_command() {
    if ! command -v "$1" &> /dev/null; then
        print_error "$1 is required but not installed."
        exit 1
    fi
}

# Check prerequisites
print_info "Checking prerequisites..."
check_command docker
check_command docker-compose || check_command docker

# Check if mailcow directory exists
if [ ! -d "$MAILCOW_DIR" ]; then
    print_error "Mailcow directory does not exist: $MAILCOW_DIR"
    print_info "Please specify the correct path: $0 /path/to/mailcow-dockerized"
    exit 1
fi

print_info "Using mailcow directory: $MAILCOW_DIR"

# Load mailcow configuration
if [ -f "$MAILCOW_DIR/mailcow.conf" ]; then
    print_info "Loading mailcow configuration..."
    source "$MAILCOW_DIR/mailcow.conf"
else
    print_error "mailcow.conf not found in $MAILCOW_DIR"
    exit 1
fi

# Create imapapi-addon directory
IMAPAPI_DIR="$MAILCOW_DIR/imapapi-addon"
print_info "Creating IMAP API addon directory: $IMAPAPI_DIR"
mkdir -p "$IMAPAPI_DIR"

# Copy Dockerfile
print_info "Creating Dockerfile..."
cat > "$IMAPAPI_DIR/Dockerfile" << 'DOCKERFILE_EOF'
FROM node:22-alpine

WORKDIR /app

# Install build tools needed for native modules and wget for healthcheck
RUN apk add --no-cache python3 make g++ wget

# Copy package files and install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
DOCKERFILE_EOF

# Copy package.json and package-lock.json
print_info "Copying package files..."
cp /workspace/oauth-google-108165723388505145126/sessions/agent_7c2d15ec-c122-43e8-8a8d-24841a392198/package.json "$IMAPAPI_DIR/"
cp /workspace/oauth-google-108165723388505145126/sessions/agent_7c2d15ec-c122-43e8-8a8d-24841a392198/package-lock.json "$IMAPAPI_DIR/" 2>/dev/null || true

# Copy application source
print_info "Copying application source..."
cp -r /workspace/oauth-google-108165723388505145126/sessions/agent_7c2d15ec-c122-43e8-8a8d-24841a392198/bin "$IMAPAPI_DIR/" 2>/dev/null || true
cp -r /workspace/oauth-google-108165723388505145126/sessions/agent_7c2d15ec-c122-43e8-8a8d-24841a392198/lib "$IMAPAPI_DIR/" 2>/dev/null || true
cp -r /workspace/oauth-google-108165723388505145126/sessions/agent_7c2d15ec-c122-43e8-8a8d-24841a392198/workers "$IMAPAPI_DIR/" 2>/dev/null || true
cp -r /workspace/oauth-google-108165723388505145126/sessions/agent_7c2d15ec-c122-43e8-8a8d-24841a392198/config "$IMAPAPI_DIR/" 2>/dev/null || true
cp -r /workspace/oauth-google-108165723388505145126/sessions/agent_7c2d15ec-c122-43e8-8a8d-24841a392198/server.js "$IMAPAPI_DIR/" 2>/dev/null || true
cp -r /workspace/oauth-google-108165723388505145126/sessions/agent_7c2d15ec-c122-43e8-8a8d-24841a392198/examples "$IMAPAPI_DIR/" 2>/dev/null || true

# Update config for mailcow
print_info "Configuring IMAP API for mailcow..."
cat > "$IMAPAPI_DIR/config/imapapi-addon.toml" << CONFIG_EOF
[api]
host = "0.0.0.0"
port = 3000

[dbs]
redis = "redis://${IMAPAPI_DBHOST}:${IMAPAPI_DBPORT}/${IMAPAPI_DB}"

[log]
level = "${IMAPAPI_LOG_LEVEL}"
CONFIG_EOF

# Create docker-compose override file
COMPOSE_OVERRIDE="$MAILCOW_DIR/docker-compose.imapapi-addon.yml"
print_info "Creating docker-compose override file: $COMPOSE_OVERRIDE"

cat > "$COMPOSE_OVERRIDE" << COMPOSE_EOF
# IMAP API Mailcow Addon Service
# This file adds IMAP API as a service to your mailcow setup
#
# Configuration options (add to mailcow.conf):
#   IMAPAPI_DBHOST    - Redis host (default: redis-mailcow)
#   IMAPAPI_DBPORT    - Redis port (default: 6379)
#   IMAPAPI_DB        - Redis database number (default: 8)
#   IMAPAPI_HOST      - API host (default: 0.0.0.0)
#   IMAPAPI_PORT      - API external port (default: 3001)
#   IMAPAPI_LOG_LEVEL - Log level (default: info)
#
# The API will be available at http://<mailcow-host>:\${IMAPAPI_PORT:-3001}
# Swagger docs: http://<mailcow-host>:\${IMAPAPI_PORT:-3001}/docs
# Metrics: http://<mailcow-host>:\${IMAPAPI_PORT:-3001}/metrics

services:
  imapapi-mailcow:
    build:
      context: ./imapapi-addon
      dockerfile: Dockerfile
    image: imapapi-mailcow:latest
    hostname: imapapi-mailcow
    restart: always
    environment:
      - TZ=\${TZ}
      - REDIS_URL=redis://\${IMAPAPI_DBHOST:-redis-mailcow}:\${IMAPAPI_DBPORT:-6379}/\${IMAPAPI_DB:-8}
      - API_HOST=\${IMAPAPI_HOST:-0.0.0.0}
      - API_PORT=3000
      - LOG_LEVEL=\${IMAPAPI_LOG_LEVEL:-info}
    ports:
      - "\${IMAPAPI_PORT:-3001}:3000"
    depends_on:
      - redis-mailcow
    networks:
      mailcow-network:
        aliases:
          - imapapi-mailcow
    labels:
      - "com.centurylinklabs.watchtower.enable=false"
    volumes:
      - imapapi-logs:/var/log/imapapi
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/metrics"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  imapapi-logs:
COMPOSE_EOF

# Update mailcow.conf with defaults if not already set
print_info "Updating mailcow.conf with IMAP API settings..."

if ! grep -q "^IMAPAPI_" "$MAILCOW_DIR/mailcow.conf" 2>/dev/null; then
    cat >> "$MAILCOW_DIR/mailcow.conf" << 'DEFAULTS_EOF'

# IMAP API Addon Configuration
IMAPAPI_DBHOST=redis-mailcow
IMAPAPI_DBPORT=6379
IMAPAPI_DB=8
IMAPAPI_HOST=0.0.0.0
IMAPAPI_PORT=3001
IMAPAPI_LOG_LEVEL=info
DEFAULTS_EOF
    print_success "Added IMAP API defaults to mailcow.conf"
else
    print_info "IMAP API settings already exist in mailcow.conf"
fi

# Reload configuration
source "$MAILCOW_DIR/mailcow.conf"

print_success "Installation complete!"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Review the configuration in $MAILCOW_DIR/mailcow.conf"
echo "2. Build and start the IMAP API service:"
echo "   cd $MAILCOW_DIR"
echo "   docker compose up -d imapapi-mailcow"
echo ""
echo -e "${BLUE}IMAP API will be available at:${NC}"
echo "  HTTP: http://${MAILCOW_HOSTNAME}:${IMAPAPI_PORT:-3001}"
echo "  API Docs: http://${MAILCOW_HOSTNAME}:${IMAPAPI_PORT:-3001}/docs"
echo "  Metrics: http://${MAILCOW_HOSTNAME}:${IMAPAPI_PORT:-3001}/metrics"
echo ""
echo -e "${YELLOW}Note:${NC} The IMAP API uses Redis database ${IMAPAPI_DB:-8}."
echo "Make sure this doesn't conflict with other services."
