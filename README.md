# imapapi — mailcow addon

Minimal, stateless REST facade for IMAP, designed as an addon that runs
alongside [mailcow-dockerized](https://mailcow.email) and uses a user's
mailcow credentials to authenticate every request. No database, no
credential store, no persistent account registry — just HTTP Basic Auth
in front of IMAP.

> **Fork notice.** This is a hard fork of [`imapapi` by Andris
> Reinman](https://github.com/andris9/imapapi) (AGPL-3.0). The upstream
> is a general-purpose IMAP sync engine with workers, Redis, webhooks
> and a web UI; this fork strips all of that and replaces it with a
> ~900-LoC single-process proxy aimed at mailcow.

---

## How it works

Every API call carries `Authorization: Basic <base64(email:password)>`.
On each request:

1. The credentials hash is looked up in a SQLite (WAL) auth cache.
2. On miss, the addon attempts an IMAP LOGIN against mailcow's Dovecot.
   The result (valid/invalid) is cached with a short TTL.
3. Valid requests acquire a pooled IMAP connection for that user, run
   the operation against mailcow's Dovecot, and release the connection.

No credentials are ever written to disk. The cache stores only SHA-256
hashes with expiry timestamps.

## Requirements

- A running mailcow-dockerized install on the same host.
- Docker + Docker Compose v2.

## Install (mailcow-upgrade-safe)

Clone this repo **outside** `/opt/mailcow-dockerized/` so mailcow's
`update.sh` never touches it:

```bash
git clone https://github.com/jr551/imapapi-ng /opt/imapapi
cd /opt/imapapi
cp .env.example .env   # tweak if you want non-defaults
docker compose up -d --build
```

Verify:

```bash
curl -s http://127.0.0.1:3001/health
# {"ok":true,"cache":0,"pool":0}
```

Uninstall:

```bash
cd /opt/imapapi && docker compose down -v
rm -rf /opt/imapapi
```

The addon makes **zero** edits to mailcow's working tree, compose file,
or `mailcow.conf`. It joins mailcow's existing docker network as
`external`; override `MAILCOW_NETWORK` in `.env` if a future mailcow
version renames its network.

## Public exposure

By default the container publishes port `3001` on all interfaces. You
have two options:

- **Direct with TLS.** Set `TLS_CERT` and `TLS_KEY` to mailcow's cert
  files, e.g.
  `TLS_CERT=/opt/mailcow-dockerized/data/assets/ssl/cert.pem`. Mount
  them read-only into the container.
- **Behind mailcow's nginx.** Set `BIND_ADDR=127.0.0.1` and add a custom
  `data/conf/nginx/site.imapapi.custom` in mailcow proxying `/imapapi/`
  to `http://host.docker.internal:3001/` (preserves mailcow's cert).
  This file survives `update.sh`.

## Configuration

All settings are env vars; see `.env.example` for the full list.

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3001` | Host listen port |
| `BIND_ADDR` | `0.0.0.0` | `127.0.0.1` when fronted by nginx |
| `IMAP_HOST` | `dovecot-mailcow` | mailcow Dovecot service |
| `IMAP_PORT` | `143` | Plain or STARTTLS port |
| `IMAP_SECURE` | `false` | `true` = implicit TLS (993) |
| `CACHE_TTL_VALID_MS` | `60000` | Positive-auth cache TTL |
| `CACHE_TTL_INVALID_MS` | `10000` | Negative-auth cache TTL |
| `POOL_MAX` | `50` | Max live IMAP connections |
| `POOL_IDLE_MS` | `30000` | Idle connection eviction |
| `TLS_CERT` / `TLS_KEY` | — | Optional HTTPS termination |
| `LOG_LEVEL` | `info` | pino level |
| `MAILCOW_NETWORK` | `mailcowdockerized_mailcow-network` | Override if mailcow renames it |

## API

All routes except `/health` require `Authorization: Basic …`. Errors are
returned as RFC 7807 `application/problem+json`.

### Mailboxes

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/mailboxes` | List all mailboxes |
| POST | `/v1/mailboxes` | Create `{"path": "..."}` |
| PUT | `/v1/mailboxes/:path` | Rename `{"newPath": "..."}` |
| DELETE | `/v1/mailboxes/:path` | Delete (rejects INBOX) |

### Messages

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/mailboxes/:path/messages?page=&pageSize=&search=` | Paged list, newest first |
| GET | `/v1/mailboxes/:path/messages/:uid` | Parsed message (text/html/attachments) |
| GET | `/v1/mailboxes/:path/messages/:uid/raw` | Full rfc822 source |
| GET | `/v1/mailboxes/:path/messages/:uid/attachments/:id` | Binary attachment |
| PUT | `/v1/mailboxes/:path/messages/:uid/flags` | `{"add":[],"remove":[],"set":[]}` |
| PUT | `/v1/mailboxes/:path/messages/:uid/move` | `{"path": "..."}` |
| DELETE | `/v1/mailboxes/:path/messages/:uid` | Mark \Deleted + expunge |

`:path` is URL-encoded so IMAP namespaces like `Archive/2024` become
`Archive%2F2024`.

### Health

| Method | Path | Auth |
|---|---|---|
| GET | `/health` | none |

### Example

```bash
AUTH=$(printf 'user@example.com:hunter2' | base64)
curl -H "Authorization: Basic $AUTH" http://127.0.0.1:3001/v1/mailboxes
```

## Development

```bash
npm install
npm test                 # unit tests (node:test, no network)
npm run test:integration # starts a dovecot docker container, runs full E2E
npm run dev              # watch-mode server on PORT (default 3001)
```

Integration tests build and run a minimal Dovecot 2.3 container
(`test/integration/fixtures/dovecot/`) on a random local port and
exercise every endpoint end-to-end. Requires Docker.

## Security notes

- Every request that isn't a cache hit hits Dovecot with the user's
  credentials; a wrong password yields 401 and a short negative-TTL
  cache entry.
- Credentials are never logged or persisted. The SQLite cache stores
  only `sha256(user:pass)` and an expiry.
- There is no rate limiter — front the port with nginx/fail2ban or set
  `BIND_ADDR=127.0.0.1` and proxy through mailcow.

## What's removed vs upstream `imapapi`

Upstream features this fork does **not** include:

- Web UI, Bootstrap/jQuery assets, Swagger UI
- Persistent account registry + Redis + Bull workers
- Webhook notifications
- OAuth2 support, SMTP sending
- Worker threads (single-process model)

If you need any of those, use the [upstream
project](https://github.com/andris9/imapapi).

## License

AGPL-3.0-or-later (inherited from upstream). See `LICENSE-Community.txt`.
