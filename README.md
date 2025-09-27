# 🇷🇺 Russkaya Familie Discord Bot v3.0

**Das ultimative Discord Bot System für GTA V Grand RP - Vollständige Aktivitäten-Verwaltung und Auszahlungssystem**

![Discord Bot](https://img.shields.io/badge/Discord-Bot%20v3.0-7289da?style=for-the-badge&logo=discord&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![Railway](https://img.shields.io/badge/Railway-Deployment-0B0D0E?style=for-the-badge&logo=railway&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)

## 🚀 NEU in v3.0 - Das komplette GTA RP System!

### 🔫 **Vollständiges Raid & Event System**
- **Raids:** 10.000€ pro Person automatisch erfasst
- **Hafen Events:** 50.000€ pro wertvollem Container
- **Mount Chiliad:** 30.000€ für We.Co.+Wüstenschal Container
- **EKZ:** 100.000€ pro Person bei Gewinnen
- **Shop Raub:** ~10.000€ pro Person (anpassbar)
- **Flugzeugträger:** 20.000€ pro Drop-Aktivität

### 🌾 **Externe Arbeiten System**
- **Beete düngen:** 1.000€ pro gedüngtes Beet (extern)
- **Solar reparieren:** 1.000€ pro Reparatur (extern)
- **Pilzfarm:** 800€ pro Pilz-Abgabe
- **Solar Batterie Abgabe:** 10.000€ pro abgegebene Batterie

### 👥 **Rekrutierungs-System**
- **20.000€** pro erfolgreich rekrutierte Person
- **1-Woche Tracking** für Aktivitäts-Nachweis
- **Automatische Auszahlung** nach Bestätigung

### 💸 **Passive Einnahmen**
- **Gelddruckmaschine:** 2.000€ alle 5 Minuten
- **Automatisches Tracking** für passive Erträge

### 🍊 **Erweiterte Pflanzen (3 Typen)**
- **🍊 Mandarinen:** 3h Wachstum, 800€ Ertrag (Standard)
- **🍍 Ananas:** 5h Wachstum, 1.500€ Ertrag (Premium)
- **🥬 Kohl:** 2h Wachstum, 500€ Ertrag (Schnell)
- **Intelligente Timer:** Pausiert automatisch bei fehlender Düngung

### 🚗 **Gallivanter-Regel Integration**
- **Automatische Erkennung** wenn Erträge in Gallivanter-Kofferaum gelegt werden
- **Auszahlungs-Tracking** für alle qualifizierten Aktivitäten
- **WICHTIG:** Batterie/Pilze/Beete NICHT selbst einsammeln!

## 📋 Vollständige Command-Liste

### 🌱 **Farming Commands**
| Command | Beschreibung |
|---------|--------------|
| `/pflanze-säen location: pflanzentyp:` | Neue Pflanze säen (3 Typen verfügbar) |
| `/pflanze-düngen id:` | Pflanze düngen (pausiert Timer!) |
| `/pflanze-ernten id: car:` | Pflanze ernten (Gallivanter für Auszahlung!) |
| `/pflanzen-status [filter:]` | Aktive Pflanzen anzeigen |
| `/pflanzen-info` | Alle Pflanzentypen & Details |

### ☀️ **Solar Commands**
| Command | Beschreibung |
|---------|--------------|
| `/solar-aufstellen location:` | Solarpanel aufstellen |
| `/solar-reparieren id:` | Panel reparieren (pausiert Timer!) |
| `/solar-sammeln id: car:` | Batterie sammeln (Gallivanter!) |
| `/solar-status` | Aktive Panels anzeigen |

### 🔫 **Event & Raid Commands (NEU!)**
| Command | Beschreibung |
|---------|--------------|
| `/aktivität-eintragen typ: location: teilnehmer:` | Raids/Events registrieren |
| `/externe-arbeit typ: location: anzahl:` | Beete/Solar extern |
| `/aktivitäten-info` | Alle Aktivitäten & Auszahlungsraten |

### 👥 **Rekrutierung Commands (NEU!)**
| Command | Beschreibung |
|---------|--------------|
| `/rekrutierung neuer_spieler: [discord_user:]` | Rekrutierung starten |
| `/rekrutierung-abschließen id:` | Nach 1 Woche abschließen (20.000€) |

### 📊 **Statistiken & Info**
| Command | Beschreibung |
|---------|--------------|
| `/meine-aktivitäten [zeitraum:]` | Persönliche Übersicht |
| `/statistiken` | Umfassende Server-Statistiken |
| `/help` | Vollständige Hilfe v3.0 |

### 💾 **Admin Commands** (Admin only)
| Command | Beschreibung |
|---------|--------------|
| `/backup format:json` | **VOLLSTÄNDIGE AUSZAHLUNGEN** |
| `/backup format:csv` | Standard Daten-Backup |
| `/backup format:complete` | Alle Tabellen (v3.0) |

## 💰 Vollständige Auszahlungsraten

### 🔫 **Raids & Events**
```
🔫 Raid: 10.000€ pro Person
🚢 Hafen Event: 50.000€ pro Container
⛰️ Mount Chiliad: 30.000€ pro Abgabe
🏬 EKZ: 100.000€ pro Person
🏪 Shop Raub: ~10.000€ pro Person
✈️ Flugzeugträger: 20.000€ pro Drop
```

### 🌾 **Farming & Externe Arbeiten**
```
🌱 Beete düngen: 1.000€ pro Beet
🔧 Solar reparieren: 1.000€ pro Reparatur
🔋 Solar Abgabe: 10.000€ pro Batterie
🍄 Pilzfarm: 800€ pro Abgabe
```

### 🍊 **Pflanzen-System (Neue Typen)**
```
🍊 Mandarinen (3h): 800€ Ertrag, 400€ Säen-Rate
🍍 Ananas (5h): 1.500€ Ertrag, 600€ Säen-Rate
🥬 Kohl (2h): 500€ Ertrag, 300€ Säen-Rate
💚 Dünger-Bonus: +25% auf alle Pflanzen
```

### 💸 **Passive & Sonstige**
```
💸 Gelddruckmaschine: 2.000€ alle 5 Min
👥 Rekrutierung: 20.000€ pro Person (1+ Woche)
```

## 🚀 Railway Deployment (v3.0)

### Quick Setup:
1. **Repository:** [Fork/Clone v3.0 Branch]
2. **Railway:** Neues Projekt von GitHub repo
3. **PostgreSQL:** Automatisch hinzufügen
4. **Environment Variables:**
   ```env
   DISCORD_TOKEN=dein_token_hier
   PLANT_CHANNEL_ID=123456789012345678
   SOLAR_CHANNEL_ID=123456789012345678
   BACKUP_CHANNEL_ID=123456789012345678
   LOGS_CHANNEL_ID=123456789012345678
   ```
5. **Deploy:** Automatisch bei Git Push

### Migration von v2.0:
- ✅ **Keine Breaking Changes**
- ✅ **Automatische Datenbank-Migration**
- ✅ **Alle bestehenden Daten bleiben erhalten**
- ✅ **Zero-Downtime Update möglich**

## 🔧 Tech Stack v3.0

- **Runtime:** Node.js 18+
- **Database:** PostgreSQL (5 Tabellen)
- **Discord API:** discord.js v14
- **Background Jobs:** node-cron (Timer-Management)
- **Health Monitoring:** Express + erweiterte Checks
- **Deployment:** Railway (Auto-Scaling)
- **Fallbacks:** SQLite + Memory-Storage

## 📊 Neue Datenbank-Struktur

### Tabellen (v3.0):
1. **plants** - Erweitert mit plant_type, timer_paused_at
2. **solar_panels** - Erweitert mit timer_paused_at  
3. **activity_logs** - Erweitert mit plant_type, reward, activity_category
4. **general_activities** - NEU: Raids, Events, etc.
5. **external_work** - NEU: Externe Beete/Solar Arbeiten
6. **recruitments** - NEU: Rekrutierungs-Tracking

## ⚠️ WICHTIGE GALLIVANTER-REGEL

```
🚗 FÜR AUSZAHLUNGEN:
Batterie/Pilze/Beete NICHT selbst einsammeln!
➡️ In GALLIVANTER-KOFFERAUM legen!

Commands nutzen:
• /aktivität-eintragen für Events
• /externe-arbeit für Beete/Solar
• /solar-sammeln car:gallivanter
• /pflanze-ernten car:gallivanter
```

## 🏆 Features & Highlights

- ✅ **100% Rückwärtskompatibel** mit v2.0
- ✅ **Vollständiges Auszahlungssystem** für alle GTA RP Aktivitäten
- ✅ **Smart Timer-Mechanik** pausiert bei Inaktivität
- ✅ **3 Pflanzentypen** mit strategischen Unterschieden
- ✅ **Gallivanter-Integration** für automatische Auszahlungserkennung
- ✅ **Rekrutierungs-Belohnungen** für Familienwachstum
- ✅ **Umfassende Statistiken** und Analytics
- ✅ **Production-Ready** mit Health Monitoring
- ✅ **Auto-Scaling** auf Railway
- ✅ **Zero-Config** Deployment

## 🔧 Lokale Entwicklung

```bash
# Repository clonen
git clone https://github.com/dein-username/russkaya-bot-v3.git
cd russkaya-bot-v3

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

## 📞 Support & Updates

- **🐛 Bug Reports:** [GitHub Issues](https://github.com/dein-username/discord-bot-v3/issues)
- **💡 Feature Requests:** [GitHub Discussions](https://github.com/dein-username/discord-bot-v3/discussions)
- **📚 Documentation:** [Wiki v3.0](https://github.com/dein-username/discord-bot-v3/wiki)
- **💬 Discord:** [Community Server](https://discord.gg/russkaya)

## 📜 License

MIT License - Open Source für die Community

---

**Развивайся с семьёй Русская! 🇷🇺**

*v3.0 - Das ultimative GTA RP Familie Management System*
