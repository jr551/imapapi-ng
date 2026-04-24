# Mailcow Integration Guide

This guide explains how to integrate IMAP API as a service addon in your mailcow setup.

## Why Run IMAP API with Mailcow?

- **Unified Infrastructure**: Use mailcow's existing Redis and networking
- **Centralized Logging**: All logs in one place
- **Easy Management**: Manage with docker-compose alongside other services
- **Monitoring**: Health checks and Prometheus metrics integration

## Prerequisites

- A working mailcow installation
- Docker Compose v2.0+
- Access to mailcow's docker-compose.yml directory (typically `/opt/mailcow-dockerized`)

## Installation Steps

### Step 1: Prepare the IMAP API Directory

```bash
# Navigate to your mailcow directory
cd /opt/mailcow-dockerized

# Create IMAP API directory
mkdir -p imapapi-addon
cd imapapi-addon
```

### Step 2: Add IMAP API Files

Copy the following files to `imapapi-addon/`:

```bash
# Application files
cp /path/to/imapapi/package.json .
cp /path/to/imapapi/package-lock.json .
cp /path/to/imapapi/server.js .

# Directories
cp -r /path/to/imapapi/bin .
cp -r /path/to/imapapi/lib .
cp -r /path/to/imapapi/workers .
cp -r /path/to/imapapi/config .
```

### Step 3: Create Dockerfile

Create `imapapi-addon/Dockerfile`:

```dockerfile
FROM node:22-alpine

WORKDIR /app

# Install build tools and wget for healthcheck
RUN apk add --no-cache python3 make g++ wget

# Copy package files and install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

### Step 4: Create docker-compose Override

Create or edit `docker-compose.imapapi-addon.yml` in the mailcow root:

```yaml
services:
  imapapi-mailcow:
    build:
      context: ./imapapi-addon
      dockerfile: Dockerfile
    image: imapapi-mailcow:latest
    hostname: imapapi-mailcow
    restart: always
    environment:
      - TZ=${TZ}
      - REDIS_URL=redis://redis-mailcow:6379/8
      - API_HOST=0.0.0.0
      - API_PORT=3000
      - LOG_LEVEL=info
    ports:
      - "3001:3000"
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
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  imapapi-logs:
```

### Step 5: Update mailcow.conf

Add these lines to your `mailcow.conf`:

```bash
# IMAP API Configuration
IMAPAPI_DBHOST=redis-mailcow
IMAPAPI_DBPORT=6379
IMAPAPI_DB=8
IMAPAPI_HOST=0.0.0.0
IMAPAPI_PORT=3001
IMAPAPI_LOG_LEVEL=info
```

### Step 6: Start the Service

```bash
# Reload environment variables
source mailcow.conf

# Start IMAP API
docker compose up -d imapapi-mailcow

# Verify it's running
docker compose ps imapapi-mailcow
```

## Verification

### Check Service Status

```bash
# Check container status
docker compose ps imapapi-mailcow

# View logs
docker compose logs -f imapapi-mailcow
```

### Test Health Endpoint

```bash
curl http://localhost:3001/health
# Expected: {"status":"ok","redis":"connected",...}
```

### Test API

```bash
# List accounts (should be empty initially)
curl http://localhost:3001/v1/accounts

# Access Swagger docs
open http://localhost:3001/docs
```

## Usage Examples

### Register a Mailcow Email Account

```bash
curl -X POST "http://localhost:3001/v1/account" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "user1",
    "name": "User One",
    "imap": {
      "host": "localhost",
      "port": 1143,
      "secure": false,
      "auth": {
        "user": "user1@example.com",
        "pass": "user-password"
      }
    },
    "smtp": {
      "host": "localhost",
      "port": 1025,
      "secure": false,
      "auth": {
        "user": "user1@example.com",
        "pass": "user-password"
      }
    }
  }'
