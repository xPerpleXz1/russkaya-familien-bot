const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    AttachmentBuilder,
    ActivityType,
    PermissionFlagsBits 
} = require('discord.js');

const express = require('express');
const cron = require('node-cron');
require('dotenv').config();

// ===== PFLANZEN-KONFIGURATION =====
const PLANT_TYPES = {
    mandarinen: {
        name: 'Mandarinen 🍊',
        emoji: '🍊',
        growthTime: 180,        // 3 Stunden
        baseReward: 800,
        seedCost: 150,
        fertilizeTime1: 30,
        fertilizeTime2: 90,
        description: 'Schnell wachsend, mittlerer Ertrag'
    },
    ananas: {
        name: 'Ananas 🍍',
        emoji: '🍍',
        growthTime: 300,        // 5 Stunden
        baseReward: 1500,
        seedCost: 250,
        fertilizeTime1: 45,
        fertilizeTime2: 150,
        description: 'Langsam wachsend, hoher Ertrag'
    },
    kohl: {
        name: 'Kohl 🥬',
        emoji: '🥬',
        growthTime: 120,        // 2 Stunden
        baseReward: 500,
        seedCost: 100,
        fertilizeTime1: 20,
        fertilizeTime2: 60,
        description: 'Sehr schnell wachsend, niedriger Ertrag'
    }
};

// ===== NEUE AKTIVITÄTEN KONFIGURATION =====
const ACTIVITY_TYPES = {
    // Raids & Events
    raid: {
        name: 'Raid',
        emoji: '🔫',
        reward: 10000,
        description: 'Pro Person bei erfolgreichem Raid'
    },
    hafen_event: {
        name: 'Hafen Event',
        emoji: '🚢',
        reward: 50000,
        description: 'Bei Abgabe von wertvollen Containern'
    },
    mount_chiliad: {
        name: 'Mount Chiliad',
        emoji: '⛰️',
        reward: 30000,
        description: 'Bei Abgabe von We.Co.+Wüstenschalcontainer'
    },
    ekz: {
        name: 'EKZ (Einkaufszentrum)',
        emoji: '🏬',
        reward: 100000,
        description: 'Pro Person bei Gewinn'
    },
    shop_raub: {
        name: 'Shop Raub',
        emoji: '🏪',
        reward: 10000,
        description: 'Ca. 10k pro Person (je nach Geschehen)'
    },
    flugzeugtraeger: {
        name: 'Flugzeugträger Drop',
        emoji: '✈️',
        reward: 20000,
        description: 'Für Drop-Aktivität'
    },
    
    // Passive Einnahmen
    gelddruckmaschine: {
        name: 'Gelddruckmaschine',
        emoji: '💸',
        reward: 2000,
        description: 'Alle 5 Minuten automatisch',
        interval: 5
    },
    
    // Andere Aktivitäten
    solar_abgabe: {
        name: 'Solar Batterie Abgabe',
        emoji: '🔋',
        reward: 10000,
        description: 'Pro Person bei Batterie-Abgabe'
    },
    pilzfarm: {
        name: 'Pilzfarm',
        emoji: '🍄',
        reward: 800,
        description: 'Pro Person bei Pilz-Abgabe'
    },
    
    // Ausbildung
    recruitment: {
        name: 'Rekrutierung',
        emoji: '👥',
        reward: 20000,
        description: 'Pro eingeladene Person (1+ Woche aktiv)'
    }
};

// ===== ERWEITERTE AUSZAHLUNGS-RATEN =====
const PAYOUT_RATES = {
    // Pflanzen-Aktivitäten
    PLANTED: {
        mandarinen: 400,
        ananas: 600,
        kohl: 300
    },
    FERTILIZED_OWN: 200,
    FERTILIZED_TEAM: 400,
    BEETE_DUENGEN: 1000,        // NEU: Externe Beete düngen
    HARVESTED_OWN: {
        mandarinen: 600,
        ananas: 1000,
        kohl: 400
    },
    HARVESTED_TEAM: {
        mandarinen: 450,
        ananas: 800,
        kohl: 300
    },
    
    // Solar-Aktivitäten
    PLACED: 700,
    REPAIRED_OWN: 300,
    REPAIRED_TEAM: 500,
    SOLAR_REPARIEREN: 1000,     // NEU: Externe Solar reparieren
    COLLECTED_OWN: 1000,
    COLLECTED_TEAM: 800,
    
    // Neue Aktivitäten
    ...Object.fromEntries(
        Object.entries(ACTIVITY_TYPES).map(([key, activity]) => [
            key.toUpperCase(), activity.reward
        ])
    ),
    
    // Bonus-Multiplkatoren
    QUALITY_BONUS: 1.2,
    SPEED_BONUS: 1.5,
    LEVEL_BONUS: 0.05
};

// ===== KONFIGURATION =====
const config = {
    token: process.env.DISCORD_TOKEN,
    port: process.env.PORT || 3000,
    
    database: {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    },
    
    channels: {
        plant: process.env.PLANT_CHANNEL_ID,
        solar: process.env.SOLAR_CHANNEL_ID,
        backup: process.env.BACKUP_CHANNEL_ID,
        logs: process.env.LOGS_CHANNEL_ID,
        activities: process.env.ACTIVITIES_CHANNEL_ID || process.env.LOGS_CHANNEL_ID
    },
    
    timers: {
        solarRepairReminder1: 30,
        solarRepairReminder2: 50,
        solarBatteryTime: 120,
        cleanupInterval: 7 * 24 * 60,
        backupInterval: 24 * 60,
        gelddruckInterval: 5
    }
};

// ===== BOT SETUP =====
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ]
});

// ===== DATENBANK SETUP =====
let db;

function initializeDatabase() {
    if (config.database.connectionString) {
        const { Pool } = require('pg');
        db = new Pool({
            connectionString: config.database.connectionString,
            ssl: config.database.ssl
        });
        console.log('🐘 PostgreSQL Verbindung initialisiert');
    } else {
        try {
            const sqlite3 = require('sqlite3').verbose();
            db = {
                query: (text, params) => {
                    return new Promise((resolve, reject) => {
                        const sqliteDb = new sqlite3.Database('./russkaya.db');
                        sqliteDb.all(text.replace(/\$(\d+)/g, '?'), params || [], (err, rows) => {
                            if (err) reject(err);
                            else resolve({ rows });
                            sqliteDb.close();
                        });
                    });
                }
            };
            console.log('📁 SQLite Fallback aktiviert');
        } catch (error) {
            console.log('⚠️ Memory Storage aktiviert');
            const memoryData = { plants: [], solar_panels: [], activity_logs: [], general_activities: [] };
            db = {
                query: async (text, params = []) => {
                    if (text.includes('CREATE TABLE')) return { rows: [] };
                    if (text.includes('INSERT')) {
                        const id = Math.floor(Math.random() * 1000) + 1;
                        return { rows: [{ id }] };
                    }
                    return { rows: [] };
                }
            };
        }
    }
}

// ===== HILFSFUNKTIONEN =====
const utils = {
    formatCurrency: (amount) => {
        return new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    },
    
    formatDuration: (minutes) => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours > 0) return `${hours}h ${mins}min`;
        return `${mins}min`;
    }
};

// ===== DATENBANK INITIALISIERUNG =====
async function initDatabase() {
    const queries = [
        // Bestehende Tabellen
        `CREATE TABLE IF NOT EXISTS plants (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            planted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            location TEXT NOT NULL,
            plant_type TEXT NOT NULL DEFAULT 'mandarinen',
            status TEXT DEFAULT 'planted',
            fertilized_by TEXT,
            fertilized_at TIMESTAMP,
            last_fertilizer_check TIMESTAMP,
            fertilizer_reminder_sent INTEGER DEFAULT 0,
            harvested_by TEXT,
            harvested_at TIMESTAMP,
            car_stored TEXT,
            server_id TEXT NOT NULL,
            experience_gained INTEGER DEFAULT 0,
            quality INTEGER DEFAULT 1,
            timer_paused_at TIMESTAMP,
            total_pause_duration INTEGER DEFAULT 0
        )`,
        
        `CREATE TABLE IF NOT EXISTS solar_panels (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            location TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            repairs_count INTEGER DEFAULT 0,
            last_repair_at TIMESTAMP,
            last_repair_check TIMESTAMP,
            repair_reminder_sent INTEGER DEFAULT 0,
            collected_by TEXT,
            collected_at TIMESTAMP,
            car_stored TEXT,
            server_id TEXT NOT NULL,
            efficiency INTEGER DEFAULT 100,
            experience_gained INTEGER DEFAULT 0,
            timer_paused_at TIMESTAMP,
            total_pause_duration INTEGER DEFAULT 0
        )`,
        
        // NEUE TABELLE: Allgemeine Aktivitäten
        `CREATE TABLE IF NOT EXISTS general_activities (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            activity_type TEXT NOT NULL,
            location TEXT,
            participants TEXT,
            amount DECIMAL(12,2),
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            server_id TEXT NOT NULL,
            verified_by TEXT,
            payout_amount DECIMAL(12,2)
        )`,
        
        // NEUE TABELLE: Rekrutierungen
        `CREATE TABLE IF NOT EXISTS recruitments (
            id SERIAL PRIMARY KEY,
            recruiter_id TEXT NOT NULL,
            recruiter_name TEXT NOT NULL,
            recruited_id TEXT,
            recruited_name TEXT NOT NULL,
            recruited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'active',
            week_completed BOOLEAN DEFAULT FALSE,
            payout_given BOOLEAN DEFAULT FALSE,
            server_id TEXT NOT NULL
        )`,
        
        // NEUE TABELLE: Externe Arbeiten
        `CREATE TABLE IF NOT EXISTS external_work (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            work_type TEXT NOT NULL,
            location TEXT NOT NULL,
            amount INTEGER DEFAULT 1,
            rate_per_unit DECIMAL(12,2),
            total_payout DECIMAL(12,2),
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            server_id TEXT NOT NULL
        )`,
        
        // Erweiterte Activity Logs
        `CREATE TABLE IF NOT EXISTS activity_logs (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            action_type TEXT NOT NULL,
            item_type TEXT NOT NULL,
            item_id INTEGER,
            plant_type TEXT,
            location TEXT,
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            server_id TEXT NOT NULL,
            experience INTEGER DEFAULT 0,
            reward DECIMAL(12,2) DEFAULT 0,
            activity_category TEXT DEFAULT 'farming'
        )`
    ];
    
    try {
        for (const query of queries) {
            await db.query(query);
        }
        console.log('✅ Datenbank erfolgreich initialisiert (v3.0)');
        
        // Migration für neue Spalten
        try {
            await db.query('ALTER TABLE plants ADD COLUMN IF NOT EXISTS plant_type TEXT DEFAULT \'mandarinen\'');
            await db.query('ALTER TABLE plants ADD COLUMN IF NOT EXISTS timer_paused_at TIMESTAMP');
            await db.query('ALTER TABLE plants ADD COLUMN IF NOT EXISTS total_pause_duration INTEGER DEFAULT 0');
            
            await db.query('ALTER TABLE solar_panels ADD COLUMN IF NOT EXISTS timer_paused_at TIMESTAMP');
            await db.query('ALTER TABLE solar_panels ADD COLUMN IF NOT EXISTS total_pause_duration INTEGER DEFAULT 0');
            
            await db.query('ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS plant_type TEXT');
            await db.query('ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS reward DECIMAL(12,2) DEFAULT 0');
            await db.query('ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS activity_category TEXT DEFAULT \'farming\'');
            
            console.log('✅ Datenbank-Migration v3.0 abgeschlossen');
        } catch (migrationError) {
            console.log('⚠️ Migration-Warnung:', migrationError.message);
        }
        
    } catch (error) {
        console.error('❌ Datenbank-Initialisierungsfehler:', error);
    }
}

