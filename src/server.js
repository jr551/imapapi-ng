'use strict';

const fs = require('node:fs');
const Fastify = require('fastify');
const sensible = require('@fastify/sensible');

const config = require('./config');
const { createCache } = require('./cache');
const { createPool } = require('./pool');
const { createAuthHook } = require('./auth');
const mailboxRoutes = require('./routes/mailboxes');
const messageRoutes = require('./routes/messages');

function loadTls() {
    if (!config.tls.cert || !config.tls.key) return null;
    return { cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key) };
}

async function build({ cache, pool, logger, imap } = {}) {
    const app = Fastify({
        logger: logger ?? { level: config.logLevel, name: 'imapapi' },
        https: loadTls(),
        disableRequestLogging: false,
        bodyLimit: 2 * 1024 * 1024
    });

    await app.register(sensible);

    const imapCfg = imap ?? config.imap;

    cache = cache ?? createCache({
        filePath: config.cache.path,
        ttlValidMs: config.cache.ttlValidMs,
        ttlInvalidMs: config.cache.ttlInvalidMs,
        pruneIntervalMs: config.cache.pruneIntervalMs
    });

    pool = pool ?? createPool({
        imap: imapCfg,
        max: config.pool.max,
        idleMs: config.pool.idleMs,
        logger: app.log
    });

    app.decorate('cache', cache);
    app.decorate('pool', pool);

    // Public routes declared BEFORE the auth hook runs.
    app.addHook('onRequest', createAuthHook({ cache, imap: imapCfg }));

    app.get('/health', { config: { public: true } }, async () => ({
        ok: true,
        cache: cache.size(),
        pool: pool.count()
    }));

    await app.register(mailboxRoutes, { pool });
    await app.register(messageRoutes, { pool });

    app.setErrorHandler((err, req, reply) => {
        const status = err.statusCode || 500;
        const problem = err.problem || {
            type: 'about:blank',
            title: err.name || 'Error',
            status,
            detail: err.message || 'Unexpected error'
        };
        if (status >= 500) req.log.error({ err }, 'request failed');
        else req.log.warn({ err: { message: err.message, code: err.code } }, 'request rejected');
        reply.code(status).type('application/problem+json').send(problem);
    });

    app.addHook('onClose', async () => {
        await pool.closeAll();
        cache.close();
    });

    return app;
}

async function start() {
    const app = await build();
    const shutdown = async (signal) => {
        app.log.info({ signal }, 'shutting down');
        try {
            await app.close();
            process.exit(0);
        } catch (err) {
            app.log.error({ err }, 'shutdown error');
            process.exit(1);
        }
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    try {
        await app.listen({ port: config.port, host: config.host });
    } catch (err) {
        app.log.error({ err }, 'failed to start');
        process.exit(1);
    }
}

module.exports = { build, start };

if (require.main === module) {
    start();
}
