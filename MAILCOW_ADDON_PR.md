# Mailcow Addon Integration - Pull Request Summary

## Overview

This PR adds IMAP API as a seamless mailcow addon service, allowing users to easily deploy and integrate email sync functionality with their existing mailcow mail server.

## What's Included

### Core Application Changes

1. **Health Check Endpoint** (`workers/api.js`)
   - New `/health` endpoint for service monitoring
   - Returns status, Redis connectivity, and account count
   - Integrated with Docker health checks

### New Files

#### Docker Configuration
- `docker-compose.yml` - Standalone docker-compose for testing
- `docker-compose.mailcow-addon.yml.example` - Mailcow addon template
- `docker-compose.mailcow.test.yml` - Testing configuration
- `imapapi-addon/Dockerfile` - Optimized Dockerfile for addon deployment

#### Configuration
- `config/imapapi-addon.toml` - Default addon configuration

#### Installation
- `install-mailcow-addon.sh` - Automated installation script

#### Documentation
- `MAILCOW_ADDON_README.md` - Comprehensive user guide
- `examples/mailcow-integration.md` - Integration examples
- `Mailcow_Addon_Integration_Summary.md` - Technical summary

#### Testing
- `test-mailcow-addon.sh` - Validation test script

## Features

### 1. Seamless Integration
- Uses mailcow's existing Redis infrastructure
- Joins mailcow's Docker network
- Shares same DNS resolution
- Consistent logging and monitoring

### 2. Easy Deployment
```bash
./install-mailcow-addon.sh /opt/mailcow-dockerized
docker compose up -d imapapi-mailcow
```

### 3. Health Monitoring
- Docker health checks
- `/health` endpoint
- Prometheus metrics at `/metrics`

### 4. Configuration
Environment variables in `mailcow.conf`:
- `IMAPAPI_DBHOST` - Redis host
- `IMAPAPI_DBPORT` - Redis port
- `IMAPAPI_DB` - Redis database
- `IMAPAPI_HOST` - API host
- `IMAPAPI_PORT` - API external port
- `IMAPAPI_LOG_LEVEL` - Log level

## Architecture

### Network Integration
```
mailcow-network (Docker Bridge)
 redis-mailcow (port 6379)
 imapapi-mailcow (port 3000)
 dovecot-mailcow
 nginx-mailcow
 [other mailcow services]
```

### Data Flow
1. User request → IMAP API (port 3001)
2. IMAP API → Redis (account data)
3. IMAP API → IMAP/SMTP (mailcow's Dovecot/Postfix)
4. Monitoring → Health endpoint

## API Endpoints

### New Endpoints
- `GET /health` - Health check
  - Returns: `{"status": "ok", "redis": "connected", "accounts": N}`

### Existing Endpoints (Unchanged)
- `GET /docs` - Swagger documentation
- `GET /metrics` - Prometheus metrics
- `POST /v1/account` - Register account
- `GET /v1/accounts` - List accounts
- And all other existing IMAP API endpoints

## Usage Examples

### Basic Setup
```bash
# Run installation
./install-mailcow-addon.sh /opt/mailcow-dockerized

# Start service
cd /opt/mailcow-dockerized
docker compose up -d imapapi-mailcow

# Verify
curl http://mailcow.example.com:3001/health
```

### Register Account
```bash
curl -X POST "http://mailcow.example.com:3001/v1/account" \
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
        "pass": "password"
      }
    },
    "smtp": {
      "host": "localhost",
      "port": 1025,
      "secure": false,
      "auth": {
        "user": "user1@example.com",
        "pass": "password"
      }
    }
  }'
```

## Testing

### Run Validation Tests
```bash
./test-mailcow-addon.sh
```

Tests validate:
- All required files exist
- Dockerfile syntax
- Docker-compose configuration
- Health endpoint implementation
- Installation script
- Configuration files
- Documentation

### Local Test (Without Mailcow)
```bash
# Start standalone version
docker compose up -d

# Test health endpoint
curl http://localhost:3000/health

# Test API
curl http://localhost:3000/accounts

# Stop
docker compose down
```

## Benefits

1. **Unified Infrastructure**: No separate servers needed
2. **Easy Deployment**: Automated installation script
3. **Monitoring**: Health checks and metrics
4. **Scalability**: Can scale independently
5. **Maintenance**: Managed through docker-compose
6. **Security**: Leverages mailcow's network isolation
7. **Performance**: Optimized resource usage

## Compatibility

- **Mailcow**: Compatible with all modern mailcow-dockerized versions
- **Docker**: Requires Docker Compose v2.0+
- **Node.js**: Node.js 22+ (in Docker image)
- **Redis**: Redis 7 (mailcow's version)

## Security

### Best Practices
1. **Network Isolation**: Service in mailcow's Docker network
2. **Port Binding**: Optional external port binding
3. **Authentication**: Can add via reverse proxy
4. **TLS**: Use nginx/apache for HTTPS
5. **Firewall**: Limit access to trusted networks

### Recommended Setup
```nginx
# Nginx reverse proxy with authentication
server {
    listen 443 ssl http2;
    server_name imapapi.example.com;

    ssl_certificate /etc/ssl/mail/cert.pem;
    ssl_certificate_key /etc/ssl/mail/key.pem;

    # Add authentication here
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Migration

### From Standalone to Mailcow Addon
```bash
# 1. Stop standalone service
systemctl stop imapapi

# 2. Backup configuration
cp /etc/imapapi/config.toml /backup/

# 3. Run mailcow addon installation
./install-mailcow-addon.sh /opt/mailcow-dockerized

# 4. Start new service
cd /opt/mailcow-dockerized
docker compose up -d imapapi-mailcow
```

## Maintenance

### Update IMAP API
```bash
cd /opt/mailcow-dockerized/imapapi-addon
# Update files from repository
docker compose build imapapi-mailcow
docker compose up -d imapapi-mailcow
```

### Monitor
```bash
# Health check
docker compose ps imapapi-mailcow

# Logs
docker compose logs -f imapapi-mailcow

# Metrics
curl http://localhost:3001/metrics
```

### Troubleshooting

**Service won't start:**
```bash
docker compose logs imapapi-mailcow
```

**Redis connection:**
```bash
docker compose exec redis-mailcow redis-cli ping
```

## Documentation

- `MAILCOW_ADDON_README.md` - User guide
- `examples/mailcow-integration.md` - Integration examples
- `README.md` - Main documentation (updated)

## Breaking Changes

None. This is a pure addition that doesn't modify existing functionality.

## Future Enhancements

1. Prometheus monitoring integration
2. Automated backup scripts
3. Mailcow UI integration panel
4. OAuth2 proxy support
5. Rate limiting configuration

## References

- [Mailcow Documentation](https://docs.mailcow.email)
- [IMAP API Documentation](https://imapapi.com)
- [Docker Compose Documentation](https://docs.docker.com/compose/)

## License

AGPL-3.0-or-later (same as main IMAP API)

## Contributors

- Original IMAP API: Andris Reinman
- Mailcow Addon Integration: Community

---

**Status**: Ready for Review  
**Version**: 1.0.0  
**Last Updated**: 2026-04-24