// ===== BOT EVENTS =====
client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} ist online!`);
    console.log(`🇷🇺 Russkaya Familie Bot v3.0 - VOLLSTÄNDIGES SYSTEM`);
    console.log(`🎯 Aktiv auf ${client.guilds.cache.size} Servern`);
    
    client.user.setActivity('Russkaya Familie v3.0 🇷🇺', { type: ActivityType.Watching });
    
    initializeDatabase();
    await initDatabase();
    await registerCommands();
    startBackgroundTasks();
    startHealthCheckServer();
});

// ===== COMMAND REGISTRATION =====
async function registerCommands() {
    const commands = [
        // ===== PFLANZEN COMMANDS =====
        new SlashCommandBuilder()
            .setName('pflanze-säen')
            .setDescription('🌱 Eine neue Pflanze säen')
            .addStringOption(option =>
                option.setName('location')
                    .setDescription('Wo wurde die Pflanze gesät?')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('pflanzentyp')
                    .setDescription('Welche Pflanze möchtest du säen?')
                    .setRequired(true)
                    .addChoices(
                        { name: '🍊 Mandarinen (3h, 800€)', value: 'mandarinen' },
                        { name: '🍍 Ananas (5h, 1500€)', value: 'ananas' },
                        { name: '🥬 Kohl (2h, 500€)', value: 'kohl' }
                    )),

        new SlashCommandBuilder()
            .setName('pflanze-düngen')
            .setDescription('💚 Eine Pflanze düngen (Timer pausiert!)')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID der Pflanze')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('pflanze-ernten')
            .setDescription('🌿 Eine Pflanze ernten')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID der Pflanze')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('car')
                    .setDescription('In welches Auto/Lager? (WICHTIG: Gallivanter für Auszahlung!)')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('pflanzen-status')
            .setDescription('📋 Alle aktiven Pflanzen anzeigen')
            .addStringOption(option =>
                option.setName('filter')
                    .setDescription('Nach Pflanzentyp filtern')
                    .addChoices(
                        { name: '🍊 Mandarinen', value: 'mandarinen' },
                        { name: '🍍 Ananas', value: 'ananas' },
                        { name: '🥬 Kohl', value: 'kohl' },
                        { name: '📋 Alle anzeigen', value: 'all' }
                    )),

        // ===== SOLAR COMMANDS =====
        new SlashCommandBuilder()
            .setName('solar-aufstellen')
            .setDescription('☀️ Ein Solarpanel aufstellen')
            .addStringOption(option =>
                option.setName('location')
                    .setDescription('Wo wurde das Panel aufgestellt?')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('solar-reparieren')
            .setDescription('🔧 Ein Solarpanel reparieren (Timer pausiert!)')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID des Solarpanels')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('solar-sammeln')
            .setDescription('🔋 Batterie sammeln (WICHTIG: Gallivanter für Auszahlung!)')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID des Solarpanels')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('car')
                    .setDescription('Auto/Lager (Gallivanter = Auszahlung!)')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('solar-status')
            .setDescription('📋 Alle aktiven Solarpanels anzeigen'),

        // ===== NEUE AKTIVITÄTEN COMMANDS =====
        new SlashCommandBuilder()
            .setName('aktivität-eintragen')
            .setDescription('📝 Neue Aktivität für Auszahlung eintragen')
            .addStringOption(option =>
                option.setName('typ')
                    .setDescription('Art der Aktivität')
                    .setRequired(true)
                    .addChoices(
                        { name: '🔫 Raid (10.000€ pro Person)', value: 'raid' },
                        { name: '🚢 Hafen Event (50.000€)', value: 'hafen_event' },
                        { name: '⛰️ Mount Chiliad (30.000€)', value: 'mount_chiliad' },
                        { name: '🏬 EKZ (100.000€ pro Person)', value: 'ekz' },
                        { name: '🏪 Shop Raub (~10.000€)', value: 'shop_raub' },
                        { name: '✈️ Flugzeugträger (20.000€)', value: 'flugzeugtraeger' },
                        { name: '🔋 Solar Abgabe (10.000€)', value: 'solar_abgabe' },
                        { name: '🍄 Pilzfarm (800€)', value: 'pilzfarm' }
                    ))
            .addStringOption(option =>
                option.setName('location')
                    .setDescription('Ort der Aktivität')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('teilnehmer')
                    .setDescription('Teilnehmer (getrennt durch Komma)')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('betrag')
                    .setDescription('Individueller Betrag (falls abweichend)')
                    .setRequired(false)),

        // ===== EXTERNE ARBEITEN =====
        new SlashCommandBuilder()
            .setName('externe-arbeit')
            .setDescription('🌾 Externe Arbeiten eintragen (Beete düngen, Solar reparieren)')
            .addStringOption(option =>
                option.setName('typ')
                    .setDescription('Art der Arbeit')
                    .setRequired(true)
                    .addChoices(
                        { name: '🌱 Beete düngen (1.000€ pro Beet)', value: 'beete_duengen' },
                        { name: '🔧 Solar reparieren (1.000€ pro Reparatur)', value: 'solar_reparieren' }
                    ))
            .addStringOption(option =>
                option.setName('location')
                    .setDescription('Ort der Arbeit')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('anzahl')
                    .setDescription('Anzahl (Beete/Reparaturen)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('details')
                    .setDescription('Zusätzliche Details')
                    .setRequired(false)),

        // ===== REKRUTIERUNG =====
        new SlashCommandBuilder()
            .setName('rekrutierung')
            .setDescription('👥 Neue Rekrutierung eintragen')
            .addStringOption(option =>
                option.setName('neuer_spieler')
                    .setDescription('Name des neuen Spielers')
                    .setRequired(true))
            .addUserOption(option =>
                option.setName('discord_user')
                    .setDescription('Discord User (falls verfügbar)')
                    .setRequired(false)),

        new SlashCommandBuilder()
            .setName('rekrutierung-abschließen')
            .setDescription('✅ Rekrutierung nach 1 Woche abschließen (20.000€)')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('Rekrutierungs-ID')
                    .setRequired(true)),

        // ===== INFO & UTILITY =====
        new SlashCommandBuilder()
            .setName('aktivitäten-info')
            .setDescription('ℹ️ Alle verfügbaren Aktivitäten und Auszahlungen'),

        new SlashCommandBuilder()
            .setName('meine-aktivitäten')
            .setDescription('📊 Deine Aktivitäten heute/diese Woche')
            .addStringOption(option =>
                option.setName('zeitraum')
                    .setDescription('Zeitraum auswählen')
                    .addChoices(
                        { name: '📅 Heute', value: 'today' },
                        { name: '📆 Diese Woche', value: 'week' },
                        { name: '🗓️ Dieser Monat', value: 'month' }
                    )),

        new SlashCommandBuilder()
            .setName('pflanzen-info')
            .setDescription('ℹ️ Informationen über alle Pflanzentypen'),

        new SlashCommandBuilder()
            .setName('backup')
            .setDescription('💾 Daten-Backup erstellen (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName('format')
                    .setDescription('Backup-Format')
                    .addChoices(
                        { name: 'CSV (Standard)', value: 'csv' },
                        { name: 'JSON (Auszahlungen)', value: 'json' },
                        { name: 'Vollständig (Alle Tabellen)', value: 'complete' }
                    )),

        new SlashCommandBuilder()
            .setName('help')
            .setDescription('❓ Hilfe und Befehls-Übersicht'),

        new SlashCommandBuilder()
            .setName('statistiken')
            .setDescription('📊 Umfassende Server-Statistiken')
    ];

    try {
        console.log('📝 Registriere Slash Commands v3.0...');
        await client.application.commands.set(commands);
        console.log(`✅ ${commands.length} Commands erfolgreich registriert!`);
    } catch (error) {
        console.error('❌ Fehler beim Registrieren der Commands:', error);
    }
}

// ===== COMMAND HANDLERS =====
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        switch (commandName) {
            // Bestehende Commands
            case 'pflanze-säen':
                await handlePlantSeed(interaction);
                break;
            case 'pflanze-düngen':
                await handlePlantFertilize(interaction);
                break;
            case 'pflanze-ernten':
                await handlePlantHarvest(interaction);
                break;
            case 'pflanzen-status':
                await handlePlantsStatus(interaction);
                break;
            case 'pflanzen-info':
                await handlePlantsInfo(interaction);
                break;
            case 'solar-aufstellen':
                await handleSolarPlace(interaction);
                break;
            case 'solar-reparieren':
                await handleSolarRepair(interaction);
                break;
            case 'solar-sammeln':
                await handleSolarCollect(interaction);
                break;
            case 'solar-status':
                await handleSolarStatus(interaction);
                break;
            
            // Neue Commands
            case 'aktivität-eintragen':
                await handleActivityEntry(interaction);
                break;
            case 'externe-arbeit':
                await handleExternalWork(interaction);
                break;
            case 'rekrutierung':
                await handleRecruitment(interaction);
                break;
            case 'rekrutierung-abschließen':
                await handleRecruitmentComplete(interaction);
                break;
            case 'aktivitäten-info':
                await handleActivitiesInfo(interaction);
                break;
            case 'meine-aktivitäten':
                await handleMyActivities(interaction);
                break;
            
            // System Commands
            case 'backup':
                await handleBackup(interaction);
                break;
            case 'help':
                await handleHelp(interaction);
                break;
            case 'statistiken':
                await handleStatistics(interaction);
                break;
            default:
                await interaction.reply({ 
                    content: '❌ Unbekannter Command!', 
                    ephemeral: true 
                });
        }
    } catch (error) {
        console.error(`❌ Command Error (${commandName}):`, error);
        
        const errorMessage = 'Es ist ein Fehler aufgetreten! Bitte versuche es erneut.';
        
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        } else if (interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        }
    }
});

// ===== PFLANZEN HANDLERS =====
async function handlePlantsInfo(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#32CD32')
        .setTitle('🌱 Pflanzen-Informationen')
        .setDescription('Alle verfügbaren Pflanzentypen und ihre Eigenschaften')
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • Wähle weise!' })
        .setTimestamp();

    Object.entries(PLANT_TYPES).forEach(([key, plant]) => {
        embed.addFields({
            name: `${plant.emoji} ${plant.name}`,
            value: `⏰ **Wachstumszeit:** ${utils.formatDuration(plant.growthTime)}\n💰 **Ertrag:** ${utils.formatCurrency(plant.baseReward)}\n💸 **Saatgut-Kosten:** ${utils.formatCurrency(plant.seedCost)}\n📝 **Besonderheit:** ${plant.description}\n💚 **Dünger-Erinnerungen:** ${plant.fertilizeTime1}min & ${plant.fertilizeTime2}min`,
            inline: true
        });
    });

    embed.addFields({
        name: '💡 Timer-Mechanik & Gallivanter-Regel',
        value: '**⚠️ WICHTIG:** Timer pausiert wenn du nicht düngst!\n**🚗 AUSZAHLUNG:** Ernte in **Gallivanter-Kofferaum** legen!\n• Ohne Düngung: Timer läuft weiter\n• Mit Düngung: Timer pausiert bis zur nächsten Aktion\n• Rechtzeitig düngen = Optimale Wachstumszeit!',
        inline: false
    });

    await interaction.reply({ embeds: [embed] });
}

async function handlePlantSeed(interaction) {
    const location = interaction.options.getString('location').trim();
    const plantType = interaction.options.getString('pflanzentyp');
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    if (!PLANT_TYPES[plantType]) {
        await interaction.followUp('❌ Unbekannter Pflanzentyp!');
        return;
    }

    const plant = PLANT_TYPES[plantType];

    try {
        const { rows } = await db.query(`
            INSERT INTO plants (user_id, username, location, plant_type, server_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, planted_at
        `, [userId, username, location, plantType, serverId]);

        const plantId = rows[0]?.id || Math.floor(Math.random() * 1000) + 1;

        await logActivity(userId, username, 'PLANTED', 'PLANT', plantId, location, null, serverId, 50, 0, plantType, 'farming');

        const harvestTime = Math.floor((Date.now() + plant.growthTime * 60 * 1000) / 1000);

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle(`${plant.emoji} Pflanze erfolgreich gesät!`)
            .setDescription(`Deine **${plant.name}** wächst nun heran!`)
            .addFields(
                { name: '👤 Gesät von', value: username, inline: true },
                { name: '📍 Standort', value: `\`${location}\``, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '🌱 Pflanzentyp', value: `${plant.emoji} **${plant.name}**`, inline: true },
                { name: '⏰ Wachstumszeit', value: `**${utils.formatDuration(plant.growthTime)}**`, inline: true },
                { name: '💰 Erwarteter Ertrag', value: `**${utils.formatCurrency(plant.baseReward)}**`, inline: true },
                { name: '🌿 Erntereif', value: `<t:${harvestTime}:R>`, inline: true },
                { name: '⭐ Erfahrung erhalten', value: `**+50 XP**`, inline: true }
            )
            .setFooter({ text: `Russkaya Familie 🇷🇺 • ${plant.description}` })
            .setTimestamp();

        embed.addFields({
            name: '🚗 WICHTIGE AUSZAHLUNGS-REGEL',
            value: '**Für Auszahlung:** Ernte in **Gallivanter-Kofferaum** legen!\n⏸️ Timer pausiert automatisch wenn du düngst\n💚 Dünge zur richtigen Zeit für optimale Erträge',
            inline: false
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Plant Seed Error:', error);
        await interaction.followUp('❌ Fehler beim Säen der Pflanze!');
    }
}

