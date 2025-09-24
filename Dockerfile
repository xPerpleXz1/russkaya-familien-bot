# Node.js Base Image - LTS Version für Stabilität
FROM node:18-alpine

# Metadata
LABEL maintainer="Russkaya Familie"
LABEL description="Discord Bot für GTA V Grand RP - Pflanzen & Solar Management"
LABEL version="2.0"

# System dependencies für Charts und SQLite
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    sqlite

# Arbeitsverzeichnis erstellen
WORKDIR /app

# Package files zuerst kopieren für besseres Caching
COPY package*.json ./

# Dependencies installieren
RUN npm ci --only=production && \
    npm cache clean --force

# Bot Code kopieren
COPY . .

# Benutzer für Sicherheit erstellen
RUN addgroup -g 1001 -S botuser && \
    adduser -S discordbot -u 1001 -G botuser

# Datenbank Ordner erstellen und Permissions setzen
RUN mkdir -p /app/data && \
    chown -R discordbot:botuser /app

# Als non-root User wechseln
USER discordbot

# Port für Health Checks exponieren
EXPOSE 3000

# Healthcheck hinzufügen
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Graceful shutdown support
STOPSIGNAL SIGTERM

# Bot starten
CMD ["npm", "start"]
