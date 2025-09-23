const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, Collection } = require('discord.js');
const { Pool } = require('pg');
const express = require('express');
const cron = require('node-cron');

// ==========================================
// BOT KONFIGURATION
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// PostgreSQL Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Commands Collection
client.commands = new Collection();
client.cooldowns = new Collection();

// Environment Variables
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const BACKUP_CHANNEL_ID = process.env.BACKUP_CHANNEL_ID;
const PORT = process.env.PORT || 3000;

// ==========================================
// DATENBANK INITIALISIERUNG
// ==========================================

async function initDatabase() {
    try {
        console.log('🔄 Initialisiere Datenbank...');

        // Tabelle für Pflanzen
        await pool.query(`
            CREATE TABLE IF NOT EXISTS plants (
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
                server_id TEXT
            )
        `);

        // Tabelle für Solar
        await pool.query(`
            CREATE TABLE IF NOT EXISTS solar_panels (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                location TEXT NOT NULL,
                status TEXT DEFAULT 'active',
                repairs_count INTEGER DEFAULT 0,
                collected_by TEXT,
                collected_at TIMESTAMP,
                car_stored TEXT,
                server_id TEXT
            )
        `);

        // Tabelle für Logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                action_type TEXT NOT NULL,
                item_type TEXT NOT NULL,
                item_id INTEGER,
                location TEXT,
                details TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                server_id TEXT
            )
        `);

        // Performance Indizes
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_plants_server_status ON plants(server_id, status);
            CREATE INDEX IF NOT EXISTS idx_solar_server_status ON solar_panels(server_id, status);
            CREATE INDEX IF NOT EXISTS idx_logs_server_time ON activity_logs(server_id, timestamp DESC);
        `);

        console.log('✅ Datenbank erfolgreich initialisiert!');
    } catch (error) {
        console.error('❌ Datenbank Fehler:', error);
        throw error;
    }
}

// ==========================================
// SLASH COMMANDS DEFINITIONEN
// ==========================================

const commands = [
    new SlashCommandBuilder()
        .setName('pflanze-säen')
        .setDescription('🌱 Eine neue Pflanze säen')
        .addStringOption(option =>
            option.setName('location')
                .setDescription('Wo wurde die Pflanze gesät?')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('pflanze-düngen')
        .setDescription('💚 Eine Pflanze düngen')
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

    new SlashCommandBuilder()
        .setName('solar-aufstellen')
        .setDescription('☀️ Ein Solarpanel aufstellen')
        .addStringOption(option =>
            option.setName('location')
                .setDescription('Wo wurde das Panel aufgestellt?')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('solar-status')
        .setDescription('📋 Alle aktiven Solarpanels anzeigen'),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('❓ Hilfe anzeigen'),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('📊 Bot Statistiken anzeigen')
];

// ==========================================
// BOT EVENT HANDLERS
// ==========================================

client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} ist online!`);
    console.log(`🇷🇺 Russkaya Familie Bot gestartet`);
    
    // Bot Status setzen
    client.user.setActivity('Russkaya Familie 🇷🇺', { type: 3 }); // Type 3 = WATCHING
    
    try {
        // Datenbank initialisieren
        await initDatabase();
        
        // Commands registrieren
        await registerCommands();
        
        console.log('✅ Bot vollständig initialisiert!');
    } catch (error) {
        console.error('❌ Initialisierung fehlgeschlagen:', error);
        process.exit(1);
    }
});

async function registerCommands() {
    try {
        console.log('📝 Registriere Commands...');
        await client.application.commands.set(commands);
        console.log('✅ Commands erfolgreich registriert!');
    } catch (error) {
        console.error('❌ Command Registrierung fehlgeschlagen:', error);
        throw error;
    }
}

// ==========================================
// COMMAND HANDLER
// ==========================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const serverId = interaction.guildId;
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    try {
        await interaction.deferReply();

        switch (commandName) {
            case 'pflanze-säen':
                await handlePlantSeed(interaction, serverId, userId, username);
                break;
            case 'pflanze-düngen':
                await handlePlantFertilize(interaction, serverId, userId, username);
                break;
            case 'pflanze-ernten':
                await handlePlantHarvest(interaction, serverId, userId, username);
                break;
            case 'pflanzen-status':
                await handlePlantsStatus(interaction, serverId);
                break;
            case 'solar-aufstellen':
                await handleSolarPlace(interaction, serverId, userId, username);
                break;
            case 'solar-status':
                await handleSolarStatus(interaction, serverId);
                break;
            case 'help':
                await handleHelp(interaction);
                break;
            case 'stats':
                await handleStats(interaction, serverId);
                break;
            default:
                await interaction.editReply('❌ Unbekannter Command!');
        }
    } catch (error) {
        console.error(`❌ Command Error (${commandName}):`, error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Fehler')
            .setDescription('Ein Fehler ist aufgetreten. Bitte versuche es später erneut.')
            .setTimestamp();

        if (interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
});

// ==========================================
// COMMAND IMPLEMENTATIONS
// ==========================================

async function handlePlantSeed(interaction, serverId, userId, username) {
    const location = interaction.options.getString('location');
    
    const result = await pool.query(
        'INSERT INTO plants (user_id, username, location, server_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, username, location, serverId]
    );
    
    const plantId = result.rows[0].id;
    
    // Log Aktivität
    await pool.query(
        'INSERT INTO activity_logs (user_id, username, action_type, item_type, item_id, location, server_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [userId, username, 'PLANTED', 'PLANT', plantId, location, serverId]
    );
    
    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🌱 Pflanze erfolgreich gesät!')
        .addFields(
            { name: '👤 Gesät von', value: username, inline: true },
            { name: '📍 Standort', value: location, inline: true },
            { name: '🆔 ID', value: `#${plantId}`, inline: true },
            { name: '⏰ Wachstumszeit', value: '4 Stunden', inline: true }
        )
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • Railway PostgreSQL' })
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
}

