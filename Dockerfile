# Multi-stage build für optimale Performance
FROM node:18-alpine AS builder

# Metadata
LABEL maintainer="Russkaya Familie"
LABEL description="Discord Bot v2.0 für GTA V Grand RP - Production Ready mit PostgreSQL"
LABEL version="2.0.0"

# System dependencies für Charts und Native Modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    postgresql-client

# Arbeitsverzeichnis erstellen
WORKDIR /app

# Package files kopieren für besseres Caching
COPY package*.json ./

# Dependencies installieren - FIXED für Railway
# Nutze npm install statt npm ci falls keine package-lock.json vorhanden
RUN if [ -f package-lock.json ]; then \
        npm ci --omit=dev; \
    else \
        npm install --only=production; \
    fi && \
    npm cache clean --force

# Production Stage
FROM node:18-alpine AS production

# System runtime dependencies
RUN apk add --no-cache \
    cairo \
    jpeg \
    pango \
    giflib \
    pixman \
    postgresql-client \
    curl

# Arbeitsverzeichnis
WORKDIR /app

# Non-root user erstellen
RUN addgroup -g 1001 -S botgroup && \
    adduser -S botuser -u 1001 -G botgroup

# Dependencies und Code kopieren
COPY --from=builder --chown=botuser:botgroup /app/node_modules ./node_modules
COPY --chown=botuser:botgroup . .

# Berechtigungen setzen
RUN chown -R botuser:botgroup /app && \
    chmod +x /app/scripts/*.js || true

# Als non-root user wechseln
USER botuser

# Port für Health Checks
EXPOSE 3000

# Health Check
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Graceful shutdown signal
STOPSIGNAL SIGTERM

# Bot starten
CMD ["npm", "start"]
