'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

// Auth-verification cache backed by SQLite in WAL mode.
// Stores sha256(email:password) → {valid, expires_at}. Credentials are never
// stored in plaintext. Entries are pruned lazily on read and periodically.

function hashCreds(user, pass) {
    return crypto.createHash('sha256').update(`${user}:${pass}`).digest('hex');
}

function createCache(opts) {
    const { filePath, ttlValidMs, ttlInvalidMs, pruneIntervalMs } = opts;

    if (filePath !== ':memory:') {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    const db = new Database(filePath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 2000');

    db.exec(`
        CREATE TABLE IF NOT EXISTS auth_cache (
            hash TEXT PRIMARY KEY,
            valid INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_cache_expires ON auth_cache(expires_at);
    `);

    const getStmt = db.prepare('SELECT valid, expires_at FROM auth_cache WHERE hash = ?');
    const setStmt = db.prepare(
        'INSERT INTO auth_cache (hash, valid, expires_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(hash) DO UPDATE SET valid = excluded.valid, expires_at = excluded.expires_at'
    );
    const deleteStmt = db.prepare('DELETE FROM auth_cache WHERE hash = ?');
    const pruneStmt = db.prepare('DELETE FROM auth_cache WHERE expires_at < ?');
    const sizeStmt = db.prepare('SELECT COUNT(*) AS c FROM auth_cache');

    function get(hash, now = Date.now()) {
        const row = getStmt.get(hash);
        if (!row) return null;
        if (row.expires_at < now) {
            deleteStmt.run(hash);
            return null;
        }
        return { valid: row.valid === 1, expiresAt: row.expires_at };
    }

    function set(hash, valid, now = Date.now()) {
        const ttl = valid ? ttlValidMs : ttlInvalidMs;
        setStmt.run(hash, valid ? 1 : 0, now + ttl);
    }

    function invalidate(hash) {
        deleteStmt.run(hash);
    }

    function prune(now = Date.now()) {
        return pruneStmt.run(now).changes;
    }

    function size() {
        return sizeStmt.get().c;
    }

    let pruneTimer = null;
    if (pruneIntervalMs > 0) {
        pruneTimer = setInterval(() => prune(), pruneIntervalMs);
        pruneTimer.unref();
    }

    function close() {
        if (pruneTimer) clearInterval(pruneTimer);
        db.close();
    }

    return { get, set, invalidate, prune, size, close, hashCreds };
}

module.exports = { createCache, hashCreds };
