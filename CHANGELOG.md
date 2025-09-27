# Changelog - Russkaya Familie Bot

## [3.0.0] - 2025-09-27 - GROSSES UPDATE

### 🆕 Neue Features

#### 🔫 **Vollständiges Raid & Event System**
- **Raid:** 10.000€ pro Person bei erfolgreichem Raid
- **Hafen Event:** 50.000€ pro wertvollem Container
- **Mount Chiliad:** 30.000€ für We.Co.+Wüstenschal Container  
- **EKZ (Einkaufszentrum):** 100.000€ pro Person bei Gewinnen
- **Shop Raub:** ~10.000€ pro Person (anpassbar je nach Situation)
- **Flugzeugträger:** 20.000€ pro Drop-Aktivität
- **Automatisches Tracking:** Alle Events werden für Auszahlungen erfasst

#### 🌾 **Externe Arbeiten System**
- **Beete düngen:** 1.000€ pro gedüngtes Beet (außerhalb eigener Pflanzen)
- **Solar reparieren:** 1.000€ pro Reparatur (außerhalb eigener Panels)
- **Solar Batterie Abgabe:** 10.000€ pro abgegebene Batterie
- **Pilzfarm:** 800€ pro Pilz-Abgabe
- **Vollständige Erfassung:** Alle externen Arbeiten werden getrackt

#### 👥 **Rekrutierungs-System**
- **Rekrutierungs-Tracking:** Neue Mitglieder registrieren
- **1-Woche Nachverfolgung:** Aktivitäts-Nachweis erforderlich
- **20.000€ Belohnung:** Automatische Auszahlung nach erfolgreicher 1-Woche
- **Discord Integration:** Optional Discord-User verknüpfen

#### 🍊 **3 Pflanzentypen mit strategischen Unterschieden**
- **🍊 Mandarinen (Standard):** 3h Wachstum, 800€ Ertrag, ausgewogenes Timing
- **🍍 Ananas (Premium):** 5h Wachstum, 1.500€ Ertrag, höchster Gewinn
- **🥬 Kohl (Speed):** 2h Wachstum, 500€ Ertrag, schnelle Zyklen
- **Verschiedene Auszahlungsraten:** Pflanzentyp-spezifische Vergütung

#### ⏸️ **Smart Timer-System**
- **Intelligente Pausierung:** Timer pausiert automatisch bei fehlender Düngung/Reparatur
- **Automatische Reaktivierung:** Nach 30 Minuten oder bei nächster Aktion
- **Optimiertes Timing:** Belohnt aktive Teilnahme am System
- **Status-Tracking:** Pausierte Timer werden in Status-Commands angezeigt

#### 💸 **Passive Einnahmen & Gelddruckmaschine**
- **Gelddruckmaschine:** 2.000€ alle 5 Minuten (passive Einnahmen)
- **Background Processing:** Automatische Verarbeitung im Hintergrund
- **Tracking:** Alle passiven Einnahmen werden erfasst

### 🔧 Technische Verbesserungen

#### 📊 **Erweiterte Datenbank-Struktur**
- **general_activities:** Neue Tabelle für Raids, Events, etc.
- **external_work:** Neue Tabelle für externe Beete/Solar Arbeiten
- **recruitments:** Neue Tabelle für Rekrutierungs-Tracking
- **Erweiterte activity_logs:** plant_type, reward, activity_category Spalten
- **Timer-Management:** timer_paused_at Spalten für intelligente Pausierung

#### 🔄 **Background Job System**
- **Timer-Überwachung:** Alle 5 Minuten pausierte Timer prüfen
- **Automatische Reaktivierung:** Smart Timer Management
- **Cleanup Jobs:** Wöchentliche Bereinigung alter Daten
- **Health Monitoring:** Erweiterte System-Überwachung

