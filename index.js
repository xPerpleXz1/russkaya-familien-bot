const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Bot Setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Konfiguration aus Environment Variables
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const DATABASE_PATH = process.env.DATABASE_PATH || './russkaya.db';
const PLANT_CHANNEL_ID = process.env.PLANT_CHANNEL_ID;
const SOLAR_CHANNEL_ID = process.env.SOLAR_CHANNEL_ID;
const PORT = process.env.PORT || 3000;

// Zeitkonstanten (in Minuten für bessere Kontrolle)
const PLANT_FERTILIZER_REMINDER_1 = 35; // Erste Dünger-Erinnerung nach 35 Min
const PLANT_FERTILIZER_REMINDER_2 = 55; // Zweite Dünger-Erinnerung nach 55 Min
const PLANT_HARVEST_TIME = 240; // Pflanze erntereif nach 4 Stunden (240 Min)
const SOLAR_REPAIR_REMINDER_1 = 30; // Erste Reparatur-Erinnerung nach 30 Min
const SOLAR_REPAIR_REMINDER_2 = 50; // Zweite Reparatur-Erinnerung nach 50 Min
const SOLAR_BATTERY_TIME = 120; // Batterie alle 2 Stunden (120 Min)

// Database Setup
const db = new sqlite3.Database(DATABASE_PATH);

// Chart Configuration
const width = 800;
const height = 400;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

// Hilfsfunktion für Geld-Formatierung
function formatCurrency(amount) {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

// Hilfsfunktion für Zeitformatierung
function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
        return `${hours}h ${mins}min`;
    }
    return `${mins}min`;
}

