'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { build } = require('../../../src/server');
const { createCache } = require('../../../src/cache');
const { createPool } = require('../../../src/pool');

async function startServer({ imap }) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imapapi-test-'));
    const cache = createCache({
        filePath: path.join(tmpDir, 'cache.db'),
        ttlValidMs: 5_000,
        ttlInvalidMs: 2_000,
        pruneIntervalMs: 0
    });
    const pool = createPool({
        imap,
        max: 5,
        idleMs: 60_000,
        createClient: undefined // use real ImapFlow against imap config
    });
    // We need the pool to use the provided imap config, not the default
    // env-loaded one. createPool's defaultClientFactory closes over opts.imap.
    const app = await build({ cache, pool, imap, logger: false });
    const addr = await app.listen({ port: 0, host: '127.0.0.1' });
    return {
        app,
        cache,
        pool,
        url: typeof addr === 'string' ? addr : `http://127.0.0.1:${app.server.address().port}`,
        tmpDir,
        async stop() {
            await app.close();
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
        }
    };
}

function authHeader(user, pass) {
    return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

module.exports = { startServer, authHeader };
