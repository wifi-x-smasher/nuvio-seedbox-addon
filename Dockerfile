# Self-hosted seedbox add-on.
# Build:  docker build -t nuvio-seedbox-addon .
# Run:    docker run -p 7700:7700 -v "$PWD/data:/data" nuvio-seedbox-addon
# Then open http://localhost:7700/setup to configure (no env required).

FROM node:20-alpine

WORKDIR /app

# Install dependencies first so this layer is cached when only src/ changes.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Persistent state (index + caches + settings.json) lives here. Mount a volume.
ENV DATA_DIR=/data \
    ADDON_PORT=7700 \
    NODE_ENV=production
VOLUME ["/data"]
EXPOSE 7700

# Built-in health endpoint (unauthenticated).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7700/healthz || exit 1

CMD ["node", "src/index.js"]
