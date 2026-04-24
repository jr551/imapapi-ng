'use strict';

const { ImapFlow } = require('imapflow');

// In-memory pool of live ImapFlow connections keyed by credential hash.
// Per-hash LIFO stack of idle clients. Global bound on total live clients.
// Idle clients are closed after idleMs. Callers `acquire()` and `release()`.

function defaultClientFactory(imap) {
    return async function make(user, pass) {
        const client = new ImapFlow({
            host: imap.host,
            port: imap.port,
            secure: imap.secure,
            auth: { user, pass },
            tls: { rejectUnauthorized: imap.rejectUnauthorized },
            logger: false,
            emitLogs: false,
            connectTimeout: imap.connectTimeoutMs
        });
        await client.connect();
        return client;
    };
}

function createPool(opts) {
    const { imap, max, idleMs, logger, createClient } = opts;
    const newClient = createClient || defaultClientFactory(imap || {});

    // hash -> { idle: [{ client, lastUsed }], busy: number }
    const entries = new Map();
    let totalLive = 0;
    const waiters = []; // { resolve, reject, timer }

    function count() {
        return totalLive;
    }

    function ensureEntry(hash) {
        let e = entries.get(hash);
        if (!e) {
            e = { idle: [], busy: 0 };
            entries.set(hash, e);
        }
        return e;
    }

    async function acquire(hash, user, pass, { waitMs = 10_000 } = {}) {
        const e = ensureEntry(hash);

        // hot path: reuse idle client for this user
        while (e.idle.length) {
            const { client } = e.idle.pop();
            if (client.authenticated && client.usable) {
                e.busy++;
                return client;
            }
            // stale — close quietly
            totalLive--;
            safeClose(client);
        }

        if (totalLive < max) {
            totalLive++;
            try {
                const client = await newClient(user, pass);
                e.busy++;
                return client;
            } catch (err) {
                totalLive--;
                throw err;
            }
        }

        // pool full — evict oldest idle across all users if we can
        const evicted = tryEvictOneIdle();
        if (evicted) {
            totalLive--;
            totalLive++; // conceptual slot transfer
            try {
                const client = await newClient(user, pass);
                e.busy++;
                return client;
            } catch (err) {
                totalLive--;
                throw err;
            }
        }

        // otherwise wait for a release
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const ix = waiters.indexOf(w);
                if (ix >= 0) waiters.splice(ix, 1);
                reject(new Error('Pool acquire timeout'));
            }, waitMs);
            const w = { hash, user, pass, resolve, reject, timer };
            waiters.push(w);
        });
    }

    function release(hash, client) {
        const e = ensureEntry(hash);
        e.busy = Math.max(0, e.busy - 1);
        if (!client.authenticated || !client.usable) {
            totalLive--;
            safeClose(client);
            pump();
            return;
        }
        e.idle.push({ client, lastUsed: Date.now() });
        pump();
    }

    // discard a client without returning to pool (e.g. after network error)
    function discard(hash, client) {
        const e = ensureEntry(hash);
        e.busy = Math.max(0, e.busy - 1);
        totalLive--;
        safeClose(client);
        pump();
    }

    function pump() {
        while (waiters.length && totalLive < max) {
            const w = waiters.shift();
            clearTimeout(w.timer);
            totalLive++;
            newClient(w.user, w.pass)
                .then((c) => {
                    const e = ensureEntry(w.hash);
                    e.busy++;
                    w.resolve(c);
                })
                .catch((err) => {
                    totalLive--;
                    w.reject(err);
                });
        }
    }

    function tryEvictOneIdle() {
        let oldest = null;
        for (const [, e] of entries) {
            for (const it of e.idle) {
                if (!oldest || it.lastUsed < oldest.it.lastUsed) {
                    oldest = { e, it };
                }
            }
        }
        if (!oldest) return false;
        const ix = oldest.e.idle.indexOf(oldest.it);
        oldest.e.idle.splice(ix, 1);
        safeClose(oldest.it.client);
        return true;
    }

    function sweepIdle(now = Date.now()) {
        for (const [hash, e] of entries) {
            e.idle = e.idle.filter(({ client, lastUsed }) => {
                if (now - lastUsed > idleMs) {
                    totalLive--;
                    safeClose(client);
                    return false;
                }
                return true;
            });
            if (e.idle.length === 0 && e.busy === 0) {
                entries.delete(hash);
            }
        }
    }

    function safeClose(client) {
        try {
            client.close();
        } catch (err) {
            if (logger) logger.debug({ err }, 'pool close error');
        }
    }

    let sweepTimer = null;
    if (idleMs > 0) {
        sweepTimer = setInterval(() => sweepIdle(), Math.max(1000, Math.floor(idleMs / 2)));
        sweepTimer.unref();
    }

    async function closeAll() {
        if (sweepTimer) clearInterval(sweepTimer);
        // reject all waiters
        for (const w of waiters.splice(0)) {
            clearTimeout(w.timer);
            w.reject(new Error('Pool closing'));
        }
        const closes = [];
        for (const [, e] of entries) {
            for (const { client } of e.idle.splice(0)) {
                closes.push(
                    Promise.resolve()
                        .then(() => client.logout())
                        .catch(() => safeClose(client))
                );
            }
        }
        entries.clear();
        totalLive = 0;
        await Promise.allSettled(closes);
    }

    // Close all currently-idle clients but keep the pool usable.
    // Useful after external mailbox state changes make cached MBox views stale.
    async function flushIdle() {
        const closes = [];
        for (const [hash, e] of entries) {
            for (const { client } of e.idle.splice(0)) {
                totalLive--;
                closes.push(
                    Promise.resolve()
                        .then(() => client.logout())
                        .catch(() => safeClose(client))
                );
            }
            if (e.idle.length === 0 && e.busy === 0) entries.delete(hash);
        }
        await Promise.allSettled(closes);
    }

    return { acquire, release, discard, sweepIdle, closeAll, flushIdle, count };
}

module.exports = { createPool };
