'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startDovecot } = require('./helpers/docker');
const { seedAccount, buildRfc822 } = require('./helpers/seed');
const { startServer, authHeader } = require('./helpers/server');

const ALICE = { user: 'alice@test.local', pass: 'secret123' };
const BOB = { user: 'bob@test.local', pass: 'password1' };

let dovecot;
let server;
let imapConfig;

async function resetAlice() {
    // Delete all messages in alice's standard folders, then re-seed a fresh set.
    const { ImapFlow } = require('imapflow');
    const c = new ImapFlow({
        host: imapConfig.host, port: imapConfig.port, secure: false,
        auth: ALICE, logger: false
    });
    await c.connect();
    try {
        // clean up any custom mailboxes left by prior tests
        const list = await c.list();
        for (const mb of list) {
            if (!['INBOX', 'Sent', 'Drafts', 'Trash', 'Archive', 'Junk'].includes(mb.path)) {
                try { await c.mailboxDelete(mb.path); } catch { /* */ }
            }
        }
        for (const box of ['INBOX', 'Sent', 'Trash', 'Archive']) {
            try {
                const lock = await c.getMailboxLock(box);
                try {
                    const uids = await c.search({ all: true }, { uid: true });
                    if (uids && uids.length) {
                        await c.messageDelete(uids, { uid: true });
                    }
                } finally { lock.release(); }
            } catch { /* mailbox missing is ok */ }
        }
    } finally {
        await c.logout().catch(() => c.close());
    }

    await seedAccount({
        host: imapConfig.host, port: imapConfig.port,
        user: ALICE.user, pass: ALICE.pass,
        messages: [
            { mailbox: 'INBOX', from: 'alice@test.local', to: 'alice@test.local', subject: 'First message', text: 'Hello world, first.' },
            { mailbox: 'INBOX', from: 'someone@test.local', to: 'alice@test.local', subject: 'Second message', text: 'Second body.', html: '<b>Second body.</b>' },
            { mailbox: 'INBOX', from: 'carol@test.local', to: 'alice@test.local', subject: 'Third — urgent', text: 'urgent please read', flags: ['\\Flagged'] },
            { mailbox: 'Sent', from: 'alice@test.local', to: 'somebody@test.local', subject: 'Outgoing one', text: 'hi there' }
        ]
    });
}

test.before(async () => {
    dovecot = await startDovecot();
    imapConfig = {
        host: dovecot.host,
        port: dovecot.port,
        secure: false,
        rejectUnauthorized: false,
        connectTimeoutMs: 10_000
    };
    server = await startServer({ imap: imapConfig });
});

test.after(async () => {
    if (server) await server.stop();
    if (dovecot) dovecot.stop();
});

test.beforeEach(async () => {
    // give each test a predictable alice inbox
    await resetAlice();
    // drop any pooled IMAP connections so the next request does a fresh
    // SELECT against the re-seeded mailboxes (otherwise cached UID/EXISTS
    // state from the previous test is reused).
    if (server && server.pool) await server.pool.flushIdle();
    if (server && server.cache) server.cache.prune(Date.now() + 10 ** 9);
});

