'use strict';

const { withClient, serializeMailbox } = require('../imap');
const {
    mailboxSchema,
    createMailboxSchema,
    renameMailboxSchema,
    problemSchema
} = require('../schemas');
const { badRequest, notFound, conflict } = require('../errors');

module.exports = async function mailboxRoutes(app, { pool }) {
    app.get('/v1/mailboxes', {
        schema: {
            response: {
                200: { type: 'array', items: mailboxSchema },
                401: problemSchema,
                502: problemSchema
            }
        }
    }, async (req) => {
        return withClient(pool, req.creds, async (client) => {
            const list = await client.list();
            return list.map(serializeMailbox);
        });
    });

    app.post('/v1/mailboxes', {
        schema: {
            body: createMailboxSchema,
            response: { 201: mailboxSchema, 400: problemSchema, 409: problemSchema }
        }
    }, async (req, reply) => {
        const { path } = req.body;
        return withClient(pool, req.creds, async (client) => {
            const res = await client.mailboxCreate(path);
            if (res && res.created === false) throw conflict('Mailbox already exists');
            reply.code(201);
            return {
                path: res.path,
                name: res.path.split(res.delimiter || '/').pop(),
                delimiter: res.delimiter || '/',
                flags: [],
                specialUse: null,
                subscribed: false
            };
        });
    });

    app.put('/v1/mailboxes/:path', {
        schema: {
            body: renameMailboxSchema,
            response: { 200: mailboxSchema, 404: problemSchema, 409: problemSchema }
        }
    }, async (req) => {
        const from = decodeURIComponent(req.params.path);
        const { newPath } = req.body;
        return withClient(pool, req.creds, async (client) => {
            const res = await client.mailboxRename(from, newPath);
            return {
                path: res.newPath || newPath,
                name: (res.newPath || newPath).split(res.delimiter || '/').pop(),
                delimiter: res.delimiter || '/',
                flags: [],
                specialUse: null,
                subscribed: false
            };
        });
    });

    app.delete('/v1/mailboxes/:path', {
        schema: {
            response: { 204: { type: 'null' }, 404: problemSchema }
        }
    }, async (req, reply) => {
        const path = decodeURIComponent(req.params.path);
        if (path.toUpperCase() === 'INBOX') throw badRequest('Cannot delete INBOX');
        await withClient(pool, req.creds, async (client) => {
            await client.mailboxDelete(path);
        });
        reply.code(204).send();
    });
};
