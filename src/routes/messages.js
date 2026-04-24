'use strict';

const { finished } = require('node:stream/promises');
const { withClient, withMailbox, serializeListItem, serializeEnvelope } = require('../imap');
const {
    messageListItemSchema,
    messageDetailSchema,
    flagsOpSchema,
    moveOpSchema,
    listMessagesQuerySchema,
    problemSchema
} = require('../schemas');
const { notFound, badRequest } = require('../errors');

// Walk bodyStructure nodes (recursive MIME tree) and collect text parts
// (inline text/plain, text/html) and attachments (anything else with a filename
// or content-disposition=attachment).
function walkStructure(node, path, acc) {
    if (!node) return;
    const part = path || (node.part ? node.part : '');
    const type = (node.type || '').toLowerCase();
    const disposition = (node.disposition || '').toLowerCase();
    const filename = (node.dispositionParameters && node.dispositionParameters.filename) ||
        (node.parameters && node.parameters.name) ||
        null;

    if (Array.isArray(node.childNodes) && node.childNodes.length) {
        for (const child of node.childNodes) {
            walkStructure(child, child.part, acc);
        }
        return;
    }

    const isAttachment = disposition === 'attachment' || (filename && !type.startsWith('text/'));
    if (isAttachment) {
        acc.attachments.push({
            id: part || '1',
            filename,
            contentType: type || null,
            size: node.size || null,
            disposition: disposition || null,
            related: disposition === 'inline'
        });
        return;
    }
    if (type === 'text/plain' && !acc.textPart) acc.textPart = part || '1';
    else if (type === 'text/html' && !acc.htmlPart) acc.htmlPart = part || '1';
}

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function downloadPartText(client, uid, part) {
    if (!part) return null;
    const res = await client.download(uid, part, { uid: true });
    if (!res || !res.content) return null;
    const buf = await streamToBuffer(res.content);
    return buf.toString('utf8');
}