// Initialize Database
db.serialize(() => {
    // Tabelle für aktuelle Pflanzen
    db.run(`CREATE TABLE IF NOT EXISTS plants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        planted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        location TEXT NOT NULL,
        status TEXT DEFAULT 'planted',
        fertilized_by TEXT,
        fertilized_at DATETIME,
        harvested_by TEXT,
        harvested_at DATETIME,
        car_stored TEXT,
        reminder_message_id TEXT,
        server_id TEXT
    )`);

    // Tabelle für Solarpanels
    db.run(`CREATE TABLE IF NOT EXISTS solar_panels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        placed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        location TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        repairs_count INTEGER DEFAULT 0,
        last_repair_at DATETIME,
        collected_by TEXT,
        collected_at DATETIME,
        car_stored TEXT,
        reminder_message_id TEXT,
        server_id TEXT
    )`);

    // Tabelle für Aktivitäts-Logs
    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        action_type TEXT NOT NULL,
        item_type TEXT NOT NULL,
        item_id INTEGER,
        location TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        server_id TEXT
    )`);

    // Migration für bestehende Datenbank
    db.all("PRAGMA table_info(plants)", (err, columns) => {
        if (!err && columns) {
            const hasServerId = columns.some(col => col.name === 'server_id');
            if (!hasServerId) {
                console.log('🔄 Migriere Pflanzen-Tabelle...');
                db.run(`ALTER TABLE plants ADD COLUMN server_id TEXT DEFAULT 'default'`);
            }
        }
    });

    db.all("PRAGMA table_info(solar_panels)", (err, columns) => {
        if (!err && columns) {
            const hasServerId = columns.some(col => col.name === 'server_id');
            const hasRepairs = columns.some(col => col.name === 'repairs_count');
            if (!hasServerId) {
                console.log('🔄 Migriere Solar-Tabelle...');
                db.run(`ALTER TABLE solar_panels ADD COLUMN server_id TEXT DEFAULT 'default'`);
            }
            if (!hasRepairs) {
                db.run(`ALTER TABLE solar_panels ADD COLUMN repairs_count INTEGER DEFAULT 0`);
                db.run(`ALTER TABLE solar_panels ADD COLUMN last_repair_at DATETIME`);
            }
        }
    });

    // Bereinigung alter Einträge (7 Tage)
    setInterval(() => {
        const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        
        db.run('DELETE FROM plants WHERE status = ? AND harvested_at < ?', ['harvested', cutoffDate]);
        db.run('DELETE FROM solar_panels WHERE status = ? AND collected_at < ?', ['collected', cutoffDate]);
        db.run('DELETE FROM activity_logs WHERE timestamp < ?', [cutoffDate]);
        
        console.log('🧹 Alte Einträge bereinigt');
    }, 24 * 60 * 60 * 1000); // Täglich

    console.log('✅ Datenbank initialisiert');
});

// Bot Events
client.once('ready', () => {
    console.log(`🤖 ${client.user.tag} ist online!`);
    console.log(`🇷🇺 Russkaya Familie Bot gestartet`);
    
    // Bot-Status setzen
    client.user.setActivity('Russkaya Familie 🇷🇺', { type: 'WATCHING' });
    
    registerCommands();
    
    // Health Check Server für Cloud Deployment
    if (PORT) {
        const express = require('express');
        const app = express();
        
        app.get('/', (req, res) => {
            res.json({ 
                status: 'online', 
                bot: client.user.tag,
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            });
        });
        
        app.listen(PORT, () => {
            console.log(`🌐 Health Check Server läuft auf Port ${PORT}`);
        });
    }
});

// Register Slash Commands
async function registerCommands() {
    const commands = [
        // Pflanzen Commands
        new SlashCommandBuilder()
            .setName('pflanze-säen')
            .setDescription('🌱 Eine neue Pflanze säen')
            .addStringOption(option =>
                option.setName('location')
                    .setDescription('Wo wurde die Pflanze gesät? (z.B. Feld Nord, Gewächshaus 1)')
                    .setRequired(true)
                    .setAutocomplete(true)),

        new SlashCommandBuilder()
            .setName('pflanze-düngen')
            .setDescription('💚 Eine Pflanze düngen')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID der Pflanze')
                    .setRequired(true)
                    .setAutocomplete(true)),

        new SlashCommandBuilder()
            .setName('pflanze-ernten')
            .setDescription('🌿 Eine Pflanze ernten')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID der Pflanze')
                    .setRequired(true)
                    .setAutocomplete(true))
            .addStringOption(option =>
                option.setName('car')
                    .setDescription('In welches Auto/Lager? (z.B. Bison, Lager West)')
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
                    .setDescription('Wo wurde das Panel aufgestellt? (z.B. Dach Ost, Feld Süd)')
                    .setRequired(true)
                    .setAutocomplete(true)),

        new SlashCommandBuilder()
            .setName('solar-reparieren')
            .setDescription('🔧 Ein Solarpanel reparieren')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID des Solarpanels')
                    .setRequired(true)
                    .setAutocomplete(true)),

        new SlashCommandBuilder()
            .setName('solar-sammeln')
            .setDescription('🔋 Batterie von Solarpanel sammeln')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID des Solarpanels')
                    .setRequired(true)
                    .setAutocomplete(true))
            .addStringOption(option =>
                option.setName('car')
                    .setDescription('In welches Auto/Lager? (z.B. Bison, Lager West)')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('solar-status')
            .setDescription('📋 Alle aktiven Solarpanels anzeigen'),

        // Statistik Commands
        new SlashCommandBuilder()
            .setName('statistiken')
            .setDescription('📊 Ausführliche Statistiken anzeigen')
            .addStringOption(option =>
                option.setName('typ')
                    .setDescription('Welche Statistiken?')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Übersicht', value: 'overview' },
                        { name: 'Pflanzen', value: 'plants' },
                        { name: 'Solar', value: 'solar' },
                        { name: 'Spieler', value: 'players' }
                    )),

        // Log Commands
        new SlashCommandBuilder()
            .setName('logs')
            .setDescription('📋 Letzte Aktivitäten anzeigen')
            .addIntegerOption(option =>
                option.setName('anzahl')
                    .setDescription('Anzahl der Logs (Standard: 10, Max: 25)')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('typ')
                    .setDescription('Filtertyp')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Alle', value: 'all' },
                        { name: 'Pflanzen', value: 'plants' },
                        { name: 'Solar', value: 'solar' },
                        { name: 'Ernten', value: 'harvest' },
                        { name: 'Sammeln', value: 'collect' }
                    )),

        // Management Commands
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('❓ Hilfe und Übersicht aller Commands'),

        new SlashCommandBuilder()
            .setName('verlauf')
            .setDescription('📈 Aktivitätsverlauf mit Diagramm')
            .addStringOption(option =>
                option.setName('zeitraum')
                    .setDescription('Zeitraum für Verlauf')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Letzte 24h', value: '24h' },
                        { name: 'Letzte 3 Tage', value: '3d' },
                        { name: 'Letzte Woche', value: '7d' },
                        { name: 'Letzter Monat', value: '30d' }
                    ))
    ];

    try {
        console.log('📝 Registriere Slash Commands...');
        await client.application.commands.set(commands);
        console.log('✅ Slash Commands erfolgreich registriert!');
    } catch (error) {
        console.error('❌ Fehler beim Registrieren der Commands:', error);
    }
}

// Command Handler
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        const serverId = interaction.guildId;

        try {
            switch (commandName) {
                case 'pflanze-säen':
                    await handlePlantSeed(interaction, serverId);
                    break;
                case 'pflanze-düngen':
                    await handlePlantFertilize(interaction, serverId);
                    break;
                case 'pflanze-ernten':
                    await handlePlantHarvest(interaction, serverId);
                    break;
                case 'pflanzen-status':
                    await handlePlantsStatus(interaction, serverId);
                    break;
                case 'solar-aufstellen':
                    await handleSolarPlace(interaction, serverId);
                    break;
                case 'solar-reparieren':
                    await handleSolarRepair(interaction, serverId);
                    break;
                case 'solar-sammeln':
                    await handleSolarCollect(interaction, serverId);
                    break;
                case 'solar-status':
                    await handleSolarStatus(interaction, serverId);
                    break;
                case 'statistiken':
                    await handleStatistics(interaction, serverId);
                    break;
                case 'logs':
                    await handleLogs(interaction, serverId);
                    break;
                case 'verlauf':
                    await handleActivityChart(interaction, serverId);
                    break;
                case 'help':
                    await handleHelp(interaction);
                    break;
            }
        } catch (error) {
            console.error('❌ Command Error:', error);
            const errorMessage = 'Es ist ein Fehler aufgetreten! Bitte versuche es erneut.';
            
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            }
        }
    } else if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
    }
});

// Autocomplete Handler
async function handleAutocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const { name, value } = focusedOption;
    const serverId = interaction.guildId;

    try {
        let choices = [];

        if (name === 'location') {
            // Standort-Autocomplete für Pflanzen und Solar
            const plantLocations = await new Promise((resolve, reject) => {
                db.all(
                    'SELECT DISTINCT location FROM plants WHERE server_id = ? AND location LIKE ? ORDER BY location LIMIT 10',
                    [serverId, `%${value}%`],
                    (err, rows) => err ? reject(err) : resolve(rows.map(row => row.location))
                );
            });

            const solarLocations = await new Promise((resolve, reject) => {
                db.all(
                    'SELECT DISTINCT location FROM solar_panels WHERE server_id = ? AND location LIKE ? ORDER BY location LIMIT 10',
                    [serverId, `%${value}%`],
                    (err, rows) => err ? reject(err) : resolve(rows.map(row => row.location))
                );
            });

            const allLocations = [...new Set([...plantLocations, ...solarLocations])];
            choices = allLocations.slice(0, 25).map(location => ({
                name: location,
                value: location
            }));

        } else if (name === 'id') {
            // ID-Autocomplete für aktive Items
            const commandName = interaction.commandName;
            
            if (commandName.includes('pflanze')) {
                const plants = await new Promise((resolve, reject) => {
                    db.all(
                        'SELECT id, location, username FROM plants WHERE server_id = ? AND status = "planted" ORDER BY planted_at DESC LIMIT 25',
                        [serverId],
                        (err, rows) => err ? reject(err) : resolve(rows)
                    );
                });

                choices = plants.map(plant => ({
                    name: `#${plant.id} - ${plant.location} (von ${plant.username})`,
                    value: plant.id
                }));

            } else if (commandName.includes('solar')) {
                const panels = await new Promise((resolve, reject) => {
                    db.all(
                        'SELECT id, location, username, repairs_count FROM solar_panels WHERE server_id = ? AND status = "active" ORDER BY placed_at DESC LIMIT 25',
                        [serverId],
                        (err, rows) => err ? reject(err) : resolve(rows)
                    );
                });

                choices = panels.map(panel => ({
                    name: `#${panel.id} - ${panel.location} (${panel.repairs_count}/4 Reparaturen, von ${panel.username})`,
                    value: panel.id
                }));
            }
        }

        await interaction.respond(choices);
    } catch (error) {
        console.error('❌ Autocomplete Error:', error);
        await interaction.respond([]);
    }
}