#### 💾 **Erweiterte Backup-Systeme**
- **Vollständige Auszahlungen:** JSON Format mit allen Aktivitätstypen
- **Complete Backup:** Alle 6 Datenbank-Tabellen in einem Export
- **CSV Erweiterungen:** Neue Spalten für alle Features
- **Pflanzentyp-Integration:** Detaillierte Aufschlüsselung nach Pflanzenarten

#### 🚀 **Performance & Skalierung**
- **Memory Optimierung:** Verbesserte Database Queries
- **Connection Pooling:** Optimierte PostgreSQL Verbindungen
- **Error Handling:** Verbesserte Fehlerbehandlung für alle neuen Features
- **Fallback Systems:** SQLite + Memory-Storage für Ausfallsicherheit

### 📋 Neue Commands

#### 🔫 **Event & Raid Commands**
- `/aktivität-eintragen` - Raids, Events und andere Aktivitäten registrieren
- `/aktivitäten-info` - Vollständige Übersicht aller Aktivitäten und Auszahlungsraten

#### 🌾 **Externe Arbeiten Commands**
- `/externe-arbeit` - Beete düngen und Solar reparieren (extern) eintragen

#### 👥 **Rekrutierungs-Commands**
- `/rekrutierung` - Neue Rekrutierung starten
- `/rekrutierung-abschließen` - Nach 1 Woche Belohnung einlösen

#### 📊 **Erweiterte Info Commands**
- `/meine-aktivitäten` - Persönliche Aktivitätsübersicht mit Zeitraum-Filter
- `/pflanzen-info` - Detaillierte Informationen über alle 3 Pflanzentypen

#### 💾 **Erweiterte Admin Commands**
- `/backup format:complete` - Vollständiger Datenbank-Export aller Tabellen

### 🚗 **Gallivanter-Regel Implementation**

#### ⚠️ **Wichtige Auszahlungsregel**
- **Neue Regel:** Batterie/Pilze/Beete NICHT selbst einsammeln
- **Gallivanter-Kofferaum:** Erträge dort lagern für Auszahlung
- **Command Integration:** Automatische Erkennung bei car:gallivanter
- **Tracking:** Alle qualifizierten Auszahlungen werden erfasst

### 💰 **Erweiterte Auszahlungsraten**

#### 🔫 **Raids & Events (NEU)**
```
🔫 Raid: 10.000€ pro Person
🚢 Hafen Event: 50.000€ pro Container
⛰️ Mount Chiliad: 30.000€ pro Abgabe
🏬 EKZ: 100.000€ pro Person
🏪 Shop Raub: ~10.000€ pro Person
✈️ Flugzeugträger: 20.000€ pro Drop
```

#### 🌾 **Externe Arbeiten (NEU)**
```
🌱 Beete düngen: 1.000€ pro Beet
🔧 Solar reparieren: 1.000€ pro Reparatur
🔋 Solar Abgabe: 10.000€ pro Batterie
🍄 Pilzfarm: 800€ pro Abgabe
```

#### 🍊 **Pflanzen-System (Erweitert)**
```
Säen-Raten:
🍊 Mandarinen: 400€
🍍 Ananas: 600€
🥬 Kohl: 300€

Ernte-Raten (eigene):
🍊 Mandarinen: 600€
🍍 Ananas: 1.000€
🥬 Kohl: 400€

Ernte-Raten (Teamwork):
🍊 Mandarinen: 450€
🍍 Ananas: 800€
🥬 Kohl: 300€
```

#### 💸 **Passive & Sonstige (NEU)**
```
💸 Gelddruckmaschine: 2.000€ alle 5 Min
👥 Rekrutierung: 20.000€ pro Person (1+ Woche)
```

### 🔄 **Migration & Kompatibilität**

#### ✅ **Vollständige Rückwärtskompatibilität**
- **Keine Breaking Changes:** Alle v2.0 Commands funktionieren weiterhin
- **Automatische Migration:** Neue Tabellen werden automatisch erstellt
- **Daten-Erhaltung:** Alle bestehenden Pflanzen und Solar-Panels bleiben erhalten
- **Pflanzentyp-Migration:** Bestehende Pflanzen werden als "Mandarinen" klassifiziert
- **Zero-Downtime:** Update ohne Service-Unterbrechung möglich

