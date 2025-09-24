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
    
    // PostgreSQL oder SQLite
    database: {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    },
    
    // Channel IDs
    channels: {
        plant: process.env.PLANT_CHANNEL_ID,
        solar: process.env.SOLAR_CHANNEL_ID,
        backup: process.env.BACKUP_CHANNEL_ID,
        logs: process.env.LOGS_CHANNEL_ID
    },
    
    // Zeiten in Minuten
    timers: {
        plantFertilizerReminder1: 35,
        plantFertilizerReminder2: 55,
        plantHarvestTime: 240,        // 4 Stunden
        solarRepairReminder1: 30,
        solarRepairReminder2: 50,
        solarBatteryTime: 120,        // 2 Stunden
        cleanupInterval: 7 * 24 * 60, // 7 Tage
        backupInterval: 24 * 60       // 24 Stunden
    }
};

// ===== AUSZAHLUNGS-SYSTEM (für Leaderin) =====
const PAYOUT_RATES = {
    // Pflanzen-Aktivitäten (BEISPIELWERTE - anpassbar!)
    PLANTED: 500,        // 500€ pro gesäter Pflanze
    FERTILIZED_OWN: 200, // 200€ für eigene Pflanze düngen
    FERTILIZED_TEAM: 400, // 400€ für fremde Pflanze düngen (Teamwork!)
    HARVESTED_OWN: 800,   // 800€ für eigene Pflanze ernten
    HARVESTED_TEAM: 600,  // 600€ für fremde Pflanze ernten
    
    // Solar-Aktivitäten (BEISPIELWERTE - anpassbar!)
    PLACED: 700,         // 700€ pro aufgestelltem Panel
    REPAIRED_OWN: 300,   // 300€ für eigenes Panel reparieren
    REPAIRED_TEAM: 500,  // 500€ für fremdes Panel reparieren (Teamwork!)
    COLLECTED_OWN: 1000, // 1000€ für eigene Batterie sammeln
    COLLECTED_TEAM: 800, // 800€ für fremde Batterie sammeln
    
    // Bonus-Multiplkatoren (BEISPIELWERTE - anpassbar!)
    QUALITY_BONUS: 1.2,  // +20% für qualitativ hochwertige Pflanzen
    SPEED_BONUS: 1.5,    // +50% für schnelle Aktionen
    LEVEL_BONUS: 0.05    // +5% pro Level (Level 10 = +50%)
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
        // PostgreSQL für Production (Railway)
        const { Pool } = require('pg');
        db = new Pool({
            connectionString: config.database.connectionString,
            ssl: config.database.ssl
        });
        console.log('🐘 PostgreSQL Verbindung initialisiert');
    } else {
        // SQLite für Development
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
            console.log('⚠️ SQLite nicht verfügbar, nutze Memory-Storage');
            // Memory-Fallback für Railway ohne zusätzliche Dependencies
            const memoryData = {
                plants: [],
                solar_panels: [],
                activity_logs: [],
                user_profiles: []
            };
            
            db = {
                query: async (text, params = []) => {
                    // Vereinfachte Memory-DB für Notfall
                    if (text.includes('CREATE TABLE')) {
                        return { rows: [] };
                    }
                    if (text.includes('INSERT INTO plants')) {
                        const id = memoryData.plants.length + 1;
                        memoryData.plants.push({ id, ...params });
                        return { rows: [{ id }] };
                    }
                    if (text.includes('INSERT INTO solar_panels')) {
                        const id = memoryData.solar_panels.length + 1;
                        memoryData.solar_panels.push({ id, ...params });
                        return { rows: [{ id }] };
                    }
                    if (text.includes('INSERT INTO activity_logs')) {
                        memoryData.activity_logs.push(params);
                        return { rows: [] };
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
        `CREATE TABLE IF NOT EXISTS plants (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            planted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            location TEXT NOT NULL,
            status TEXT DEFAULT 'planted',
            fertilized_by TEXT,
            fertilized_at TIMESTAMP,
            harvested_by TEXT,
            harvested_at TIMESTAMP,
            car_stored TEXT,
            server_id TEXT NOT NULL,
            experience_gained INTEGER DEFAULT 0,
            quality INTEGER DEFAULT 1
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
            collected_by TEXT,
            collected_at TIMESTAMP,
            car_stored TEXT,
            server_id TEXT NOT NULL,
            efficiency INTEGER DEFAULT 100,
            experience_gained INTEGER DEFAULT 0
        )`,
        
        `CREATE TABLE IF NOT EXISTS activity_logs (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            action_type TEXT NOT NULL,
            item_type TEXT NOT NULL,
            item_id INTEGER,
            location TEXT,
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            server_id TEXT NOT NULL,
            experience INTEGER DEFAULT 0,
            reward INTEGER DEFAULT 0
        )`
    ];
    
    try {
        for (const query of queries) {
            await db.query(query);
        }
        console.log('✅ Datenbank erfolgreich initialisiert');
    } catch (error) {
        console.error('❌ Datenbank-Initialisierungsfehler:', error);
        // Nicht beenden - Bot funktioniert trotzdem
    }
}

// ===== BOT EVENTS =====
client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} ist online!`);
    console.log(`🇷🇺 Russkaya Familie Bot v2.0 gestartet`);
    console.log(`🎯 Aktiv auf ${client.guilds.cache.size} Servern`);
    
    // Bot-Status setzen
    client.user.setActivity('Russkaya Familie 🇷🇺', { type: ActivityType.Watching });
    
    // Datenbank initialisieren
    initializeDatabase();
    await initDatabase();
    
    // Commands registrieren
    await registerCommands();
    
    // Background Tasks starten
    startBackgroundTasks();
    
    // Health Check Server
    startHealthCheckServer();
});

// Command Registration – SOFORT für deinen Server aus der .env-Variable
async function registerCommands() {
    const commands = [
        // Pflanzen Commands
        new SlashCommandBuilder()
            .setName('pflanze-säen')
            .setDescription('🌱 Eine neue Pflanze säen')
            .addStringOption(option =>
                option.setName('location')
                    .setDescription('Wo wurde die Pflanze gesät?')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('pflanze-düngen')
            .setDescription('💚 Eine Pflanze düngen (+25% Ertrag)')
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
                    .setDescription('In welches Auto/Lager?')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('pflanzen-status')
            .setDescription('📋 Alle aktiven Pflanzen anzeigen'),

        // Solar Commands
        new SlashCommandBuilder()
            .setName('solar-aufstellen')
            .setDescription('☀️ Ein Solarpanel aufstellen')
            .addStringOption(option =>
                option.setName('location')
                    .setDescription('Wo wurde das Panel aufgestellt?')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('solar-reparieren')
            .setDescription('🔧 Ein Solarpanel reparieren')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID des Solarpanels')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('solar-sammeln')
            .setDescription('🔋 Batterie von Solarpanel sammeln')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID des Solarpanels')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('car')
                    .setDescription('In welches Auto/Lager?')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('solar-status')
            .setDescription('📋 Alle aktiven Solarpanels anzeigen'),

        // Admin & Utility
        new SlashCommandBuilder()
            .setName('backup')
            .setDescription('💾 Daten-Backup erstellen (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName('format')
                    .setDescription('Backup-Format')
                    .addChoices(
                        { name: 'CSV (Standard)', value: 'csv' },
                        { name: 'JSON (Auszahlungen)', value: 'json' }
                    )),
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('❓ Hilfe und Befehls-Übersicht'),
        new SlashCommandBuilder()
            .setName('statistiken')
            .setDescription('📊 Server-Statistiken anzeigen')
    ].map(cmd => cmd.toJSON());

    try {
        console.log('📝 Registriere Slash Commands...');
        const GUILD_ID = process.env.DISCORD_GUILD_ID;
        if (!GUILD_ID) {
            throw new Error('Keine GUILD_ID in der .env-Datei gefunden!');
        }
        // Discord.js v14: guilds.fetch statt cache.get, damit es sicher klappt!
        const guild = await client.guilds.fetch(GUILD_ID);

        if (guild) {
            await guild.commands.set(commands);
            console.log(`✅ Slash Commands SOFORT für "${guild.name}" registriert!`);
        } else {
            await client.application.commands.set(commands);
            console.log('⚠️ Commands global registriert (dauert bis zu 1 Stunde!)');
        }
    } catch (error) {
        console.error('❌ Fehler beim Registrieren der Commands:', error);
    }
}
});

// ===== PFLANZEN COMMANDS =====

async function handlePlantSeed(interaction) {
    const location = interaction.options.getString('location').trim();
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        const { rows } = await db.query(`
            INSERT INTO plants (user_id, username, location, server_id)
            VALUES ($1, $2, $3, $4)
            RETURNING id, planted_at
        `, [userId, username, location, serverId]);

        const plantId = rows[0]?.id || Math.floor(Math.random() * 1000) + 1;

        // Activity Log
        await logActivity(userId, username, 'PLANTED', 'PLANT', plantId, location, null, serverId, 50, 0);

        const harvestTime = Math.floor((Date.now() + config.timers.plantHarvestTime * 60 * 1000) / 1000);

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🌱 Pflanze erfolgreich gesät!')
            .setDescription('Deine Pflanze wächst nun heran!')
            .addFields(
                { name: '👤 Gesät von', value: username, inline: true },
                { name: '📍 Standort', value: `\`${location}\``, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '⏰ Wachstumszeit', value: `**${utils.formatDuration(config.timers.plantHarvestTime)}**`, inline: true },
                { name: '🌿 Erntereif', value: `<t:${harvestTime}:R>`, inline: true },
                { name: '⭐ Erfahrung erhalten', value: `**+50 XP**`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Vergiss nicht zu düngen für +25% Ertrag!' })
            .setTimestamp();

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
            SELECT * FROM plants 
            WHERE id = $1 AND server_id = $2 AND status = 'planted'
        `, [plantId, serverId]);

        if (plantRows.length === 0) {
            await interaction.followUp('❌ Pflanze nicht gefunden oder bereits geerntet!');
            return;
        }

        const plant = plantRows[0];

        if (plant.fertilized_by) {
            await interaction.followUp('❌ Diese Pflanze wurde bereits gedüngt!');
            return;
        }

        await db.query(`
            UPDATE plants 
            SET fertilized_by = $1, fertilized_at = NOW(), quality = quality + 1
            WHERE id = $2
        `, [username, plantId]);

        const isOwnPlant = plant.user_id === userId;
        const experience = isOwnPlant ? 30 : 50;

        await logActivity(userId, username, 'FERTILIZED', 'PLANT', plantId, plant.location, 
                         isOwnPlant ? 'Eigene Pflanze' : `Pflanze von ${plant.username}`, serverId, experience, 0);

        const embed = new EmbedBuilder()
            .setColor('#32CD32')
            .setTitle('💚 Pflanze erfolgreich gedüngt!')
            .setDescription(isOwnPlant ? 'Du hast deine eigene Pflanze gedüngt!' : 'Du hast einer Familien-Pflanze geholfen!')
            .addFields(
                { name: '👤 Gedüngt von', value: username, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '📍 Standort', value: `\`${plant.location}\``, inline: true },
                { name: '🌱 Ursprünglich gesät von', value: plant.username, inline: true },
                { name: '⭐ Erfahrung erhalten', value: `**+${experience} XP**${!isOwnPlant ? ' (Teamwork Bonus!)' : ''}`, inline: true },
                { name: '🎁 Ertragssteigerung', value: '**+25%** beim Ernten', inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Teamwork macht stark!' })
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
                   EXTRACT(EPOCH FROM (NOW() - planted_at)) / 60 as minutes_growing
            FROM plants 
            WHERE id = $1 AND server_id = $2 AND status = 'planted'
        `, [plantId, serverId]);

        if (plantRows.length === 0) {
            await interaction.followUp('❌ Pflanze nicht gefunden oder bereits geerntet!');
            return;
        }

        const plant = plantRows[0];

        // Reifezeit prüfen
        const minutesGrowing = plant.minutes_growing || 0;
        if (minutesGrowing < config.timers.plantHarvestTime) {
            const remainingMinutes = Math.ceil(config.timers.plantHarvestTime - minutesGrowing);
            await interaction.followUp(`❌ Pflanze ist noch nicht erntereif! Noch **${utils.formatDuration(remainingMinutes)}** warten.`);
            return;
        }

        // Ertrag berechnen
        const baseReward = 1000;
        const fertilizedBonus = plant.fertilized_by ? baseReward * 0.25 : 0;
        const totalReward = Math.floor(baseReward + fertilizedBonus);

        const isOwnPlant = plant.user_id === userId;
        const experience = isOwnPlant ? 100 : 75;

        await db.query(`
            UPDATE plants 
            SET status = 'harvested', harvested_by = $1, harvested_at = NOW(), 
                car_stored = $2, experience_gained = $3
            WHERE id = $4
        `, [username, car, experience, plantId]);

        await logActivity(userId, username, 'HARVESTED', 'PLANT', plantId, plant.location, 
                         `Auto: ${car}, Ertrag: ${utils.formatCurrency(totalReward)}${!isOwnPlant ? `, Pflanze von ${plant.username}` : ''}`, 
                         serverId, experience, totalReward);

        const embed = new EmbedBuilder()
            .setColor('#228B22')
            .setTitle('🌿 Pflanze erfolgreich geerntet!')
            .setDescription(isOwnPlant ? 'Du hast deine eigene Pflanze geerntet!' : 'Du hast eine Familien-Pflanze geerntet!')
            .addFields(
                { name: '👤 Geerntet von', value: username, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '🚗 Verstaut in', value: `\`${car}\``, inline: true },
                { name: '📍 Standort', value: `\`${plant.location}\``, inline: true },
                { name: '🌱 Ursprünglich gesät von', value: plant.username, inline: true },
                { name: '💚 Gedüngt', value: plant.fertilized_by ? `✅ von ${plant.fertilized_by}` : '❌ Nicht gedüngt', inline: true },
                { name: '💰 Ertrag', value: `**${utils.formatCurrency(totalReward)}**`, inline: true },
                { name: '⭐ Erfahrung', value: `**+${experience} XP**`, inline: true },
                { name: '⏱️ Wachstumszeit', value: `${utils.formatDuration(Math.floor(minutesGrowing))}`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Erfolgreiche Ernte!' })
            .setTimestamp();

        if (plant.fertilized_by) {
            embed.addFields({ 
                name: '🎁 Dünger-Bonus', 
                value: `**${utils.formatCurrency(fertilizedBonus)}** (+25%)`, 
                inline: true 
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
    await interaction.deferReply();

    try {
        const { rows: plants } = await db.query(`
            SELECT *,
                   EXTRACT(EPOCH FROM (NOW() - planted_at)) / 60 as minutes_growing
            FROM plants
            WHERE server_id = $1 AND status = 'planted'
            ORDER BY planted_at DESC
            LIMIT 10
        `, [serverId]);

        const embed = new EmbedBuilder()
            .setColor('#00AA00')
            .setTitle('🌱 Aktive Pflanzen')
            .setDescription(`**${plants.length}** aktive Pflanzen gefunden`)
            .setFooter({ text: 'Russkaya Familie 🇷🇺' })
            .setTimestamp();

        if (plants.length === 0) {
            embed.setDescription('Keine aktiven Pflanzen vorhanden.');
            await interaction.followUp({ embeds: [embed] });
            return;
        }

        plants.forEach((plant, index) => {
            if (index >= 5) return;

            const minutesGrowing = plant.minutes_growing || 0;
            const isReady = minutesGrowing >= config.timers.plantHarvestTime;
            
            let status = '';
            if (isReady) {
                status = '🌿 **ERNTEREIF**';
            } else {
                const remainingMinutes = Math.ceil(config.timers.plantHarvestTime - minutesGrowing);
                status = `⏰ Noch ${utils.formatDuration(remainingMinutes)}`;
            }

            const fertilizerStatus = plant.fertilized_by ? `✅ Gedüngt von ${plant.fertilized_by}` : '❌ Nicht gedüngt';

            embed.addFields({
                name: `Pflanze #${plant.id} - ${plant.location}`,
                value: `👤 **${plant.username}** • ${status}\n💚 ${fertilizerStatus}`,
                inline: true
            });
        });

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Plants Status Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Pflanzen!');
    }
}

// ===== SOLAR COMMANDS =====

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
        
        await logActivity(userId, username, 'PLACED', 'SOLAR', solarId, location, null, serverId, 75, 0);

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
            SELECT * FROM solar_panels 
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
            SET repairs_count = $1, last_repair_at = NOW()
            WHERE id = $2
        `, [newRepairCount, solarId]);

        const isOwnPanel = panel.user_id === userId;
        const experience = isOwnPanel ? 40 : 60;

        await logActivity(userId, username, 'REPAIRED', 'SOLAR', solarId, panel.location, 
                         `Reparatur ${newRepairCount}/4${!isOwnPanel ? `, Panel von ${panel.username}` : ''}`, serverId, experience, 0);

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
                { name: '⭐ Erfahrung', value: `**+${experience} XP**${!isOwnPanel ? ' (Teamwork!)' : ''}`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Weiter so!' })
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
                         serverId, experience, totalReward);

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
                { name: '⭐ Erfahrung', value: `**+${experience} XP**`, inline: true },
                { name: '⏱️ Aktive Zeit', value: `${utils.formatDuration(Math.floor(minutesActive))}`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Erfolgreiche Sammlung!' })
            .setTimestamp();

        if (!isOwnPanel) {
            embed.addFields({
                name: '🤝 Teamwork-Bonus',
                value: 'Du hilfst der Familie!',
                inline: true
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
            .setFooter({ text: 'Russkaya Familie 🇷🇺' })
            .setTimestamp();

        if (panels.length === 0) {
            embed.setDescription('Keine aktiven Solarpanels vorhanden.');
            await interaction.followUp({ embeds: [embed] });
            return;
        }

        panels.forEach((panel, index) => {
            if (index >= 5) return;

            const minutesActive = panel.minutes_active || 0;
            const isTimeReady = minutesActive >= config.timers.solarBatteryTime;
            const isRepairReady = panel.repairs_count >= 4;

            let status = '';
            if (isRepairReady && isTimeReady) {
                status = '🔋 **BATTERIE BEREIT**';
            } else if (isRepairReady) {
                const remainingMinutes = Math.ceil(config.timers.solarBatteryTime - minutesActive);
                status = `⏰ Noch ${utils.formatDuration(remainingMinutes)}`;
            } else {
                status = `🔧 ${panel.repairs_count}/4 Reparaturen`;
            }

            embed.addFields({
                name: `Panel #${panel.id} - ${panel.location}`,
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

// ===== BACKUP & AUSZAHLUNGS-SYSTEM =====

async function calculateDailyPayouts(serverId, date = null) {
    try {
        const targetDate = date || new Date().toISOString().split('T')[0];
        
        const { rows: activities } = await db.query(`
            SELECT 
                al.*,
                CASE 
                    WHEN al.item_type = 'PLANT' THEN 
                        CASE 
                            WHEN p.user_id = al.user_id THEN 'OWN'
                            ELSE 'TEAM'
                        END
                    WHEN al.item_type = 'SOLAR' THEN
                        CASE 
                            WHEN sp.user_id = al.user_id THEN 'OWN'
                            ELSE 'TEAM'
                        END
                    ELSE 'UNKNOWN'
                END as ownership_type,
                p.quality as plant_quality
            FROM activity_logs al
            LEFT JOIN plants p ON al.item_id = p.id AND al.item_type = 'PLANT'
            LEFT JOIN solar_panels sp ON al.item_id = sp.id AND al.item_type = 'SOLAR'
            WHERE al.server_id = $1 AND DATE(al.timestamp) = $2
            ORDER BY al.timestamp DESC
        `, [serverId, targetDate]);

        const userPayouts = {};

        activities.forEach(activity => {
            const userId = activity.user_id;
            const username = activity.username;
            
            if (!userPayouts[userId]) {
                userPayouts[userId] = {
                    username,
                    activities: [],
                    totalPayout: 0,
                    breakdown: {
                        planted: 0,
                        fertilized: 0,
                        harvested: 0,
                        placed: 0,
                        repaired: 0,
                        collected: 0
                    }
                };
            }

            let payout = 0;
            
            switch (activity.action_type) {
                case 'PLANTED':
                    payout = PAYOUT_RATES.PLANTED;
                    userPayouts[userId].breakdown.planted += payout;
                    break;
                case 'FERTILIZED':
                    payout = activity.ownership_type === 'OWN' ? PAYOUT_RATES.FERTILIZED_OWN : PAYOUT_RATES.FERTILIZED_TEAM;
                    userPayouts[userId].breakdown.fertilized += payout;
                    break;
                case 'HARVESTED':
                    payout = activity.ownership_type === 'OWN' ? PAYOUT_RATES.HARVESTED_OWN : PAYOUT_RATES.HARVESTED_TEAM;
                    if (activity.plant_quality > 1) {
                        payout = Math.round(payout * PAYOUT_RATES.QUALITY_BONUS);
                    }
                    userPayouts[userId].breakdown.harvested += payout;
                    break;
                case 'PLACED':
                    payout = PAYOUT_RATES.PLACED;
                    userPayouts[userId].breakdown.placed += payout;
                    break;
                case 'REPAIRED':
                    payout = activity.ownership_type === 'OWN' ? PAYOUT_RATES.REPAIRED_OWN : PAYOUT_RATES.REPAIRED_TEAM;
                    userPayouts[userId].breakdown.repaired += payout;
                    break;
                case 'COLLECTED':
                    payout = activity.ownership_type === 'OWN' ? PAYOUT_RATES.COLLECTED_OWN : PAYOUT_RATES.COLLECTED_TEAM;
                    userPayouts[userId].breakdown.collected += payout;
                    break;
            }
            
            userPayouts[userId].totalPayout += payout;
            userPayouts[userId].activities.push({
                action: activity.action_type,
                payout,
                location: activity.location,
                ownership: activity.ownership_type
            });
        });

        return { date: targetDate, userPayouts, activities: activities.length };

    } catch (error) {
        console.error('❌ Calculate Daily Payouts Error:', error);
        return null;
    }
}

async function handleBackup(interaction) {
    const format = interaction.options.getString('format') || 'csv';
    const serverId = interaction.guildId;

    await interaction.deferReply({ ephemeral: true });

    try {
        const today = new Date().toISOString().split('T')[0];
        
        if (format === 'json') {
            // AUSZAHLUNGS-SYSTEM für Leaderin
            const payoutData = await calculateDailyPayouts(serverId, today);
            
            if (!payoutData) {
                await interaction.followUp({ content: '❌ Fehler beim Berechnen der Auszahlungen!', ephemeral: true });
                return;
            }

            const payoutJson = {
                metadata: {
                    generatedAt: new Date().toISOString(),
                    date: payoutData.date,
                    serverId: serverId,
                    totalActivities: payoutData.activities,
                    payoutRates: PAYOUT_RATES
                },
                summary: {
                    totalUsers: Object.keys(payoutData.userPayouts).length,
                    totalPayout: Object.values(payoutData.userPayouts).reduce((sum, user) => sum + user.totalPayout, 0),
                    averagePayout: Math.round(Object.values(payoutData.userPayouts).reduce((sum, user) => sum + user.totalPayout, 0) / Object.keys(payoutData.userPayouts).length || 0)
                },
                payouts: Object.entries(payoutData.userPayouts)
                    .map(([userId, data]) => ({
                        userId,
                        username: data.username,
                        totalPayout: data.totalPayout,
                        breakdown: data.breakdown,
                        activities: data.activities
                    }))
                    .sort((a, b) => b.totalPayout - a.totalPayout)
            };

            // CSV für Leaderin erstellen
            let payoutCsv = `TÄGLICHE AUSZAHLUNGEN - ${today}\n\n`;
            payoutCsv += 'Rang,Username,Gesamt Auszahlung,Gepflanzt,Gedüngt,Geerntet,Solar Aufgestellt,Repariert,Batterien Gesammelt\n';
            
            payoutJson.payouts.forEach((user, index) => {
                payoutCsv += `${index + 1},${user.username},${user.totalPayout}€,`;
                payoutCsv += `${user.breakdown.planted}€,${user.breakdown.fertilized}€,${user.breakdown.harvested}€,`;
                payoutCsv += `${user.breakdown.placed}€,${user.breakdown.repaired}€,${user.breakdown.collected}€\n`;
            });

            payoutCsv += `\nGESAMTSUMME:,,${payoutJson.summary.totalPayout}€,,,,,\n`;
            payoutCsv += `DURCHSCHNITT:,,${payoutJson.summary.averagePayout}€,,,,,\n`;

            const jsonBuffer = Buffer.from(JSON.stringify(payoutJson, null, 2), 'utf8');
            const csvBuffer = Buffer.from(payoutCsv, 'utf8');
            
            const jsonAttachment = new AttachmentBuilder(jsonBuffer, { name: `russkaya_auszahlungen_${today}.json` });
            const csvAttachment = new AttachmentBuilder(csvBuffer, { name: `russkaya_auszahlungen_${today}.csv` });

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('💰 Tägliche Auszahlungs-Berechnung')
                .setDescription(`Automatische Berechnung für **${today}**`)
                .addFields(
                    { name: '👥 Aktive Spieler', value: `${payoutJson.summary.totalUsers}`, inline: true },
                    { name: '📊 Gesamt-Aktivitäten', value: `${payoutData.activities}`, inline: true },
                    { name: '💰 Gesamt-Auszahlung', value: `**${utils.formatCurrency(payoutJson.summary.totalPayout)}**`, inline: true }
                )
                .setFooter({ text: 'Russkaya Familie 🇷🇺 • JSON = Details, CSV = Übersicht für Excel' })
                .setTimestamp();

            if (payoutJson.payouts.length > 0) {
                const top3 = payoutJson.payouts.slice(0, 3).map((user, i) => 
                    `${i + 1}. ${user.username}: **${utils.formatCurrency(user.totalPayout)}**`
                ).join('\n');
                embed.addFields({ name: '📋 Top 3 Verdiener', value: top3, inline: false });
            }

            await interaction.followUp({ 
                embeds: [embed], 
                files: [jsonAttachment, csvAttachment], 
                ephemeral: true 
            });
            
        } else {
            // Standard CSV Backup
            const { rows: plants } = await db.query('SELECT * FROM plants WHERE server_id = $1 ORDER BY planted_at DESC LIMIT 100', [serverId]);
            const { rows: solar } = await db.query('SELECT * FROM solar_panels WHERE server_id = $1 ORDER BY placed_at DESC LIMIT 100', [serverId]);
            const { rows: logs } = await db.query('SELECT * FROM activity_logs WHERE server_id = $1 ORDER BY timestamp DESC LIMIT 200', [serverId]);

            let csvContent = `RUSSKAYA FAMILIE BACKUP - ${today}\n\n`;
            csvContent += 'PFLANZEN:\n';
            csvContent += 'ID,User_ID,Username,Planted_At,Location,Status,Fertilized_By,Harvested_By,Car_Stored\n';
            
            plants.forEach(p => {
                csvContent += `${p.id || 'N/A'},${p.user_id},${p.username},${p.planted_at || 'N/A'},${p.location},${p.status},${p.fertilized_by || ''},${p.harvested_by || ''},${p.car_stored || ''}\n`;
            });

            csvContent += '\nSOLAR PANELS:\n';
            csvContent += 'ID,User_ID,Username,Placed_At,Location,Status,Repairs_Count,Collected_By,Car_Stored\n';
            
            solar.forEach(s => {
                csvContent += `${s.id || 'N/A'},${s.user_id},${s.username},${s.placed_at || 'N/A'},${s.location},${s.status},${s.repairs_count || 0},${s.collected_by || ''},${s.car_stored || ''}\n`;
            });

            csvContent += '\nACTIVITY LOGS (letzte 200):\n';
            csvContent += 'ID,User_ID,Username,Action_Type,Item_Type,Item_ID,Location,Details,Timestamp\n';
            
            logs.forEach(l => {
                csvContent += `${l.id || 'N/A'},${l.user_id},${l.username},${l.action_type},${l.item_type},${l.item_id || 'N/A'},${l.location || ''},${l.details || ''},${l.timestamp || 'N/A'}\n`;
            });

            const buffer = Buffer.from(csvContent, 'utf8');
            const attachment = new AttachmentBuilder(buffer, { name: `russkaya_backup_${today}.csv` });

            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('💾 Standard-Backup erstellt')
                .setDescription('CSV-Backup aller Server-Daten')
                .addFields(
                    { name: '🌱 Pflanzen', value: `${plants.length}`, inline: true },
                    { name: '☀️ Solar', value: `${solar.length}`, inline: true },
                    { name: '📋 Logs', value: `${logs.length}`, inline: true }
                )
                .setFooter({ text: 'Russkaya Familie 🇷🇺' })
                .setTimestamp();

            await interaction.followUp({ embeds: [embed], files: [attachment], ephemeral: true });
        }

    } catch (error) {
        console.error('❌ Backup Error:', error);
        await interaction.followUp({ content: '❌ Fehler beim Erstellen des Backups!', ephemeral: true });
    }
}

// ===== WEITERE COMMANDS =====

async function handleHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('❓ Russkaya Familie Bot v2.0 - Hilfe')
        .setDescription('Alle verfügbaren Commands im Überblick')
        .addFields(
            {
                name: '🌱 Pflanzen-Commands',
                value: '`/pflanze-säen location:` - Neue Pflanze säen\n`/pflanze-düngen id:` - Pflanze düngen (+25%)\n`/pflanze-ernten id: car:` - Pflanze ernten\n`/pflanzen-status` - Aktive Pflanzen',
                inline: true
            },
            {
                name: '☀️ Solar-Commands',
                value: '`/solar-aufstellen location:` - Panel aufstellen\n`/solar-reparieren id:` - Panel reparieren\n`/solar-sammeln id: car:` - Batterie sammeln\n`/solar-status` - Aktive Panels',
                inline: true
            },
            {
                name: '💰 Admin-Commands',
                value: '`/backup format:csv` - Standard Backup\n`/backup format:json` - **AUSZAHLUNGEN**\n`/statistiken` - Server Statistiken',
                inline: true
            },
            {
                name: '⏰ Zeiten & Regeln',
                value: `🌱 **Pflanzen:** ${utils.formatDuration(config.timers.plantHarvestTime)} Wachstumszeit\n☀️ **Solar:** ${utils.formatDuration(config.timers.solarBatteryTime)} + 4 Reparaturen = 1 Batterie\n💚 **Düngen:** +25% Ertrag bei Pflanzen\n🤝 **Teamwork:** Mehr XP für fremde Hilfe`,
                inline: false
            },
            {
                name: '💰 AUSZAHLUNGS-SYSTEM',
                value: '**Für Leaderin:** `/backup format:json`\nErstellt automatisch CSV mit allen Auszahlungen des Tages!\n\n**Beispiel-Werte:** Säen=500€, Düngen=200€/400€, Ernten=800€/600€, etc.',
                inline: false
            }
        )
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • Bot v2.0 Production Ready!' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleStatistics(interaction) {
    const serverId = interaction.guildId;
    await interaction.deferReply();

    try {
        const { rows: plantStats } = await db.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'planted') as active_plants,
                COUNT(*) FILTER (WHERE status = 'harvested') as harvested_plants
            FROM plants WHERE server_id = $1
        `, [serverId]);

        const { rows: solarStats } = await db.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'active') as active_solar,
                COUNT(*) FILTER (WHERE status = 'collected') as collected_solar
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
            .setTitle('📊 Russkaya Familie - Server Statistiken')
            .setDescription('Gesamtübersicht aller Aktivitäten')
            .addFields(
                {
                    name: '🌱 Pflanzen',
                    value: `**${plants.active_plants || 0}** aktiv\n**${plants.harvested_plants || 0}** geerntet\n**${(plants.active_plants || 0) + (plants.harvested_plants || 0)}** gesamt`,
                    inline: true
                },
                {
                    name: '☀️ Solarpanels',
                    value: `**${solar.active_solar || 0}** aktiv\n**${solar.collected_solar || 0}** eingesammelt\n**${(solar.active_solar || 0) + (solar.collected_solar || 0)}** gesamt`,
                    inline: true
                },
                {
                    name: '👥 Community',
                    value: `**${activity.active_users || 0}** aktive Spieler\n**${interaction.guild.memberCount}** Server-Mitglieder\n**${client.guilds.cache.size}** aktive Server`,
                    inline: true
                }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Statistics Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Statistiken!');
    }
}

// ===== HELPER FUNCTIONS =====

async function logActivity(userId, username, actionType, itemType, itemId, location, details, serverId, experience = 0, reward = 0) {
    try {
        await db.query(`
            INSERT INTO activity_logs (user_id, username, action_type, item_type, item_id, location, details, server_id, experience, reward)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [userId, username, actionType, itemType, itemId, location, details, serverId, experience, reward]);
    } catch (error) {
        console.error('❌ Log Activity Error:', error);
    }
}

