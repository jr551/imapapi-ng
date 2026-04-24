FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++ \
    && corepack disable

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

FROM node:22-alpine AS runtime

RUN apk add --no-cache tini wget ca-certificates \
    && adduser -D -u 10001 imapapi

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    CACHE_PATH=/data/cache.db

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

RUN mkdir -p /data \
    && chown -R imapapi:imapapi /app /data

USER imapapi
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