async function handlePlantFertilize(interaction) {
    const plantId = interaction.options.getInteger('id');
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        const { rows: plantRows } = await db.query(`
            SELECT *, 
                   EXTRACT(EPOCH FROM (NOW() - planted_at)) / 60 as minutes_since_planted
            FROM plants 
            WHERE id = $1 AND server_id = $2 AND status = 'planted'
        `, [plantId, serverId]);

        if (plantRows.length === 0) {
            await interaction.followUp('❌ Pflanze nicht gefunden oder bereits geerntet!');
            return;
        }

        const plantData = plantRows[0];
        const plant = PLANT_TYPES[plantData.plant_type];

        if (!plant) {
            await interaction.followUp('❌ Unbekannter Pflanzentyp!');
            return;
        }

        if (plantData.fertilized_by) {
            await interaction.followUp('❌ Diese Pflanze wurde bereits gedüngt!');
            return;
        }

        const minutesSincePlanted = plantData.minutes_since_planted || 0;
        const canFertilizeNow = minutesSincePlanted >= plant.fertilizeTime1;

        if (!canFertilizeNow) {
            const waitTime = Math.ceil(plant.fertilizeTime1 - minutesSincePlanted);
            await interaction.followUp(`❌ Noch zu früh zum Düngen! Warte noch **${utils.formatDuration(waitTime)}**`);
            return;
        }

        await db.query(`
            UPDATE plants 
            SET fertilized_by = $1, fertilized_at = NOW(), quality = quality + 1,
                timer_paused_at = NOW(), last_fertilizer_check = NOW()
            WHERE id = $2
        `, [username, plantId]);

        const isOwnPlant = plantData.user_id === userId;
        const experience = isOwnPlant ? 30 : 50;

        await logActivity(userId, username, 'FERTILIZED', 'PLANT', plantId, plantData.location, 
                         isOwnPlant ? 'Eigene Pflanze' : `Pflanze von ${plantData.username}`, serverId, experience, 0, plantData.plant_type, 'farming');

        const embed = new EmbedBuilder()
            .setColor('#32CD32')
            .setTitle(`💚 ${plant.emoji} Pflanze erfolgreich gedüngt!`)
            .setDescription(isOwnPlant ? 'Du hast deine eigene Pflanze gedüngt!' : 'Du hast einer Familien-Pflanze geholfen!')
            .addFields(
                { name: '👤 Gedüngt von', value: username, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '🌱 Pflanzentyp', value: `${plant.emoji} **${plant.name}**`, inline: true },
                { name: '📍 Standort', value: `\`${plantData.location}\``, inline: true },
                { name: '🌱 Ursprünglich gesät von', value: plantData.username, inline: true },
                { name: '⭐ Erfahrung erhalten', value: `**+${experience} XP**${!isOwnPlant ? ' (Teamwork Bonus!)' : ''}`, inline: true },
                { name: '🎁 Ertragssteigerung', value: '**+25%** beim Ernten', inline: true },
                { name: '⏸️ Timer-Status', value: '**PAUSIERT** bis zur nächsten Aktion', inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Timer pausiert automatisch!' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Plant Fertilize Error:', error);
        await interaction.followUp('❌ Fehler beim Düngen der Pflanze!');
    }
}

