'use strict';

const { fromImapError } = require('./errors');

// Acquire a pooled IMAP client for the authenticated user, run `fn(client)`,
// then release or discard. If the operation throws, classify the error and
// discard the client if it's a connection-level failure.
async function withClient(pool, creds, fn) {
    const client = await pool.acquire(creds.hash, creds.user, creds.pass);
    try {
        const result = await fn(client);
        pool.release(creds.hash, client);
        return result;
    } catch (err) {
        const isFatal = !client.authenticated || !client.usable ||
            /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket/i.test(String(err && err.message));
        if (isFatal) pool.discard(creds.hash, client);
        else pool.release(creds.hash, client);
        throw fromImapError(err);
    }
}

// Run `fn(lock)` while holding a mailbox lock. Ensures release even on error.
async function withMailbox(client, path, readOnly, fn) {
    const lock = await client.getMailboxLock(path, { readonly: !!readOnly });
    try {
        return await fn(lock);
    } finally {
        lock.release();
    }
}

// imapflow's mailbox objects carry a non-serializable `specialUse` symbol
// and other extras. This plucks just the fields we expose.
function serializeMailbox(mb) {
    return {
        path: mb.path,
        name: mb.name,
        delimiter: mb.delimiter,
        flags: mb.flags ? [...mb.flags] : [],
        specialUse: mb.specialUse || null,
        subscribed: !!mb.subscribed
    };
}

function serializeEnvelope(env) {
    if (!env) return {};
    const mapAddrs = (a) => (a || []).map((x) => ({ name: x.name || '', address: x.address || '' }));
    return {
        date: env.date ? new Date(env.date).toISOString() : null,
        subject: env.subject || null,
        from: mapAddrs(env.from),
        sender: mapAddrs(env.sender),
        replyTo: mapAddrs(env.replyTo),
        to: mapAddrs(env.to),
        cc: mapAddrs(env.cc),
        bcc: mapAddrs(env.bcc),
        messageId: env.messageId || null,
        inReplyTo: env.inReplyTo || null
    };
}

function serializeListItem(msg) {
    return {
        uid: msg.uid,
        seq: msg.seq,
        flags: msg.flags ? [...msg.flags] : [],
        size: msg.size || 0,
        internalDate: msg.internalDate ? new Date(msg.internalDate).toISOString() : null,
        envelope: serializeEnvelope(msg.envelope)
    };
}

module.exports = { withClient, withMailbox, serializeMailbox, serializeEnvelope, serializeListItem };