async function handlePlantFertilize(interaction, serverId, userId, username) {
    const plantId = interaction.options.getInteger('id');
    
    const plant = await pool.query(
        'SELECT * FROM plants WHERE id = $1 AND server_id = $2 AND status = $3',
        [plantId, serverId, 'planted']
    );
    
    if (plant.rows.length === 0) {
        await interaction.editReply('❌ Pflanze nicht gefunden oder bereits geerntet!');
        return;
    }
    
    if (plant.rows[0].fertilized_by) {
        await interaction.editReply('❌ Diese Pflanze wurde bereits gedüngt!');
        return;
    }
    
    await pool.query(
        'UPDATE plants SET fertilized_by = $1, fertilized_at = CURRENT_TIMESTAMP WHERE id = $2',
        [username, plantId]
    );
    
    // Log Aktivität
    await pool.query(
        'INSERT INTO activity_logs (user_id, username, action_type, item_type, item_id, location, server_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [userId, username, 'FERTILIZED', 'PLANT', plantId, plant.rows[0].location, serverId]
    );
    
    const embed = new EmbedBuilder()
        .setColor('#32CD32')
        .setTitle('💚 Pflanze erfolgreich gedüngt!')
        .addFields(
            { name: '👤 Gedüngt von', value: username, inline: true },
            { name: '🆔 Pflanze', value: `#${plantId}`, inline: true },
            { name: '📍 Standort', value: plant.rows[0].location, inline: true },
            { name: '🎁 Bonus', value: '+25% Ertrag', inline: true }
        )
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
}

async function handlePlantHarvest(interaction, serverId, userId, username) {
    const plantId = interaction.options.getInteger('id');
    const car = interaction.options.getString('car');
    
    const plant = await pool.query(
        'SELECT * FROM plants WHERE id = $1 AND server_id = $2 AND status = $3',
        [plantId, serverId, 'planted']
    );
    
    if (plant.rows.length === 0) {
        await interaction.editReply('❌ Pflanze nicht gefunden oder bereits geerntet!');
        return;
    }
    
    await pool.query(
        'UPDATE plants SET status = $1, harvested_by = $2, harvested_at = CURRENT_TIMESTAMP, car_stored = $3 WHERE id = $4',
        ['harvested', username, car, plantId]
    );
    
    // Log Aktivität
    await pool.query(
        'INSERT INTO activity_logs (user_id, username, action_type, item_type, item_id, location, details, server_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [userId, username, 'HARVESTED', 'PLANT', plantId, plant.rows[0].location, `Auto: ${car}`, serverId]
    );
    
    const plantData = plant.rows[0];
    const wasFertilized = plantData.fertilized_by !== null;
    
    const embed = new EmbedBuilder()
        .setColor('#228B22')
        .setTitle('🌿 Pflanze erfolgreich geerntet!')
        .addFields(
            { name: '👤 Geerntet von', value: username, inline: true },
            { name: '🆔 Pflanze', value: `#${plantId}`, inline: true },
            { name: '🚗 Auto', value: car, inline: true },
            { name: '📍 Standort', value: plantData.location, inline: true },
            { name: '🌱 Gesät von', value: plantData.username, inline: true },
            { name: '💚 Gedüngt', value: wasFertilized ? `✅ von ${plantData.fertilized_by}` : '❌ Nicht gedüngt', inline: true }
        )
        .setTimestamp();
    
    if (wasFertilized) {
        embed.addFields({ name: '🎁 Bonus', value: '**+25% Ertrag** durch Dünger!', inline: false });
    }
    
    await interaction.editReply({ embeds: [embed] });
}

