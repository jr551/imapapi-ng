# Mailcow Addon Integration - Summary

## Overview

This document summarizes the changes made to port IMAP API as a seamless mailcow addon service that can be activated for users to use with mailcow search and email management.

## Changes Made

### 1. Core Application Updates

#### `workers/api.js` (Modified)
- **Added**: `/health` endpoint for health checks
  - Returns service status, Redis connectivity, and account count
  - Used by Docker health checks for monitoring
  - Endpoint: `GET /health`

This allows mailcow's monitoring system to verify IMAP API is running correctly.

### 2. Docker Configuration

#### `Dockerfile` (Existing - No Changes)
- Already uses Alpine Linux for minimal size
- Node.js 22-alpine base image
- Multi-stage build ready

#### `docker-compose.yml` (New)
- Standalone docker-compose for testing without mailcow
- Includes Redis service
- Health checks configured
- Exposes port 3000

#### `docker-compose.mailcow-addon.yml.example` (New)
- Template for mailcow integration
- Shows how to add IMAP API as a service to mailcow
- Uses mailcow's existing Redis
- Joins `mailcow-network`
- Health checks configured

#### `imapapi-addon/Dockerfile` (New)
- Optimized Dockerfile for mailcow addon deployment
- Includes `wget` for health checks
- Copies all necessary application files

#### `config/imapapi-addon.toml` (New)
- Default configuration for mailcow addon
- Pre-configured to use mailcow's Redis
- Configured for internal network communication

### 3. Installation Scripts

#### `install-mailcow-addon.sh` (New)
- Automated installation script for mailcow users
- Performs the following:
  1. Validates prerequisites
  2. Creates `imapapi-addon/` directory
  3. Copies all application files
  4. Creates Dockerfile
  5. Updates `mailcow.conf` with IMAP API settings
  6. Creates docker-compose override file
  7. Provides next steps

**Usage:**
```bash
./install-mailcow-addon.sh /opt/mailcow-dockerized
```

### 4. Documentation

#### `MAILCOW_ADDON_README.md` (New)
- Comprehensive guide for mailcow users
- Covers:
  - Prerequisites and requirements
  - Installation methods (automated and manual)
  - Configuration options
  - Usage examples
  - Integration with mailcow services
  - Security best practices
  - Monitoring and maintenance
  - Troubleshooting

#### `examples/mailcow-integration.md` (New)
- Step-by-step integration guide
- Practical examples
- Common use cases
- Advanced configurations

### 5. Configuration Files

#### `docker-compose.mailcow.test.yml` (New)
- Example configuration for testing
- Shows how to integrate with existing mailcow setup
- Includes nginx proxy example

## Architecture

### Network Integration

```
mailcow-network (Docker Bridge)
 redis-mailcow (port 6379)
 imapapi-mailcow (port 3000)
    Connects to redis-mailcow
 dovecot-mailcow
 nginx-mailcow
 sogo-mailcow
 [other mailcow services]
```

### Data Flow

