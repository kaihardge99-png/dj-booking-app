FROM node:22-bookworm-slim

WORKDIR /usr/src/app

# Install system dependencies required by Playwright and native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    build-essential \
    ca-certificates \
    wget \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgdk-pixbuf2.0-0 \
    libgraphene-1.0-0 \
    libgtk-4-1 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    libxkbcommon0 \
    libxkbcommon-x11-0 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libxshmfence1 \
    libxcb1 \
    libxcb-dri3-0 \
    libxcb-dri2-0 \
    libxcb-glx0 \
    libxcb-present0 \
    libxcb-shm0 \
    libxcb-xfixes0 \
    libxcb-sync1 \
    libxcb-render0 \
    libxcb-render-util0 \
    fontconfig \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies, build frontend, and prune dev dependencies
COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --production

ENV NODE_ENV=production

EXPOSE 5000
CMD ["node", "server.js"]
