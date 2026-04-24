# Mailcow Addon Refactor — Design

**Date:** 2026-04-24
**Branch:** `refactor/mailcow-addon`
**Status:** Approved, implementation in progress

## Goal

Refactor this fork of [imapapi](https://github.com/andris9/imapapi) into a minimal, stateless mailcow addon that runs on its own port on the mailcow host, authenticates users with their mailcow credentials, and exposes IMAP operations over REST. The addon must not conflict with mailcow upgrades.

## Non-goals

- No persistent account registry, no webhooks, no Bull queue, no worker threads.
- No SMTP send endpoint.
- No web UI.
- No Redis dependency.

## Architecture

Single Node process. One Fastify server. Every HTTP request flows:

```
HTTP request
  Basic Auth middleware
    hash = sha256("email:password")
    SQLite cache lookup (WAL mode)
      hit + valid   → continue
      hit + invalid → 401
      miss          → IMAP LOGIN against Dovecot
                        success → cache {valid:1, expires: now+60s}
                        failure → cache {valid:0, expires: now+10s}
  Route handler
    Acquire IMAP connection from in-memory pool (key = hash)
      miss → new ImapFlow(user,pass), LOGIN, add to pool
    Perform IMAP operation
    Release to pool (30s idle TTL, bounded)
```

## Components

| File | LoC target | Purpose |
|---|---|---|
| `src/server.js` | ~60 | Fastify bootstrap, plugin registration, graceful shutdown |
| `src/config.js` | ~40 | env-var config |
| `src/auth.js` | ~80 | Basic Auth decorator, cache check, Dovecot verification |
| `src/cache.js` | ~60 | better-sqlite3 WAL, get/set/prune |
| `src/pool.js` | ~100 | in-memory ImapFlow pool, idle eviction |
| `src/errors.js` | ~30 | IMAP error → HTTP mapping |
| `src/schemas.js` | ~100 | shared JSON schemas |
| `src/routes/mailboxes.js` | ~120 | list/create/delete/rename mailboxes |
| `src/routes/messages.js` | ~250 | list/get/raw/attachments/flag/move/delete |

Target: ~840 LoC of app code (down from ~5,400).

## API surface — 15 endpoints

All authenticated routes require `Authorization: Basic <base64(email:password)>`. Errors follow RFC 7807 (`application/problem+json`).

**Mailboxes**
- `GET /v1/mailboxes`
- `POST /v1/mailboxes` — `{path}`
- `PUT /v1/mailboxes/:path` — `{newPath}`
- `DELETE /v1/mailboxes/:path`

**Messages**
- `GET /v1/mailboxes/:path/messages?page=0&pageSize=20&search=...`
- `GET /v1/mailboxes/:path/messages/:uid`
- `GET /v1/mailboxes/:path/messages/:uid/raw`
- `GET /v1/mailboxes/:path/messages/:uid/attachments/:id`
- `PUT /v1/mailboxes/:path/messages/:uid/flags` — `{add?,remove?,set?}`
- `PUT /v1/mailboxes/:path/messages/:uid/move` — `{path}`
- `DELETE /v1/mailboxes/:path/messages/:uid`

**Unauthenticated**
- `GET /health`
- `GET /openapi.json`

`:path` is URL-encoded to support IMAP namespaces and delimiters.

## Dependencies (all latest as of 2026-04-24)

**Runtime**
- `fastify` — HTTP server + JSON schema validation + OpenAPI
- `@fastify/sensible` — error helpers
- `imapflow` — IMAP client (same lib as upstream imapapi)
- `better-sqlite3` — synchronous SQLite with WAL
- `pino` — logging (Fastify's default)

**Dev**
- `node:test` (built-in) — test runner
- `undici` — HTTP client for integration tests
- Docker (external) — Dovecot image for integration tests

## Mailcow-upgrade isolation

Addon lives in its own directory (e.g. `/opt/imapapi-mailcow/`), **not** inside `/opt/mailcow-dockerized/`. Its `docker-compose.yml` joins mailcow's docker network as external:

```yaml
networks:
  mailcow-network:
    external: true
    name: mailcowdockerized_mailcow-network
```

- `update.sh` in mailcow never touches this directory
- No edits to `mailcow.conf`, `docker-compose.yml`, or `data/conf/**`
- Network name can be overridden via env var for major mailcow version bumps
- Uninstall = `docker compose down && rm -rf <dir>`

Public exposure binds `:3001` (configurable) on the host. Optional TLS termination via `TLS_CERT`/`TLS_KEY` env vars; pointing them at mailcow's existing certs works without any nginx changes.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen address |
| `IMAP_HOST` | `dovecot-mailcow` | mailcow Dovecot hostname |
| `IMAP_PORT` | `143` | IMAP port (STARTTLS) |
| `IMAP_SECURE` | `false` | true = implicit TLS (993) |
| `IMAP_TLS_REJECT_UNAUTHORIZED` | `true` | verify cert chain |
| `CACHE_PATH` | `/data/cache.db` | SQLite file |
| `CACHE_TTL_VALID_MS` | `60000` | positive auth TTL |
| `CACHE_TTL_INVALID_MS` | `10000` | negative auth TTL |
| `POOL_MAX` | `50` | max live IMAP connections |
| `POOL_IDLE_MS` | `30000` | idle eviction |
| `TLS_CERT` / `TLS_KEY` | — | optional HTTPS termination |
| `LOG_LEVEL` | `info` | pino log level |

## Testing plan

Three tiers, all run under `node --test`.

**Unit** (mock imapflow) — auth parsing, cache hit/miss/expire, pool acquire/release/evict, error mapping, schema rejection.

**Integration** — real Dovecot container (`dovecot/dovecot:latest` or minimal custom image) on the VM, plain passdb with 3 users, seeded mailboxes via `doveadm`. Every endpoint exercised end-to-end against real IMAP.

**Smoke** — one full user journey: list mailboxes → read message → flag it → move to another folder → delete. Validates that pool + cache + routes compose.

Pass gate: all tiers green on this VM before opening the PR.

## Unbranding

- Keep package name `imapapi` and AGPL-3.0 license.
- README leads with: "Fork of [imapapi](https://github.com/andris9/imapapi) refactored as a minimal stateless mailcow addon."
- Remove the upstream's web UI, Swagger UI, Bootstrap/jQuery assets, Bull/worker infra, and the old bolt-on addon markdown files.
- License header retained on any reused source.

## Files removed

`workers/`, `lib/connection.js`, `lib/mailbox.js`, `lib/account.js`, `lib/settings.js`, `lib/db.js`, `lib/tools.js`, `lib/message-port-stream.js`, `static/`, `views/`, `Gruntfile.js`, old `server.js`, old `bin/imapapi.js`, `IMPLEMENTATION_COMPLETE.md`, `MAILCOW_ADDON_README.md`, `MAILCOW_ADDON_PR.md`, `Mailcow_Addon_Integration_Summary.md`, `install-mailcow-addon.sh`, `test-mailcow-addon.sh`, `docker-compose.mailcow-addon.yml.example`, `docker-compose.mailcow.test.yml`, `imapapi-addon/`, `examples/`, `config/`, `.prettierrc.js`.

## PR

Branch `refactor/mailcow-addon` → `master`. Title: "Refactor into minimal mailcow addon (stateless, Basic Auth via Dovecot)". PR body includes before/after LoC, test evidence, install/upgrade instructions, and breaking-change note (not a drop-in replacement for upstream imapapi).
