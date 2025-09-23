# 🇷🇺 Russkaya Familie Discord Bot

Production-ready Discord Bot für GTA V Grand RP DE1 Server mit PostgreSQL auf Railway.

## ✨ Features

- 🌱 **Pflanzen-System** - Säen, Düngen, Ernten mit Timer
- ☀️ **Solar-System** - Panel aufstellen und verwalten
- 📊 **PostgreSQL Database** - Enterprise-grade Datenbank
- 🔄 **Automatische Backups** - Tägliche CSV Backups
- ⚡ **Railway Hosting** - Zero-downtime Deployments
- 📈 **Health Monitoring** - System Überwachung

## 🚀 Deploy auf Railway

1. Fork dieses Repository
2. Railway Account erstellen
3. "Deploy from GitHub repo" wählen
4. Environment Variables setzen:
   - `DISCORD_TOKEN` - Dein Bot Token
   - `BACKUP_CHANNEL_ID` - Channel ID für Backups
5. PostgreSQL Database hinzufügen
6. Deploy!

## 📋 Commands

- `/pflanze-säen location:[Ort]` - Neue Pflanze säen
- `/pflanze-düngen id:[ID]` - Pflanze düngen (+25% Ertrag)
- `/pflanze-ernten id:[ID] car:[Auto]` - Pflanze ernten
- `/pflanzen-status` - Aktive Pflanzen anzeigen
- `/solar-aufstellen location:[Ort]` - Solarpanel aufstellen
- `/solar-status` - Aktive Panels anzeigen
- `/stats` - Bot Statistiken
- `/help` - Hilfe anzeigen

## 🛠️ Tech Stack

- **Discord.js v14** - Discord API
- **PostgreSQL** - Database
- **Express** - Health Check Server
- **Node-Cron** - Backup Scheduler
- **Railway** - Cloud Hosting

---

**Развивайся с семьёй Русская! 🇷🇺**