// Log-Funktion
function logActivity(userId, username, actionType, itemType, itemId, location, details, serverId) {
    db.run(
        'INSERT INTO activity_logs (user_id, username, action_type, item_type, item_id, location, details, server_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, username, actionType, itemType, itemId, location, details, serverId]
    );
}

// Reminder-System
function scheduleReminder(type, itemId, serverId, delayMinutes, reminderType) {
    setTimeout(async () => {
        try {
            if (type === 'plant' && reminderType === 'fertilizer') {
                await sendPlantFertilizerReminder(itemId, serverId);
            } else if (type === 'plant' && reminderType === 'harvest') {
                await sendPlantHarvestReminder(itemId, serverId);
            } else if (type === 'solar' && reminderType === 'repair') {
                await sendSolarRepairReminder(itemId, serverId);
            } else if (type === 'solar' && reminderType === 'battery') {
                await sendSolarBatteryReminder(itemId, serverId);
            }
        } catch (error) {
            console.error('❌ Reminder Error:', error);
        }
    }, delayMinutes * 60 * 1000);
}

// Pflanzen Commands Implementation
async function handlePlantSeed(interaction, serverId) {
    const location = interaction.options.getString('location').trim();
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    await interaction.deferReply();

    try {
        const result = await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO plants (user_id, username, location, server_id) VALUES (?, ?, ?, ?)',
                [userId, username, location, serverId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        const plantId = result;

        // Log aktivität
        logActivity(userId, username, 'PLANTED', 'PLANT', plantId, location, null, serverId);

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🌱 Pflanze erfolgreich gesät!')
            .setDescription('Deine Pflanze wächst nun heran!')
            .addFields(
                { name: '👤 Gesät von', value: `${username}`, inline: true },
                { name: '📍 Standort', value: `\`${location}\``, inline: true },
                { name: '🆔 Panel-ID', value: `**#${solarId}**`, inline: true },
                { name: '🔧 Reparaturen', value: `**0/4**`, inline: true },
                { name: '⏰ Reparatur-Erinnerung', value: `Nach ${formatDuration(SOLAR_REPAIR_REMINDER_1)}`, inline: true },
                { name: '🔋 Batterie bereit', value: `<t:${Math.floor((Date.now() + SOLAR_BATTERY_TIME * 60 * 1000) / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Vergiss nicht zu reparieren!' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

        // Erinnerungen planen
        scheduleReminder('solar', solarId, serverId, SOLAR_REPAIR_REMINDER_1, 'repair');
        scheduleReminder('solar', solarId, serverId, SOLAR_REPAIR_REMINDER_2, 'repair');
        scheduleReminder('solar', solarId, serverId, SOLAR_BATTERY_TIME, 'battery');

    } catch (error) {
        console.error('❌ Solar Place Error:', error);
        await interaction.followUp('❌ Fehler beim Aufstellen des Solarpanels!');
    }
}

async function handleSolarRepair(interaction, serverId) {
    const solarId = interaction.options.getInteger('id');
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    await interaction.deferReply();

    try {
        const panel = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM solar_panels WHERE id = ? AND server_id = ? AND status = "active"',
                [solarId, serverId],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (!panel) {
            await interaction.followUp('❌ Solarpanel nicht gefunden oder bereits eingesammelt!');
            return;
        }

        if (panel.repairs_count >= 4) {
            await interaction.followUp('❌ Dieses Panel wurde bereits 4x repariert! Batterie kann eingesammelt werden.');
            return;
        }

        const newRepairCount = panel.repairs_count + 1;

        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE solar_panels SET repairs_count = ?, last_repair_at = CURRENT_TIMESTAMP WHERE id = ?',
                [newRepairCount, solarId],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Log aktivität
        logActivity(userId, username, 'REPAIRED', 'SOLAR', solarId, panel.location, `Reparatur ${newRepairCount}/4`, serverId);

        const isReadyForBattery = newRepairCount >= 4;

        const embed = new EmbedBuilder()
            .setColor(isReadyForBattery ? '#00FF00' : '#FFA500')
            .setTitle(isReadyForBattery ? '🔋 Panel bereit für Batterie-Entnahme!' : '🔧 Solarpanel repariert!')
            .setDescription(isReadyForBattery ? 'Das Panel kann jetzt eine Batterie produzieren!' : 'Eine weitere Reparatur durchgeführt!')
            .addFields(
                { name: '👤 Repariert von', value: `${username}`, inline: true },
                { name: '🆔 Panel-ID', value: `**#${solarId}**`, inline: true },
                { name: '🔧 Reparaturen', value: `**${newRepairCount}/4**`, inline: true },
                { name: '📍 Standort', value: `\`${panel.location}\``, inline: true },
                { name: '☀️ Ursprünglich aufgestellt von', value: `${panel.username}`, inline: true },
                { name: '📅 Aufgestellt am', value: `<t:${Math.floor(new Date(panel.placed_at).getTime() / 1000)}:f>`, inline: true }
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

async function handleSolarCollect(interaction, serverId) {
    const solarId = interaction.options.getInteger('id');
    const car = interaction.options.getString('car').trim();
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    await interaction.deferReply();

    try {
        const panel = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM solar_panels WHERE id = ? AND server_id = ? AND status = "active"',
                [solarId, serverId],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (!panel) {
            await interaction.followUp('❌ Solarpanel nicht gefunden oder bereits eingesammelt!');
            return;
        }

        // Prüfe Reparatur-Status
        if (panel.repairs_count < 4) {
            await interaction.followUp(`❌ Panel noch nicht bereit! Benötigt noch **${4 - panel.repairs_count}** Reparaturen.`);
            return;
        }

        // Prüfe Zeitbedingung (2 Stunden seit Aufstellung)
        const placedTime = new Date(panel.placed_at).getTime();
        const currentTime = Date.now();
        const timeDiff = currentTime - placedTime;
        const readyTime = SOLAR_BATTERY_TIME * 60 * 1000;

        if (timeDiff < readyTime) {
            const remainingMinutes = Math.ceil((readyTime - timeDiff) / (60 * 1000));
            await interaction.followUp(`❌ Batterie noch nicht bereit! Noch **${formatDuration(remainingMinutes)}** warten.`);
            return;
        }

        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE solar_panels SET status = "collected", collected_by = ?, collected_at = CURRENT_TIMESTAMP, car_stored = ? WHERE id = ?',
                [username, car, solarId],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Log aktivität
        logActivity(userId, username, 'COLLECTED', 'SOLAR', solarId, panel.location, `Auto: ${car}`, serverId);

        const wasOwner = panel.user_id === userId;

        const embed = new EmbedBuilder()
            .setColor('#32CD32')
            .setTitle('🔋 Batterie erfolgreich eingesammelt!')
            .setDescription(wasOwner ? 'Du hast deine eigene Solar-Batterie eingesammelt!' : 'Du hast eine Familien-Batterie eingesammelt!')
            .addFields(
                { name: '👤 Eingesammelt von', value: `${username}`, inline: true },
                { name: '🆔 Panel-ID', value: `**#${solarId}**`, inline: true },
                { name: '🚗 Verstaut in', value: `\`${car}\``, inline: true },
                { name: '📍 Standort', value: `\`${panel.location}\``, inline: true },
                { name: '☀️ Ursprünglich aufgestellt von', value: `${panel.username}`, inline: true },
                { name: '🔧 Reparaturen erhalten', value: `**${panel.repairs_count}/4** ✅`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Erfolgreiche Sammlung!' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Solar Collect Error:', error);
        await interaction.followUp('❌ Fehler beim Sammeln der Batterie!');
    }
}

// Status Commands
async function handlePlantsStatus(interaction, serverId) {
    await interaction.deferReply();

    try {
        const plants = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM plants WHERE server_id = ? AND status = "planted" ORDER BY planted_at DESC',
                [serverId],
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });

        const embed = new EmbedBuilder()
            .setColor('#00AA00')
            .setTitle('🌱 Aktive Pflanzen')
            .setDescription(plants.length > 0 ? `**${plants.length}** aktive Pflanzen gefunden` : 'Keine aktiven Pflanzen vorhanden')
            .setFooter({ text: 'Russkaya Familie 🇷🇺' })
            .setTimestamp();

        if (plants.length === 0) {
            await interaction.followUp({ embeds: [embed] });
            return;
        }

        // Gruppiere nach Status
        plants.forEach((plant, index) => {
            if (index >= 10) return; // Maximal 10 anzeigen

            const plantedTime = new Date(plant.planted_at).getTime();
            const currentTime = Date.now();
            const timeDiff = currentTime - plantedTime;
            const readyTime = PLANT_HARVEST_TIME * 60 * 1000;
            const isReady = timeDiff >= readyTime;

            let status = '';
            if (isReady) {
                status = '🌿 **ERNTEREIF**';
            } else {
                const remainingMinutes = Math.ceil((readyTime - timeDiff) / (60 * 1000));
                status = `⏰ Noch ${formatDuration(remainingMinutes)}`;
            }

            const fertilizerStatus = plant.fertilized_by ? `✅ Gedüngt von ${plant.fertilized_by}` : '❌ Nicht gedüngt';

            embed.addFields({
                name: `Pflanze #${plant.id} - ${plant.location}`,
                value: `👤 **${plant.username}** • ${status}\n💚 ${fertilizerStatus}\n📅 <t:${Math.floor(plantedTime / 1000)}:R>`,
                inline: true
            });
        });

        if (plants.length > 10) {
            embed.setDescription(`**${plants.length}** aktive Pflanzen (zeige erste 10)`);
        }

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Plants Status Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Pflanzen!');
    }
}

async function handleSolarStatus(interaction, serverId) {
    await interaction.deferReply();

    try {
        const panels = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM solar_panels WHERE server_id = ? AND status = "active" ORDER BY placed_at DESC',
                [serverId],
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('☀️ Aktive Solarpanels')
            .setDescription(panels.length > 0 ? `**${panels.length}** aktive Panels gefunden` : 'Keine aktiven Solarpanels vorhanden')
            .setFooter({ text: 'Russkaya Familie 🇷🇺' })
            .setTimestamp();

        if (panels.length === 0) {
            await interaction.followUp({ embeds: [embed] });
            return;
        }

        panels.forEach((panel, index) => {
            if (index >= 10) return; // Maximal 10 anzeigen

            const placedTime = new Date(panel.placed_at).getTime();
            const currentTime = Date.now();
            const timeDiff = currentTime - placedTime;
            const readyTime = SOLAR_BATTERY_TIME * 60 * 1000;
            const isTimeReady = timeDiff >= readyTime;
            const isRepairReady = panel.repairs_count >= 4;

            let status = '';
            if (isRepairReady && isTimeReady) {
                status = '🔋 **BATTERIE BEREIT**';
            } else if (isRepairReady) {
                const remainingMinutes = Math.ceil((readyTime - timeDiff) / (60 * 1000));
                status = `⏰ Noch ${formatDuration(remainingMinutes)}`;
            } else {
                status = `🔧 ${panel.repairs_count}/4 Reparaturen`;
            }

            embed.addFields({
                name: `Panel #${panel.id} - ${panel.location}`,
                value: `👤 **${panel.username}** • ${status}\n📅 <t:${Math.floor(placedTime / 1000)}:R>`,
                inline: true
            });
        });

        if (panels.length > 10) {
            embed.setDescription(`**${panels.length}** aktive Panels (zeige erste 10)`);
        }

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Solar Status Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Solarpanels!');
    }
}

// Statistiken Command
async function handleStatistics(interaction, serverId) {
    const type = interaction.options.getString('typ') || 'overview';
    await interaction.deferReply();

    try {
        if (type === 'overview') {
            // Gesamtstatistiken
            const stats = await Promise.all([
                new Promise((resolve, reject) => {
                    db.get('SELECT COUNT(*) as count FROM plants WHERE server_id = ? AND status = "planted"', [serverId], (err, row) => err ? reject(err) : resolve(row.count));
                }),
                new Promise((resolve, reject) => {
                    db.get('SELECT COUNT(*) as count FROM plants WHERE server_id = ? AND status = "harvested"', [serverId], (err, row) => err ? reject(err) : resolve(row.count));
                }),
                new Promise((resolve, reject) => {
                    db.get('SELECT COUNT(*) as count FROM solar_panels WHERE server_id = ? AND status = "active"', [serverId], (err, row) => err ? reject(err) : resolve(row.count));
                }),
                new Promise((resolve, reject) => {
                    db.get('SELECT COUNT(*) as count FROM solar_panels WHERE server_id = ? AND status = "collected"', [serverId], (err, row) => err ? reject(err) : resolve(row.count));
                }),
                new Promise((resolve, reject) => {
                    db.get('SELECT COUNT(DISTINCT user_id) as count FROM activity_logs WHERE server_id = ?', [serverId], (err, row) => err ? reject(err) : resolve(row.count));
                })
            ]);

            const [activePlants, harvestedPlants, activeSolar, collectedSolar, activeUsers] = stats;

            const embed = new EmbedBuilder()
                .setColor('#9900FF')
                .setTitle('📊 Russkaya Familie - Gesamtstatistiken')
                .addFields(
                    { name: '🌱 Pflanzen', value: `**${activePlants}** aktiv\n**${harvestedPlants}** geerntet\n**${activePlants + harvestedPlants}** gesamt`, inline: true },
                    { name: '☀️ Solarpanels', value: `**${activeSolar}** aktiv\n**${collectedSolar}** eingesammelt\n**${activeSolar + collectedSolar}** gesamt`, inline: true },
                    { name: '👥 Aktive Mitglieder', value: `**${activeUsers}** Spieler\nhaben beigetragen`, inline: true }
                )
                .setFooter({ text: 'Russkaya Familie 🇷🇺' })
                .setTimestamp();

            await interaction.followUp({ embeds: [embed] });

        } else if (type === 'players') {
            // Spieler-Statistiken
            const playerStats = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT 
                        username,
                        COUNT(CASE WHEN action_type = 'PLANTED' THEN 1 END) as plants_seeded,
                        COUNT(CASE WHEN action_type = 'HARVESTED' THEN 1 END) as plants_harvested,
                        COUNT(CASE WHEN action_type = 'FERTILIZED' THEN 1 END) as plants_fertilized,
                        COUNT(CASE WHEN action_type = 'PLACED' THEN 1 END) as solar_placed,
                        COUNT(CASE WHEN action_type = 'COLLECTED' THEN 1 END) as solar_collected,
                        COUNT(CASE WHEN action_type = 'REPAIRED' THEN 1 END) as solar_repaired
                    FROM activity_logs 
                    WHERE server_id = ? 
                    GROUP BY username 
                    ORDER BY (plants_seeded + plants_harvested + solar_placed + solar_collected) DESC 
                    LIMIT 10
                `, [serverId], (err, rows) => err ? reject(err) : resolve(rows));
            });

            const embed = new EmbedBuilder()
                .setColor('#FF6600')
                .setTitle('👥 Top Familienmitglieder')
                .setDescription('Die aktivsten Mitglieder der letzten Zeit')
                .setFooter({ text: 'Russkaya Familie 🇷🇺' })
                .setTimestamp();

            if (playerStats.length === 0) {
                embed.setDescription('Noch keine Aktivitäten vorhanden');
            } else {
                playerStats.forEach((player, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                    const totalActivity = player.plants_seeded + player.plants_harvested + player.solar_placed + player.solar_collected;
                    
                    embed.addFields({
                        name: `${medal} ${player.username}`,
                        value: `🌱 **${player.plants_seeded}** gesät, **${player.plants_harvested}** geerntet, **${player.plants_fertilized}** gedüngt\n☀️ **${player.solar_placed}** aufgestellt, **${player.solar_collected}** gesammelt, **${player.solar_repaired}** repariert\n📊 **${totalActivity}** Gesamt-Aktionen`,
                        inline: false
                    });
                });
            }

            await interaction.followUp({ embeds: [embed] });
        }

    } catch (error) {
        console.error('❌ Statistics Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Statistiken!');
    }
}

// Logs Command
async function handleLogs(interaction, serverId) {
    const limit = Math.min(interaction.options.getInteger('anzahl') || 10, 25);
    const type = interaction.options.getString('typ') || 'all';
    
    await interaction.deferReply();

    try {
        let whereClause = 'WHERE server_id = ?';
        let params = [serverId];

        if (type !== 'all') {
            if (type === 'plants') {
                whereClause += ' AND item_type = "PLANT"';
            } else if (type === 'solar') {
                whereClause += ' AND item_type = "SOLAR"';
            } else if (type === 'harvest') {
                whereClause += ' AND action_type = "HARVESTED"';
            } else if (type === 'collect') {
                whereClause += ' AND action_type = "COLLECTED"';
            }
        }

        const logs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM activity_logs ${whereClause} ORDER BY timestamp DESC LIMIT ?`,
                [...params, limit],
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });

        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('📋 Aktivitätslogs')
            .setDescription(logs.length > 0 ? `**${logs.length}** letzte Aktivitäten${type !== 'all' ? ` (${type})` : ''}` : 'Keine Aktivitäten gefunden')
            .setFooter({ text: 'Russkaya Familie 🇷🇺' })
            .setTimestamp();

        if (logs.length === 0) {
            await interaction.followUp({ embeds: [embed] });
            return;
        }

        let logText = '';
        logs.forEach(log => {
            const timestamp = Math.floor(new Date(log.timestamp).getTime() / 1000);
            const icon = getActionIcon(log.action_type);
            const details = log.details ? ` (${log.details})` : '';
            
            logText += `${icon} **${log.username}** ${getActionText(log.action_type)} ${log.item_type.toLowerCase()} #${log.item_id}`;
            if (log.location) logText += ` bei *${log.location}*`;
            logText += `${details} • <t:${timestamp}:R>\n`;
        });

        embed.setDescription(`**${logs.length}** letzte Aktivitäten${type !== 'all' ? ` (${type})` : ''}\n\n${logText}`);

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Logs Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Logs!');
    }
}

// Hilfsfunktionen für Logs
function getActionIcon(actionType) {
    const icons = {
        'PLANTED': '🌱',
        'FERTILIZED': '💚',
        'HARVESTED': '🌿',
        'PLACED': '☀️',
        'REPAIRED': '🔧',
        'COLLECTED': '🔋'
    };
    return icons[actionType] || '📝';
}

function getActionText(actionType) {
    const texts = {
        'PLANTED': 'säte',
        'FERTILIZED': 'düngte',
        'HARVESTED': 'erntete',
        'PLACED': 'stellte auf',
        'REPAIRED': 'reparierte',
        'COLLECTED': 'sammelte'
    };
    return texts[actionType] || 'machte etwas mit';
}

// Activity Chart Command
async function handleActivityChart(interaction, serverId) {
    const period = interaction.options.getString('zeitraum') || '7d';
    await interaction.deferReply();

    try {
        // Bestimme Zeitraum
        let hours = 168; // 7 Tage default
        if (period === '24h') hours = 24;
        else if (period === '3d') hours = 72;
        else if (period === '30d') hours = 720;

        const startDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

        // Hole Aktivitätsdaten
        const activities = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    DATE(timestamp) as date,
                    action_type,
                    COUNT(*) as count
                FROM activity_logs 
                WHERE server_id = ? AND timestamp >= ?
                GROUP BY DATE(timestamp), action_type
                ORDER BY date DESC
            `, [serverId, startDate], (err, rows) => err ? reject(err) : resolve(rows));
        });

        if (activities.length === 0) {
            await interaction.followUp('❌ Keine Aktivitäten im gewählten Zeitraum gefunden!');
            return;
        }

        // Bereite Chart-Daten vor
        const dates = [...new Set(activities.map(a => a.date))].sort();
        const actionTypes = ['PLANTED', 'FERTILIZED', 'HARVESTED', 'PLACED', 'REPAIRED', 'COLLECTED'];
        const colors = ['#00FF00', '#32CD32', '#228B22', '#FFD700', '#FFA500', '#32CD32'];

        const datasets = actionTypes.map((actionType, index) => ({
            label: getActionText(actionType).charAt(0).toUpperCase() + getActionText(actionType).slice(1),
            data: dates.map(date => {
                const activity = activities.find(a => a.date === date && a.action_type === actionType);
                return activity ? activity.count : 0;
            }),
            borderColor: colors[index],
            backgroundColor: colors[index] + '20',
            tension: 0.3,
            fill: false
        }));

        const configuration = {
            type: 'line',
            data: {
                labels: dates.map(date => new Date(date).toLocaleDateString('de-DE')),
                datasets: datasets
            },
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: `📈 Aktivitätsverlauf (${period})`,
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Anzahl Aktivitäten',
                            font: { size: 14, weight: 'bold' }
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Datum',
                            font: { size: 14, weight: 'bold' }
                        }
                    }
                }
            }
        };

        const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'aktivitaetsverlauf.png' });

        const totalActivities = activities.reduce((sum, a) => sum + a.count, 0);

        const embed = new EmbedBuilder()
            .setColor('#9900FF')
            .setTitle(`📈 Aktivitätsverlauf (${period})`)
            .setDescription(`**${totalActivities}** Aktivitäten in den letzten ${period}`)
            .setImage('attachment://aktivitaetsverlauf.png')
            .setFooter({ text: 'Russkaya Familie 🇷🇺' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed], files: [attachment] });

    } catch (error) {
        console.error('❌ Activity Chart Error:', error);
        await interaction.followUp('❌ Fehler beim Erstellen des Diagramms! Zeige Text-Fallback...');
        
        // Text-Fallback
        await handleLogs(interaction, serverId);
    }
}

// Help Command
async function handleHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('❓ Russkaya Familie Bot - Hilfe')
        .setDescription('Alle verfügbaren Commands im Überblick')
        .addFields(
            {
                name: '🌱 Pflanzen-Commands',
                value: '`/pflanze-säen` - Neue Pflanze säen\n`/pflanze-düngen` - Pflanze düngen\n`/pflanze-ernten` - Pflanze ernten\n`/pflanzen-status` - Aktive Pflanzen anzeigen',
                inline: true
            },
            {
                name: '☀️ Solar-Commands',
                value: '`/solar-aufstellen` - Panel aufstellen\n`/solar-reparieren` - Panel reparieren\n`/solar-sammeln` - Batterie sammeln\n`/solar-status` - Aktive Panels anzeigen',
                inline: true
            },
            {
                name: '📊 Statistik-Commands',
                value: '`/statistiken` - Ausführliche Statistiken\n`/logs` - Aktivitätslogs anzeigen\n`/verlauf` - Aktivitätsdiagramm\n`/help` - Diese Hilfe',
                inline: true
            },
            {
                name: '⏰ Zeiten & Erinnerungen',
                value: `🌱 **Pflanzen:** ${formatDuration(PLANT_HARVEST_TIME)} Wachstumszeit\n💚 **Dünger-Erinnerung:** Nach ${formatDuration(PLANT_FERTILIZER_REMINDER_1)} & ${formatDuration(PLANT_FERTILIZER_REMINDER_2)}\n☀️ **Solar:** ${formatDuration(SOLAR_BATTERY_TIME)} für Batterie\n🔧 **Reparatur-Erinnerung:** Nach ${formatDuration(SOLAR_REPAIR_REMINDER_1)} & ${formatDuration(SOLAR_REPAIR_REMINDER_2)}`,
                inline: false
            },
            {
                name: '🎯 Tipps',
                value: '• Nutze Autocomplete für schnellere Eingabe\n• Düngen erhöht den Ertrag um 25%\n• 4 Reparaturen = 1 Batterie bereit\n• Alle Aktivitäten werden geloggt\n• Teamwork macht die Familie stark! 🇷🇺',
                inline: false
            }
        )
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • Entwickelt für GrandRP DE1' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

// Reminder-System Implementation
async function sendPlantFertilizerReminder(plantId, serverId) {
    try {
        const plant = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM plants WHERE id = ? AND server_id = ? AND status = "planted" AND fertilized_by IS NULL',
                [plantId, serverId],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (!plant) return; // Pflanze bereits gedüngt oder geerntet

        const channelId = PLANT_CHANNEL_ID || plant.channel_id;
        if (!channelId) return;

        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        const plantedTime = new Date(plant.planted_at).getTime();
        const currentTime = Date.now();
        const timeDiff = currentTime - plantedTime;
        const remainingMinutes = Math.ceil((PLANT_HARVEST_TIME * 60 * 1000 - timeDiff) / (60 * 1000));

        const embed = new EmbedBuilder()
            .setColor('#FF6600')
            .setTitle('⚠️ Dünger-Erinnerung!')
            .setDescription('Eine Pflanze braucht Dünger für besseren Ertrag!')
            .addFields(
                { name: '🌱 Pflanze', value: `**#${plant.id}** bei *${plant.location}*`, inline: true },
                { name: '👤 Gesät von', value: `${plant.username}`, inline: true },
                { name: '⏰ Noch bis Ernte', value: `${formatDuration(Math.max(0, remainingMinutes))}`, inline: true },
                { name: '💰 Bonus', value: '**+25% Ertrag** mit Dünger!', inline: false },
                { name: '🔧 Command', value: `/pflanze-düngen id:${plant.id}`, inline: false }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Düngen lohnt sich!' })
            .setTimestamp();

        const message = await channel.send({ embeds: [embed] });
        
        // Reaktionen hinzufügen
        await message.react('✅'); // Für "erledigt"
        await message.react('⏰'); // Für "später"

    } catch (error) {
        console.error('❌ Plant Fertilizer Reminder Error:', error);
    }
}

async function sendPlantHarvestReminder(plantId, serverId) {
    try {
        const plant = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM plants WHERE id = ? AND server_id = ? AND status = "planted"',
                [plantId, serverId],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (!plant) return; // Pflanze bereits geerntet

        const channelId = PLANT_CHANNEL_ID || plant.channel_id;
        if (!channelId) return;

        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🌿 Pflanze erntereif!')
            .setDescription('Eine Pflanze kann jetzt geerntet werden!')
            .addFields(
                { name: '🌱 Pflanze', value: `**#${plant.id}** bei *${plant.location}*`, inline: true },
                { name: '👤 Gesät von', value: `${plant.username}`, inline: true },
                { name: '💚 Status', value: plant.fertilized_by ? `✅ Gedüngt von ${plant.fertilized_by}` : '❌ Nicht gedüngt', inline: true },
                { name: '🔧 Command', value: `/pflanze-ernten id:${plant.id} car:[Auto]`, inline: false }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Ernte bereit!' })
            .setTimestamp();

        if (plant.fertilized_by) {
            embed.addFields({ name: '🎁 Bonus', value: '**+25% Ertrag** durch Dünger!', inline: false });
        }

        const message = await channel.send({ embeds: [embed] });
        
        // Reaktionen hinzufügen
        await message.react('🌿'); // Für Ernte
        await message.react('📍'); // Für Standort

    } catch (error) {
        console.error('❌ Plant Harvest Reminder Error:', error);
    }
}

async function sendSolarRepairReminder(solarId, serverId) {
    try {
        const panel = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM solar_panels WHERE id = ? AND server_id = ? AND status = "active" AND repairs_count < 4',
                [solarId, serverId],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (!panel) return; // Panel bereits voll repariert oder eingesammelt

        const channelId = SOLAR_CHANNEL_ID || panel.channel_id;
        if (!channelId) return;

        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🔧 Solarpanel-Erinnerung!')
            .setDescription('Ein Solarpanel kann repariert werden!')
            .addFields(
                { name: '☀️ Panel', value: `**#${panel.id}** bei *${panel.location}*`, inline: true },
                { name: '👤 Aufgestellt von', value: `${panel.username}`, inline: true },
                { name: '🔧 Reparaturen', value: `**${panel.repairs_count}/4**`, inline: true },
                { name: '📋 Noch benötigt', value: `**${4 - panel.repairs_count}** Reparaturen`, inline: true },
                { name: '🔧 Command', value: `/solar-reparieren id:${panel.id}`, inline: false }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • 4 Reparaturen = 1 Batterie!' })
            .setTimestamp();

        const message = await channel.send({ embeds: [embed] });
        
        // Reaktionen hinzufügen
        await message.react('🔧'); // Für Reparatur
        await message.react('⏰'); // Für später

    } catch (error) {
        console.error('❌ Solar Repair Reminder Error:', error);
    }
}

async function sendSolarBatteryReminder(solarId, serverId) {
    try {
        const panel = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM solar_panels WHERE id = ? AND server_id = ? AND status = "active" AND repairs_count >= 4',
                [solarId, serverId],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (!panel) return; // Panel noch nicht bereit oder bereits eingesammelt

        const channelId = SOLAR_CHANNEL_ID || panel.channel_id;
        if (!channelId) return;

        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor('#32CD32')
            .setTitle('🔋 Batterie bereit!')
            .setDescription('Ein Solarpanel hat eine Batterie produziert!')
            .addFields(
                { name: '☀️ Panel', value: `**#${panel.id}** bei *${panel.location}*`, inline: true },
                { name: '👤 Aufgestellt von', value: `${panel.username}`, inline: true },
                { name: '🔧 Reparaturen', value: `**${panel.repairs_count}/4** ✅`, inline: true },
                { name: '📅 Aufgestellt', value: `<t:${Math.floor(new Date(panel.placed_at).getTime() / 1000)}:R>`, inline: true },
                { name: '🔧 Command', value: `/solar-sammeln id:${panel.id} car:[Auto]`, inline: false }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Batterie einsammeln!' })
            .setTimestamp();

        const message = await channel.send({ embeds: [embed] });
        
        // Reaktionen hinzufügen
        await message.react('🔋'); // Für Batterie
        await message.react('🚗'); // Für Transport

        // Wiederholende Erinnerung alle 2 Stunden
        scheduleReminder('solar', solarId, serverId, SOLAR_BATTERY_TIME, 'battery');

    } catch (error) {
        console.error('❌ Solar Battery Reminder Error:', error);
    }
}

// Reaktions-Handler für Erinnerungen
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    try {
        // Lade die vollständige Nachricht falls partial
        if (reaction.partial) {
            await reaction.fetch();
        }

        const message = reaction.message;
        if (!message.embeds.length) return;

        const embed = message.embeds[0];
        if (!embed.title) return;

        const emoji = reaction.emoji.name;

        // Dünger-Erinnerung abgeschlossen
        if (embed.title.includes('Dünger-Erinnerung') && emoji === '✅') {
            const newEmbed = new EmbedBuilder(embed)
                .setTitle('✅ Dünger-Erinnerung abgeschlossen!')
                .setColor('#00FF00')
                .setDescription('Vielen Dank fürs Düngen! 💚');

            await message.edit({ embeds: [newEmbed] });
        }

        // Reparatur-Erinnerung abgeschlossen
        if (embed.title.includes('Solarpanel-Erinnerung') && emoji === '🔧') {
            const newEmbed = new EmbedBuilder(embed)
                .setTitle('🔧 Reparatur abgeschlossen!')
                .setColor('#00FF00')
                .setDescription('Vielen Dank fürs Reparieren! 🔧');

            await message.edit({ embeds: [newEmbed] });
        }

        // Batterie eingesammelt
        if (embed.title.includes('Batterie bereit') && emoji === '🔋') {
            const newEmbed = new EmbedBuilder(embed)
                .setTitle('🔋 Batterie eingesammelt!')
                .setColor('#00FF00')
                .setDescription('Vielen Dank fürs Einsammeln! 🔋');

            await message.edit({ embeds: [newEmbed] });
        }

    } catch (error) {
        console.error('❌ Reaction Handler Error:', error);
    }
});

// Error Handling
process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('🛑 Bot wird heruntergefahren...');
    db.close((err) => {
        if (err) {
            console.error('❌ Fehler beim Schließen der Datenbank:', err);
        } else {
            console.log('✅ Datenbank geschlossen');
        }
        client.destroy();
        process.exit(0);
    });
});

// Login
if (!BOT_TOKEN) {
    console.error('❌ DISCORD_TOKEN Environment Variable nicht gesetzt!');
    process.exit(1);
}

client.login(BOT_TOKEN).catch(error => {
    console.error('❌ Bot Login Error:', error);
    process.exit(1);
});
                location}\``, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '⏰ Wachstumszeit', value: `**${formatDuration(PLANT_HARVEST_TIME)}**`, inline: true },
                { name: '💚 Dünger-Erinnerung', value: `Nach ${formatDuration(PLANT_FERTILIZER_REMINDER_1)}`, inline: true },
                { name: '🌿 Erntereif', value: `<t:${Math.floor((Date.now() + PLANT_HARVEST_TIME * 60 * 1000) / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Vergiss nicht zu düngen!' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

        // Erinnerungen planen
        scheduleReminder('plant', plantId, serverId, PLANT_FERTILIZER_REMINDER_1, 'fertilizer');
        scheduleReminder('plant', plantId, serverId, PLANT_FERTILIZER_REMINDER_2, 'fertilizer');
        scheduleReminder('plant', plantId, serverId, PLANT_HARVEST_TIME, 'harvest');

    } catch (error) {
        console.error('❌ Plant Seed Error:', error);
        await interaction.followUp('❌ Fehler beim Säen der Pflanze!');
    }
}

async function handlePlantFertilize(interaction, serverId) {
    const plantId = interaction.options.getInteger('id');
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    await interaction.deferReply();

    try {
        const plant = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM plants WHERE id = ? AND server_id = ? AND status = "planted"',
                [plantId, serverId],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (!plant) {
            await interaction.followUp('❌ Pflanze nicht gefunden oder bereits geerntet!');
            return;
        }

        if (plant.fertilized_by) {
            await interaction.followUp('❌ Diese Pflanze wurde bereits gedüngt!');
            return;
        }

        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE plants SET fertilized_by = ?, fertilized_at = CURRENT_TIMESTAMP WHERE id = ?',
                [username, plantId],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Log aktivität
        logActivity(userId, username, 'FERTILIZED', 'PLANT', plantId, plant.location, null, serverId);

        const embed = new EmbedBuilder()
            .setColor('#32CD32')
            .setTitle('💚 Pflanze erfolgreich gedüngt!')
            .setDescription('Die Pflanze wächst nun schneller!')
            .addFields(
                { name: '👤 Gedüngt von', value: `${username}`, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '📍 Standort', value: `\`${plant.location}\``, inline: true },
                { name: '🌱 Gesät von', value: `${plant.username}`, inline: true },
                { name: '📅 Gesät am', value: `<t:${Math.floor(new Date(plant.planted_at).getTime() / 1000)}:f>`, inline: true },
                { name: '✅ Status', value: '**Gedüngt & Wachsend**', inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Gut gemacht!' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Plant Fertilize Error:', error);
        await interaction.followUp('❌ Fehler beim Düngen der Pflanze!');
    }
}

