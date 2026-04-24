FROM alpine:3.20

RUN apk add --no-cache dovecot ca-certificates \
    && mkdir -p /srv/mail /etc/dovecot

COPY dovecot.conf /etc/dovecot/dovecot.conf
COPY passwd /etc/dovecot/passwd

RUN addgroup -g 5000 vmail \
    && adduser -D -u 5000 -G vmail -h /srv/mail -s /sbin/nologin vmail \
    && chown -R vmail:vmail /srv/mail \
    && chmod 640 /etc/dovecot/passwd \
    && chown root:dovecot /etc/dovecot/passwd

EXPOSE 143
CMD ["dovecot", "-F"]
