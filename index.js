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
        solarBatteryTime: 240,
        solarInactivityTimeout: 30,
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
let PLANT_TYPES = {};

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
            const memoryData = { plants: [], solar_panels: [], activity_logs: [] };
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
        // Pflanzen-Konfiguration Tabelle
        `CREATE TABLE IF NOT EXISTS plant_configs (
            id SERIAL PRIMARY KEY,
            plant_name TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            emoji TEXT NOT NULL,
            growth_time_hours INTEGER NOT NULL,
            harvest_amount INTEGER NOT NULL,
            seed_cost INTEGER NOT NULL,
            sell_price INTEGER NOT NULL,
            water_interval_hours INTEGER DEFAULT 12,
            required_level INTEGER DEFAULT 1,
            icon_emoji TEXT DEFAULT '🌱',
            description TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // Benutzer-Pflanzen Tabelle
        `CREATE TABLE IF NOT EXISTS user_plants (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            plant_config_id INTEGER REFERENCES plant_configs(id),
            planted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_watered TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            harvest_ready_at TIMESTAMP NOT NULL,
            status TEXT DEFAULT 'growing',
            water_count INTEGER DEFAULT 0,
            location TEXT,
            notes TEXT,
            server_id TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT valid_status CHECK (status IN ('growing', 'ready', 'dead', 'harvested'))
        )`,

        // Ernte-Historie
        `CREATE TABLE IF NOT EXISTS harvest_history (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            plant_config_id INTEGER REFERENCES plant_configs(id),
            harvest_amount INTEGER NOT NULL,
            total_value INTEGER NOT NULL,
            harvested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            growth_duration_hours DECIMAL(10,2),
            water_count INTEGER DEFAULT 0,
            server_id TEXT NOT NULL
        )`,

        // Solar Panels Tabelle
        `CREATE TABLE IF NOT EXISTS solar_panels (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            location TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            repairs_count INTEGER DEFAULT 0,
            last_repair_at TIMESTAMP,
            last_repair_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            repair_reminder_sent INTEGER DEFAULT 0,
            collected_by TEXT,
            collected_at TIMESTAMP,
            car_stored TEXT,
            server_id TEXT NOT NULL,
            efficiency INTEGER DEFAULT 100,
            experience_gained INTEGER DEFAULT 0,
            production_paused_at TIMESTAMP,
            total_pause_duration INTEGER DEFAULT 0,
            next_repair_due TIMESTAMP
        )`,

        // Activity Logs
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
        )`,

        // General Activities
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

        // Recruitments
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

        // DB Migrations Tracking
        `CREATE TABLE IF NOT EXISTS db_migrations (
            id SERIAL PRIMARY KEY,
            version TEXT UNIQUE NOT NULL,
            description TEXT,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ];
    
    try {
        for (const query of queries) {
            await db.query(query);
        }
        console.log('✅ Datenbank erfolgreich initialisiert (v3.0.2)');
        
        // Migration ausführen
        await runMigration();
        
        // Pflanzen-Konfiguration laden
        await initializePlantConfig();
        
    } catch (error) {
        console.error('❌ Datenbank-Initialisierungsfehler:', error);
    }
}

// ===== MIGRATION v3.0.2 =====
async function runMigration() {
    try {
        // Prüfe ob Migration bereits durchgeführt
        const { rows: migrationCheck } = await db.query(
            "SELECT * FROM db_migrations WHERE version = 'v3.0.2'"
        );

        if (migrationCheck.length > 0) {
            console.log('✅ Migration v3.0.2 bereits durchgeführt');
            return;
        }

        console.log('🔄 Führe Migration v3.0.2 durch...');

        // Solar Panels: last_repair_check hinzufügen
        try {
            await db.query(`
                ALTER TABLE solar_panels 
                ADD COLUMN IF NOT EXISTS last_repair_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            `);
            console.log('✅ solar_panels.last_repair_check hinzugefügt');
        } catch (e) {
            console.log('⚠️ last_repair_check bereits vorhanden');
        }

        // Migration als durchgeführt markieren
        await db.query(`
            INSERT INTO db_migrations (version, description)
            VALUES ('v3.0.2', 'Bug Fix: Solar Panel last_repair_check + Pflanzen-System')
            ON CONFLICT (version) DO NOTHING
        `);

        console.log('✅ Migration v3.0.2 abgeschlossen');

    } catch (error) {
        console.error('❌ Migration Error:', error);
    }
}

// ===== PFLANZEN-KONFIGURATION =====
async function initializePlantConfig() {
    try {
        const { rows: existingConfig } = await db.query(
            'SELECT * FROM plant_configs WHERE is_active = TRUE'
        );
        
        if (existingConfig.length === 0) {
            console.log('📋 Initialisiere Standard-Pflanzen-Konfiguration...');
            
            const defaultPlants = [
                {
                    plant_name: 'tomato',
                    display_name: 'Tomate',
                    emoji: '🍅',
                    growth_time_hours: 24,
                    harvest_amount: 5,
                    seed_cost: 100,
                    sell_price: 50,
                    water_interval_hours: 8,
                    required_level: 1,
                    description: 'Einfache Pflanze für Anfänger'
                },
                {
                    plant_name: 'cannabis',
                    display_name: 'Cannabis',
                    emoji: '🌿',
                    growth_time_hours: 48,
                    harvest_amount: 10,
                    seed_cost: 500,
                    sell_price: 150,
                    water_interval_hours: 12,
                    required_level: 3,
                    description: 'Wertvollere Pflanze, benötigt mehr Pflege'
                },
                {
                    plant_name: 'poppy',
                    display_name: 'Mohnblume',
                    emoji: '🌺',
                    growth_time_hours: 72,
                    harvest_amount: 15,
                    seed_cost: 1000,
                    sell_price: 200,
                    water_interval_hours: 12,
                    required_level: 5,
                    description: 'Seltene und wertvolle Pflanze'
                }
            ];

            for (const plant of defaultPlants) {
                await db.query(`
                    INSERT INTO plant_configs (
                        plant_name, display_name, emoji, growth_time_hours, 
                        harvest_amount, seed_cost, sell_price, water_interval_hours,
                        required_level, description
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    ON CONFLICT (plant_name) DO NOTHING
                `, [
                    plant.plant_name, plant.display_name, plant.emoji,
                    plant.growth_time_hours, plant.harvest_amount, plant.seed_cost,
                    plant.sell_price, plant.water_interval_hours, plant.required_level,
                    plant.description
                ]);
            }
            
            console.log('✅ Standard-Pflanzen-Konfiguration erstellt');
        }
        
        // Konfiguration laden
        await loadPlantConfigFromDB();
        
    } catch (error) {
        console.error('❌ Fehler bei Pflanzen-Konfiguration:', error);
    }
}

async function loadPlantConfigFromDB() {
    try {
        const { rows: configRows } = await db.query(
            'SELECT * FROM plant_configs WHERE is_active = TRUE ORDER BY required_level'
        );
        
        PLANT_TYPES = {};
        configRows.forEach(config => {
            PLANT_TYPES[config.plant_name] = {
                id: config.id,
                name: config.display_name,
                emoji: config.emoji,
                growthTimeHours: config.growth_time_hours,
                harvestAmount: config.harvest_amount,
                seedCost: config.seed_cost,
                sellPrice: config.sell_price,
                waterIntervalHours: config.water_interval_hours,
                requiredLevel: config.required_level,
                description: config.description
            };
        });
        
        console.log(`📋 ${configRows.length} Pflanzen-Konfigurationen aus Datenbank geladen`);
        
    } catch (error) {
        console.error('❌ Fehler beim Laden der Pflanzen-Konfiguration:', error);
    }
}

// ===== BOT EVENTS =====
client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} ist online!`);
    console.log(`🇷🇺 Russkaya Familie Bot v3.0.2 - PRODUCTION READY`);
    console.log(`🎯 Aktiv auf ${client.guilds.cache.size} Servern`);
    
    client.user.setActivity('Russkaya Familie v3.0.2 🇷🇺', { type: ActivityType.Watching });
    
    initializeDatabase();
    await initDatabase();
    await registerCommands();
    startBackgroundTasks();
    startHealthCheckServer();
});

