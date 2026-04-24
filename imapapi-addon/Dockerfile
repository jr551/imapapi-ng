FROM node:22-alpine

WORKDIR /app

# Install build tools needed for native modules and wget for healthcheck
RUN apk add --no-cache python3 make g++ wget

# Copy package files and install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]