async function handlePlantHarvest(interaction, serverId) {
    const plantId = interaction.options.getInteger('id');
    const car = interaction.options.getString('car').trim();
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    await interaction.deferReply();

    try {
        const plant = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM plants WHERE id = ? AND server_id = ? AND status = "planted"',
                [plantId, serverId],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (!plant) {
            await interaction.followUp('❌ Pflanze nicht gefunden oder bereits geerntet!');
            return;
        }

        // Prüfe ob Pflanze erntereif ist (4 Stunden)
        const plantedTime = new Date(plant.planted_at).getTime();
        const currentTime = Date.now();
        const timeDiff = currentTime - plantedTime;
        const readyTime = PLANT_HARVEST_TIME * 60 * 1000;

        if (timeDiff < readyTime) {
            const remainingMinutes = Math.ceil((readyTime - timeDiff) / (60 * 1000));
            await interaction.followUp(`❌ Pflanze ist noch nicht erntereif! Noch **${formatDuration(remainingMinutes)}** warten.`);
            return;
        }

        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE plants SET status = "harvested", harvested_by = ?, harvested_at = CURRENT_TIMESTAMP, car_stored = ? WHERE id = ?',
                [username, car, plantId],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Log aktivität
        logActivity(userId, username, 'HARVESTED', 'PLANT', plantId, plant.location, `Auto: ${car}`, serverId);

        const wasOwner = plant.user_id === userId;
        const wasFertilized = plant.fertilized_by !== null;

        const embed = new EmbedBuilder()
            .setColor('#228B22')
            .setTitle('🌿 Pflanze erfolgreich geerntet!')
            .setDescription(wasOwner ? 'Du hast deine eigene Pflanze geerntet!' : 'Du hast eine Familien-Pflanze geerntet!')
            .addFields(
                { name: '👤 Geerntet von', value: `${username}`, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '🚗 Verstaut in', value: `\`${car}\``, inline: true },
                { name: '📍 Standort', value: `\`${plant.location}\``, inline: true },
                { name: '🌱 Ursprünglich gesät von', value: `${plant.username}`, inline: true },
                { name: '💚 Gedüngt', value: wasFertilized ? `✅ von ${plant.fertilized_by}` : '❌ Nicht gedüngt', inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Erfolgreiche Ernte!' })
            .setTimestamp();

        // Bonus-Info für gedüngte Pflanzen
        if (wasFertilized) {
            embed.addFields({ 
                name: '🎁 Bonus', 
                value: '**+25% Ertrag** durch Dünger!', 
                inline: false 
            });
        }

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Plant Harvest Error:', error);
        await interaction.followUp('❌ Fehler beim Ernten der Pflanze!');
    }
}

// Solar Commands Implementation
async function handleSolarPlace(interaction, serverId) {
    const location = interaction.options.getString('location').trim();
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    await interaction.deferReply();

    try {
        const result = await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO solar_panels (user_id, username, location, server_id) VALUES (?, ?, ?, ?)',
                [userId, username, location, serverId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        const solarId = result;

        // Log aktivität
        logActivity(userId, username, 'PLACED', 'SOLAR', solarId, location, null, serverId);

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('☀️ Solarpanel erfolgreich aufgestellt!')
            .setDescription('Das Panel sammelt nun Sonnenenergie!')
            .addFields(
                { name: '👤 Aufgestellt von', value: `${username}`, inline: true },
                { name: '📍 Standort', value: `\`${
