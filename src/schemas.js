'use strict';

// Shared JSON schemas used by route options. Fastify both validates requests
// and generates the OpenAPI document from these.

const addressSchema = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        address: { type: 'string', format: 'email' }
    },
    required: ['address']
};

const envelopeSchema = {
    type: 'object',
    properties: {
        date: { type: ['string', 'null'] },
        subject: { type: ['string', 'null'] },
        from: { type: 'array', items: addressSchema },
        sender: { type: 'array', items: addressSchema },
        replyTo: { type: 'array', items: addressSchema },
        to: { type: 'array', items: addressSchema },
        cc: { type: 'array', items: addressSchema },
        bcc: { type: 'array', items: addressSchema },
        messageId: { type: ['string', 'null'] },
        inReplyTo: { type: ['string', 'null'] }
    }
};

const mailboxSchema = {
    type: 'object',
    properties: {
        path: { type: 'string' },
        name: { type: 'string' },
        delimiter: { type: 'string' },
        flags: { type: 'array', items: { type: 'string' } },
        specialUse: { type: ['string', 'null'] },
        subscribed: { type: 'boolean' }
    },
    required: ['path', 'name']
};

const messageListItemSchema = {
    type: 'object',
    properties: {
        uid: { type: 'integer' },
        seq: { type: 'integer' },
        flags: { type: 'array', items: { type: 'string' } },
        size: { type: 'integer' },
        internalDate: { type: ['string', 'null'] },
        envelope: envelopeSchema
    }
};

const attachmentRefSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        filename: { type: ['string', 'null'] },
        contentType: { type: ['string', 'null'] },
        size: { type: ['integer', 'null'] },
        disposition: { type: ['string', 'null'] },
        related: { type: 'boolean' }
    },
    required: ['id']
};

const messageDetailSchema = {
    type: 'object',
    properties: {
        uid: { type: 'integer' },
        seq: { type: 'integer' },
        flags: { type: 'array', items: { type: 'string' } },
        size: { type: 'integer' },
        internalDate: { type: ['string', 'null'] },
        envelope: envelopeSchema,
        text: { type: ['string', 'null'] },
        html: { type: ['string', 'null'] },
        attachments: { type: 'array', items: attachmentRefSchema }
    }
};

const flagsOpSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        add: { type: 'array', items: { type: 'string' } },
        remove: { type: 'array', items: { type: 'string' } },
        set: { type: 'array', items: { type: 'string' } }
    }
};

const moveOpSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: { path: { type: 'string' } }
};

const createMailboxSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: { path: { type: 'string', minLength: 1 } }
};

const renameMailboxSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['newPath'],
    properties: { newPath: { type: 'string', minLength: 1 } }
};

const listMessagesQuerySchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        page: { type: 'integer', minimum: 0, default: 0 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        search: { type: 'string' }
    }
};

const problemSchema = {
    type: 'object',
    properties: {
        type: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' }
    }
};

module.exports = {
    addressSchema,
    envelopeSchema,
    mailboxSchema,
    messageListItemSchema,
    messageDetailSchema,
    attachmentRefSchema,
    flagsOpSchema,
    moveOpSchema,
    createMailboxSchema,
    renameMailboxSchema,
    listMessagesQuerySchema,
    problemSchema
};
