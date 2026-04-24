'use strict';

const { ImapFlow } = require('imapflow');
const { hashCreds } = require('./cache');
const { unauthorized } = require('./errors');

// Parse `Authorization: Basic <base64>` into { user, pass } or null.
function parseBasicAuth(headerValue) {
    if (!headerValue || typeof headerValue !== 'string') return null;
    const [scheme, encoded] = headerValue.split(/\s+/);
    if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) return null;
    let decoded;
    try {
        decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
        return null;
    }
    const ix = decoded.indexOf(':');
    if (ix < 0) return null;
    const user = decoded.slice(0, ix);
    const pass = decoded.slice(ix + 1);
    if (!user || !pass) return null;
    return { user, pass };
}

// Try a fresh IMAP LOGIN to verify credentials without polluting the pool.
async function verifyWithDovecot(imap, user, pass) {
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
    try {
        await client.connect();
        try {
            await client.logout();
        } catch {
            client.close();
        }
        return { valid: true };
    } catch (err) {
        try {
            client.close();
        } catch {
            /* noop */
        }
        const text = `${err && err.responseText ? err.responseText : ''} ${err && err.message ? err.message : ''}`;
        if (err && err.authenticationFailed) return { valid: false, reason: 'auth' };
        if (/authentication\s*fail|invalid credentials|LOGIN failed/i.test(text)) return { valid: false, reason: 'auth' };
        // network / backend failures — surface distinctly
        throw err;
    }
}

// Fastify onRequest hook factory. Populates `req.creds = { user, pass, hash }`.
function createAuthHook({ cache, imap, verifier = verifyWithDovecot, now = () => Date.now() }) {
    return async function authHook(req, reply) {
        if (req.routeOptions?.config?.public) return;

        const creds = parseBasicAuth(req.headers.authorization);
        if (!creds) {
            reply.header('WWW-Authenticate', 'Basic realm="imapapi"');
            throw unauthorized('Missing Basic credentials');
        }

        const hash = hashCreds(creds.user, creds.pass);
        const cached = cache.get(hash, now());
        if (cached) {
            if (!cached.valid) {
                reply.header('WWW-Authenticate', 'Basic realm="imapapi"');
                throw unauthorized('Invalid credentials');
            }
            req.creds = { user: creds.user, pass: creds.pass, hash };
            return;
        }

        let result;
        try {
            result = await verifier(imap, creds.user, creds.pass);
        } catch (err) {
            req.log.warn({ err }, 'imap backend unreachable during auth');
            const e = new Error('IMAP backend unavailable');
            e.statusCode = 502;
            e.problem = { type: 'about:blank', title: 'Bad Gateway', status: 502, detail: 'IMAP backend unavailable' };
            throw e;
        }

        cache.set(hash, result.valid, now());
        if (!result.valid) {
            reply.header('WWW-Authenticate', 'Basic realm="imapapi"');
            throw unauthorized('Invalid credentials');
        }
        req.creds = { user: creds.user, pass: creds.pass, hash };
    };
}

module.exports = { parseBasicAuth, verifyWithDovecot, createAuthHook };
