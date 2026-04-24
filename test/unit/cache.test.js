'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCache, hashCreds } = require('../../src/cache');

function mem() {
    return createCache({ filePath: ':memory:', ttlValidMs: 1000, ttlInvalidMs: 500, pruneIntervalMs: 0 });
}

test('hashCreds: deterministic and sensitive to input', () => {
    const a = hashCreds('u', 'p');
    const b = hashCreds('u', 'p');
    const c = hashCreds('u', 'P');
    assert.equal(a, b);
    assert.notEqual(a, c);
});

test('cache: unknown key returns null', () => {
    const c = mem();
    assert.equal(c.get('nope'), null);
    c.close();
});

test('cache: set/get valid entry round-trips', () => {
    const c = mem();
    c.set('h1', true);
    const row = c.get('h1');
    assert.equal(row.valid, true);
    assert.ok(row.expiresAt > Date.now());
    c.close();
});

test('cache: invalid uses shorter TTL than valid', () => {
    const c = createCache({ filePath: ':memory:', ttlValidMs: 60000, ttlInvalidMs: 10, pruneIntervalMs: 0 });
    const now = 1_000_000;
    c.set('h', false, now);
    const row = c.get('h', now);
    assert.equal(row.expiresAt - now, 10);
    c.close();
});

test('cache: expired entries are evicted on read', () => {
    const c = mem();
    const now = 1_000_000;
    c.set('h', true, now);
    assert.ok(c.get('h', now + 500));
    assert.equal(c.get('h', now + 5000), null);
    assert.equal(c.size(), 0);
    c.close();
});

test('cache: invalidate removes an entry', () => {
    const c = mem();
    c.set('h', true);
    c.invalidate('h');
    assert.equal(c.get('h'), null);
    c.close();
});

test('cache: prune clears expired entries', () => {
    const c = mem();
    const now = 1_000_000;
    c.set('h1', true, now);
    c.set('h2', false, now);
    const removed = c.prune(now + 10_000);
    assert.equal(removed, 2);
    assert.equal(c.size(), 0);
    c.close();
});

test('cache: overwrite existing entry', () => {
    const c = mem();
    c.set('h', false);
    assert.equal(c.get('h').valid, false);
    c.set('h', true);
    assert.equal(c.get('h').valid, true);
    c.close();
});
