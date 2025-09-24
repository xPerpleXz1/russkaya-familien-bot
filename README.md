# 🇷🇺 Russkaya Familie Discord Bot v2.0

**Production-ready Discord Bot für GTA V Grand RP DE1 Server mit PostgreSQL auf Railway.**

![Discord Bot](https://img.shields.io/badge/Discord-Bot-7289da?style=for-the-badge&logo=discord&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![Railway](https://img.shields.io/badge/Railway-Deployment-0B0D0E?style=for-the-badge&logo=railway&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)

## ✨ Features

### 🌱 **Pflanzen-System**
- Säen, Düngen, Ernten mit präzisen Timern
- Teamwork-Bonus für fremde Pflanzen (+25% XP)
- Qualitätssystem und Ertragssteigerung
- Automatische Erinnerungen

### ☀️ **Solar-System** 
- Panel aufstellen und verwalten
- 4-Reparaturen-System für Batterien
- Effizienz-System mit Bonus-Erträgen
- Speed-Collection-Bonus

### 👤 **Profil & Level-System**
- Erfahrungspunkte für alle Aktivitäten
- Level-System mit Belohnungen
- Persönliche Statistiken und Fortschritt
- Leaderboards nach Kategorien

### 🏆 **Achievement-System**
- 20+ verschiedene Achievements
- 5 Seltenheitsstufen (Common bis Legendary)
- Automatische Freischaltung
- Belohnungen in XP und Geld

### 📊 **Erweiterte Statistiken**
- Server-Übersichten
- Aktivitätsverlauf mit Diagrammen
- Top-Standorte Analyse
- Tägliche/wöchentliche Reports

### 🔧 **Admin-Features**
- Automatische Backups (täglich)
- Datenbank-Cleanup
- Server-Einstellungen
- Logs und Monitoring

## 🚀 Railway Deployment (1-Click)

### Voraussetzungen
- [Railway Account](https://railway.app) (kostenlos)
- Discord Bot Token
- GitHub Repository

### Schritt-für-Schritt Anleitung

#### 1. Repository Setup
```bash
# Repository forken oder clonen
git clone https://github.com/russkaya-familie/discord-bot-v2.git
cd discord-bot-v2

# Oder eigenes Repository erstellen
```

#### 2. Discord Bot erstellen
1. Gehe zu [Discord Developer Portal](https://discord.com/developers/applications)
2. "New Application" → Namen eingeben
3. Links: "Bot" → "Add Bot"
4. Token kopieren (für später)
5. Bot Permissions:
   - Send Messages
   - Use Slash Commands  
   - Embed Links
   - Attach Files
   - Read Message History
   - Add Reactions

#### 3. Railway Deployment
1. **Railway Account erstellen**
   - Gehe zu [railway.app](https://railway.app)
   - Registriere dich mit GitHub

2. **Neues Projekt**
   - "New Project" → "Deploy from GitHub repo"
   - Wähle dein Repository

3. **PostgreSQL hinzufügen**
   - Im Dashboard: "New" → "Database" → "PostgreSQL"
   - `DATABASE_URL` wird automatisch gesetzt

4. **Environment Variables setzen**
   ```
   DISCORD_TOKEN=dein_bot_token_hier
   PLANT_CHANNEL_ID=123456789012345678
   SOLAR_CHANNEL_ID=123456789012345678
   BACKUP_CHANNEL_ID=123456789012345678
   ```

5. **Deployment**
   - Automatisch bei Git Push
   - URL: `https://your-app-name.up.railway.app`

#### 4. Channel IDs finden
1. Discord → Einstellungen → Erweitert → Entwicklermodus ✅
2. Rechtsklick auf Channel → "ID kopieren"
3. In Railway Environment Variables einfügen

#### 5. Bot einladen
1. Discord Developer Portal → OAuth2 → URL Generator
2. Scopes: `bot` + `applications.commands`
3. URL öffnen → Bot zu Server einladen

**🎉 Fertig! Der Bot ist jetzt online und funktionsbereit.**

## 📋 Commands Übersicht

### 🌱 Pflanzen
| Command | Beschreibung |
|---------|--------------|
| `/pflanze-säen location:[Ort]` | Neue Pflanze säen |
| `/pflanze-düngen id:[ID]` | Pflanze düngen (+25% Ertrag) |
| `/pflanze-ernten id:[ID] car:[Auto]` | Pflanze ernten |
| `/pflanzen-status [filter]` | Aktive Pflanzen anzeigen |

### ☀️ Solar
| Command | Beschreibung |
|---------|--------------|
| `/solar-aufstellen location:[Ort]` | Solarpanel aufstellen |
| `/solar-reparieren id:[ID]` | Panel reparieren |
| `/solar-sammeln id:[ID] car:[Auto]` | Batterie sammeln |
| `/solar-status [filter]` | Aktive Panels anzeigen |

### 👤 Profil & Stats
| Command | Beschreibung |
|---------|--------------|
| `/profil [user]` | Profil anzeigen |
| `/leaderboard [kategorie]` | Bestenliste |
| `/achievements [user]` | Errungenschaften |
| `/statistiken [typ]` | Server-Statistiken |

### 🔧 Utility
| Command | Beschreibung |
|---------|--------------|
| `/logs [anzahl] [typ]` | Aktivitätslogs |
| `/verlauf [zeitraum]` | Aktivitätsdiagramm |
| `/help [kategorie]` | Hilfe anzeigen |

### 👑 Admin (Nur Administratoren)
| Command | Beschreibung |
|---------|--------------|
| `/backup [format]` | Daten-Backup erstellen |
| `/admin-cleanup [tage]` | Alte Einträge bereinigen |
| `/admin-settings [setting]` | Server-Einstellungen |

## ⏰ Timer & Mechaniken

### 🌱 Pflanzen-System
- **Wachstumszeit:** 4 Stunden (240 Min)
- **Dünger-Erinnerungen:** Nach 35 Min & 55 Min
- **Ertragssteigerung:** +25% mit Dünger
- **Teamwork-Bonus:** +25 XP für fremde Pflanzen

### ☀️ Solar-System
- **Batterie-Zeit:** 2 Stunden (120 Min)
- **Reparatur-Erinnerungen:** Nach 30 Min & 50 Min
- **System:** 4 Reparaturen = 1 Batterie
- **Effizienz-Bonus:** +20% pro Reparatur

### ⭐ Erfahrungssystem
| Aktivität | XP (eigen) | XP (fremd) |
|-----------|------------|------------|
| Pflanze säen | 50 | - |
| Pflanze düngen | 30 | 50 |
| Pflanze ernten | 100 | 75 |
| Solar aufstellen | 75 | - |
| Solar reparieren | 40 | 60 |
| Batterie sammeln | 120 | 90 |

## 🛠️ Tech Stack

- **Runtime:** Node.js 18+
- **Database:** PostgreSQL (Railway)
- **Discord API:** discord.js v14
- **Charts:** ChartJS-Node-Canvas
- **Scheduling:** node-cron
- **Health Checks:** Express
- **Deployment:** Railway
- **Container:** Docker (optional)

## 🔧 Lokale Entwicklung

```bash
# Repository clonen
git clone https://github.com/russkaya-familie/discord-bot-v2.git
cd discord-bot-v2

# Dependencies installieren
npm install

# Environment Variables setzen
cp .env.example .env
# .env bearbeiten mit deinen Werten

# Development Server starten
npm run dev

# Tests ausführen
npm test
```

### Lokale Datenbank
Der Bot verwendet automatisch SQLite als Fallback wenn keine PostgreSQL `DATABASE_URL` gesetzt ist.

## 📊 Monitoring & Logs

### Health Checks
- **Endpoint:** `https://your-app.railway.app/health`
- **Status:** `https://your-app.railway.app/`
- **Überwachung:** Railway Dashboard

### Automatische Backups
- **Frequenz:** Täglich um 03:00 (Berlin Zeit)
- **Format:** JSON mit vollständigen Daten
- **Channel:** Backup-Channel (konfigurierbar)

### Logging
- **Console Logs:** Alle Aktivitäten
- **Database Logs:** Activity_logs Tabelle
- **Error Handling:** Graceful Error Recovery

## 🏆 Achievement-System

### Seltenheitsstufen
- **🌟 Legendary:** Ultimative Herausforderungen
- **🔥 Epic:** Sehr schwere Ziele
- **💜 Rare:** Schwierige Aufgaben
- **💙 Uncommon:** Mittlere Herausforderungen
- **⚪ Common:** Einfache Ziele

### Beispiel Achievements
- **Erster Schritt** (Common): Erste Pflanze säen
- **Meister-Gärtner** (Rare): 50 Pflanzen säen
- **Team-Player** (Uncommon): 5 fremde Pflanzen düngen
- **Legende** (Legendary): Level 30 erreichen

## 🔐 Sicherheit & Best Practices

- ✅ **Environment Variables** für alle Secrets
- ✅ **Input Validation** bei allen Commands
- ✅ **Rate Limiting** durch Discord API
- ✅ **Non-root Container** Ausführung
- ✅ **SQL Injection** Schutz mit Parameterized Queries
- ✅ **Error Handling** mit Graceful Degradation

## 🌍 Skalierung & Performance

- **Horizontal Scaling:** Stateless Design
- **Database:** PostgreSQL Connection Pooling
- **Memory:** Automatische Garbage Collection
- **Background Tasks:** Cron-Jobs für Maintenance
- **Railway:** Auto-Scaling Support

## 📞 Support & Community

- **🐛 Bug Reports:** [GitHub Issues](https://github.com/russkaya-familie/discord-bot-v2/issues)
- **💡 Feature Requests:** [GitHub Discussions](https://github.com/russkaya-familie/discord-bot-v2/discussions)
- **📚 Wiki:** [Dokumentation](https://github.com/russkaya-familie/discord-bot-v2/wiki)
- **💬 Discord:** [Community Server](#)

## 📝 Changelog

### v2.0.0 (Latest)
- ✅ PostgreSQL Support
- ✅ Railway-Ready Deployment
- ✅ Achievement-System
- ✅ Level & XP System
- ✅ Advanced Statistics
- ✅ Automated Backups
- ✅ Health Monitoring
- ✅ 20+ New Commands

### v1.0.0
- 🌱 Basic Plant System
- ☀️ Basic Solar System
- 📊 SQLite Database

## 📜 License

MIT License - siehe [LICENSE](LICENSE) file.

---

**Развивайся с семьёй Русская! 🇷🇺**

*Made with ❤️ for the GrandRP Community*
