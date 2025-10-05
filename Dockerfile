# Railway-optimiertes Dockerfile
FROM node:18-alpine

# Metadata
LABEL version="3.0.2"
LABEL description="Russkaya Familie Bot"

# System dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client \
    curl

# Arbeitsverzeichnis
WORKDIR /app

# Package files kopieren
COPY package.json ./

# Dependencies installieren
RUN npm install --only=production && \
    npm cache clean --force

# App Code kopieren
COPY . .

# Port exposieren
EXPOSE 3000

# Health Check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Bot starten
CMD ["npm", "start"]
