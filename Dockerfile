# Multi-stage build für optimale Performance
FROM node:18-alpine AS builder

# Metadata v3.0
LABEL maintainer="Russkaya Familie"
LABEL description="Discord Bot v3.0 - Vollständiges GTA RP Management System"
LABEL version="3.0.0"

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

# Dependencies installieren
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

# Health Check v3.0
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Graceful shutdown signal
STOPSIGNAL SIGTERM

# Bot starten v3.0
CMD ["npm", "start"]