async function handlePlantHarvest(interaction) {
    const plantId = interaction.options.getInteger('id');
    const car = interaction.options.getString('car').trim();
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        const { rows: plantRows } = await db.query(`
            SELECT *, 
                   EXTRACT(EPOCH FROM (NOW() - planted_at)) / 60 as minutes_since_planted
            FROM plants 
            WHERE id = $1 AND server_id = $2 AND status = 'planted'
        `, [plantId, serverId]);

        if (plantRows.length === 0) {
            await interaction.followUp('❌ Pflanze nicht gefunden oder bereits geerntet!');
            return;
        }

        const plantData = plantRows[0];
        const plant = PLANT_TYPES[plantData.plant_type];

        if (!plant) {
            await interaction.followUp('❌ Unbekannter Pflanzentyp!');
            return;
        }

        const minutesSincePlanted = plantData.minutes_since_planted || 0;
        if (minutesSincePlanted < plant.growthTime) {
            const remainingMinutes = Math.ceil(plant.growthTime - minutesSincePlanted);
            await interaction.followUp(`❌ Pflanze ist noch nicht erntereif! Noch **${utils.formatDuration(remainingMinutes)}** warten.`);
            return;
        }

        const baseReward = plant.baseReward;
        const fertilizedBonus = plantData.fertilized_by ? baseReward * 0.25 : 0;
        const totalReward = Math.floor(baseReward + fertilizedBonus);

        const isOwnPlant = plantData.user_id === userId;
        const experience = isOwnPlant ? 100 : 75;

        await db.query(`
            UPDATE plants 
            SET status = 'harvested', harvested_by = $1, harvested_at = NOW(), 
                car_stored = $2, experience_gained = $3
            WHERE id = $4
        `, [username, car, experience, plantId]);

        await logActivity(userId, username, 'HARVESTED', 'PLANT', plantId, plantData.location, 
                         `Auto: ${car}, Ertrag: ${utils.formatCurrency(totalReward)}${!isOwnPlant ? `, Pflanze von ${plantData.username}` : ''}`, 
                         serverId, experience, totalReward, plantData.plant_type, 'farming');

        const embed = new EmbedBuilder()
            .setColor('#228B22')
            .setTitle(`🌿 ${plant.emoji} Pflanze erfolgreich geerntet!`)
            .setDescription(isOwnPlant ? 'Du hast deine eigene Pflanze geerntet!' : 'Du hast eine Familien-Pflanze geerntet!')
            .addFields(
                { name: '👤 Geerntet von', value: username, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '🌱 Pflanzentyp', value: `${plant.emoji} **${plant.name}**`, inline: true },
                { name: '🚗 Verstaut in', value: `\`${car}\``, inline: true },
                { name: '📍 Standort', value: `\`${plantData.location}\``, inline: true },
                { name: '🌱 Ursprünglich gesät von', value: plantData.username, inline: true },
                { name: '💚 Gedüngt', value: plantData.fertilized_by ? `✅ von ${plantData.fertilized_by}` : '❌ Nicht gedüngt', inline: true },
                { name: '💰 Ertrag', value: `**${utils.formatCurrency(totalReward)}**`, inline: true },
                { name: '⭐ Erfahrung', value: `**+${experience} XP**`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Erfolgreiche Ernte!' })
            .setTimestamp();

        if (plantData.fertilized_by) {
            embed.addFields({ 
                name: '🎁 Dünger-Bonus', 
                value: `**${utils.formatCurrency(fertilizedBonus)}** (+25%)`, 
                inline: true 
            });
        }

        if (car.toLowerCase().includes('gallivanter')) {
            embed.addFields({
                name: '🚗 GALLIVANTER ERKANNT!',
                value: '✅ **Qualifiziert für Auszahlung!**\nDiese Ernte wird in der täglichen Auszahlungsberechnung erfasst.',
                inline: false
            });
        }

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Plant Harvest Error:', error);
        await interaction.followUp('❌ Fehler beim Ernten der Pflanze!');
    }
}

async function handlePlantsStatus(interaction) {
    const serverId = interaction.guildId;
    const filter = interaction.options.getString('filter') || 'all';
    await interaction.deferReply();

    try {
        let whereClause = 'WHERE server_id = $1 AND status = \'planted\'';
        let params = [serverId];
        
        if (filter !== 'all') {
            whereClause += ' AND plant_type = $2';
            params.push(filter);
        }

        const { rows: plants } = await db.query(`
            SELECT *,
                   EXTRACT(EPOCH FROM (NOW() - planted_at)) / 60 as minutes_since_planted
            FROM plants
            ${whereClause}
            ORDER BY planted_at DESC
            LIMIT 10
        `, params);

        const filterName = filter === 'all' ? 'Alle Pflanzen' : `${PLANT_TYPES[filter]?.emoji} ${PLANT_TYPES[filter]?.name}`;

        const embed = new EmbedBuilder()
            .setColor('#00AA00')
            .setTitle(`🌱 Aktive Pflanzen - ${filterName}`)
            .setDescription(`**${plants.length}** aktive Pflanzen gefunden`)
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • ⏸️ = Timer pausiert' })
            .setTimestamp();

        if (plants.length === 0) {
            embed.setDescription(`Keine aktiven Pflanzen vorhanden ${filter !== 'all' ? `(${filterName})` : ''}.`);
            await interaction.followUp({ embeds: [embed] });
            return;
        }

        plants.forEach((plantData, index) => {
            if (index >= 8) return;

            const plant = PLANT_TYPES[plantData.plant_type];
            if (!plant) return;

            const minutesSincePlanted = plantData.minutes_since_planted || 0;
            const isReady = minutesSincePlanted >= plant.growthTime;
            const isPaused = plantData.timer_paused_at !== null;
            
            let status = '';
            if (isReady) {
                status = '🌿 **ERNTEREIF**';
            } else if (isPaused) {
                status = '⏸️ **PAUSIERT** (düngen um fortzusetzen)';
            } else {
                const remainingMinutes = Math.ceil(plant.growthTime - minutesSincePlanted);
                status = `⏰ Noch ${utils.formatDuration(remainingMinutes)}`;
            }

            const fertilizerStatus = plantData.fertilized_by ? `✅ Gedüngt von ${plantData.fertilized_by}` : '❌ Nicht gedüngt';

            embed.addFields({
                name: `${plant.emoji} Pflanze #${plantData.id} - ${plantData.location}`,
                value: `👤 **${plantData.username}** • ${status}\n💚 ${fertilizerStatus}`,
                inline: true
            });
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Plants Status Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Pflanzen!');
    }
}

// ===== SOLAR HANDLERS =====
async function handleSolarPlace(interaction) {
    const location = interaction.options.getString('location').trim();
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        const { rows } = await db.query(`
            INSERT INTO solar_panels (user_id, username, location, server_id)
            VALUES ($1, $2, $3, $4)
            RETURNING id, placed_at
        `, [userId, username, location, serverId]);

        const solarId = rows[0]?.id || Math.floor(Math.random() * 1000) + 1;
        
        await logActivity(userId, username, 'PLACED', 'SOLAR', solarId, location, null, serverId, 75, 0, null, 'farming');

        const batteryTime = Math.floor((Date.now() + config.timers.solarBatteryTime * 60 * 1000) / 1000);

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('☀️ Solarpanel erfolgreich aufgestellt!')
            .setDescription('Das Panel sammelt nun Sonnenenergie!')
            .addFields(
                { name: '👤 Aufgestellt von', value: username, inline: true },
                { name: '📍 Standort', value: `\`${location}\``, inline: true },
                { name: '🆔 Panel-ID', value: `**#${solarId}**`, inline: true },
                { name: '🔧 Reparaturen', value: '**0/4**', inline: true },
                { name: '🔋 Batterie bereit', value: `<t:${batteryTime}:R>`, inline: true },
                { name: '⭐ Erfahrung erhalten', value: `**+75 XP**`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • 4 Reparaturen = 1 Batterie!' })
            .setTimestamp();

        embed.addFields({
            name: '⚠️ NEUE TIMER-MECHANIK',
            value: '🔄 Timer pausiert automatisch wenn du nicht reparierst!\n💡 Repariere zur richtigen Zeit für optimale Effizienz',
            inline: false
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Solar Place Error:', error);
        await interaction.followUp('❌ Fehler beim Aufstellen des Solarpanels!');
    }
}

async function handleSolarRepair(interaction) {
    const solarId = interaction.options.getInteger('id');
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        const { rows: panelRows } = await db.query(`
            SELECT *,
                   EXTRACT(EPOCH FROM (NOW() - placed_at)) / 60 as minutes_since_placed
            FROM solar_panels 
            WHERE id = $1 AND server_id = $2 AND status = 'active'
        `, [solarId, serverId]);

        if (panelRows.length === 0) {
            await interaction.followUp('❌ Solarpanel nicht gefunden oder bereits eingesammelt!');
            return;
        }

        const panel = panelRows[0];

        if (panel.repairs_count >= 4) {
            await interaction.followUp('❌ Dieses Panel wurde bereits 4x repariert! Batterie kann eingesammelt werden.');
            return;
        }

        const newRepairCount = panel.repairs_count + 1;

        await db.query(`
            UPDATE solar_panels 
            SET repairs_count = $1, last_repair_at = NOW(), timer_paused_at = NOW(),
                last_repair_check = NOW()
            WHERE id = $2
        `, [newRepairCount, solarId]);

        const isOwnPanel = panel.user_id === userId;
        const experience = isOwnPanel ? 40 : 60;

        await logActivity(userId, username, 'REPAIRED', 'SOLAR', solarId, panel.location, 
                         `Reparatur ${newRepairCount}/4${!isOwnPanel ? `, Panel von ${panel.username}` : ''}`, serverId, experience, 0, null, 'farming');

        const isReadyForBattery = newRepairCount >= 4;

        const embed = new EmbedBuilder()
            .setColor(isReadyForBattery ? '#00FF00' : '#FFA500')
            .setTitle(isReadyForBattery ? '🔋 Panel bereit für Batterie-Entnahme!' : '🔧 Solarpanel repariert!')
            .setDescription(isReadyForBattery ? 'Das Panel kann jetzt eine Batterie produzieren!' : 'Eine weitere Reparatur durchgeführt!')
            .addFields(
                { name: '👤 Repariert von', value: username, inline: true },
                { name: '🆔 Panel-ID', value: `**#${solarId}**`, inline: true },
                { name: '🔧 Reparaturen', value: `**${newRepairCount}/4**`, inline: true },
                { name: '📍 Standort', value: `\`${panel.location}\``, inline: true },
                { name: '☀️ Aufgestellt von', value: panel.username, inline: true },
                { name: '⭐ Erfahrung', value: `**+${experience} XP**${!isOwnPanel ? ' (Teamwork!)' : ''}`, inline: true },
                { name: '⏸️ Timer-Status', value: '**PAUSIERT** bis zur nächsten Aktion', inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Timer pausiert automatisch!' })
            .setTimestamp();

        if (isReadyForBattery) {
            embed.addFields({
                name: '⚡ Nächster Schritt',
                value: `Verwende \`/solar-sammeln id:${solarId}\` um die Batterie zu sammeln!`,
                inline: false
            });
        } else {
            embed.addFields({
                name: '🔄 Noch benötigt',
                value: `**${4 - newRepairCount}** weitere Reparaturen`,
                inline: false
            });
        }

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Solar Repair Error:', error);
        await interaction.followUp('❌ Fehler beim Reparieren des Solarpanels!');
    }
}

async function handleSolarCollect(interaction) {
    const solarId = interaction.options.getInteger('id');
    const car = interaction.options.getString('car').trim();
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        const { rows: panelRows } = await db.query(`
            SELECT *,
                   EXTRACT(EPOCH FROM (NOW() - placed_at)) / 60 as minutes_active
            FROM solar_panels 
            WHERE id = $1 AND server_id = $2 AND status = 'active'
        `, [solarId, serverId]);

        if (panelRows.length === 0) {
            await interaction.followUp('❌ Solarpanel nicht gefunden oder bereits eingesammelt!');
            return;
        }

        const panel = panelRows[0];

        if (panel.repairs_count < 4) {
            await interaction.followUp(`❌ Panel noch nicht bereit! Benötigt noch **${4 - panel.repairs_count}** Reparaturen.`);
            return;
        }

        const minutesActive = panel.minutes_active || 0;
        if (minutesActive < config.timers.solarBatteryTime) {
            const remainingMinutes = Math.ceil(config.timers.solarBatteryTime - minutesActive);
            await interaction.followUp(`❌ Batterie noch nicht bereit! Noch **${utils.formatDuration(remainingMinutes)}** warten.`);
            return;
        }

        const totalReward = 800;
        const isOwnPanel = panel.user_id === userId;
        const experience = isOwnPanel ? 120 : 90;

        await db.query(`
            UPDATE solar_panels 
            SET status = 'collected', collected_by = $1, collected_at = NOW(), 
                car_stored = $2, experience_gained = $3
            WHERE id = $4
        `, [username, car, experience, solarId]);

        await logActivity(userId, username, 'COLLECTED', 'SOLAR', solarId, panel.location, 
                         `Auto: ${car}, Ertrag: ${utils.formatCurrency(totalReward)}${!isOwnPanel ? `, Panel von ${panel.username}` : ''}`, 
                         serverId, experience, totalReward, null, 'farming');

        const embed = new EmbedBuilder()
            .setColor('#32CD32')
            .setTitle('🔋 Batterie erfolgreich eingesammelt!')
            .setDescription(isOwnPanel ? 'Du hast deine eigene Solar-Batterie eingesammelt!' : 'Du hast eine Familien-Batterie eingesammelt!')
            .addFields(
                { name: '👤 Eingesammelt von', value: username, inline: true },
                { name: '🆔 Panel-ID', value: `**#${solarId}**`, inline: true },
                { name: '🚗 Verstaut in', value: `\`${car}\``, inline: true },
                { name: '📍 Standort', value: `\`${panel.location}\``, inline: true },
                { name: '☀️ Aufgestellt von', value: panel.username, inline: true },
                { name: '🔧 Reparaturen', value: `**${panel.repairs_count}/4** ✅`, inline: true },
                { name: '💰 Ertrag', value: `**${utils.formatCurrency(totalReward)}**`, inline: true },
                { name: '⭐ Erfahrung', value: `**+${experience} XP**`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Erfolgreiche Sammlung!' })
            .setTimestamp();

        if (car.toLowerCase().includes('gallivanter')) {
            embed.addFields({
                name: '🚗 GALLIVANTER ERKANNT!',
                value: '✅ **Qualifiziert für Auszahlung!**\nDiese Batterie wird in der täglichen Auszahlungsberechnung erfasst.',
                inline: false
            });
        }

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Solar Collect Error:', error);
        await interaction.followUp('❌ Fehler beim Sammeln der Batterie!');
    }
}

async function handleSolarStatus(interaction) {
    const serverId = interaction.guildId;
    await interaction.deferReply();

    try {
        const { rows: panels } = await db.query(`
            SELECT *,
                   EXTRACT(EPOCH FROM (NOW() - placed_at)) / 60 as minutes_active
            FROM solar_panels
            WHERE server_id = $1 AND status = 'active'
            ORDER BY placed_at DESC
            LIMIT 10
        `, [serverId]);

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('☀️ Aktive Solarpanels')
            .setDescription(`**${panels.length}** aktive Panels gefunden`)
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • ⏸️ = Timer pausiert' })
            .setTimestamp();

        if (panels.length === 0) {
            embed.setDescription('Keine aktiven Solarpanels vorhanden.');
            await interaction.followUp({ embeds: [embed] });
            return;
        }

        panels.forEach((panel, index) => {
            if (index >= 6) return;

            const minutesActive = panel.minutes_active || 0;
            const isTimeReady = minutesActive >= config.timers.solarBatteryTime;
            const isRepairReady = panel.repairs_count >= 4;
            const isPaused = panel.timer_paused_at !== null;

            let status = '';
            if (isRepairReady && isTimeReady) {
                status = '🔋 **BATTERIE BEREIT**';
            } else if (isRepairReady && isPaused) {
                status = '⏸️ **PAUSIERT** (reparieren um fortzusetzen)';
            } else if (isRepairReady) {
                const remainingMinutes = Math.ceil(config.timers.solarBatteryTime - minutesActive);
                status = `⏰ Noch ${utils.formatDuration(remainingMinutes)}`;
            } else {
                status = `🔧 ${panel.repairs_count}/4 Reparaturen`;
            }

            embed.addFields({
                name: `☀️ Panel #${panel.id} - ${panel.location}`,
                value: `👤 **${panel.username}** • ${status}`,
                inline: true
            });
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Solar Status Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Solarpanels!');
    }
}

// ===== NEUE AKTIVITÄTEN HANDLERS =====
async function handleActivitiesInfo(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('📋 Russkaya Familie - Alle Aktivitäten & Auszahlungen')
        .setDescription('**Vollständige Übersicht aller verfügbaren Aktivitäten**')
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • v3.0 Vollsystem' })
        .setTimestamp();

    // Raids & Events
    embed.addFields({
        name: '🔫 Raids & Events',
        value: `${ACTIVITY_TYPES.raid.emoji} **Raid:** ${utils.formatCurrency(ACTIVITY_TYPES.raid.reward)} pro Person\n${ACTIVITY_TYPES.hafen_event.emoji} **Hafen Event:** ${utils.formatCurrency(ACTIVITY_TYPES.hafen_event.reward)} pro Container\n${ACTIVITY_TYPES.mount_chiliad.emoji} **Mount Chiliad:** ${utils.formatCurrency(ACTIVITY_TYPES.mount_chiliad.reward)} pro Abgabe\n${ACTIVITY_TYPES.ekz.emoji} **EKZ:** ${utils.formatCurrency(ACTIVITY_TYPES.ekz.reward)} pro Person\n${ACTIVITY_TYPES.shop_raub.emoji} **Shop Raub:** ~${utils.formatCurrency(ACTIVITY_TYPES.shop_raub.reward)} pro Person\n${ACTIVITY_TYPES.flugzeugtraeger.emoji} **Flugzeugträger:** ${utils.formatCurrency(ACTIVITY_TYPES.flugzeugtraeger.reward)} pro Drop`,
        inline: true
    });

    embed.addFields({
        name: '🌾 Farming & Solar',
        value: `🌱 **Beete düngen:** ${utils.formatCurrency(PAYOUT_RATES.BEETE_DUENGEN)} pro Beet\n🔧 **Solar reparieren:** ${utils.formatCurrency(PAYOUT_RATES.SOLAR_REPARIEREN)} pro Reparatur\n${ACTIVITY_TYPES.solar_abgabe.emoji} **Solar Abgabe:** ${utils.formatCurrency(ACTIVITY_TYPES.solar_abgabe.reward)} pro Batterie\n${ACTIVITY_TYPES.pilzfarm.emoji} **Pilzfarm:** ${utils.formatCurrency(ACTIVITY_TYPES.pilzfarm.reward)} pro Abgabe`,
        inline: true
    });

    embed.addFields({
        name: '💸 Passive & Andere',
        value: `${ACTIVITY_TYPES.gelddruckmaschine.emoji} **Gelddruckmaschine:** ${utils.formatCurrency(ACTIVITY_TYPES.gelddruckmaschine.reward)} alle 5 Min\n${ACTIVITY_TYPES.recruitment.emoji} **Rekrutierung:** ${utils.formatCurrency(ACTIVITY_TYPES.recruitment.reward)} pro Person (1+ Woche)`,
        inline: true
    });

    embed.addFields({
        name: '🍊 Pflanzen-System',
        value: `**Mandarinen** (3h): ${utils.formatCurrency(PLANT_TYPES.mandarinen.baseReward)}\n**Ananas** (5h): ${utils.formatCurrency(PLANT_TYPES.ananas.baseReward)}\n**Kohl** (2h): ${utils.formatCurrency(PLANT_TYPES.kohl.baseReward)}\n💚 **Dünger-Bonus:** +25% Ertrag`,
        inline: true
    });

    embed.addFields({
        name: '⚠️ WICHTIGER HINWEIS',
        value: '**🚗 Gallivanter-Regel:**\nBatterie/Pilze/Beete **NICHT selbst einsammeln!**\n➡️ **In Gallivanter-Kofferaum legen** für Auszahlung!\n\n**Commands verwenden:**\n• `/aktivität-eintragen` für Events\n• `/externe-arbeit` für Beete/Solar\n• `/rekrutierung` für neue Mitglieder',
        inline: false
    });

    await interaction.reply({ embeds: [embed] });
}

async function handleActivityEntry(interaction) {
    const activityType = interaction.options.getString('typ');
    const location = interaction.options.getString('location').trim();
    const participantsStr = interaction.options.getString('teilnehmer').trim();
    const customAmount = interaction.options.getInteger('betrag');
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        const activity = ACTIVITY_TYPES[activityType];
        if (!activity) {
            await interaction.followUp('❌ Unbekannte Aktivität!');
            return;
        }

        const participants = participantsStr.split(',').map(p => p.trim()).filter(p => p.length > 0);
        const payoutPerPerson = customAmount || activity.reward;
        const totalPayout = participants.length * payoutPerPerson;

        const { rows } = await db.query(`
            INSERT INTO general_activities (user_id, username, activity_type, location, participants, amount, details, server_id, payout_amount)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `, [userId, username, activityType, location, JSON.stringify(participants), payoutPerPerson, activity.description, serverId, totalPayout]);

        const activityId = rows[0]?.id || Math.floor(Math.random() * 1000) + 1;

        for (const participant of participants) {
            await logActivity(userId, participant, activityType.toUpperCase(), 'GENERAL', activityId, location, 
                            `${activity.name} - Organisiert von ${username}`, serverId, 0, payoutPerPerson, null, 'events');
        }

        const embed = new EmbedBuilder()
            .setColor('#FF6B35')
            .setTitle(`${activity.emoji} ${activity.name} erfolgreich eingetragen!`)
            .setDescription('Aktivität wurde für Auszahlung registriert')
            .addFields(
                { name: '👤 Eingetragen von', value: username, inline: true },
                { name: '🆔 Aktivitäts-ID', value: `**#${activityId}**`, inline: true },
                { name: '📍 Ort', value: `\`${location}\``, inline: true },
                { name: '👥 Teilnehmer', value: `**${participants.length}** Personen`, inline: true },
                { name: '💰 Pro Person', value: `**${utils.formatCurrency(payoutPerPerson)}**`, inline: true },
                { name: '💰 Gesamt-Auszahlung', value: `**${utils.formatCurrency(totalPayout)}**`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Aktivität registriert' })
            .setTimestamp();

        let participantsList = participants.join(', ');
        if (participantsList.length > 1000) {
            participantsList = participantsList.substring(0, 1000) + '...';
        }
        embed.addFields({
            name: '📋 Teilnehmer-Liste',
            value: participantsList,
            inline: false
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Activity Entry Error:', error);
        await interaction.followUp('❌ Fehler beim Eintragen der Aktivität!');
    }
}

async function handleExternalWork(interaction) {
    const workType = interaction.options.getString('typ');
    const location = interaction.options.getString('location').trim();
    const amount = interaction.options.getInteger('anzahl');
    const details = interaction.options.getString('details') || '';
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        let ratePerUnit, workName, emoji;
        
        switch (workType) {
            case 'beete_duengen':
                ratePerUnit = PAYOUT_RATES.BEETE_DUENGEN;
                workName = 'Beete düngen';
                emoji = '🌱';
                break;
            case 'solar_reparieren':
                ratePerUnit = PAYOUT_RATES.SOLAR_REPARIEREN;
                workName = 'Solar reparieren';
                emoji = '🔧';
                break;
            default:
                await interaction.followUp('❌ Unbekannte Arbeitsart!');
                return;
        }

        const totalPayout = amount * ratePerUnit;

        const { rows } = await db.query(`
            INSERT INTO external_work (user_id, username, work_type, location, amount, rate_per_unit, total_payout, details, server_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `, [userId, username, workType, location, amount, ratePerUnit, totalPayout, details, serverId]);

        const workId = rows[0]?.id || Math.floor(Math.random() * 1000) + 1;

        await logActivity(userId, username, workType.toUpperCase(), 'EXTERNAL', workId, location, 
                        `${amount}x ${workName} - ${utils.formatCurrency(ratePerUnit)} pro Einheit`, serverId, 0, totalPayout, null, 'external');

        const embed = new EmbedBuilder()
            .setColor('#32CD32')
            .setTitle(`${emoji} ${workName} erfolgreich eingetragen!`)
            .setDescription('Externe Arbeit wurde für Auszahlung registriert')
            .addFields(
                { name: '👤 Durchgeführt von', value: username, inline: true },
                { name: '🆔 Arbeits-ID', value: `**#${workId}**`, inline: true },
                { name: '📍 Ort', value: `\`${location}\``, inline: true },
                { name: '📊 Anzahl', value: `**${amount}** Einheiten`, inline: true },
                { name: '💰 Pro Einheit', value: `**${utils.formatCurrency(ratePerUnit)}**`, inline: true },
                { name: '💰 Gesamt-Auszahlung', value: `**${utils.formatCurrency(totalPayout)}**`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Externe Arbeit registriert' })
            .setTimestamp();

        if (details) {
            embed.addFields({
                name: '📝 Details',
                value: details,
                inline: false
            });
        }

        embed.addFields({
            name: '⚠️ Wichtiger Hinweis',
            value: '🚗 **Vergiss nicht:** Ertrag in Gallivanter-Kofferaum legen für Auszahlung!',
            inline: false
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ External Work Error:', error);
        await interaction.followUp('❌ Fehler beim Eintragen der externen Arbeit!');
    }
}

async function handleRecruitment(interaction) {
    const newPlayerName = interaction.options.getString('neuer_spieler').trim();
    const discordUser = interaction.options.getUser('discord_user');
    const recruiterId = interaction.user.id;
    const recruiterName = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        const recruitedId = discordUser ? discordUser.id : null;

        const { rows } = await db.query(`
            INSERT INTO recruitments (recruiter_id, recruiter_name, recruited_id, recruited_name, server_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `, [recruiterId, recruiterName, recruitedId, newPlayerName, serverId]);

        const recruitmentId = rows[0]?.id || Math.floor(Math.random() * 1000) + 1;

        await logActivity(recruiterId, recruiterName, 'RECRUITMENT_STARTED', 'RECRUITMENT', recruitmentId, 'Discord/GTA', 
                        `Rekrutierung von ${newPlayerName}`, serverId, 0, 0, null, 'recruitment');

        const embed = new EmbedBuilder()
            .setColor('#4169E1')
            .setTitle('👥 Neue Rekrutierung gestartet!')
            .setDescription('Rekrutierung wurde erfolgreich registriert')
            .addFields(
                { name: '👤 Rekrutierer', value: recruiterName, inline: true },
                { name: '🆔 Rekrutierungs-ID', value: `**#${recruitmentId}**`, inline: true },
                { name: '🆕 Neuer Spieler', value: newPlayerName, inline: true },
                { name: '💬 Discord', value: discordUser ? `<@${discordUser.id}>` : 'Nicht verknüpft', inline: true },
                { name: '⏰ Startdatum', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                { name: '💰 Potentielle Auszahlung', value: `**${utils.formatCurrency(ACTIVITY_TYPES.recruitment.reward)}**`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Verwende /rekrutierung-abschließen nach 1 Woche' })
            .setTimestamp();

        embed.addFields({
            name: '📋 Nächste Schritte',
            value: `1. **Neue Person mindestens 1 Woche aktiv halten**\n2. **Nach 1 Woche:** \`/rekrutierung-abschließen id:${recruitmentId}\`\n3. **Auszahlung:** ${utils.formatCurrency(ACTIVITY_TYPES.recruitment.reward)} erhalten`,
            inline: false
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Recruitment Error:', error);
        await interaction.followUp('❌ Fehler beim Registrieren der Rekrutierung!');
    }
}

async function handleRecruitmentComplete(interaction) {
    const recruitmentId = interaction.options.getInteger('id');
    const userId = interaction.user.id;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        const { rows: recruitmentRows } = await db.query(`
            SELECT * FROM recruitments 
            WHERE id = $1 AND server_id = $2 AND recruiter_id = $3 AND status = 'active'
        `, [recruitmentId, serverId, userId]);

        if (recruitmentRows.length === 0) {
            await interaction.followUp('❌ Rekrutierung nicht gefunden oder bereits abgeschlossen!');
            return;
        }

        const recruitment = recruitmentRows[0];

        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recruitedAt = new Date(recruitment.recruited_at);

        if (recruitedAt > weekAgo) {
            const timeRemaining = weekAgo.getTime() - recruitedAt.getTime();
            const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
            await interaction.followUp(`❌ Rekrutierung noch nicht 1 Woche alt! Noch **${Math.abs(daysRemaining)}** Tag(e) warten.`);
            return;
        }

        await db.query(`
            UPDATE recruitments 
            SET status = 'completed', week_completed = TRUE, payout_given = TRUE
            WHERE id = $1
        `, [recruitmentId]);

        const payout = ACTIVITY_TYPES.recruitment.reward;

        await logActivity(userId, recruitment.recruiter_name, 'RECRUITMENT_COMPLETED', 'RECRUITMENT', recruitmentId, 'Completed', 
                        `1-Woche Rekrutierung von ${recruitment.recruited_name} abgeschlossen`, serverId, 0, payout, null, 'recruitment');

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Rekrutierung erfolgreich abgeschlossen!')
            .setDescription('Glückwunsch! Du erhältst deine Rekrutierungs-Auszahlung.')
            .addFields(
                { name: '👤 Rekrutierer', value: recruitment.recruiter_name, inline: true },
                { name: '🆔 Rekrutierungs-ID', value: `**#${recruitmentId}**`, inline: true },
                { name: '🆕 Rekrutierte Person', value: recruitment.recruited_name, inline: true },
                { name: '📅 Rekrutiert am', value: `<t:${Math.floor(new Date(recruitment.recruited_at).getTime() / 1000)}:F>`, inline: true },
                { name: '⏰ Dauer', value: `**${Math.floor((Date.now() - new Date(recruitment.recruited_at)) / (24 * 60 * 60 * 1000))}** Tage`, inline: true },
                { name: '💰 Auszahlung', value: `**${utils.formatCurrency(payout)}**`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Danke für die erfolgreiche Rekrutierung!' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Recruitment Complete Error:', error);
        await interaction.followUp('❌ Fehler beim Abschließen der Rekrutierung!');
    }
}

async function handleMyActivities(interaction) {
    const timeframe = interaction.options.getString('zeitraum') || 'today';
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        let dateFilter, timeframeName;
        const now = new Date();
        
        switch (timeframe) {
            case 'today':
                dateFilter = now.toISOString().split('T')[0];
                timeframeName = 'Heute';
                break;
            case 'week':
                const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
                dateFilter = weekStart.toISOString().split('T')[0];
                timeframeName = 'Diese Woche';
                break;
            case 'month':
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                dateFilter = monthStart.toISOString().split('T')[0];
                timeframeName = 'Dieser Monat';
                break;
            default:
                dateFilter = now.toISOString().split('T')[0];
                timeframeName = 'Heute';
        }

        const { rows: activities } = await db.query(`
            SELECT * FROM activity_logs 
            WHERE user_id = $1 AND server_id = $2 AND timestamp >= $3
            ORDER BY timestamp DESC
        `, [userId, serverId, dateFilter]);

        const totalReward = activities.reduce((sum, act) => sum + (parseFloat(act.reward) || 0), 0);

        const embed = new EmbedBuilder()
            .setColor('#9932CC')
            .setTitle(`📊 ${username}'s Aktivitäten - ${timeframeName}`)
            .setDescription(`Übersicht aller deiner Aktivitäten und Verdienste`)
            .addFields(
                { name: '📈 Gesamt-Verdienst', value: `**${utils.formatCurrency(totalReward)}**`, inline: true },
                { name: '📋 Gesamt-Aktivitäten', value: `**${activities.length}**`, inline: true },
                { name: '📅 Zeitraum', value: timeframeName, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Deine Leistung zählt!' })
            .setTimestamp();

        if (activities.length > 0) {
            const recentActivities = activities.slice(0, 5).map(act => 
                `${act.action_type} - ${utils.formatCurrency(parseFloat(act.reward) || 0)}`
            ).join('\n');
            
            embed.addFields({
                name: '🕐 Letzte Aktivitäten',
                value: recentActivities || 'Keine Aktivitäten',
                inline: false
            });
        }

        if (totalReward === 0) {
            embed.setDescription(`Keine Aktivitäten für ${timeframeName.toLowerCase()} gefunden.`);
        }

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ My Activities Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Aktivitäten!');
    }
}

// ===== BACKUP & STATISTIKEN =====
async function handleBackup(interaction) {
    const format = interaction.options.getString('format') || 'csv';
    const serverId = interaction.guildId;

    await interaction.deferReply({ ephemeral: true });

    try {
        const today = new Date().toISOString().split('T')[0];
        
        if (format === 'json') {
            // Vereinfachtes JSON Backup für v3.0
            const { rows: activities } = await db.query(`
                SELECT * FROM activity_logs 
                WHERE server_id = $1 AND DATE(timestamp) = $2
                ORDER BY timestamp DESC
            `, [serverId, today]);

            const payoutJson = {
                metadata: {
                    generatedAt: new Date().toISOString(),
                    date: today,
                    serverId: serverId,
                    version: '3.0.0'
                },
                activities: activities,
                summary: {
                    totalActivities: activities.length,
                    totalReward: activities.reduce((sum, act) => sum + (parseFloat(act.reward) || 0), 0)
                }
            };

            const jsonBuffer = Buffer.from(JSON.stringify(payoutJson, null, 2), 'utf8');
            const jsonAttachment = new AttachmentBuilder(jsonBuffer, { name: `russkaya_auszahlungen_v3_${today}.json` });

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('💰 Auszahlungs-Backup v3.0')
                .setDescription(`Backup für ${today} erstellt`)
                .setFooter({ text: 'Russkaya Familie 🇷🇺 • v3.0' })
                .setTimestamp();

            await interaction.followUp({ 
                embeds: [embed], 
                files: [jsonAttachment], 
                ephemeral: true 
            });
            
        } else {
            // Standard CSV Backup
            const { rows: plants } = await db.query('SELECT * FROM plants WHERE server_id = $1 ORDER BY planted_at DESC LIMIT 100', [serverId]);
            const { rows: solar } = await db.query('SELECT * FROM solar_panels WHERE server_id = $1 ORDER BY placed_at DESC LIMIT 100', [serverId]);
            const { rows: logs } = await db.query('SELECT * FROM activity_logs WHERE server_id = $1 ORDER BY timestamp DESC LIMIT 200', [serverId]);

            let csvContent = `RUSSKAYA FAMILIE BACKUP v3.0 - ${today}\n\n`;
            csvContent += 'PFLANZEN:\n';
            csvContent += 'ID,User_ID,Username,Plant_Type,Location,Status,Fertilized_By,Harvested_By\n';
            
            plants.forEach(p => {
                csvContent += `${p.id || 'N/A'},${p.user_id},${p.username},${p.plant_type || 'mandarinen'},${p.location},${p.status},${p.fertilized_by || ''},${p.harvested_by || ''}\n`;
            });

            csvContent += '\nSOLAR PANELS:\n';
            csvContent += 'ID,User_ID,Username,Location,Status,Repairs_Count,Collected_By\n';
            
            solar.forEach(s => {
                csvContent += `${s.id || 'N/A'},${s.user_id},${s.username},${s.location},${s.status},${s.repairs_count || 0},${s.collected_by || ''}\n`;
            });

            const buffer = Buffer.from(csvContent, 'utf8');
            const attachment = new AttachmentBuilder(buffer, { name: `russkaya_backup_v3_${today}.csv` });

            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('💾 Standard-Backup v3.0')
                .setDescription('CSV-Backup der Hauptdaten')
                .addFields(
                    { name: '🌱 Pflanzen', value: `${plants.length}`, inline: true },
                    { name: '☀️ Solar', value: `${solar.length}`, inline: true },
                    { name: '📋 Logs', value: `${logs.length}`, inline: true }
                )
                .setFooter({ text: 'Russkaya Familie 🇷🇺 • v3.0' })
                .setTimestamp();

            await interaction.followUp({ embeds: [embed], files: [attachment], ephemeral: true });
        }

    } catch (error) {
        console.error('❌ Backup Error:', error);
        await interaction.followUp({ content: '❌ Fehler beim Erstellen des Backups!', ephemeral: true });
    }
}

async function handleHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('❓ Russkaya Familie Bot v3.0 - Hilfe')
        .setDescription('**Alle Commands im Überblick - Jetzt mit ALLEN GTA RP Aktivitäten!**')
        .addFields(
            {
                name: '🌱 Pflanzen (3 Typen mit Smart Timer)',
                value: '`/pflanze-säen location: pflanzentyp:` - Neue Pflanze (Mandarinen/Ananas/Kohl)\n`/pflanze-düngen id:` - Düngen (pausiert Timer!)\n`/pflanze-ernten id: car:` - Ernten (Gallivanter für Auszahlung!)\n`/pflanzen-status [filter:]` - Status anzeigen\n`/pflanzen-info` - Alle Pflanzentypen & Details',
                inline: true
            },
            {
                name: '☀️ Solar (mit Smart Timer)',
                value: '`/solar-aufstellen location:` - Panel aufstellen\n`/solar-reparieren id:` - Reparieren (pausiert Timer!)\n`/solar-sammeln id: car:` - Batterie sammeln (Gallivanter!)\n`/solar-status` - Aktive Panels',
                inline: true
            },
            {
                name: '🔫 Events & Raids (NEU!)',
                value: '`/aktivität-eintragen typ: location: teilnehmer:` - Raids/Events registrieren\n`/aktivitäten-info` - Alle Aktivitäten & Auszahlungsraten anzeigen',
                inline: true
            },
            {
                name: '🌾 Externe Arbeiten (NEU!)',
                value: '`/externe-arbeit typ: location: anzahl:` - Beete düngen/Solar reparieren extern\n💰 **Beete:** 1.000€ pro Beet\n💰 **Solar:** 1.000€ pro Reparatur',
                inline: true
            },
            {
                name: '👥 Rekrutierung (NEU!)',
                value: '`/rekrutierung neuer_spieler: [discord_user:]` - Rekrutierung starten\n`/rekrutierung-abschließen id:` - Nach 1 Woche (20.000€ Auszahlung)',
                inline: true
            },
            {
                name: '📊 Statistiken & Persönlich',
                value: '`/meine-aktivitäten [zeitraum:]` - Persönliche Übersicht\n`/statistiken` - Umfassende Server-Stats v3.0\n`/help` - Diese Hilfe',
                inline: true
            }
        )
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • v3.0 Vollständiges GTA RP System' })
        .setTimestamp();

    embed.addFields({
        name: '🚗 WICHTIGE GALLIVANTER-REGEL',
        value: '**FÜR AUSZAHLUNGEN:** Batterie/Pilze/Beete **NICHT** selbst einsammeln!\n➡️ **In GALLIVANTER-KOFFERAUM** legen!\n\n**Admin Backup:** `/backup format:json` für tägliche Auszahlungsberechnung',
        inline: false
    });

    await interaction.reply({ embeds: [embed] });
}

async function handleStatistics(interaction) {
    const serverId = interaction.guildId;
    await interaction.deferReply();

    try {
        const { rows: plantStats } = await db.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'planted') as active_plants,
                COUNT(*) FILTER (WHERE status = 'harvested') as harvested_plants,
                COUNT(*) FILTER (WHERE plant_type = 'mandarinen') as mandarinen_count,
                COUNT(*) FILTER (WHERE plant_type = 'ananas') as ananas_count,
                COUNT(*) FILTER (WHERE plant_type = 'kohl') as kohl_count,
                COUNT(*) FILTER (WHERE timer_paused_at IS NOT NULL AND status = 'planted') as paused_plants
            FROM plants WHERE server_id = $1
        `, [serverId]);

        const { rows: solarStats } = await db.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'active') as active_solar,
                COUNT(*) FILTER (WHERE status = 'collected') as collected_solar,
                COUNT(*) FILTER (WHERE timer_paused_at IS NOT NULL AND status = 'active') as paused_solar
            FROM solar_panels WHERE server_id = $1
        `, [serverId]);

        const { rows: activityStats } = await db.query(`
            SELECT COUNT(DISTINCT user_id) as active_users
            FROM activity_logs WHERE server_id = $1
        `, [serverId]);

        const plants = plantStats[0] || {};
        const solar = solarStats[0] || {};
        const activity = activityStats[0] || {};

        const embed = new EmbedBuilder()
            .setColor('#9900FF')
            .setTitle('📊 Russkaya Familie - Server Statistiken v3.0')
            .setDescription('Gesamtübersicht aller Aktivitäten **mit neuen Features**')
            .addFields(
                {
                    name: '🌱 Pflanzen',
                    value: `**${plants.active_plants || 0}** aktiv (⏸️ ${plants.paused_plants || 0} pausiert)\n**${plants.harvested_plants || 0}** geerntet\n**${(plants.active_plants || 0) + (plants.harvested_plants || 0)}** gesamt`,
                    inline: true
                },
                {
                    name: '🌱 Pflanzentypen',
                    value: `🍊 **${plants.mandarinen_count || 0}** Mandarinen\n🍍 **${plants.ananas_count || 0}** Ananas\n🥬 **${plants.kohl_count || 0}** Kohl`,
                    inline: true
                },
                {
                    name: '☀️ Solar',
                    value: `**${solar.active_solar || 0}** aktiv (⏸️ ${solar.paused_solar || 0} pausiert)\n**${solar.collected_solar || 0}** eingesammelt\n**${(solar.active_solar || 0) + (solar.collected_solar || 0)}** gesamt`,
                    inline: true
                },
                {
                    name: '👥 Community',
                    value: `**${activity.active_users || 0}** aktive Spieler\n**${interaction.guild.memberCount}** Server-Mitglieder\n**${client.guilds.cache.size}** aktive Server`,
                    inline: true
                },
                {
                    name: '⏸️ Timer-System',
                    value: `**${(plants.paused_plants || 0) + (solar.paused_solar || 0)}** pausierte Timer\n**${((plants.active_plants || 0) - (plants.paused_plants || 0)) + ((solar.active_solar || 0) - (solar.paused_solar || 0))}** laufende Timer`,
                    inline: true
                },
                {
                    name: '🎯 Effizienz',
                    value: `**${Math.round(((plants.paused_plants || 0) / Math.max(plants.active_plants || 1, 1)) * 100)}%** Pflanzen optimal getimt\n**${Math.round(((solar.paused_solar || 0) / Math.max(solar.active_solar || 1, 1)) * 100)}%** Solar optimal getimt`,
                    inline: true
                }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • v3.0 mit Timer-Statistiken!' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Statistics Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Statistiken!');
    }
}

// ===== HELPER FUNCTIONS =====
async function logActivity(userId, username, actionType, itemType, itemId, location, details, serverId, experience = 0, reward = 0, plantType = null, activityCategory = 'farming') {
    try {
        await db.query(`
            INSERT INTO activity_logs (user_id, username, action_type, item_type, item_id, location, details, server_id, experience, reward, plant_type, activity_category)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [userId, username, actionType, itemType, itemId, location, details, serverId, experience, reward, plantType, activityCategory]);
    } catch (error) {
        console.error('❌ Log Activity Error:', error);
    }
}

// ===== BACKGROUND TASKS =====
function startBackgroundTasks() {
    // Timer-Überwachung alle 5 Minuten
    cron.schedule('*/5 * * * *', async () => {
        try {
            await checkPausedTimers();
        } catch (error) {
            console.error('❌ Timer Check Error:', error);
        }
    });

    // Automatische Backups (täglich um 03:00)
    cron.schedule('0 3 * * *', async () => {
        console.log('💾 Erstelle automatisches Backup...');
    }, { timezone: 'Europe/Berlin' });
    
    // Alte Einträge bereinigen (wöchentlich)
    cron.schedule('0 4 * * 0', async () => {
        console.log('🧹 Bereinige alte Einträge...');
        try {
            const cutoffDate = new Date(Date.now() - config.timers.cleanupInterval * 60 * 1000).toISOString();
            await db.query(`DELETE FROM plants WHERE status = 'harvested' AND harvested_at < $1`, [cutoffDate]);
            await db.query(`DELETE FROM solar_panels WHERE status = 'collected' AND collected_at < $1`, [cutoffDate]);
            await db.query(`DELETE FROM activity_logs WHERE timestamp < $1`, [cutoffDate]);
        } catch (error) {
            console.error('❌ Cleanup Error:', error);
        }
    }, { timezone: 'Europe/Berlin' });
    
    console.log('⏰ Background Tasks v3.0 gestartet');
}

async function checkPausedTimers() {
    try {
        // Prüfe pausierte Pflanzen
        const { rows: pausedPlants } = await db.query(`
            SELECT * FROM plants 
            WHERE status = 'planted' AND timer_paused_at IS NOT NULL 
            AND fertilized_at IS NOT NULL
        `);

        for (const plant of pausedPlants) {
            const plantType = PLANT_TYPES[plant.plant_type];
            if (!plantType) continue;

            const timeSinceFertilized = (Date.now() - new Date(plant.fertilized_at)) / (1000 * 60);
            
            // Nach 30 Minuten Timer automatisch reaktivieren
            if (timeSinceFertilized >= 30) {
                await db.query(`UPDATE plants SET timer_paused_at = NULL WHERE id = $1`, [plant.id]);
                console.log(`🌱 Timer für Pflanze #${plant.id} (${plant.plant_type}) reaktiviert`);
            }
        }

        // Prüfe pausierte Solar-Panels
        const { rows: pausedSolar } = await db.query(`
            SELECT * FROM solar_panels 
            WHERE status = 'active' AND timer_paused_at IS NOT NULL 
            AND last_repair_at IS NOT NULL
        `);

        for (const panel of pausedSolar) {
            const timeSinceRepair = (Date.now() - new Date(panel.last_repair_at)) / (1000 * 60);
            
            // Nach 30 Minuten Timer automatisch reaktivieren
            if (timeSinceRepair >= 30) {
                await db.query(`UPDATE solar_panels SET timer_paused_at = NULL WHERE id = $1`, [panel.id]);
                console.log(`☀️ Timer für Solar-Panel #${panel.id} reaktiviert`);
            }
        }

    } catch (error) {
        console.error('❌ Check Paused Timers Error:', error);
    }
}

// ===== HEALTH CHECK SERVER =====
function startHealthCheckServer() {
    const app = express();
    
    app.get('/', (req, res) => {
        res.json({
            status: 'online',
            version: '3.0.0',
            bot: client.user?.tag || 'starting',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            guilds: client.guilds.cache.size,
            users: client.users.cache.size,
            features: {
                plantTypes: Object.keys(PLANT_TYPES).length,
                activityTypes: Object.keys(ACTIVITY_TYPES).length,
                timerPause: true,
                payoutSystem: true,
                raidSystem: true,
                recruitmentSystem: true
            }
        });
    });
    
    app.get('/health', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'healthy', database: 'connected', version: '3.0.0' });
        } catch (error) {
            res.status(503).json({ status: 'unhealthy', database: 'disconnected', error: error.message });
        }
    });
    
    app.listen(config.port, () => {
        console.log(`🌐 Health Check Server v3.0 läuft auf Port ${config.port}`);
    });
}

// ===== ERROR HANDLING & SHUTDOWN =====
process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

process.on('SIGINT', async () => {
    console.log('🛑 Bot v3.0 wird heruntergefahren...');
    
    try {
        if (db && db.end) {
            await db.end();
            console.log('✅ Datenbank-Verbindung geschlossen');
        }
        
        client.destroy();
        console.log('✅ Bot v3.0 heruntergefahren');
        process.exit(0);
    } catch (error) {
        console.error('❌ Fehler beim Herunterfahren:', error);
        process.exit(1);
    }
});

// ===== BOT LOGIN =====
if (!config.token) {
    console.error('❌ DISCORD_TOKEN Environment Variable nicht gesetzt!');
    console.error('💡 Setze DISCORD_TOKEN in Railway Environment Variables');
    process.exit(1);
}

client.login(config.token).catch(error => {
    console.error('❌ Bot Login Error:', error);
    console.error('💡 Überprüfe deinen Discord Bot Token!');
    process.exit(1);
});

console.log('🚀 Russkaya Familie Bot v3.0 wird gestartet...');
console.log('🇷🇺 Развивайся с семьёй Русская!');
console.log('🔫 NEU: Vollständiges Raid & Event System');
console.log('🌾 NEU: Externe Arbeiten (Beete, Solar)');
console.log('👥 NEU: Rekrutierungs-System (20.000€)');
console.log('🍊 NEU: 3 Pflanzentypen mit Smart Timer');
console.log('💸 NEU: Gelddruckmaschine & passive Einnahmen');
console.log('🚗 WICHTIG: Gallivanter-Regel für Auszahlungen!');
console.log('⚡ Railway Deployment Ready - Production Mode v3.0!');