```

**Note**: For mailcow's internal Dovecot/SMTP, use the ports exposed internally.

### Access via Nginx (HTTPS)

To expose IMAP API through mailcow's Nginx with HTTPS:

1. Create `data/conf/nginx/site.imapapi.custom`:

```nginx
server {
    listen 443 ssl http2;
    server_name imapapi.example.com;

    ssl_certificate /etc/ssl/mail/cert.pem;
    ssl_certificate_key /etc/ssl/mail/key.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
    }
}
```

2. Restart Nginx:

```bash
docker compose restart nginx-mailcow
```

3. Update DNS to point `imapapi.example.com` to your mailcow server

## Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `IMAPAPI_DBHOST` | Redis host | `redis-mailcow` |
| `IMAPAPI_DBPORT` | Redis port | `6379` |
| `IMAPAPI_DB` | Redis database | `8` |
| `IMAPAPI_HOST` | API listen host | `0.0.0.0` |
| `IMAPAPI_PORT` | External port | `3001` |
| `IMAPAPI_LOG_LEVEL` | Log level | `info` |

### Redis Database Selection

Mailcow uses several Redis databases:
- DB 0: Rspamd (spam data)
- DB 1: Not used
- DB 2: Not used  
- DB 3: Not used
- DB 4: Not used
- DB 5: Not used
- DB 6: Not used
- DB 7: Not used
- DB 8: Available (recommended for IMAP API)

Check mailcow's documentation for the latest usage.

## Monitoring

### Prometheus Metrics

Access metrics at: `http://localhost:3001/metrics`

Metrics available:
- `thread_starts`: Number of started threads
- `thread_stops`: Number of stopped threads
- `api_call`: API call counts
- `imap_connections`: Current IMAP connection states

### Docker Health Checks

The health check verifies:
- API responsiveness
- Redis connectivity
- Service availability

View health status:

```bash
docker inspect --format='{{json .State.Health}}' $(docker compose ps -q imapapi-mailcow)
```

## Maintenance

### Update IMAP API

1. Update files in `imapapi-addon/`
2. Rebuild:
```bash
docker compose build imapapi-mailcow
```
3. Restart:
```bash
docker compose up -d imapapi-mailcow
```

### Backup

Backup the `imapapi-logs` volume if needed:
```bash
docker compose exec imapapi-mailcow tar czf /tmp/logs-backup.tar.gz /var/log/imapapi/
```

### Troubleshooting

**Service won't start:**
```bash
docker compose logs imapapi-mailcow
```

**Redis connection refused:**
- Verify Redis is running: `docker compose ps redis-mailcow`
- Check Redis database number isn't conflicting

**Port already in use:**
```bash
# Change IMAPAPI_PORT in mailcow.conf and docker-compose.imapapi-addon.yml
IMAPAPI_PORT=3002
```

## Security Best Practices

1. **Restrict Network Access**: Only expose IMAP API to trusted networks
2. **Use HTTPS**: Always use TLS for external access
3. **Authentication**: Place behind reverse proxy with authentication
4. **Firewall Rules**: Limit access to API port (3001)
5. **Regular Updates**: Keep IMAP API updated
6. **Monitor Logs**: Watch for unauthorized access attempts

## Integration with Other Services

### Nextcloud

Configure Nextcloud to use IMAP API for email:
- Server: `imapapi.example.com`
- Port: `443` (HTTPS)
- Use TLS/SSL

### Bitwarden

Use IMAP API for email alias management:
- Set IMAP API as custom IMAP/SMTP server
- Configure OAuth2 if needed

## Uninstallation

```bash
# Stop and remove service
docker compose down imapapi-mailcow

# Remove volumes (optional)
docker volume rm $(docker volume ls -qf name=imapapi-logs)

# Remove configuration from mailcow.conf
# (Manually delete IMAPAPI_* lines)
```

## Support

For issues:
1. Check logs: `docker compose logs imapapi-mailcow`
2. Verify configuration
3. Test Redis connectivity
4. Review health endpoint output

## Performance Tuning

For high-volume setups:

1. **Increase Worker Threads**: Edit `server.js` line 328-330
```javascript
for (let i = 0; i < 8; i++) {  // Increase from 4 to 8
    spawnWorker('imap');
}
```

2. **Resource Limits**: Add to docker-compose:
```yaml
resources:
  limits:
    cpus: '2.0'
    memory: 2G
  reservations:
    cpus: '0.5'
    memory: 512M
```

3. **Redis Optimization**: Tune Redis for IMAP API workload