module.exports = async function messageRoutes(app, { pool }) {
    app.get('/v1/mailboxes/:path/messages', {
        schema: {
            querystring: listMessagesQuerySchema,
            response: {
                200: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        page: { type: 'integer' },
                        pageSize: { type: 'integer' },
                        total: { type: 'integer' },
                        messages: { type: 'array', items: messageListItemSchema }
                    }
                },
                404: problemSchema
            }
        }
    }, async (req) => {
        const mboxPath = decodeURIComponent(req.params.path);
        const { page = 0, pageSize = 20, search } = req.query;

        return withClient(pool, req.creds, (client) =>
            withMailbox(client, mboxPath, true, async () => {
                const fetchQuery = { uid: true, flags: true, envelope: true, size: true, internalDate: true };
                let uids;

                if (search) {
                    uids = await client.search({
                        or: [{ subject: search }, { from: search }, { body: search }]
                    }, { uid: true });
                    uids = (uids || []).sort((a, b) => b - a);
                } else {
                    const exists = client.mailbox?.exists || 0;
                    if (!exists) return { path: mboxPath, page, pageSize, total: 0, messages: [] };
                    const top = exists - page * pageSize;
                    const bottom = Math.max(1, top - pageSize + 1);
                    if (top < 1) return { path: mboxPath, page, pageSize, total: exists, messages: [] };

                    const messages = [];
                    for await (const msg of client.fetch(`${bottom}:${top}`, fetchQuery)) {
                        messages.push(serializeListItem(msg));
                    }
                    messages.sort((a, b) => b.uid - a.uid);
                    return { path: mboxPath, page, pageSize, total: exists, messages };
                }

                const total = uids.length;
                const slice = uids.slice(page * pageSize, page * pageSize + pageSize);
                const messages = [];
                if (slice.length) {
                    for await (const msg of client.fetch(slice, fetchQuery, { uid: true })) {
                        messages.push(serializeListItem(msg));
                    }
                    messages.sort((a, b) => b.uid - a.uid);
                }
                return { path: mboxPath, page, pageSize, total, messages };
            })
        );
    });

    app.get('/v1/mailboxes/:path/messages/:uid', {
        schema: {
            response: { 200: messageDetailSchema, 404: problemSchema }
        }
    }, async (req) => {
        const mboxPath = decodeURIComponent(req.params.path);
        const uid = Number(req.params.uid);

        return withClient(pool, req.creds, (client) =>
            withMailbox(client, mboxPath, true, async () => {
                const msg = await client.fetchOne(String(uid), {
                    uid: true,
                    flags: true,
                    envelope: true,
                    size: true,
                    internalDate: true,
                    bodyStructure: true
                }, { uid: true });
                if (!msg) throw notFound('Message not found');

                const acc = { textPart: null, htmlPart: null, attachments: [] };
                walkStructure(msg.bodyStructure, msg.bodyStructure?.part || '1', acc);

                const [text, html] = await Promise.all([
                    downloadPartText(client, uid, acc.textPart),
                    downloadPartText(client, uid, acc.htmlPart)
                ]);

                return {
                    uid: msg.uid,
                    seq: msg.seq,
                    flags: msg.flags ? [...msg.flags] : [],
                    size: msg.size || 0,
                    internalDate: msg.internalDate ? new Date(msg.internalDate).toISOString() : null,
                    envelope: serializeEnvelope(msg.envelope),
                    text,
                    html,
                    attachments: acc.attachments
                };
            })
        );
    });

    app.get('/v1/mailboxes/:path/messages/:uid/raw', async (req, reply) => {
        const mboxPath = decodeURIComponent(req.params.path);
        const uid = Number(req.params.uid);

        return withClient(pool, req.creds, (client) =>
            withMailbox(client, mboxPath, true, async () => {
                const dl = await client.download(String(uid), undefined, { uid: true });
                if (!dl || !dl.content) throw notFound('Message not found');
                reply.header('content-type', 'message/rfc822');
                if (dl.meta && dl.meta.size) reply.header('content-length', dl.meta.size);
                reply.send(dl.content);
                await finished(dl.content);
            })
        );
    });

    app.get('/v1/mailboxes/:path/messages/:uid/attachments/:attachmentId', async (req, reply) => {
        const mboxPath = decodeURIComponent(req.params.path);
        const uid = Number(req.params.uid);
        const attachmentId = req.params.attachmentId;

        return withClient(pool, req.creds, (client) =>
            withMailbox(client, mboxPath, true, async () => {
                const dl = await client.download(String(uid), attachmentId, { uid: true });
                if (!dl || !dl.content) throw notFound('Attachment not found');
                const meta = dl.meta || {};
                reply.header('content-type', meta.contentType || 'application/octet-stream');
                if (meta.filename) {
                    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(meta.filename)}"`);
                }
                reply.send(dl.content);
                await finished(dl.content);
            })
        );
    });

    app.put('/v1/mailboxes/:path/messages/:uid/flags', {
        schema: {
            body: flagsOpSchema,
            response: {
                200: {
                    type: 'object',
                    properties: { uid: { type: 'integer' }, flags: { type: 'array', items: { type: 'string' } } }
                }
            }
        }
    }, async (req) => {
        const mboxPath = decodeURIComponent(req.params.path);
        const uid = Number(req.params.uid);
        const { add, remove, set } = req.body || {};
        if (!add && !remove && !set) throw badRequest('Provide add, remove, or set');

        return withClient(pool, req.creds, (client) =>
            withMailbox(client, mboxPath, false, async () => {
                const opts = { uid: true };
                if (set) await client.messageFlagsSet(String(uid), set, opts);
                if (add) await client.messageFlagsAdd(String(uid), add, opts);
                if (remove) await client.messageFlagsRemove(String(uid), remove, opts);
                const msg = await client.fetchOne(String(uid), { uid: true, flags: true }, { uid: true });
                if (!msg) throw notFound('Message not found');
                return { uid: msg.uid, flags: msg.flags ? [...msg.flags] : [] };
            })
        );
    });

    app.put('/v1/mailboxes/:path/messages/:uid/move', {
        schema: {
            body: moveOpSchema,
            response: {
                200: {
                    type: 'object',
                    properties: {
                        uid: { type: 'integer' },
                        path: { type: 'string' },
                        destUid: { type: ['integer', 'null'] }
                    }
                }
            }
        }
    }, async (req) => {
        const mboxPath = decodeURIComponent(req.params.path);
        const uid = Number(req.params.uid);
        const dest = req.body.path;

        return withClient(pool, req.creds, (client) =>
            withMailbox(client, mboxPath, false, async () => {
                const res = await client.messageMove(String(uid), dest, { uid: true });
                let destUid = null;
                if (res && res.uidMap) {
                    const v = res.uidMap.get ? res.uidMap.get(uid) : res.uidMap[uid];
                    if (v) destUid = v;
                }
                return { uid, path: dest, destUid };
            })
        );
    });

    app.delete('/v1/mailboxes/:path/messages/:uid', async (req, reply) => {
        const mboxPath = decodeURIComponent(req.params.path);
        const uid = Number(req.params.uid);

        await withClient(pool, req.creds, (client) =>
            withMailbox(client, mboxPath, false, async () => {
                const ok = await client.messageDelete(String(uid), { uid: true });
                if (!ok) throw notFound('Message not found');
            })
        );
        reply.code(204).send();
    });
};
