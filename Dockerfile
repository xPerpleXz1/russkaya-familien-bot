# Multi-stage build für optimale Performance
FROM node:18-alpine AS builder

# Metadata
LABEL maintainer="Russkaya Familie"
LABEL description="Discord Bot v3.0.2 - Pflanzen & Solar System"
LABEL version="3.0.2"

# System dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client

# Arbeitsverzeichnis
WORKDIR /app

# Package files kopieren
COPY package*.json ./

# Dependencies installieren
RUN npm ci --omit=dev && \
    npm cache clean --force

# Production Stage
FROM node:18-alpine AS production

# Runtime dependencies
RUN apk add --no-cache \
    postgresql-client \
    curl

# Arbeitsverzeichnis
WORKDIR /app

# Non-root user
RUN addgroup -g 1001 -S botgroup && \
    adduser -S botuser -u 1001 -G botgroup

# Dependencies und Code
COPY --from=builder --chown=botuser:botgroup /app/node_modules ./node_modules
COPY --chown=botuser:botgroup . .

# User wechseln
USER botuser

# Port
EXPOSE 3000

# Health Check
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Graceful shutdown
STOPSIGNAL SIGTERM

# Bot starten
CMD ["npm", "start"]
