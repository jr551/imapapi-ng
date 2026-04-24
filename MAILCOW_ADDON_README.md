# IMAP API - Mailcow Addon

Seamlessly integrate IMAP API into your mailcow mail server to provide REST-based access to IMAP accounts.

## Overview

IMAP API is a self-hosted application that provides REST API access to IMAP and SMTP accounts. This addon allows you to run IMAP API alongside your mailcow mail server, leveraging mailcow's existing infrastructure (Redis, networking, etc.).

## Features

- **REST API for IMAP**: Access IMAP accounts via simple REST calls
- **Webhook Support**: Get notifications for new messages, deletions, and flag changes
- **OAuth2 Support**: Integrate with OAuth2 authentication providers
- **Prometheus Metrics**: Monitor API usage and IMAP connections
- **Shared Redis**: Uses mailcow's existing Redis instance
- **Docker-based**: Easy deployment with docker-compose

## Prerequisites

- mailcow-dockerized installed and running
- Docker Compose v2.0 or higher
- Port 3001 (or your chosen port) available on the host

## Quick Start

### Method 1: Automated Installation (Recommended)

Run the installation script:

```bash
wget https://raw.githubusercontent.com/your-repo/install-mailcow-addon.sh
chmod +x install-mailcow-addon.sh
./install-mailcow-addon.sh /opt/mailcow-dockerized
```

### Method 2: Manual Installation

1. **Clone or copy the addon files**:

```bash
cd /opt/mailcow-dockerized
mkdir -p imapapi-addon
```

2. **Create the Dockerfile** (`imapapi-addon/Dockerfile`):

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

3. **Copy the application source** (from this repository):
   - `package.json` and `package-lock.json`
   - `server.js`
   - `bin/`, `lib/`, `workers/`, `config/`, `examples/` directories

4. **Create docker-compose override** (`docker-compose.imapapi-addon.yml`):

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
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/metrics"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  imapapi-logs:
```

5. **Update mailcow.conf** with IMAP API settings:

```bash
# Add to mailcow.conf
IMAPAPI_DBHOST=redis-mailcow
IMAPAPI_DBPORT=6379
IMAPAPI_DB=8
IMAPAPI_HOST=0.0.0.0
IMAPAPI_PORT=3001
IMAPAPI_LOG_LEVEL=info
```

6. **Start the service**:

```bash
cd /opt/mailcow-dockerized
docker compose up -d imapapi-mailcow
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `IMAPAPI_DBHOST` | Redis host | `redis-mailcow` |
| `IMAPAPI_DBPORT` | Redis port | `6379` |
| `IMAPAPI_DB` | Redis database number | `8` |
| `IMAPAPI_HOST` | API host to bind to | `0.0.0.0` |
| `IMAPAPI_PORT` | External port (host) | `3001` |
| `IMAPAPI_LOG_LEVEL` | Log level | `info` |

### Configuration File

You can also configure IMAP API using a TOML file mounted at `/app/config/imapapi-addon.toml`:

```toml
[api]
host = "0.0.0.0"
port = 3000

[dbs]
redis = "redis://redis-mailcow:6379/8"

[log]
level = "info"
```

## Usage

### Accessing the API

Once deployed, IMAP API is available at:

- **API Base URL**: `http://<mailcow-host>:3001`
- **Swagger Documentation**: `http://<mailcow-host>:3001/docs`
- **Prometheus Metrics**: `http://<mailcow-host>:3001/metrics`

### Example: Register an Email Account

```bash
curl -X POST "http://mailcow.example.com:3001/v1/account" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "example",
    "name": "My Email Account",
    "imap": {
      "host": "imap.gmail.com",
      "port": 993,
      "secure": true,
      "auth": {
        "user": "myuser@gmail.com",
        "pass": "verysecret"
      }
    },
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 465,
      "secure": true,
      "auth": {
        "user": "myuser@gmail.com",
        "pass": "verysecret"
      }
    }
  }'
```

### Example: List Messages

```bash
curl "http://mailcow.example.com:3001/v1/account/example/messages?path=INBOX"
```

## Integration with Mailcow

### Using Mailcow's Redis

IMAP API uses the same Redis instance as mailcow (database 8 by default). This ensures:
- Shared infrastructure
- Simplified deployment
- Resource efficiency

**Important**: Ensure the Redis database number doesn't conflict with other services.

### Network Integration

The addon service joins mailcow's Docker network (`mailcow-network`), enabling:
- Communication with other mailcow services
- DNS resolution via mailcow's Unbound resolver
- Access to shared volumes if needed

### Security Considerations

1. **Firewall**: Restrict access to IMAP API port (3001) to trusted networks
2. **Authentication**: IMAP API doesn't implement authentication. Consider:
   - Using nginx/apache as a reverse proxy with auth
   - VPN-only access
   - IP whitelisting
3. **Redis Security**: Use Redis AUTH if enabled in mailcow
4. **TLS**: Use a reverse proxy for HTTPS termination

### Adding Reverse Proxy with Nginx

To add HTTPS support, create `data/conf/nginx/site.imapapi.custom`:

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
    }
}
```

Then restart nginx:
```bash
docker compose restart nginx-mailcow
```

## Monitoring

### Health Checks

Docker health checks are configured to verify the API is responsive:
```bash
docker compose ps imapapi-mailcow
```

### Prometheus Metrics

Metrics are available at `/metrics` endpoint:
- API call counts
- IMAP connection states
- Thread statistics

### Logs

```bash
# View IMAP API logs
docker compose logs -f imapapi-mailcow

# Or access logs from the volume
docker compose exec imapapi-mailcow tail -f /var/log/imapapi/*.log
```

## Maintenance

### Updating IMAP API

1. Update source files in `imapapi-addon/`
2. Rebuild the image:
```bash
docker compose build imapapi-mailcow
```
3. Restart the service:
```bash
docker compose up -d imapapi-mailcow
```

### Backup

The following data should be backed up:
- Redis data (mailcow's responsibility)
- IMAP API logs (optional, at `imapapi-logs` volume)

### Troubleshooting

**Service won't start**:
```bash
docker compose logs imapapi-mailcow
```

**Redis connection failed**:
- Verify Redis is running: `docker compose ps redis-mailcow`
- Check Redis configuration in environment variables

**Port already in use**:
- Change `IMAPAPI_PORT` in `mailcow.conf` and `docker-compose.imapapi-addon.yml`

## API Documentation

For complete API documentation, see:
- Swagger UI: `http://<host>:3001/docs`
- README.md in the IMAP API repository

## Limitations

- IMAP API doesn't implement its own authentication (relies on IMAP/SMTP credentials)
- Uses Redis database exclusively - ensure no conflicts
- Default configuration is for local access only

## Support

For issues with:
- **IMAP API**: Refer to the main IMAP API documentation
- **Mailcow integration**: Check mailcow documentation
- **Docker deployment**: Review Docker logs and configuration

## License

IMAP API is licensed under AGPL-3.0-or-later. See LICENSE-Community.txt for details.

## Contributing

Contributions welcome! Please ensure:
- Code follows existing style
- Tests pass
- Documentation is updated
- Mailcow integration is considered