#### 🔧 **Environment Variables**
- **Unverändert:** Alle bestehenden Variables funktionieren weiterhin
- **Optional neu:** ACTIVITIES_CHANNEL_ID für separaten Aktivitäts-Channel
- **Einfaches Update:** Kein neues Setup erforderlich

### 📊 **Erweiterte Statistiken & Analytics**

#### 📈 **Neue Statistik-Kategorien**
- **Aktivitäts-Breakdown:** Farming vs. Events vs. Externe Arbeit vs. Rekrutierung
- **Pflanzentyp-Verteilung:** Statistiken nach Mandarinen/Ananas/Kohl
- **Timer-Effizienz:** Prozentsatz optimal getimter Aktivitäten
- **Community-Wachstum:** Rekrutierungs-Erfolgsraten

#### 🏆 **Performance Metrics**
- **System-Health:** Erweiterte Health-Checks mit Feature-Status
- **Database-Performance:** Optimierte Queries für alle neuen Tabellen
- **Background-Jobs:** Status der Timer-Management und Cleanup-Prozesse

### 🚀 **Deployment & Infrastructure**

#### 🔧 **Railway Optimierungen**
- **Auto-Migration:** Automatische Datenbank-Updates beim Deployment
- **Health-Checks:** Erweiterte Monitoring-Endpoints
- **Scaling:** Optimiert für horizontale Skalierung
- **Error Recovery:** Verbesserte Fehlerbehandlung und Wiederherstellung

#### 🐳 **Docker Improvements**
- **Multi-stage Build:** Optimierte Container-Größe
- **Security:** Non-root User Execution
- **Health-Checks:** Container-Level Health Monitoring
- **Performance:** Optimierte Runtime Dependencies

---

## [2.0.0] - 2024-XX-XX

### 🚀 **Grundlegendes System**
- **PostgreSQL Integration:** Production-ready Datenbank
- **Railway Deployment:** Cloud-native Hosting
- **Basis Pflanzen-System:** Säen, Düngen, Ernten
- **Basis Solar-System:** Aufstellen, Reparieren, Sammeln
- **Auszahlungs-System:** Grundlegende Vergütungsberechnungen
- **Timer-System:** Basis Wachstums- und Produktionszeiten
- **Admin-Tools:** Backup und Statistiken

### 🔧 **Technische Foundation**
- **Discord.js v14:** Moderne Bot-Entwicklung
- **Express Health-Checks:** System-Monitoring
- **Cron-Jobs:** Background Task Scheduling
- **SQLite Fallback:** Development-friendly Database

---

## [1.0.0] - 2024-XX-XX

### 🌱 **Initiale Version**
- **Basis Bot-Funktionalität:** Discord Commands
- **SQLite Datenbank:** Lokale Datenspeicherung
- **Einfache Commands:** Grundlegende Pflanzen-Verwaltung
- **Memory-Storage:** Fallback-System

---

## 🎯 **Roadmap v3.1 (Geplant)**

### 🔮 **Zukünftige Features**
- **Level-System:** XP-basierte Spieler-Progression
- **Achievement-System:** Belohnungen für Meilensteine
- **Clan-Statistiken:** Familien-weite Leistungsmetriken
- **Advanced Charts:** Graphische Auswertungen
- **Mobile Integration:** Discord-App Optimierungen
- **API Endpoints:** Externe System-Integration
- **Real-time Notifications:** Live-Updates für wichtige Events

### 🔧 **Technische Verbesserungen**
- **Redis Integration:** Caching für bessere Performance
- **Microservices:** Modulare Architektur-Aufteilung
- **Advanced Analytics:** ML-basierte Trend-Analysen
- **Security Enhancements:** 2FA und erweiterte Berechtigungen

---

**Развивайся с семьёй Русская! 🇷🇺**

*Das komplette GTA RP Familie Management System - v3.0*
