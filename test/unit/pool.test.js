'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPool } = require('../../src/pool');

function fakeClient() {
    const c = {
        authenticated: true,
        usable: true,
        closed: false,
        loggedOut: false,
        close() { c.closed = true; c.authenticated = false; c.usable = false; },
        async logout() { c.loggedOut = true; c.close(); }
    };
    return c;
}

function mockFactory() {
    const created = [];
    return {
        create: async (user, pass) => {
            const c = fakeClient();
            c.user = user;
            created.push(c);
            return c;
        },
        created
    };
}

test('pool: acquire creates new client, release returns it to idle', async () => {
    const f = mockFactory();
    const pool = createPool({ max: 5, idleMs: 10_000, createClient: f.create });
    const c = await pool.acquire('h1', 'u', 'p');
    assert.equal(f.created.length, 1);
    assert.equal(pool.count(), 1);
    pool.release('h1', c);
    assert.equal(pool.count(), 1); // still live, just idle
});

test('pool: acquire reuses idle client for same hash', async () => {
    const f = mockFactory();
    const pool = createPool({ max: 5, idleMs: 10_000, createClient: f.create });
    const c1 = await pool.acquire('h1', 'u', 'p');
    pool.release('h1', c1);
    const c2 = await pool.acquire('h1', 'u', 'p');
    assert.equal(c1, c2);
    assert.equal(f.created.length, 1);
    pool.release('h1', c2);
});

test('pool: discard closes client and frees slot', async () => {
    const f = mockFactory();
    const pool = createPool({ max: 5, idleMs: 10_000, createClient: f.create });
    const c = await pool.acquire('h1', 'u', 'p');
    pool.discard('h1', c);
    assert.equal(pool.count(), 0);
    assert.equal(f.created[0].closed, true);
});

test('pool: does not reuse stale client', async () => {
    const f = mockFactory();
    const pool = createPool({ max: 5, idleMs: 10_000, createClient: f.create });
    const c1 = await pool.acquire('h1', 'u', 'p');
    pool.release('h1', c1);
    c1.authenticated = false; // simulate disconnect while idle
    c1.usable = false;
    const c2 = await pool.acquire('h1', 'u', 'p');
    assert.notEqual(c1, c2);
    assert.equal(f.created.length, 2);
});

test('pool: respects max by evicting oldest idle across users', async () => {
    const f = mockFactory();
    const pool = createPool({ max: 2, idleMs: 10_000, createClient: f.create });
    const a = await pool.acquire('h1', 'u1', 'p');
    pool.release('h1', a);
    await new Promise(r => setTimeout(r, 2));
    const b = await pool.acquire('h2', 'u2', 'p');
    pool.release('h2', b);
    // both idle, max hit
    const c = await pool.acquire('h3', 'u3', 'p'); // triggers eviction of 'a'
    assert.equal(f.created.length, 3);
    assert.equal(a.closed, true, 'oldest idle client should be closed');
    pool.release('h3', c);
});

test('pool: sweepIdle closes clients idle past idleMs', async () => {
    const f = mockFactory();
    const pool = createPool({ max: 5, idleMs: 50, createClient: f.create });
    const c = await pool.acquire('h1', 'u', 'p');
    pool.release('h1', c);
    await new Promise(r => setTimeout(r, 80));
    pool.sweepIdle();
    assert.equal(pool.count(), 0);
    assert.equal(f.created[0].closed, true);
});

test('pool: closeAll logs out clients and rejects waiters', async () => {
    const f = mockFactory();
    const pool = createPool({ max: 1, idleMs: 10_000, createClient: f.create });
    const c = await pool.acquire('h1', 'u', 'p');
    pool.release('h1', c);
    await pool.closeAll();
    assert.equal(f.created[0].loggedOut, true);
});

test('pool: acquire waits when full, released by another', async () => {
    const f = mockFactory();
    const pool = createPool({ max: 1, idleMs: 10_000, createClient: f.create });
    const c1 = await pool.acquire('h1', 'u1', 'p');
    const pending = pool.acquire('h2', 'u2', 'p', { waitMs: 2000 });
    setTimeout(() => pool.discard('h1', c1), 20);
    const c2 = await pending;
    assert.ok(c2);
    pool.release('h2', c2);
});

test('pool: acquire timeout rejects when no slots free', async () => {
    const f = mockFactory();
    const pool = createPool({ max: 1, idleMs: 10_000, createClient: f.create });
    const c1 = await pool.acquire('h1', 'u', 'p'); // hold busy
    await assert.rejects(
        () => pool.acquire('h2', 'u', 'p', { waitMs: 50 }),
        /timeout/i
    );
    pool.release('h1', c1);
});