async function req(method, path, { auth, body, headers = {} } = {}) {
    const opts = { method, headers: { ...headers } };
    if (auth) opts.headers.authorization = authHeader(auth.user, auth.pass);
    if (body !== undefined) {
        opts.headers['content-type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(server.url + path, opts);
    const ct = res.headers.get('content-type') || '';
    let data;
    if (ct.includes('json') || ct.includes('problem+json')) {
        data = await res.json();
    } else if (ct.startsWith('text/') || ct.includes('rfc822')) {
        data = await res.text();
    } else {
        data = Buffer.from(await res.arrayBuffer());
    }
    return { status: res.status, headers: Object.fromEntries(res.headers), data };
}

// ----- auth -----

test('health: public, returns ok', async () => {
    const r = await req('GET', '/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
});

test('missing auth → 401 with WWW-Authenticate', async () => {
    const r = await req('GET', '/v1/mailboxes');
    assert.equal(r.status, 401);
    assert.ok(r.headers['www-authenticate']);
});

test('bad password → 401', async () => {
    const r = await req('GET', '/v1/mailboxes', { auth: { user: ALICE.user, pass: 'wrong' } });
    assert.equal(r.status, 401);
});

test('valid creds → cache warms, 2nd call uses cache', async () => {
    const a = await req('GET', '/v1/mailboxes', { auth: ALICE });
    const b = await req('GET', '/v1/mailboxes', { auth: ALICE });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
});

// ----- mailboxes -----

test('GET /v1/mailboxes lists default folders', async () => {
    const r = await req('GET', '/v1/mailboxes', { auth: ALICE });
    assert.equal(r.status, 200);
    const paths = r.data.map((m) => m.path).sort();
    assert.deepEqual(paths, ['Archive', 'Drafts', 'INBOX', 'Junk', 'Sent', 'Trash']);
});

test('POST /v1/mailboxes creates a new mailbox', async () => {
    const r = await req('POST', '/v1/mailboxes', { auth: ALICE, body: { path: 'Custom' } });
    assert.equal(r.status, 201);
    assert.equal(r.data.path, 'Custom');
    const list = await req('GET', '/v1/mailboxes', { auth: ALICE });
    assert.ok(list.data.some((m) => m.path === 'Custom'));
});

test('POST /v1/mailboxes on existing name → 409', async () => {
    await req('POST', '/v1/mailboxes', { auth: ALICE, body: { path: 'DupFolder' } });
    const dup = await req('POST', '/v1/mailboxes', { auth: ALICE, body: { path: 'DupFolder' } });
    assert.equal(dup.status, 409);
});

test('PUT /v1/mailboxes/:path renames', async () => {
    await req('POST', '/v1/mailboxes', { auth: ALICE, body: { path: 'Old' } });
    const r = await req('PUT', '/v1/mailboxes/Old', { auth: ALICE, body: { newPath: 'New' } });
    assert.equal(r.status, 200);
    const list = await req('GET', '/v1/mailboxes', { auth: ALICE });
    const paths = list.data.map((m) => m.path);
    assert.ok(paths.includes('New'));
    assert.ok(!paths.includes('Old'));
});

test('DELETE /v1/mailboxes/:path removes a mailbox', async () => {
    await req('POST', '/v1/mailboxes', { auth: ALICE, body: { path: 'ToRemove' } });
    const d = await req('DELETE', '/v1/mailboxes/ToRemove', { auth: ALICE });
    assert.equal(d.status, 204);
});

test('DELETE INBOX → 400', async () => {
    const r = await req('DELETE', '/v1/mailboxes/INBOX', { auth: ALICE });
    assert.equal(r.status, 400);
});

// ----- messages -----

test('GET /v1/mailboxes/INBOX/messages returns paged list newest-first', async () => {
    const r = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 3);
    assert.equal(r.data.messages.length, 3);
    const subjects = r.data.messages.map((m) => m.envelope.subject);
    assert.deepEqual(subjects, ['Third — urgent', 'Second message', 'First message']);
});

test('GET /v1/mailboxes/INBOX/messages with search filters', async () => {
    const r = await req('GET', '/v1/mailboxes/INBOX/messages?search=urgent', { auth: ALICE });
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 1);
    assert.equal(r.data.messages[0].envelope.subject, 'Third — urgent');
});

test('GET /v1/mailboxes/INBOX/messages pagination', async () => {
    const page0 = await req('GET', '/v1/mailboxes/INBOX/messages?pageSize=2&page=0', { auth: ALICE });
    const page1 = await req('GET', '/v1/mailboxes/INBOX/messages?pageSize=2&page=1', { auth: ALICE });
    assert.equal(page0.data.messages.length, 2);
    assert.equal(page1.data.messages.length, 1);
    const all = [...page0.data.messages, ...page1.data.messages].map((m) => m.envelope.subject);
    assert.deepEqual(all, ['Third — urgent', 'Second message', 'First message']);
});

test('GET /v1/mailboxes/:path/messages/:uid returns full detail with text', async () => {
    const list = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    const uid = list.data.messages[list.data.messages.length - 1].uid; // oldest = First
    const r = await req('GET', `/v1/mailboxes/INBOX/messages/${uid}`, { auth: ALICE });
    assert.equal(r.status, 200);
    assert.equal(r.data.envelope.subject, 'First message');
    assert.ok(r.data.text.includes('Hello world'));
});

test('GET /v1/mailboxes/:path/messages/:uid returns html when present', async () => {
    const list = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    const htmlMsg = list.data.messages.find((m) => m.envelope.subject === 'Second message');
    const r = await req('GET', `/v1/mailboxes/INBOX/messages/${htmlMsg.uid}`, { auth: ALICE });
    assert.equal(r.status, 200);
    assert.ok(r.data.html && r.data.html.includes('<b>Second body.</b>'));
});

test('GET /v1/mailboxes/:path/messages/:uid/raw returns rfc822', async () => {
    const list = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    const uid = list.data.messages[0].uid;
    const r = await req('GET', `/v1/mailboxes/INBOX/messages/${uid}/raw`, { auth: ALICE });
    assert.equal(r.status, 200);
    assert.ok((r.headers['content-type'] || '').includes('rfc822'));
    assert.ok(String(r.data).startsWith('Date:') || /\bFrom:/.test(String(r.data)));
});

test('GET message with attachment returns attachment metadata', async () => {
    await seedAccount({
        host: imapConfig.host, port: imapConfig.port,
        user: ALICE.user, pass: ALICE.pass,
        messages: [{
            mailbox: 'INBOX',
            from: 'a@test.local', to: 'alice@test.local',
            subject: 'With attach',
            text: 'see attached',
            attachmentName: 'notes.txt',
            attachmentContent: 'secret notes here'
        }]
    });
    const list = await req('GET', '/v1/mailboxes/INBOX/messages?search=attach', { auth: ALICE });
    assert.equal(list.data.total, 1);
    const uid = list.data.messages[0].uid;
    const detail = await req('GET', `/v1/mailboxes/INBOX/messages/${uid}`, { auth: ALICE });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.attachments.length, 1);
    assert.equal(detail.data.attachments[0].filename, 'notes.txt');

    const attId = detail.data.attachments[0].id;
    const dl = await req('GET', `/v1/mailboxes/INBOX/messages/${uid}/attachments/${encodeURIComponent(attId)}`, { auth: ALICE });
    assert.equal(dl.status, 200);
    assert.equal(Buffer.from(dl.data).toString('utf8'), 'secret notes here');
});

