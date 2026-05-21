FROM node:18-alpine

WORKDIR /usr/src/app

# Install build tools needed for better-sqlite3 compilation
RUN apk add --no-cache python3 make g++

# Install dependencies (including dev deps for build), then build and prune dev deps
COPY package.json package-lock.json* ./
RUN npm install

# Copy source
COPY . .

# Build frontend bundle
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "server.js"]
