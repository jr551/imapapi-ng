'use strict';

const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => {
    if (v === undefined) return d;
    const s = String(v).toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y';
};

module.exports = Object.freeze({
    port: num(process.env.PORT, 3001),
    host: process.env.HOST || '0.0.0.0',

    imap: {
        host: process.env.IMAP_HOST || 'dovecot-mailcow',
        port: num(process.env.IMAP_PORT, 143),
        secure: bool(process.env.IMAP_SECURE, false),
        rejectUnauthorized: bool(process.env.IMAP_TLS_REJECT_UNAUTHORIZED, true),
        connectTimeoutMs: num(process.env.IMAP_CONNECT_TIMEOUT_MS, 10000)
    },

    cache: {
        path: process.env.CACHE_PATH || './data/cache.db',
        ttlValidMs: num(process.env.CACHE_TTL_VALID_MS, 60_000),
        ttlInvalidMs: num(process.env.CACHE_TTL_INVALID_MS, 10_000),
        pruneIntervalMs: num(process.env.CACHE_PRUNE_INTERVAL_MS, 300_000)
    },

    pool: {
        max: num(process.env.POOL_MAX, 50),
        idleMs: num(process.env.POOL_IDLE_MS, 30_000)
    },

    tls: {
        cert: process.env.TLS_CERT || '',
        key: process.env.TLS_KEY || ''
    },

    logLevel: process.env.LOG_LEVEL || 'info'
});