test('PUT /v1/mailboxes/:path/messages/:uid/flags add+remove', async () => {
    const list = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    const uid = list.data.messages[0].uid;
    const r = await req('PUT', `/v1/mailboxes/INBOX/messages/${uid}/flags`, {
        auth: ALICE, body: { add: ['\\Seen'] }
    });
    assert.equal(r.status, 200);
    assert.ok(r.data.flags.includes('\\Seen'));

    const r2 = await req('PUT', `/v1/mailboxes/INBOX/messages/${uid}/flags`, {
        auth: ALICE, body: { remove: ['\\Seen'] }
    });
    assert.ok(!r2.data.flags.includes('\\Seen'));
});

test('PUT /v1/mailboxes/:path/messages/:uid/move moves across mailboxes', async () => {
    const list = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    const uid = list.data.messages[0].uid;
    const r = await req('PUT', `/v1/mailboxes/INBOX/messages/${uid}/move`, {
        auth: ALICE, body: { path: 'Archive' }
    });
    assert.equal(r.status, 200);

    const inbox = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    assert.equal(inbox.data.total, 2);

    const arch = await req('GET', '/v1/mailboxes/Archive/messages', { auth: ALICE });
    assert.equal(arch.data.total, 1);
});

test('DELETE /v1/mailboxes/:path/messages/:uid removes message', async () => {
    const before = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    const uid = before.data.messages[0].uid;
    const d = await req('DELETE', `/v1/mailboxes/INBOX/messages/${uid}`, { auth: ALICE });
    assert.equal(d.status, 204);
    const after = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    assert.equal(after.data.total, before.data.total - 1);
});

// ----- smoke / full journey -----

test('smoke: list → read → flag → move → delete', async () => {
    const mbs = await req('GET', '/v1/mailboxes', { auth: ALICE });
    assert.equal(mbs.status, 200);

    const list = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    assert.ok(list.data.messages.length > 0);
    const uid = list.data.messages[0].uid;

    const detail = await req('GET', `/v1/mailboxes/INBOX/messages/${uid}`, { auth: ALICE });
    assert.equal(detail.status, 200);

    await req('PUT', `/v1/mailboxes/INBOX/messages/${uid}/flags`, { auth: ALICE, body: { add: ['\\Seen'] } });

    await req('PUT', `/v1/mailboxes/INBOX/messages/${uid}/move`, { auth: ALICE, body: { path: 'Trash' } });

    const inbox = await req('GET', '/v1/mailboxes/INBOX/messages', { auth: ALICE });
    assert.ok(!inbox.data.messages.some((m) => m.uid === uid));

    const trash = await req('GET', '/v1/mailboxes/Trash/messages', { auth: ALICE });
    assert.ok(trash.data.total >= 1);

    const trashUid = trash.data.messages[0].uid;
    const del = await req('DELETE', `/v1/mailboxes/Trash/messages/${trashUid}`, { auth: ALICE });
    assert.equal(del.status, 204);
});
