'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBasicAuth, createAuthHook } = require('../../src/auth');
const { createCache, hashCreds } = require('../../src/cache');

function makeReply() {
    const headers = {};
    return {
        headers,
        header(k, v) { headers[k.toLowerCase()] = v; return this; }
    };
}

function makeReq(headerValue) {
    return {
        headers: { authorization: headerValue },
        routeOptions: {},
        log: { warn() {}, info() {}, error() {}, debug() {} }
    };
}

test('parseBasicAuth: valid header', () => {
    const v = 'Basic ' + Buffer.from('u@x.com:pw').toString('base64');
    assert.deepEqual(parseBasicAuth(v), { user: 'u@x.com', pass: 'pw' });
});

test('parseBasicAuth: lowercased scheme still works', () => {
    const v = 'basic ' + Buffer.from('a:b').toString('base64');
    assert.deepEqual(parseBasicAuth(v), { user: 'a', pass: 'b' });
});

test('parseBasicAuth: missing header returns null', () => {
    assert.equal(parseBasicAuth(undefined), null);
    assert.equal(parseBasicAuth(''), null);
});

test('parseBasicAuth: non-basic scheme returns null', () => {
    assert.equal(parseBasicAuth('Bearer xyz'), null);
});

test('parseBasicAuth: missing colon returns null', () => {
    const v = 'Basic ' + Buffer.from('nocolon').toString('base64');
    assert.equal(parseBasicAuth(v), null);
});

test('parseBasicAuth: empty user or pass returns null', () => {
    assert.equal(parseBasicAuth('Basic ' + Buffer.from(':pw').toString('base64')), null);
    assert.equal(parseBasicAuth('Basic ' + Buffer.from('u:').toString('base64')), null);
});

test('authHook: missing auth → 401 + WWW-Authenticate', async () => {
    const cache = createCache({ filePath: ':memory:', ttlValidMs: 1000, ttlInvalidMs: 1000, pruneIntervalMs: 0 });
    const hook = createAuthHook({ cache, imap: {}, verifier: async () => ({ valid: true }) });
    const req = makeReq(undefined);
    const reply = makeReply();
    await assert.rejects(() => hook(req, reply), (err) => err.statusCode === 401);
    assert.equal(reply.headers['www-authenticate'], 'Basic realm="imapapi"');
    cache.close();
});

test('authHook: cached valid → passes, sets req.creds', async () => {
    const cache = createCache({ filePath: ':memory:', ttlValidMs: 60000, ttlInvalidMs: 60000, pruneIntervalMs: 0 });
    const hash = hashCreds('u@x.com', 'pw');
    cache.set(hash, true);
    let verified = 0;
    const hook = createAuthHook({ cache, imap: {}, verifier: async () => { verified++; return { valid: true }; } });
    const req = makeReq('Basic ' + Buffer.from('u@x.com:pw').toString('base64'));
    await hook(req, makeReply());
    assert.equal(verified, 0, 'should not call verifier on cache hit');
    assert.equal(req.creds.user, 'u@x.com');
    assert.equal(req.creds.pass, 'pw');
    assert.equal(req.creds.hash, hash);
    cache.close();
});

test('authHook: cached invalid → 401 without re-verifying', async () => {
    const cache = createCache({ filePath: ':memory:', ttlValidMs: 60000, ttlInvalidMs: 60000, pruneIntervalMs: 0 });
    const hash = hashCreds('u@x.com', 'bad');
    cache.set(hash, false);
    let verified = 0;
    const hook = createAuthHook({ cache, imap: {}, verifier: async () => { verified++; return { valid: true }; } });
    const req = makeReq('Basic ' + Buffer.from('u@x.com:bad').toString('base64'));
    await assert.rejects(() => hook(req, makeReply()), (e) => e.statusCode === 401);
    assert.equal(verified, 0);
    cache.close();
});

test('authHook: cache miss → verifier called, result cached', async () => {
    const cache = createCache({ filePath: ':memory:', ttlValidMs: 60000, ttlInvalidMs: 60000, pruneIntervalMs: 0 });
    let verified = 0;
    const hook = createAuthHook({ cache, imap: {}, verifier: async () => { verified++; return { valid: true }; } });
    const req = makeReq('Basic ' + Buffer.from('u@x.com:pw').toString('base64'));
    await hook(req, makeReply());
    assert.equal(verified, 1);
    // second call should hit cache
    const req2 = makeReq('Basic ' + Buffer.from('u@x.com:pw').toString('base64'));
    await hook(req2, makeReply());
    assert.equal(verified, 1);
    cache.close();
});

test('authHook: verifier returns invalid → 401, cached as invalid', async () => {
    const cache = createCache({ filePath: ':memory:', ttlValidMs: 60000, ttlInvalidMs: 60000, pruneIntervalMs: 0 });
    const hook = createAuthHook({ cache, imap: {}, verifier: async () => ({ valid: false, reason: 'auth' }) });
    const req = makeReq('Basic ' + Buffer.from('u@x.com:bad').toString('base64'));
    await assert.rejects(() => hook(req, makeReply()), (e) => e.statusCode === 401);
    const entry = cache.get(hashCreds('u@x.com', 'bad'));
    assert.equal(entry.valid, false);
    cache.close();
});

test('authHook: verifier throws (backend down) → 502', async () => {
    const cache = createCache({ filePath: ':memory:', ttlValidMs: 60000, ttlInvalidMs: 60000, pruneIntervalMs: 0 });
    const hook = createAuthHook({ cache, imap: {}, verifier: async () => { throw new Error('ECONNREFUSED'); } });
    const req = makeReq('Basic ' + Buffer.from('u@x.com:pw').toString('base64'));
    await assert.rejects(() => hook(req, makeReply()), (e) => e.statusCode === 502);
    cache.close();
});

test('authHook: public-route config skips auth', async () => {
    const cache = createCache({ filePath: ':memory:', ttlValidMs: 60000, ttlInvalidMs: 60000, pruneIntervalMs: 0 });
    const hook = createAuthHook({ cache, imap: {}, verifier: async () => { throw new Error('should not run'); } });
    const req = makeReq(undefined);
    req.routeOptions = { config: { public: true } };
    await hook(req, makeReply());
    cache.close();
});