// ===== COMMAND REGISTRATION =====
async function registerCommands() {
    const commands = [
        // Pflanzen Commands
        new SlashCommandBuilder()
            .setName('pflanzen')
            .setDescription('🌱 Einen Samen pflanzen')
            .addStringOption(option =>
                option.setName('pflanze')
                    .setDescription('Welche Pflanze möchtest du anbauen?')
                    .setRequired(true)
                    .addChoices(
                        { name: '🍅 Tomate (24h, Level 1)', value: 'tomato' },
                        { name: '🌿 Cannabis (48h, Level 3)', value: 'cannabis' },
                        { name: '🌺 Mohnblume (72h, Level 5)', value: 'poppy' }
                    )),

        new SlashCommandBuilder()
            .setName('giessen')
            .setDescription('💧 Eine deiner Pflanzen gießen')
            .addIntegerOption(option =>
                option.setName('pflanzen_id')
                    .setDescription('ID der Pflanze')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('ernten')
            .setDescription('🌿 Eine reife Pflanze ernten')
            .addIntegerOption(option =>
                option.setName('pflanzen_id')
                    .setDescription('ID der Pflanze')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('meine-pflanzen')
            .setDescription('📋 Deine aktiven Pflanzen anzeigen'),

        new SlashCommandBuilder()
            .setName('pflanzen-shop')
            .setDescription('🏪 Verfügbare Pflanzen ansehen'),

        new SlashCommandBuilder()
            .setName('ernte-statistik')
            .setDescription('📊 Deine Ernte-Statistiken anzeigen'),

        // Solar Commands  
        new SlashCommandBuilder()
            .setName('solar-reparieren')
            .setDescription('🔧 Ein pausiertes Solar Panel reparieren')
            .addIntegerOption(option =>
                option.setName('panel_id')
                    .setDescription('ID des Solar Panels')
                    .setRequired(true)),

        // Admin Commands
        new SlashCommandBuilder()
            .setName('pflanze-bearbeiten')
            .setDescription('⚙️ Admin: Pflanzen-Konfiguration bearbeiten')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName('pflanze')
                    .setDescription('Pflanzen-Name')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Tomate', value: 'tomato' },
                        { name: 'Cannabis', value: 'cannabis' },
                        { name: 'Mohnblume', value: 'poppy' }
                    ))
            .addIntegerOption(option =>
                option.setName('wachstumszeit')
                    .setDescription('Wachstumszeit in Stunden')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('ertrag')
                    .setDescription('Anzahl Items bei Ernte')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('samen_kosten')
                    .setDescription('Kosten für Samen in €')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('verkaufspreis')
                    .setDescription('Verkaufspreis pro Item in €')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('giess_intervall')
                    .setDescription('Gieß-Intervall in Stunden')
                    .setRequired(false)),

        new SlashCommandBuilder()
            .setName('help')
            .setDescription('❓ Hilfe und Befehls-Übersicht')
    ];

    try {
        console.log('📝 Registriere Slash Commands v3.0.2...');
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
            case 'pflanzen':
                await handlePlantSeed(interaction);
                break;
            case 'giessen':
                await handleWaterPlant(interaction);
                break;
            case 'ernten':
                await handleHarvestPlant(interaction);
                break;
            case 'meine-pflanzen':
                await handleMyPlants(interaction);
                break;
            case 'pflanzen-shop':
                await handlePlantShop(interaction);
                break;
            case 'ernte-statistik':
                await handleHarvestStats(interaction);
                break;
            case 'solar-reparieren':
                await handleSolarRepair(interaction);
                break;
            case 'pflanze-bearbeiten':
                await handleEditPlantConfig(interaction);
                break;
            case 'help':
                await handleHelp(interaction);
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
async function handlePlantSeed(interaction) {
    try {
        await interaction.deferReply();

        const plantName = interaction.options.getString('pflanze');
        const userId = interaction.user.id;
        const serverId = interaction.guildId;

        // Hole User
        const userResult = await db.query(
            'SELECT * FROM users WHERE discord_id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return interaction.followUp({ 
                content: '❌ Du bist nicht registriert!', 
                ephemeral: true 
            });
        }

        const user = userResult.rows[0];
        const plant = PLANT_TYPES[plantName];

        if (!plant) {
            return interaction.followUp({ 
                content: '❌ Diese Pflanze existiert nicht!', 
                ephemeral: true 
            });
        }

        // Prüfe Level
        if (user.level < plant.requiredLevel) {
            return interaction.followUp({ 
                content: `❌ Du benötigst Level ${plant.requiredLevel} für ${plant.name}!`, 
                ephemeral: true 
            });
        }

        // Prüfe Geld
        if (user.balance < plant.seedCost) {
            return interaction.followUp({ 
                content: `❌ Nicht genug Geld! Benötigt: ${utils.formatCurrency(plant.seedCost)}`, 
                ephemeral: true 
            });
        }

        // Ziehe Kosten ab
        await db.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [plant.seedCost, user.id]
        );

        // Pflanze erstellen
        const harvestTime = new Date(Date.now() + plant.growthTimeHours * 3600 * 1000);
        
        const result = await db.query(`
            INSERT INTO user_plants (user_id, plant_config_id, harvest_ready_at, server_id, username)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [user.id, plant.id, harvestTime, serverId, interaction.user.username]);

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(`${plant.emoji} Pflanze gepflanzt!`)
            .setDescription(`**${plant.name}** wurde erfolgreich gepflanzt`)
            .addFields(
                { name: '💰 Kosten', value: utils.formatCurrency(plant.seedCost), inline: true },
                { name: '⏱️ Wachstumszeit', value: `${plant.growthTimeHours}h`, inline: true },
                { name: '🌾 Ertrag', value: `${plant.harvestAmount}x`, inline: true },
                { name: '💵 Wert', value: utils.formatCurrency(plant.harvestAmount * plant.sellPrice), inline: true },
                { name: '💧 Gießen alle', value: `${plant.waterIntervalHours}h`, inline: true },
                { name: '🆔 Pflanzen-ID', value: `#${result.rows[0].id}`, inline: true },
                { name: '✅ Erntereif', value: `<t:${Math.floor(harvestTime.getTime() / 1000)}:R>`, inline: false }
            )
            .setFooter({ text: 'Vergiss nicht regelmäßig zu gießen!' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Plant Seed Error:', error);
        await interaction.followUp({ 
            content: '❌ Fehler beim Pflanzen!', 
            ephemeral: true 
        });
    }
}

async function handleWaterPlant(interaction) {
    try {
        await interaction.deferReply();

        const plantId = interaction.options.getInteger('pflanzen_id');
        const userId = interaction.user.id;

        const result = await db.query(`
            SELECT up.*, pc.display_name, pc.emoji, pc.water_interval_hours,
                   EXTRACT(EPOCH FROM (up.harvest_ready_at - CURRENT_TIMESTAMP))/3600 as hours_remaining
            FROM user_plants up
            JOIN plant_configs pc ON up.plant_config_id = pc.id
            JOIN users u ON up.user_id = u.id
            WHERE up.id = $1 AND u.discord_id = $2
        `, [plantId, userId]);

        if (result.rows.length === 0) {
            return interaction.followUp({ 
                content: '❌ Pflanze nicht gefunden!', 
                ephemeral: true 
            });
        }

        const plant = result.rows[0];

        if (plant.status !== 'growing') {
            return interaction.followUp({ 
                content: '⚠️ Diese Pflanze kann nicht gegossen werden!', 
                ephemeral: true 
            });
        }

        // Update Gieß-Zeit
        await db.query(`
            UPDATE user_plants 
            SET last_watered = CURRENT_TIMESTAMP, water_count = water_count + 1 
            WHERE id = $1
        `, [plantId]);

        const hoursRemaining = Math.ceil(plant.hours_remaining);

        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle(`💧 Pflanze gegossen`)
            .setDescription(`${plant.emoji} **${plant.display_name}** #${plantId}`)
            .addFields(
                { name: '💧 Gegossen', value: `${plant.water_count + 1}x`, inline: true },
                { name: '⏱️ Noch', value: `${hoursRemaining}h`, inline: true },
                { name: '💡 Tipp', value: `Gieße alle ${plant.water_interval_hours}h für optimales Wachstum`, inline: false }
            )
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Water Error:', error);
        await interaction.followUp({ 
            content: '❌ Fehler beim Gießen!', 
            ephemeral: true 
        });
    }
}

async function handleHarvestPlant(interaction) {
    try {
        await interaction.deferReply();

        const plantId = interaction.options.getInteger('pflanzen_id');
        const userId = interaction.user.id;

        const result = await db.query(`
            SELECT up.*, pc.*, u.id as user_id, u.balance
            FROM user_plants up
            JOIN plant_configs pc ON up.plant_config_id = pc.id
            JOIN users u ON up.user_id = u.id
            WHERE up.id = $1 AND u.discord_id = $2
        `, [plantId, userId]);

        if (result.rows.length === 0) {
            return interaction.followUp({ 
                content: '❌ Pflanze nicht gefunden!', 
                ephemeral: true 
            });
        }

        const plant = result.rows[0];

        if (plant.status !== 'growing') {
            return interaction.followUp({ 
                content: '⚠️ Diese Pflanze wurde bereits geerntet!', 
                ephemeral: true 
            });
        }

        if (new Date(plant.harvest_ready_at) > new Date()) {
            const timeLeft = Math.ceil((new Date(plant.harvest_ready_at) - new Date()) / (1000 * 60 * 60));
            return interaction.followUp({ 
                content: `⏱️ Diese Pflanze ist noch nicht erntereif! Noch ${timeLeft}h zu warten.`, 
                ephemeral: true 
            });
        }

        const totalValue = plant.harvest_amount * plant.sell_price;
        const growthDuration = (new Date() - new Date(plant.planted_at)) / (1000 * 60 * 60);

        // Geld gutschreiben
        await db.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2',
            [totalValue, plant.user_id]
        );

        // Pflanze als geerntet markieren
        await db.query(
            'UPDATE user_plants SET status = $1 WHERE id = $2',
            ['harvested', plantId]
        );

        // Zur Historie hinzufügen
        await db.query(`
            INSERT INTO harvest_history (
                user_id, plant_config_id, harvest_amount, total_value, 
                growth_duration_hours, water_count, server_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [plant.user_id, plant.plant_config_id, plant.harvest_amount, totalValue, growthDuration.toFixed(2), plant.water_count, interaction.guildId]);

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle(`${plant.emoji} Ernte erfolgreich!`)
            .setDescription(`**${plant.display_name}** #${plantId} wurde geerntet`)
            .addFields(
                { name: '🌾 Ertrag', value: `${plant.harvest_amount}x`, inline: true },
                { name: '💰 Gewinn', value: utils.formatCurrency(totalValue), inline: true },
                { name: '⏱️ Gewachsen', value: `${growthDuration.toFixed(1)}h`, inline: true },
                { name: '💧 Gegossen', value: `${plant.water_count}x`, inline: true }
            )
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Harvest Error:', error);
        await interaction.followUp({ 
            content: '❌ Fehler bei der Ernte!', 
            ephemeral: true 
        });
    }
}

async function handleMyPlants(interaction) {
    try {
        await interaction.deferReply();

        const result = await db.query(`
            SELECT up.*, pc.display_name, pc.emoji, pc.harvest_amount, pc.sell_price,
                   EXTRACT(EPOCH FROM (up.harvest_ready_at - CURRENT_TIMESTAMP))/3600 as hours_remaining
            FROM user_plants up
            JOIN plant_configs pc ON up.plant_config_id = pc.id
            JOIN users u ON up.user_id = u.id
            WHERE u.discord_id = $1 AND up.status = 'growing'
            ORDER BY up.harvest_ready_at
        `, [interaction.user.id]);

        if (result.rows.length === 0) {
            return interaction.followUp({ 
                content: '🌱 Du hast keine aktiven Pflanzen!' 
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#00AA00')
            .setTitle('🌿 Deine Pflanzen')
            .setDescription(`**${result.rows.length} aktive Pflanzen**`)
            .setTimestamp();

        result.rows.forEach(plant => {
            const hoursLeft = Math.max(0, plant.hours_remaining);
            const isReady = hoursLeft <= 0;
            const status = isReady ? '✅ Erntereif!' : `⏱️ ${Math.ceil(hoursLeft)}h`;
            const value = plant.harvest_amount * plant.sell_price;

            embed.addFields({
                name: `${plant.emoji} ${plant.display_name} #${plant.id}`,
                value: `${status} • ${plant.harvest_amount}x (${utils.formatCurrency(value)}) • 💧 ${plant.water_count}x gegossen`,
                inline: false
            });
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ My Plants Error:', error);
        await interaction.followUp({ 
            content: '❌ Fehler beim Laden der Pflanzen!', 
            ephemeral: true 
        });
    }
}

async function handlePlantShop(interaction) {
    try {
        await interaction.deferReply();

        const result = await db.query(
            'SELECT * FROM plant_configs WHERE is_active = TRUE ORDER BY required_level, seed_cost'
        );

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('🏪 Pflanzen-Shop')
            .setDescription('**Verfügbare Pflanzen zum Anbauen**')
            .setTimestamp();

        result.rows.forEach(plant => {
            const profit = (plant.harvest_amount * plant.sell_price) - plant.seed_cost;
            const profitPercent = ((profit / plant.seed_cost) * 100).toFixed(0);

            embed.addFields({
                name: `${plant.emoji} ${plant.display_name}`,
                value: `💰 Samen: ${utils.formatCurrency(plant.seed_cost)} • ⏱️ ${plant.growth_time_hours}h • 🌾 ${plant.harvest_amount}x\n` +
                       `💵 Verkauf: ${utils.formatCurrency(plant.sell_price)}/Stück • 📈 Gewinn: ${utils.formatCurrency(profit)} (+${profitPercent}%)\n` +
                       `💧 Gießen: alle ${plant.water_interval_hours}h • 🎯 Level: ${plant.required_level}\n` +
                       `📝 ${plant.description}`,
                inline: false
            });
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Shop Error:', error);
        await interaction.followUp({ 
            content: '❌ Fehler beim Laden des Shops!', 
            ephemeral: true 
        });
    }
}

async function handleHarvestStats(interaction) {
    try {
        await interaction.deferReply();

        const result = await db.query(`
            SELECT 
                pc.display_name,
                pc.emoji,
                COUNT(hh.id) as harvest_count,
                SUM(hh.harvest_amount) as total_items,
                SUM(hh.total_value) as total_earned,
                AVG(hh.growth_duration_hours) as avg_duration,
                AVG(hh.water_count) as avg_water
            FROM harvest_history hh
            JOIN plant_configs pc ON hh.plant_config_id = pc.id
            JOIN users u ON hh.user_id = u.id
            WHERE u.discord_id = $1
            GROUP BY pc.id, pc.display_name, pc.emoji
            ORDER BY total_earned DESC
        `, [interaction.user.id]);

        if (result.rows.length === 0) {
            return interaction.followUp({ 
                content: '📊 Du hast noch keine Pflanzen geerntet!' 
            });
        }

        const totalEarned = result.rows.reduce((sum, row) => sum + parseInt(row.total_earned), 0);
        const totalHarvests = result.rows.reduce((sum, row) => sum + parseInt(row.harvest_count), 0);

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('📊 Deine Ernte-Statistiken')
            .setDescription(`**Gesamt:** ${totalHarvests} Ernten • ${utils.formatCurrency(totalEarned)} verdient`)
            .setTimestamp();

        result.rows.forEach(stat => {
            embed.addFields({
                name: `${stat.emoji} ${stat.display_name}`,
                value: `🌾 ${stat.harvest_count}x geerntet • ${stat.total_items} Items\n` +
                       `💰 ${utils.formatCurrency(stat.total_earned)} verdient\n` +
                       `⏱️ Ø ${parseFloat(stat.avg_duration).toFixed(1)}h Wachstum • 💧 Ø ${parseFloat(stat.avg_water).toFixed(1)}x gegossen`,
                inline: false
            });
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Stats Error:', error);
        await interaction.followUp({ 
            content: '❌ Fehler beim Laden der Statistiken!', 
            ephemeral: true 
        });
    }
}

// ===== SOLAR REPAIR HANDLER (FIXED) =====
async function handleSolarRepair(interaction) {
    try {
        await interaction.deferReply();

        const panelId = interaction.options.getInteger('panel_id');

        const panelResult = await db.query(`
            SELECT sp.*, u.username, u.discord_id, u.balance
            FROM solar_panels sp
            LEFT JOIN users u ON sp.user_id = u.id
            WHERE sp.id = $1
        `, [panelId]);

        if (panelResult.rows.length === 0) {
            return interaction.followUp({
                content: '❌ Solar Panel nicht gefunden!',
                ephemeral: true
            });
        }

        const panel = panelResult.rows[0];

        if (panel.status !== 'paused') {
            return interaction.followUp({
                content: '⚠️ Dieses Panel benötigt keine Reparatur!',
                ephemeral: true
            });
        }

        const repairCost = Math.floor(panel.tier * 5000);
        const repairTime = 24;

        if (panel.balance < repairCost) {
            return interaction.followUp({
                content: `❌ Nicht genug Geld! Benötigt: ${utils.formatCurrency(repairCost)}`,
                ephemeral: true
            });
        }

        await db.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [repairCost, panel.user_id]
        );
        
        await db.query(`
            UPDATE solar_panels 
            SET status = 'repairing',
                last_repair_check = CURRENT_TIMESTAMP,
                next_repair_due = CURRENT_TIMESTAMP + INTERVAL '${repairTime} hours'
            WHERE id = $1
        `, [panel.id]);

        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🔧 Reparatur gestartet')
            .addFields(
                { name: '⚡ Panel', value: `#${panel.id}`, inline: true },
                { name: '💰 Kosten', value: utils.formatCurrency(repairCost), inline: true },
                { name: '⏱️ Dauer', value: `${repairTime}h`, inline: true },
                { name: '✅ Fertig', value: `<t:${Math.floor(Date.now() / 1000) + (repairTime * 3600)}:R>`, inline: false }
            )
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Solar Repair Error:', error);
        await interaction.followUp({ 
            content: '❌ Fehler bei der Reparatur!', 
            ephemeral: true 
        });
    }
}

// ===== ADMIN: PFLANZE BEARBEITEN =====
async function handleEditPlantConfig(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
        return interaction.reply({ 
            content: '❌ Nur Admins können Pflanzen bearbeiten!', 
            ephemeral: true 
        });
    }

    try {
        await interaction.deferReply({ ephemeral: true });

        const plantName = interaction.options.getString('pflanze');
        const growthTime = interaction.options.getInteger('wachstumszeit');
        const harvestAmount = interaction.options.getInteger('ertrag');
        const seedCost = interaction.options.getInteger('samen_kosten');
        const sellPrice = interaction.options.getInteger('verkaufspreis');
        const waterInterval = interaction.options.getInteger('giess_intervall');

        let updates = [];
        let values = [];
        let paramCount = 1;

        if (growthTime !== null) {
            updates.push(`growth_time_hours = ${paramCount++}`);
            values.push(growthTime);
        }
        if (harvestAmount !== null) {
            updates.push(`harvest_amount = ${paramCount++}`);
            values.push(harvestAmount);
        }
        if (seedCost !== null) {
            updates.push(`seed_cost = ${paramCount++}`);
            values.push(seedCost);
        }
        if (sellPrice !== null) {
            updates.push(`sell_price = ${paramCount++}`);
            values.push(sellPrice);
        }
        if (waterInterval !== null) {
            updates.push(`water_interval_hours = ${paramCount++}`);
            values.push(waterInterval);
        }

        if (updates.length === 0) {
            return interaction.followUp({ 
                content: '❌ Keine Änderungen angegeben!', 
                ephemeral: true 
            });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(plantName);

        await db.query(`
            UPDATE plant_configs 
            SET ${updates.join(', ')} 
            WHERE plant_name = ${paramCount}
        `, values);

        // Konfiguration neu laden
        await loadPlantConfigFromDB();

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Pflanzen-Konfiguration aktualisiert!')
            .setDescription(`**${plantName}** wurde erfolgreich bearbeitet`)
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Konfiguration gespeichert' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed], ephemeral: true });

    } catch (error) {
        console.error('❌ Edit Config Error:', error);
        await interaction.followUp({ 
            content: '❌ Fehler beim Bearbeiten!', 
            ephemeral: true 
        });
    }
}

// ===== HELP HANDLER =====
async function handleHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('❓ Bot Hilfe v3.0.2')
        .setDescription('**Alle verfügbaren Commands**')
        .addFields(
            {
                name: '🌱 Pflanzen Commands',
                value: '`/pflanzen` - Samen pflanzen\n`/giessen` - Pflanze gießen\n`/ernten` - Pflanze ernten\n`/meine-pflanzen` - Deine Pflanzen\n`/pflanzen-shop` - Verfügbare Pflanzen\n`/ernte-statistik` - Deine Statistiken',
                inline: true
            },
            {
                name: '⚡ Solar Commands',
                value: '`/solar-reparieren` - Panel reparieren',
                inline: true
            },
            {
                name: '⚙️ Admin Commands',
                value: '`/pflanze-bearbeiten` - Pflanzen konfigurieren',
                inline: true
            }
        )
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • v3.0.2' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

// ===== BACKGROUND TASKS =====
function startBackgroundTasks() {
    // Solar Timer-Überwachung
    cron.schedule('*/5 * * * *', async () => {
        try {
            await checkSolarTimers();
        } catch (error) {
            console.error('❌ Solar Timer Check Error:', error);
        }
    });

    // Tote Pflanzen markieren
    cron.schedule('*/30 * * * *', async () => {
        try {
            await db.query(`
                UPDATE user_plants 
                SET status = 'dead' 
                WHERE status = 'growing' 
                AND CURRENT_TIMESTAMP - last_watered > INTERVAL '48 hours'
            `);
        } catch (error) {
            console.error('❌ Dead Plants Check Error:', error);
        }
    });
    
    console.log('⏰ Background Tasks v3.0.2 gestartet');
}

async function checkSolarTimers() {
    try {
        const result = await db.query(`
            SELECT sp.*, u.discord_id
            FROM solar_panels sp
            LEFT JOIN users u ON sp.user_id = u.id
            WHERE sp.status = 'repairing' 
            AND sp.next_repair_due <= CURRENT_TIMESTAMP
        `);

        for (const panel of result.rows) {
            await db.query(`
                UPDATE solar_panels 
                SET status = 'active',
                    last_repair_check = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [panel.id]);

            console.log(`✅ Panel #${panel.id} Reparatur abgeschlossen`);
        }
    } catch (error) {
        console.error('❌ Check Solar Timers Error:', error);
    }
}

// ===== HEALTH CHECK SERVER =====
function startHealthCheckServer() {
    const app = express();
    
    app.get('/', (req, res) => {
        res.json({
            status: 'online',
            version: '3.0.2',
            bot: client.user?.tag || 'starting',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            guilds: client.guilds.cache.size
        });
    });
    
    app.get('/health', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'healthy', database: 'connected', version: '3.0.2' });
        } catch (error) {
            res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
        }
    });
    
    app.listen(config.port, () => {
        console.log(`🌐 Health Check Server v3.0.2 läuft auf Port ${config.port}`);
    });
}

// ===== ERROR HANDLING =====
process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

process.on('SIGINT', async () => {
    console.log('🛑 Bot wird heruntergefahren...');
    
    try {
        if (db && db.end) {
            await db.end();
            console.log('✅ Datenbank-Verbindung geschlossen');
        }
        
        client.destroy();
        console.log('✅ Bot heruntergefahren');
        process.exit(0);
    } catch (error) {
        console.error('❌ Fehler beim Herunterfahren:', error);
        process.exit(1);
    }
});

// ===== BOT LOGIN =====
if (!config.token) {
    console.error('❌ DISCORD_TOKEN nicht gesetzt!');
    process.exit(1);
}

client.login(config.token).catch(error => {
    console.error('❌ Bot Login Error:', error);
    process.exit(1);
});

console.log('🚀 Bot v3.0.2 wird gestartet...');
console.log('🇷🇺 Russkaya Familie Bot');
console.log('✅ Bug Fixes Applied');
console.log('✅ Pflanzen-System implementiert');
console.log('✅ Railway Deployment Ready!');
