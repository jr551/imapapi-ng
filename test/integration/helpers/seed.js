'use strict';

const { ImapFlow } = require('imapflow');

function buildRfc822({ from, to, subject, text, html, date, messageId }) {
    const boundary = '----=_imapapi-test-' + Math.random().toString(36).slice(2, 10);
    const headers = [
        `Date: ${date || new Date().toUTCString()}`,
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `Message-ID: <${messageId || Math.random().toString(36).slice(2) + '@test.local'}>`,
        `MIME-Version: 1.0`
    ];
    if (html) {
        headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
        const body =
            `--${boundary}\r\n` +
            `Content-Type: text/plain; charset=utf-8\r\n\r\n${text || ''}\r\n` +
            `--${boundary}\r\n` +
            `Content-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n` +
            `--${boundary}--\r\n`;
        return headers.join('\r\n') + '\r\n\r\n' + body;
    }
    headers.push(`Content-Type: text/plain; charset=utf-8`);
    return headers.join('\r\n') + '\r\n\r\n' + (text || '');
}

function buildWithAttachment({ from, to, subject, text, attachmentName, attachmentContent }) {
    const boundary = '----=_imapapi-test-' + Math.random().toString(36).slice(2, 10);
    const b64 = Buffer.from(attachmentContent).toString('base64').match(/.{1,76}/g).join('\r\n');
    const headers = [
        `Date: ${new Date().toUTCString()}`,
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `Message-ID: <${Math.random().toString(36).slice(2)}@test.local>`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`
    ];
    const body =
        `--${boundary}\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n\r\n${text || ''}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: application/octet-stream; name="${attachmentName}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${attachmentName}"\r\n\r\n` +
        `${b64}\r\n` +
        `--${boundary}--\r\n`;
    return headers.join('\r\n') + '\r\n\r\n' + body;
}

async function seedAccount({ host, port, user, pass, messages }) {
    const c = new ImapFlow({ host, port, secure: false, auth: { user, pass }, logger: false });
    await c.connect();
    try {
        for (const m of messages) {
            const raw = m.raw || (m.attachmentName ? buildWithAttachment(m) : buildRfc822(m));
            await c.append(m.mailbox || 'INBOX', Buffer.from(raw), m.flags || []);
        }
    } finally {
        await c.logout().catch(() => c.close());
    }
}

module.exports = { seedAccount, buildRfc822, buildWithAttachment };