async function handlePlantsStatus(interaction, serverId) {
    const plants = await pool.query(
        'SELECT * FROM plants WHERE server_id = $1 AND status = $2 ORDER BY planted_at DESC LIMIT 10',
        [serverId, 'planted']
    );
    
    const embed = new EmbedBuilder()
        .setColor('#00AA00')
        .setTitle('🌱 Aktive Pflanzen')
        .setDescription(plants.rows.length > 0 ? `${plants.rows.length} aktive Pflanzen gefunden` : 'Keine aktiven Pflanzen')
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • PostgreSQL' })
        .setTimestamp();
    
    plants.rows.forEach(plant => {
        const fertilizerStatus = plant.fertilized_by ? `✅ Gedüngt von ${plant.fertilized_by}` : '❌ Nicht gedüngt';
        const timestamp = Math.floor(new Date(plant.planted_at).getTime() / 1000);
        
        embed.addFields({
            name: `Pflanze #${plant.id} - ${plant.location}`,
            value: `👤 **${plant.username}**\n💚 ${fertilizerStatus}\n📅 <t:${timestamp}:R>`,
            inline: true
        });
    });
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleSolarPlace(interaction, serverId, userId, username) {
    const location = interaction.options.getString('location');
    
    const result = await pool.query(
        'INSERT INTO solar_panels (user_id, username, location, server_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, username, location, serverId]
    );
    
    const solarId = result.rows[0].id;
    
    // Log Aktivität
    await pool.query(
        'INSERT INTO activity_logs (user_id, username, action_type, item_type, item_id, location, server_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [userId, username, 'PLACED', 'SOLAR', solarId, location, serverId]
    );
    
    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('☀️ Solarpanel erfolgreich aufgestellt!')
        .addFields(
            { name: '👤 Aufgestellt von', value: username, inline: true },
            { name: '📍 Standort', value: location, inline: true },
            { name: '🆔 ID', value: `#${solarId}`, inline: true },
            { name: '🔧 Status', value: '0/4 Reparaturen', inline: true }
        )
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • Railway PostgreSQL' })
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleSolarStatus(interaction, serverId) {
    const panels = await pool.query(
        'SELECT * FROM solar_panels WHERE server_id = $1 AND status = $2 ORDER BY placed_at DESC LIMIT 10',
        [serverId, 'active']
    );
    
    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('☀️ Aktive Solarpanels')
        .setDescription(panels.rows.length > 0 ? `${panels.rows.length} aktive Panels gefunden` : 'Keine aktiven Panels')
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • PostgreSQL' })
        .setTimestamp();
    
    panels.rows.forEach(panel => {
        const timestamp = Math.floor(new Date(panel.placed_at).getTime() / 1000);
        
        embed.addFields({
            name: `Panel #${panel.id} - ${panel.location}`,
            value: `👤 **${panel.username}**\n🔧 ${panel.repairs_count}/4 Reparaturen\n📅 <t:${timestamp}:R>`,
            inline: true
        });
    });
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('❓ Russkaya Familie Bot - Hilfe')
        .setDescription('Alle verfügbaren Commands')
        .addFields(
            {
                name: '🌱 Pflanzen Commands',
                value: '`/pflanze-säen location:[Ort]` - Neue Pflanze säen\n`/pflanze-düngen id:[ID]` - Pflanze düngen\n`/pflanze-ernten id:[ID] car:[Auto]` - Pflanze ernten\n`/pflanzen-status` - Aktive Pflanzen',
                inline: true
            },
            {
                name: '☀️ Solar Commands',
                value: '`/solar-aufstellen location:[Ort]` - Panel aufstellen\n`/solar-status` - Aktive Panels',
                inline: true
            },
            {
                name: '📊 System Commands',
                value: '`/stats` - Bot Statistiken\n`/help` - Diese Hilfe',
                inline: true
            },
            {
                name: '⚡ Powered by',
                value: '🚂 **Railway** - Cloud Platform\n🐘 **PostgreSQL** - Database\n🔒 **SSL Encryption** - Security\n💾 **Auto Backups** - Daily',
                inline: false
            }
        )
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • Railway PostgreSQL • Version 2.0' })
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleStats(interaction, serverId) {
    try {
        const stats = await Promise.all([
            pool.query('SELECT COUNT(*) FROM plants WHERE server_id = $1 AND status = $2', [serverId, 'planted']),
            pool.query('SELECT COUNT(*) FROM plants WHERE server_id = $1 AND status = $2', [serverId, 'harvested']),
            pool.query('SELECT COUNT(*) FROM solar_panels WHERE server_id = $1 AND status = $2', [serverId, 'active']),
            pool.query('SELECT COUNT(DISTINCT user_id) FROM activity_logs WHERE server_id = $1', [serverId])
        ]);
        
        const [activePlants, harvestedPlants, activeSolar, activeUsers] = stats.map(result => parseInt(result.rows[0].count));
        
        const embed = new EmbedBuilder()
            .setColor('#9900FF')
            .setTitle('📊 Bot Statistiken')
            .addFields(
                { name: '🌱 Pflanzen', value: `**${activePlants}** aktiv\n**${harvestedPlants}** geerntet`, inline: true },
                { name: '☀️ Solar', value: `**${activeSolar}** aktiv`, inline: true },
                { name: '👥 Aktive User', value: `**${activeUsers}** Spieler`, inline: true },
                { name: '🤖 Bot Info', value: `Uptime: ${Math.floor(process.uptime() / 60)} Min\nRAM: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB\nPing: ${client.ws.ping}ms`, inline: true },
                { name: '🚂 Railway', value: `PostgreSQL ✅\nSSL Verschlüsselt ✅\nAuto-Deploy ✅`, inline: true },
                { name: '📊 Database', value: `Pflanzen: ${activePlants + harvestedPlants}\nSolar: ${activeSolar}\nLogs: Aktiv`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Live Stats' })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Stats Error:', error);
        await interaction.editReply('❌ Fehler beim Abrufen der Statistiken!');
    }
}

// ==========================================
// HEALTH CHECK SERVER
// ==========================================

const app = express();

app.get('/health', async (req, res) => {
    try {
        // Database Health Check
        await pool.query('SELECT NOW()');
        
        res.status(200).json({
            status: 'healthy',
            bot: client.user?.tag || 'Not Ready',
            uptime: process.uptime(),
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            guilds: client.guilds?.cache.size || 0,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

app.get('/', (req, res) => {
    res.json({
        message: '🇷🇺 Russkaya Familie Bot - Railway Deployment',
        status: 'online',
        version: '2.0.0',
        features: ['PostgreSQL', 'Auto Backups', 'Slash Commands', 'Health Monitoring']
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Health Check Server läuft auf Port ${PORT}`);
});

// ==========================================
// BACKUP SYSTEM
// ==========================================

async function createBackup() {
    try {
        console.log('🔄 Erstelle tägliches Backup...');
        
        const timestamp = new Date().toISOString().split('T')[0];
        
        // Hole alle Daten
        const plants = await pool.query('SELECT * FROM plants ORDER BY planted_at DESC');
        const solar = await pool.query('SELECT * FROM solar_panels ORDER BY placed_at DESC');
        const logs = await pool.query('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 1000');
        
        // Erstelle CSV Content
        let csvContent = `RUSSKAYA FAMILIE BOT BACKUP - ${timestamp}\n\n`;
        
        csvContent += `PFLANZEN (${plants.rows.length} Einträge):\n`;
        csvContent += `ID,User,Standort,Status,Gesät,Gedüngt,Geerntet,Auto\n`;
        plants.rows.forEach(p => {
            csvContent += `${p.id},${p.username},${p.location},${p.status},${p.planted_at},${p.fertilized_by || ''},${p.harvested_at || ''},${p.car_stored || ''}\n`;
        });
        
        csvContent += `\nSOLAR PANELS (${solar.rows.length} Einträge):\n`;
        csvContent += `ID,User,Standort,Status,Aufgestellt,Reparaturen,Gesammelt,Auto\n`;
        solar.rows.forEach(s => {
            csvContent += `${s.id},${s.username},${s.location},${s.status},${s.placed_at},${s.repairs_count},${s.collected_at || ''},${s.car_stored || ''}\n`;
        });
        
        csvContent += `\nAKTIVITÄTS LOGS (${logs.rows.length} Einträge):\n`;
        csvContent += `ID,User,Aktion,Typ,Item-ID,Standort,Details,Zeit\n`;
        logs.rows.forEach(l => {
            csvContent += `${l.id},${l.username},${l.action_type},${l.item_type},${l.item_id || ''},${l.location || ''},${l.details || ''},${l.timestamp}\n`;
        });
        
        // Sende Backup in Discord Channel
        if (BACKUP_CHANNEL_ID) {
            const channel = await client.channels.fetch(BACKUP_CHANNEL_ID);
            
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('📂 Tägliches Backup erstellt')
                .addFields(
                    { name: '📊 Pflanzen', value: `${plants.rows.length}`, inline: true },
                    { name: '☀️ Solar', value: `${solar.rows.length}`, inline: true },
                    { name: '📋 Logs', value: `${logs.rows.length}`, inline: true },
                    { name: '📅 Datum', value: timestamp, inline: true },
                    { name: '⚡ Status', value: 'Erfolgreich', inline: true },
                    { name: '🗄️ Database', value: 'PostgreSQL', inline: true }
                )
                .setFooter({ text: 'Russkaya Familie 🇷🇺 • Auto Backup' })
                .setTimestamp();
            
            // Erstelle temporäre Datei
            const fs = require('fs');
            const path = require('path');
            const backupFile = path.join('/tmp', `russkaya_backup_${timestamp}.csv`);
            
            fs.writeFileSync(backupFile, csvContent, 'utf8');
            
            await channel.send({
                embeds: [embed],
                files: [{
                    attachment: backupFile,
                    name: `russkaya_backup_${timestamp}.csv`
                }]
            });
            
            // Datei nach Upload löschen
            fs.unlinkSync(backupFile);
            
            console.log('✅ Backup erfolgreich erstellt und gesendet!');
        }
        
    } catch (error) {
        console.error('❌ Backup Fehler:', error);
        
        if (BACKUP_CHANNEL_ID) {
            try {
                const channel = await client.channels.fetch(BACKUP_CHANNEL_ID);
                await channel.send(`❌ **Backup fehlgeschlagen!**\nFehler: ${error.message}\nZeit: ${new Date().toLocaleString('de-DE')}`);
            } catch (e) {
                console.error('Backup notification failed:', e);
            }
        }
    }
}

// Tägliches Backup um 2 Uhr UTC
cron.schedule('0 2 * * *', createBackup, {
    scheduled: true,
    timezone: "UTC"
});

console.log('⏰ Tägliches Backup geplant für 2:00 AM UTC');

// ==========================================
// ERROR HANDLING & GRACEFUL SHUTDOWN
// ==========================================

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

async function gracefulShutdown() {
    console.log('🛑 Graceful shutdown initiiert...');
    
    if (client.user) {
        client.user.setStatus('invisible');
    }
    
    client.destroy();
    
    if (pool) {
        await pool.end();
        console.log('📊 PostgreSQL Verbindung geschlossen');
    }
    
    console.log('✅ Shutdown abgeschlossen');
    process.exit(0);
}

// ==========================================
// BOT LOGIN
// ==========================================

if (!BOT_TOKEN) {
    console.error('❌ DISCORD_TOKEN Environment Variable fehlt!');
    process.exit(1);
}

client.login(BOT_TOKEN).catch(error => {
    console.error('❌ Bot Login Fehler:', error);
    process.exit(1);
});