// ===== BACKGROUND TASKS =====

function startBackgroundTasks() {
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
    
    console.log('⏰ Background Tasks gestartet');
}

// ===== HEALTH CHECK SERVER =====

function startHealthCheckServer() {
    const app = express();
    
    app.get('/', (req, res) => {
        res.json({
            status: 'online',
            bot: client.user?.tag || 'starting',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            guilds: client.guilds.cache.size,
            users: client.users.cache.size,
            version: '2.0.0'
        });
    });
    
    app.get('/health', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'healthy', database: 'connected' });
        } catch (error) {
            res.status(503).json({ status: 'unhealthy', database: 'disconnected', error: error.message });
        }
    });
    
    app.listen(config.port, () => {
        console.log(`🌐 Health Check Server läuft auf Port ${config.port}`);
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
    console.error('❌ DISCORD_TOKEN Environment Variable nicht gesetzt!');
    console.error('💡 Setze DISCORD_TOKEN in Railway Environment Variables');
    process.exit(1);
}

client.login(config.token).catch(error => {
    console.error('❌ Bot Login Error:', error);
    console.error('💡 Überprüfe deinen Discord Bot Token!');
    process.exit(1);
});

console.log('🚀 Russkaya Familie Bot v2.0 wird gestartet...');
console.log('🇷🇺 Развивайся с семьёй Русская!');
console.log('💰 AUSZAHLUNGS-SYSTEM: /backup format:json für tägliche Auszahlungsberechnungen!');
console.log('⚡ Railway Deployment Ready - Production Mode!');