1. **User** → HTTP API (port 3001) → IMAP API
2. **IMAP API** → Redis (mailcow's database 8) → Account data
3. **IMAP API** → IMAP/SMTP → mailcow's Dovecot/Postfix
4. **Monitoring** → Health endpoint → Docker status

## Integration Points with Mailcow

### 1. Redis Integration

- Uses mailcow's existing Redis instance
- Database 8 by default (configurable)
- No conflicts with mailcow services
- Shared infrastructure benefits

### 2. Network Integration

- Joins `mailcow-network`
- DNS resolution via mailcow's Unbound
- Can communicate with other services
- Uses same network aliases

### 3. Service Discovery

- Service name: `imapapi-mailcow`
- Available on `mailcow-network`
- Health checks integrated
- Logging to dedicated volume

### 4. Configuration Management

- Uses `mailcow.conf` for settings
- Environment variables integration
- Consistent with mailcow patterns
- Easy to update

## Usage Examples

### Basic Setup

```bash
# 1. Run installation script
./install-mailcow-addon.sh /opt/mailcow-dockerized

# 2. Start the service
cd /opt/mailcow-dockerized
docker compose up -d imapapi-mailcow

# 3. Verify it's running
curl http://mailcow.example.com:3001/health
```

### Advanced Setup with Reverse Proxy

```bash
# 1. Install as above
./install-mailcow-addon.sh /opt/mailcow-dockerized

# 2. Create nginx custom site
cat > /opt/mailcow-dockerized/data/conf/nginx/site.imapapi.custom << 'EOF'
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
EOF

# 3. Restart nginx
docker compose restart nginx-mailcow
```

### API Usage

```bash
# Register account
curl -X POST "https://imapapi.example.com/v1/account" \
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

# List messages
curl "https://imapapi.example.com/v1/account/user1/messages?path=INBOX"

# Get message
curl "https://imapapi.example.com/v1/account/user1/message/MSG_ID"
```

## Benefits for Mailcow Users

1. **Unified Infrastructure**: No separate servers needed
2. **Easy Deployment**: Automated installation script
3. **Monitoring**: Health checks and metrics
4. **Scalability**: Can scale independently
5. **Maintenance**: Managed through docker-compose
6. **Security**: Leverages mailcow's network isolation
7. **Performance**: Optimized resource usage

## Compatibility

- **Mailcow Version**: Compatible with all modern mailcow-dockerized versions
- **Docker**: Requires Docker Compose v2.0+
- **Node.js**: Node.js 22+ (in Docker image)
- **Redis**: Redis 7 (mailcow's version)

## Security Considerations

1. **Network Isolation**: Service runs in mailcow's Docker network
2. **Port Binding**: Optional external port binding
3. **Authentication**: Can be added via reverse proxy
4. **TLS**: Use nginx/apache for HTTPS termination
5. **Firewall**: Restrict access to trusted networks

## Monitoring & Logging

### Health Checks

```bash
# Docker health status
docker inspect --format='{{json .State.Health}}' \
  $(docker compose ps -q imapapi-mailcow)
```

### Logs

```bash
# View logs
docker compose logs -f imapapi-mailcow

# Access volume logs
docker compose exec imapapi-mailcow tail -f /var/log/imapapi/*.log
```

### Metrics

```bash
# Prometheus metrics
curl http://localhost:3001/metrics
```

## Maintenance

### Update IMAP API

```bash
cd /opt/mailcow-dockerized/imapapi-addon
git pull  # or copy new files
docker compose build imapapi-mailcow
docker compose up -d imapapi-mailcow
```

### Backup

```bash
# Redis data (handled by mailcow)
# IMAP API logs (optional)
docker compose exec imapapi-mailcow \
  tar czf /tmp/logs-backup.tar.gz /var/log/imapapi/
```

### Troubleshooting

```bash
# Check service status
docker compose ps imapapi-mailcow

# View logs
docker compose logs imapapi-mailcow

# Test health endpoint
curl http://localhost:3001/health

# Test Redis connection
docker compose exec redis-mailcow redis-cli ping
```

## Files Created/Modified

### New Files

1. `docker-compose.yml` - Standalone docker-compose for testing
2. `docker-compose.mailcow-addon.yml.example` - Mailcow addon template
3. `docker-compose.mailcow.test.yml` - Testing configuration
4. `imapapi-addon/Dockerfile` - Addon Dockerfile
5. `config/imapapi-addon.toml` - Addon configuration
6. `install-mailcow-addon.sh` - Installation script
7. `MAILCOW_ADDON_README.md` - User documentation
8. `examples/mailcow-integration.md` - Integration guide

### Modified Files

1. `README.md` - Added mailcow integration section
2. `workers/api.js` - Added `/health` endpoint

## Testing

### Local Test

```bash
# Start standalone version
docker compose up -d

# Test health endpoint
curl http://localhost:3000/health

# Test API
curl http://localhost:3000/accounts

# View logs
docker compose logs -f

# Stop
docker compose down
```

### Mailcow Integration Test

```bash
# Install addon
./install-mailcow-addon.sh /opt/mailcow-dockerized

# Start service
cd /opt/mailcow-dockerized
docker compose up -d imapapi-mailcow

# Verify
curl http://mailcow.example.com:3001/health
```

## Deployment Checklist

- [x] Core application updates (health endpoint)
- [x] Docker configuration created
- [x] Installation script created
- [x] Documentation written
- [x] Configuration files created
- [x] Testing procedures documented
- [x] Security considerations addressed
- [x] Monitoring setup documented

## Next Steps

1. Review and test the installation script
2. Validate mailcow integration
3. Update documentation based on feedback
4. Consider adding authentication layer
5. Add Prometheus monitoring to mailcow's setup
6. Create Ansible/Terraform modules for automated deployment

## Support & Contributing

For issues or contributions:
1. Test the installation script
2. Document any issues found
3. Submit feedback or PRs
4. Update documentation

## License

This integration is provided under the same AGPL-3.0-or-later license as IMAP API.

## Acknowledgments

- Mailcow maintainers for the excellent mail server solution
- IMAP API maintainers for the REST API wrapper
- Community for feedback and suggestions

---

**Last Updated**: 2026-04-24
**Version**: 1.0.0
**Status**: Ready for Review