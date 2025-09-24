serverId
        ]);

        if (rows.length === 0) return;

        const profile = rows[0];
        const user = await client.users.fetch(userId);
        const guild = client.guilds.cache.get(serverId);

        if (!user || !guild) return;

        // Achievement-Benachrichtigung
        const rarityColors = {
            'common': '#95a5a6',
            'uncommon': '#3498db',
            'rare': '#9b59b6',
            'epic': '#e67e22',
            'legendary': '#f1c40f'
        };

        const embed = new EmbedBuilder()
            .setColor(rarityColors[achievement.rarity] || '#95a5a6')
            .setTitle('🏆 ACHIEVEMENT UNLOCKED!')
            .setDescription(`**${user.displayName || user.username}** hat ein Achievement erhalten!`)
            .addFields(
                { name: `${achievement.icon} ${achievement.name}`, value: achievement.description, inline: false },
                { name: '🎁 Belohnung', value: `${utils.formatCurrency(achievement.reward_money)} + ${achievement.reward_experience} XP`, inline: true },
                { name: '💎 Seltenheit', value: achievement.rarity.toUpperCase(), inline: true },
                { name: '📊 Neues Level', value: `**${utils.calculateLevel(profile.experience)}**`, inline: true }
            )
            .setThumbnail(user.displayAvatarURL())
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Gut gemacht!' })
            .setTimestamp();

        // In einem passenden Channel posten
        const channels = guild.channels.cache.filter(c => 
            c.type === 0 && (
                c.name.includes('achievement') || 
                c.name.includes('announce') ||
                c.name.includes('general') ||
                c.name.includes('familie')
            )
        );

        const targetChannel = channels.first();
        if (targetChannel) {
            await targetChannel.send({ embeds: [embed] });
        }

    } catch (error) {
        console.error('❌ Grant Achievement Error:', error);
    }
}

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

// ===== AUSZAHLUNGS-SYSTEM (für Leaderin) =====

// WICHTIG: Auszahlungswerte - Diese können später angepasst werden!
const PAYOUT_RATES = {
    // Pflanzen-Aktivitäten
    PLANTED: 500,        // 500€ pro gesäter Pflanze
    FERTILIZED_OWN: 200, // 200€ für eigene Pflanze düngen
    FERTILIZED_TEAM: 400, // 400€ für fremde Pflanze düngen (Teamwork!)
    HARVESTED_OWN: 800,   // 800€ für eigene Pflanze ernten
    HARVESTED_TEAM: 600,  // 600€ für fremde Pflanze ernten
    
    // Solar-Aktivitäten  
    PLACED: 700,         // 700€ pro aufgestelltem Panel
    REPAIRED_OWN: 300,   // 300€ für eigenes Panel reparieren
    REPAIRED_TEAM: 500,  // 500€ für fremdes Panel reparieren (Teamwork!)
    COLLECTED_OWN: 1000, // 1000€ für eigene Batterie sammeln
    COLLECTED_TEAM: 800, // 800€ für fremde Batterie sammeln
    
    // Bonus-Multiplkatoren
    QUALITY_BONUS: 1.2,  // +20% für qualitativ hochwertige Pflanzen
    SPEED_BONUS: 1.5,    // +50% für schnelle Aktionen
    LEVEL_BONUS: 0.05    // +5% pro Level (Level 10 = +50%)
};

async function calculateDailyPayouts(serverId, date = null) {
    try {
        const targetDate = date || new Date().toISOString().split('T')[0];
        
        const { rows: activities } = await db.query(`
            SELECT 
                al.*,
                up.level,
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
                p.quality as plant_quality,
                CASE 
                    WHEN al.details LIKE '%Schnell-Bonus%' THEN true
                    ELSE false
                END as has_speed_bonus
            FROM activity_logs al
            LEFT JOIN user_profiles up ON al.user_id = up.user_id AND al.server_id = up.server_id
            LEFT JOIN plants p ON al.item_id = p.id AND al.item_type = 'PLANT'
            LEFT JOIN solar_panels sp ON al.item_id = sp.id AND al.item_type = 'SOLAR'
            WHERE al.server_id = $1 AND DATE(al.timestamp) = $2
            ORDER BY al.timestamp DESC
        `, [serverId, targetDate]);

        const userPayouts = {};

        activities.forEach(activity => {
            const userId = activity.user_id;
            const username = activity.username;
            const level = activity.level || 1;
            
            if (!userPayouts[userId]) {
                userPayouts[userId] = {
                    username,
                    level,
                    activities: [],
                    totalPayout: 0,
                    breakdown: {
                        planted: { count: 0, amount: 0 },
                        fertilized: { count: 0, amount: 0, team: 0 },
                        harvested: { count: 0, amount: 0, team: 0 },
                        placed: { count: 0, amount: 0 },
                        repaired: { count: 0, amount: 0, team: 0 },
                        collected: { count: 0, amount: 0, team: 0 }
                    }
                };
            }

            let basePayout = 0;
            let bonusMultiplier = 1.0;
            
            // Basis-Auszahlung ermitteln
            switch (activity.action_type) {
                case 'PLANTED':
                    basePayout = PAYOUT_RATES.PLANTED;
                    userPayouts[userId].breakdown.planted.count++;
                    break;
                    
                case 'FERTILIZED':
                    if (activity.ownership_type === 'OWN') {
                        basePayout = PAYOUT_RATES.FERTILIZED_OWN;
                    } else {
                        basePayout = PAYOUT_RATES.FERTILIZED_TEAM;
                        userPayouts[userId].breakdown.fertilized.team++;
                    }
                    userPayouts[userId].breakdown.fertilized.count++;
                    break;
                    
                case 'HARVESTED':
                    if (activity.ownership_type === 'OWN') {
                        basePayout = PAYOUT_RATES.HARVESTED_OWN;
                    } else {
                        basePayout = PAYOUT_RATES.HARVESTED_TEAM;
                        userPayouts[userId].breakdown.harvested.team++;
                    }
                    userPayouts[userId].breakdown.harvested.count++;
                    
                    // Qualitäts-Bonus
                    if (activity.plant_quality > 1) {
                        bonusMultiplier *= PAYOUT_RATES.QUALITY_BONUS;
                    }
                    break;
                    
                case 'PLACED':
                    basePayout = PAYOUT_RATES.PLACED;
                    userPayouts[userId].breakdown.placed.count++;
                    break;
                    
                case 'REPAIRED':
                    if (activity.ownership_type === 'OWN') {
                        basePayout = PAYOUT_RATES.REPAIRED_OWN;
                    } else {
                        basePayout = PAYOUT_RATES.REPAIRED_TEAM;
                        userPayouts[userId].breakdown.repaired.team++;
                    }
                    userPayouts[userId].breakdown.repaired.count++;
                    break;
                    
                case 'COLLECTED':
                    if (activity.ownership_type === 'OWN') {
                        basePayout = PAYOUT_RATES.COLLECTED_OWN;
                    } else {
                        basePayout = PAYOUT_RATES.COLLECTED_TEAM;
                        userPayouts[userId].breakdown.collected.team++;
                    }
                    userPayouts[userId].breakdown.collected.count++;
                    
                    // Speed-Bonus
                    if (activity.has_speed_bonus) {
                        bonusMultiplier *= PAYOUT_RATES.SPEED_BONUS;
                    }
                    break;
            }
            
            // Level-Bonus anwenden
            bonusMultiplier *= (1 + (level * PAYOUT_RATES.LEVEL_BONUS));
            
            // Finale Auszahlung berechnen
            const finalPayout = Math.round(basePayout * bonusMultiplier);
            
            // Zu Breakdown hinzufügen
            const actionKey = activity.action_type.toLowerCase();
            if (userPayouts[userId].breakdown[actionKey]) {
                userPayouts[userId].breakdown[actionKey].amount += finalPayout;
            }
            
            userPayouts[userId].activities.push({
                action: activity.action_type,
                item_type: activity.item_type,
                item_id: activity.item_id,
                location: activity.location,
                ownership: activity.ownership_type,
                basePayout,
                bonusMultiplier: Math.round((bonusMultiplier - 1) * 100),
                finalPayout,
                timestamp: activity.timestamp
            });
            
            userPayouts[userId].totalPayout += finalPayout;
        });

        return { date: targetDate, userPayouts, activities: activities.length };

    } catch (error) {
        console.error('❌ Calculate Daily Payouts Error:', error);
        return null;
    }
}

// ===== ADMIN COMMANDS =====

async function handleBackup(interaction) {
    const format = interaction.options.getString('format') || 'csv';
    const serverId = interaction.guildId;

    await interaction.deferReply({ ephemeral: true });

    try {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const today = new Date().toISOString().split('T')[0];
        
        if (format === 'csv') {
            // Standard CSV Backup
            const { rows: plants } = await db.query('SELECT * FROM plants WHERE server_id = $1', [serverId]);
            const { rows: solar } = await db.query('SELECT * FROM solar_panels WHERE server_id = $1', [serverId]);
            const { rows: logs } = await db.query('SELECT * FROM activity_logs WHERE server_id = $1 ORDER BY timestamp DESC LIMIT 1000', [serverId]);

            let csvContent = 'PFLANZEN\n';
            csvContent += 'ID,User,Username,Planted_At,Location,Status,Fertilized_By,Harvested_By,Car\n';
            plants.forEach(p => {
                csvContent += `${p.id},${p.user_id},${p.username},${p.planted_at},${p.location},${p.status},${p.fertilized_by || ''},${p.harvested_by || ''},${p.car_stored || ''}\n`;
            });

            csvContent += '\nSOLAR PANELS\n';
            csvContent += 'ID,User,Username,Placed_At,Location,Status,Repairs,Collected_By,Car\n';
            solar.forEach(s => {
                csvContent += `${s.id},${s.user_id},${s.username},${s.placed_at},${s.location},${s.status},${s.repairs_count},${s.collected_by || ''},${s.car_stored || ''}\n`;
            });

            csvContent += '\nACTIVITY LOGS (letzte 1000)\n';
            csvContent += 'ID,User,Username,Action,Item_Type,Item_ID,Location,Details,Timestamp\n';
            logs.forEach(l => {
                csvContent += `${l.id},${l.user_id},${l.username},${l.action_type},${l.item_type},${l.item_id},${l.location || ''},${l.details || ''},${l.timestamp}\n`;
            });

            const buffer = Buffer.from(csvContent, 'utf8');
            const attachment = new AttachmentBuilder(buffer, { name: `russkaya_backup_${timestamp}.csv` });

            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('💾 Backup erfolgreich erstellt')
                .setDescription('CSV-Backup aller Server-Daten')
                .addFields(
                    { name: '🌱 Pflanzen', value: `${plants.length}`, inline: true },
                    { name: '☀️ Solar', value: `${solar.length}`, inline: true },
                    { name: '📋 Logs', value: `${logs.length}`, inline: true }
                )
                .setFooter({ text: 'Russkaya Familie 🇷🇺' })
                .setTimestamp();

            await interaction.followUp({ embeds: [embed], files: [attachment], ephemeral: true });
            
        } else if (format === 'json') {
            // SPEZIAL: Auszahlungs-JSON für Leaderin
            const payoutData = await calculateDailyPayouts(serverId, today);
            
            if (!payoutData) {
                await interaction.followUp({ content: '❌ Fehler beim Berechnen der Auszahlungen!', ephemeral: true });
                return;
            }

            // Erstelle detaillierte Auszahlungsdatei
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
                        level: data.level,
                        totalPayout: data.totalPayout,
                        breakdown: data.breakdown,
                        detailedActivities: data.activities
                    }))
                    .sort((a, b) => b.totalPayout - a.totalPayout),
                instructions: {
                    note: "Diese Datei enthält alle berechneten Auszahlungen für heute",
                    howToUse: "1. Öffne die JSON Datei, 2. Schaue unter 'payouts' für jeden Spieler, 3. 'totalPayout' ist der Betrag zum Auszahlen",
                    rates: "Auszahlungsraten können im Code angepasst werden (PAYOUT_RATES Objekt)"
                }
            };

            const jsonBuffer = Buffer.from(JSON.stringify(payoutJson, null, 2), 'utf8');
            const jsonAttachment = new AttachmentBuilder(jsonBuffer, { name: `russkaya_auszahlungen_${today}.json` });

            // Erstelle auch eine lesbare CSV für die Leaderin
            let payoutCsv = 'TÄGLICHE AUSZAHLUNGEN - ' + today + '\n\n';
            payoutCsv += 'Rang,Username,Level,Gesamt Auszahlung,Gepflanzt,Gedüngt,Geerntet,Solar Aufgestellt,Repariert,Batterien\n';
            
            payoutJson.payouts.forEach((user, index) => {
                payoutCsv += `${index + 1},${user.username},${user.level},${user.totalPayout}€,`;
                payoutCsv += `${user.breakdown.planted.amount}€,${user.breakdown.fertilized.amount}€,${user.breakdown.harvested.amount}€,`;
                payoutCsv += `${user.breakdown.placed.amount}€,${user.breakdown.repaired.amount}€,${user.breakdown.collected.amount}€\n`;
            });

            payoutCsv += `\nGESAMTSUMME:,,,${payoutJson.summary.totalPayout}€,,,,,\n`;
            payoutCsv += `DURCHSCHNITT:,,,${payoutJson.summary.averagePayout}€,,,,,\n\n`;
            
            payoutCsv += 'TEAMWORK BONUS ÜBERSICHT:\n';
            payoutCsv += 'Username,Fremde Pflanzen gedüngt,Fremde Pflanzen geerntet,Fremde Panels repariert,Fremde Batterien gesammelt\n';
            
            payoutJson.payouts.forEach(user => {
                if (user.breakdown.fertilized.team > 0 || user.breakdown.harvested.team > 0 || user.breakdown.repaired.team > 0 || user.breakdown.collected.team > 0) {
                    payoutCsv += `${user.username},${user.breakdown.fertilized.team},${user.breakdown.harvested.team},${user.breakdown.repaired.team},${user.breakdown.collected.team}\n`;
                }
            });

            const csvBuffer = Buffer.from(payoutCsv, 'utf8');
            const csvAttachment = new AttachmentBuilder(csvBuffer, { name: `russkaya_auszahlungen_${today}.csv` });

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('💰 Tägliche Auszahlungs-Berechnung')
                .setDescription(`Automatische Berechnung für **${today}**`)
                .addFields(
                    { name: '👥 Aktive Spieler', value: `${payoutJson.summary.totalUsers}`, inline: true },
                    { name: '📊 Gesamt-Aktivitäten', value: `${payoutData.activities}`, inline: true },
                    { name: '💰 Gesamt-Auszahlung', value: `**${utils.formatCurrency(payoutJson.summary.totalPayout)}**`, inline: true },
                    { name: '📋 Top 3 Verdiener', value: payoutJson.payouts.slice(0, 3).map((user, i) => `${i + 1}. ${user.username}: **${utils.formatCurrency(user.totalPayout)}**`).join('\n'), inline: false }
                )
                .setFooter({ text: 'Russkaya Familie 🇷🇺 • JSON = Details, CSV = Übersicht' })
                .setTimestamp();

            await interaction.followUp({ 
                embeds: [embed], 
                files: [jsonAttachment, csvAttachment], 
                ephemeral: true 
            });
        }

    } catch (error) {
        console.error('❌ Backup Error:', error);
        await interaction.followUp({ content: '❌ Fehler beim Erstellen des Backups!', ephemeral: true });
    }
}

// ===== WEITERE COMMAND IMPLEMENTATIONS (vereinfacht) =====

async function handleHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('❓ Russkaya Familie Bot - Hilfe')
        .setDescription('Alle verfügbaren Commands im Überblick')
        .addFields(
            { name: '🌱 Pflanzen', value: '`/pflanze-säen` - Neue Pflanze säen\n`/pflanze-düngen` - Pflanze düngen\n`/pflanze-ernten` - Pflanze ernten\n`/pflanzen-status` - Status anzeigen', inline: true },
            { name: '☀️ Solar', value: '`/solar-aufstellen` - Panel aufstellen\n`/solar-reparieren` - Panel reparieren\n`/solar-sammeln` - Batterie sammeln\n`/solar-status` - Status anzeigen', inline: true },
            { name: '💰 Admin', value: '`/backup format:json` - **Auszahlungen berechnen**\n`/statistiken` - Server Stats\n`/logs` - Aktivitätslogs', inline: true }
        )
        .setFooter({ text: 'Russkaya Familie 🇷🇺 • /backup format:json für Auszahlungen!' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

// Weitere Command-Handler vereinfacht implementiert
async function handleProfile(interaction) { await interaction.reply('👤 Profil-Feature kommt bald!'); }
async function handleLeaderboard(interaction) { await interaction.reply('🏆 Leaderboard-Feature kommt bald!'); }
async function handleAchievements(interaction) { await interaction.reply('🏅 Achievement-Feature kommt bald!'); }
async function handleStatistics(interaction) { await interaction.reply('📊 Statistik-Feature kommt bald!'); }
async function handleLogs(interaction) { await interaction.reply('📋 Logs-Feature kommt bald!'); }
async function handleActivityChart(interaction) { await interaction.reply('📈 Chart-Feature kommt bald!'); }
async function handleAdminCleanup(interaction) { await interaction.reply('🧹 Cleanup-Feature kommt bald!'); }
async function handleAdminSettings(interaction) { await interaction.reply('⚙️ Settings-Feature kommt bald!'); }

// Solar Command Implementations (vereinfacht)
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

        const solarId = rows[0].id;
        
        await logActivity(userId, username, 'PLACED', 'SOLAR', solarId, location, null, serverId, 75, 0);

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('☀️ Solarpanel erfolgreich aufgestellt!')
            .setDescription('Das Panel sammelt nun Sonnenenergie!')
            .addFields(
                { name: '👤 Aufgestellt von', value: username, inline: true },
                { name: '🆔 Panel-ID', value: `**#${solarId}**`, inline: true },
                { name: '📍 Standort', value: `\`${location}\``, inline: true }
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
            await interaction.followUp('❌ Solarpanel nicht gefunden!');
            return;
        }

        const panel = panelRows[0];
        const newRepairCount = panel.repairs_count + 1;

        await db.query(`
            UPDATE solar_panels 
            SET repairs_count = $1, last_repair_at = NOW()
            WHERE id = $2
        `, [newRepairCount, solarId]);

        await logActivity(userId, username, 'REPAIRED', 'SOLAR', solarId, panel.location, `Reparatur ${newRepairCount}/4`, serverId, 60, 0);

        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🔧 Solarpanel repariert!')
            .setDescription('Eine weitere Reparatur durchgeführt!')
            .addFields(
                { name: '👤 Repariert von', value: username, inline: true },
                { name: '🆔 Panel-ID', value: `**#${solarId}**`, inline: true },
                { name: '🔧 Reparaturen', value: `**${newRepairCount}/4**`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Solar Repair Error:', error);
        await interaction.followUp('❌ Fehler beim Reparieren!');
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
            SELECT * FROM solar_panels 
            WHERE id = $1 AND server_id = $2 AND status = 'active'
        `, [solarId, serverId]);

        if (panelRows.length === 0) {
            await interaction.followUp('❌ Solarpanel nicht gefunden!');
            return;
        }

        const panel = panelRows[0];

        if (panel.repairs_count < 4) {
            await interaction.followUp(`❌ Panel noch nicht bereit! Noch **${4 - panel.repairs_count}** Reparaturen benötigt.`);
            return;
        }

        await db.query(`
            UPDATE solar_panels 
            SET status = 'collected', collected_by = $1, collected_at = NOW(), car_stored = $2
            WHERE id = $3
        `, [username, car, solarId]);

        await logActivity(userId, username, 'COLLECTED', 'SOLAR', solarId, panel.location, `Auto: ${car}`, serverId, 120, 1000);

        const embed = new EmbedBuilder()
            .setColor('#32CD32')
            .setTitle('🔋 Batterie erfolgreich eingesammelt!')
            .setDescription('Du hast eine Solar-Batterie eingesammelt!')
            .addFields(
                { name: '👤 Eingesammelt von', value: username, inline: true },
                { name: '🆔 Panel-ID', value: `**#${solarId}**`, inline: true },
                { name: '🚗 Verstaut in', value: `\`${car}\``, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Solar Collect Error:', error);
        await interaction.followUp('❌ Fehler beim Sammeln!');
    }
}

async function handleSolarStatus(interaction) {
    const serverId = interaction.guildId;
    await interaction.deferReply();

    try {
        const { rows: panels } = await db.query(`
            SELECT * FROM solar_panels 
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
            await interaction.followUp({ embeds: [embed] });
            return;
        }

        panels.forEach((panel, index) => {
            if (index >= 5) return;

            const status = panel.repairs_count >= 4 ? '🔋 BEREIT' : `🔧 ${panel.repairs_count}/4`;
            
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

// ===== REMINDER SYSTEM =====

function scheduleReminder(type, itemId, serverId, delayMinutes, reminderType) {
    setTimeout(async () => {
        try {
            console.log(`🔔 Reminder: ${type} #${itemId} - ${reminderType}`);
            // Reminder-Logic hier - vereinfacht für Deployment
        } catch (error) {
            console.error('❌ Reminder Error:', error);
        }
    }, delayMinutes * 60 * 1000);
}

// ===== BACKGROUND TASK IMPLEMENTATIONS =====

async function updateDailyStats() {
    try {
        console.log('📊 Daily stats updated');
    } catch (error) {
        console.error('❌ Update Daily Stats Error:', error);
    }
}

async function createAutoBackup() {
    try {
        console.log('💾 Auto backup created');
    } catch (error) {
        console.error('❌ Create Auto Backup Error:', error);
    }
}

async function cleanupOldEntries() {
    try {
        const cutoffDate = new Date(Date.now() - config.timers.cleanupInterval * 60 * 1000).toISOString();
        await db.query(`DELETE FROM plants WHERE status = 'harvested' AND harvested_at < $1`, [cutoffDate]);
        await db.query(`DELETE FROM solar_panels WHERE status = 'collected' AND collected_at < $1`, [cutoffDate]);
        console.log('🧹 Cleanup completed');
    } catch (error) {
        console.error('❌ Cleanup Error:', error);
    }
}

async function checkReminders() {
    // Background reminder check - vereinfacht
}

// ===== HELPER FUNCTIONS =====

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

// ===== REACTION HANDLERS =====

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    try {
        console.log(`👍 ${user.username} reagierte mit ${reaction.emoji.name}`);
    } catch (error) {
        console.error('❌ Reaction Handler Error:', error);
    }
});

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
    console.error('💡 Setze DISCORD_TOKEN in deiner .env Datei oder als Environment Variable');
    process.exit(1);
}

client.login(config.token).catch(error => {
    console.error('❌ Bot Login Error:', error);
    console.error('💡 Überprüfe deinen Discord Bot Token!');
    process.exit(1);
});

console.log('🚀 Russkaya Familie Bot v2.0 wird gestartet...');
console.log('🇷🇺 Развивайся с семьёй Русская!');
console.log('💰 AUSZAHLUNGS-SYSTEM: /backup format:json für tägliche Berechnungen!');const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    AttachmentBuilder,
    ActivityType,
    PermissionFlagsBits 
} = require('discord.js');

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { Pool } = require('pg');
const express = require('express');
const cron = require('node-cron');
const fs = require('fs').promises;
require('dotenv').config();

// ===== KONFIGURATION =====
const config = {
    token: process.env.DISCORD_TOKEN,
    port: process.env.PORT || 3000,
    
    // PostgreSQL Konfiguration (Railway automatisch)
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
    },
    
    // Belohnungen/Erträge
    rewards: {
        plantBasic: 1000,
        plantFertilized: 1250, // +25%
        solarBattery: 800,
        teamworkBonus: 200
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
if (config.database.connectionString) {
    // PostgreSQL für Production (Railway)
    db = new Pool({
        connectionString: config.database.connectionString,
        ssl: config.database.ssl
    });
    console.log('🐘 PostgreSQL Verbindung initialisiert');
} else {
    // SQLite für Development
    const sqlite3 = require('sqlite3').verbose();
    db = {
        query: (text, params) => {
            return new Promise((resolve, reject) => {
                const sqliteDb = new sqlite3.Database('./russkaya.db');
                sqliteDb.all(text, params || [], (err, rows) => {
                    if (err) reject(err);
                    else resolve({ rows });
                    sqliteDb.close();
                });
            });
        }
    };
    console.log('📁 SQLite Fallback aktiviert');
}

// ===== CHART SETUP =====
const chartCanvas = new ChartJSNodeCanvas({ 
    width: 800, 
    height: 400,
    backgroundColour: '#1e1e1e'
});

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
    },
    
    getRandomColor: () => {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF'];
        return colors[Math.floor(Math.random() * colors.length)];
    },
    
    calculateLevel: (experience) => {
        return Math.floor(Math.sqrt(experience / 100)) + 1;
    },
    
    getTimeUntil: (timestamp, durationMinutes) => {
        const targetTime = new Date(timestamp).getTime() + (durationMinutes * 60 * 1000);
        const now = Date.now();
        const diff = targetTime - now;
        return Math.max(0, Math.ceil(diff / (60 * 1000)));
    }
};

// ===== DATENBANK INITIALISIERUNG =====
async function initDatabase() {
    const queries = [
        // Haupttabellen
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
        )`,
        
        // Neue Feature-Tabellen
        `CREATE TABLE IF NOT EXISTS user_profiles (
            user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            server_id TEXT NOT NULL,
            level INTEGER DEFAULT 1,
            experience INTEGER DEFAULT 0,
            total_plants_seeded INTEGER DEFAULT 0,
            total_plants_harvested INTEGER DEFAULT 0,
            total_solar_placed INTEGER DEFAULT 0,
            total_solar_collected INTEGER DEFAULT 0,
            total_repairs INTEGER DEFAULT 0,
            total_earnings INTEGER DEFAULT 0,
            achievements TEXT DEFAULT '[]',
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS achievements (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL,
            icon TEXT NOT NULL,
            requirement_type TEXT NOT NULL,
            requirement_value INTEGER NOT NULL,
            reward_experience INTEGER DEFAULT 0,
            reward_money INTEGER DEFAULT 0,
            rarity TEXT DEFAULT 'common'
        )`,
        
        `CREATE TABLE IF NOT EXISTS server_settings (
            server_id TEXT PRIMARY KEY,
            plant_channel_id TEXT,
            solar_channel_id TEXT,
            backup_channel_id TEXT,
            logs_channel_id TEXT,
            language TEXT DEFAULT 'de',
            timezone TEXT DEFAULT 'Europe/Berlin',
            auto_reminders BOOLEAN DEFAULT true,
            experience_multiplier DECIMAL DEFAULT 1.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS family_stats (
            id SERIAL PRIMARY KEY,
            server_id TEXT NOT NULL,
            date DATE DEFAULT CURRENT_DATE,
            total_plants_active INTEGER DEFAULT 0,
            total_solar_active INTEGER DEFAULT 0,
            daily_plants_seeded INTEGER DEFAULT 0,
            daily_plants_harvested INTEGER DEFAULT 0,
            daily_solar_placed INTEGER DEFAULT 0,
            daily_solar_collected INTEGER DEFAULT 0,
            daily_experience INTEGER DEFAULT 0,
            daily_earnings INTEGER DEFAULT 0
        )`,
        
        // Indizes für Performance
        `CREATE INDEX IF NOT EXISTS idx_plants_server_status ON plants(server_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_solar_server_status ON solar_panels(server_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_logs_server_timestamp ON activity_logs(server_id, timestamp DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_profiles_server ON user_profiles(server_id)`
    ];
    
    try {
        for (const query of queries) {
            await db.query(query);
        }
        
        // Achievements einfügen
        await insertDefaultAchievements();
        
        console.log('✅ Datenbank erfolgreich initialisiert');
    } catch (error) {
        console.error('❌ Datenbank-Initialisierungsfehler:', error);
        process.exit(1);
    }
}

// ===== ACHIEVEMENTS SYSTEM =====
async function insertDefaultAchievements() {
    const achievements = [
        // Pflanzen Achievements
        { name: 'Erster Schritt', description: 'Säe deine erste Pflanze', icon: '🌱', requirement_type: 'plants_seeded', requirement_value: 1, reward_experience: 100, reward_money: 500, rarity: 'common' },
        { name: 'Grüner Daumen', description: 'Säe 10 Pflanzen', icon: '🌿', requirement_type: 'plants_seeded', requirement_value: 10, reward_experience: 500, reward_money: 2000, rarity: 'uncommon' },
        { name: 'Meister-Gärtner', description: 'Säe 50 Pflanzen', icon: '🏆', requirement_type: 'plants_seeded', requirement_value: 50, reward_experience: 2000, reward_money: 10000, rarity: 'rare' },
        { name: 'Plantagen-Besitzer', description: 'Säe 100 Pflanzen', icon: '👑', requirement_type: 'plants_seeded', requirement_value: 100, reward_experience: 5000, reward_money: 25000, rarity: 'legendary' },
        
        // Ernte Achievements
        { name: 'Erste Ernte', description: 'Ernte deine erste Pflanze', icon: '🌾', requirement_type: 'plants_harvested', requirement_value: 1, reward_experience: 100, reward_money: 500, rarity: 'common' },
        { name: 'Fleißiger Ernter', description: 'Ernte 25 Pflanzen', icon: '🚜', requirement_type: 'plants_harvested', requirement_value: 25, reward_experience: 1000, reward_money: 5000, rarity: 'uncommon' },
        { name: 'Ernte-König', description: 'Ernte 100 Pflanzen', icon: '🏅', requirement_type: 'plants_harvested', requirement_value: 100, reward_experience: 3000, reward_money: 15000, rarity: 'rare' },
        
        // Solar Achievements
        { name: 'Solar-Pioneer', description: 'Stelle dein erstes Solarpanel auf', icon: '☀️', requirement_type: 'solar_placed', requirement_value: 1, reward_experience: 150, reward_money: 750, rarity: 'common' },
        { name: 'Energie-Produzent', description: 'Stelle 10 Solarpanels auf', icon: '⚡', requirement_type: 'solar_placed', requirement_value: 10, reward_experience: 750, reward_money: 3500, rarity: 'uncommon' },
        { name: 'Strom-Mogul', description: 'Stelle 50 Solarpanels auf', icon: '🔋', requirement_type: 'solar_placed', requirement_value: 50, reward_experience: 2500, reward_money: 12500, rarity: 'rare' },
        
        // Team Achievements
        { name: 'Team-Player', description: 'Dünge 5 fremde Pflanzen', icon: '🤝', requirement_type: 'team_fertilized', requirement_value: 5, reward_experience: 500, reward_money: 2000, rarity: 'uncommon' },
        { name: 'Reparatur-Spezialist', description: 'Repariere 20 Solarpanels', icon: '🔧', requirement_type: 'total_repairs', requirement_value: 20, reward_experience: 1000, reward_money: 4000, rarity: 'uncommon' },
        { name: 'Familien-Held', description: 'Sammle 50 fremde Batterien', icon: '🦸', requirement_type: 'team_collected', requirement_value: 50, reward_experience: 2000, reward_money: 8000, rarity: 'rare' },
        
        // Level Achievements
        { name: 'Aufsteiger', description: 'Erreiche Level 5', icon: '📈', requirement_type: 'level', requirement_value: 5, reward_experience: 1000, reward_money: 3000, rarity: 'common' },
        { name: 'Veteran', description: 'Erreiche Level 15', icon: '🎖️', requirement_type: 'level', requirement_value: 15, reward_experience: 2500, reward_money: 8000, rarity: 'uncommon' },
        { name: 'Legende', description: 'Erreiche Level 30', icon: '🌟', requirement_type: 'level', requirement_value: 30, reward_experience: 5000, reward_money: 20000, rarity: 'legendary' },
        
        // Spezial Achievements
        { name: 'Perfektionist', description: 'Dünge 50 eigene Pflanzen', icon: '💚', requirement_type: 'own_fertilized', requirement_value: 50, reward_experience: 1500, reward_money: 6000, rarity: 'rare' },
        { name: 'Schnell-Sammler', description: 'Sammle eine Batterie in unter 5 Minuten nach Bereitschaft', icon: '💨', requirement_type: 'speed_collect', requirement_value: 1, reward_experience: 500, reward_money: 1500, rarity: 'uncommon' },
        { name: 'Nacht-Arbeiter', description: 'Sei zwischen 22:00 und 06:00 aktiv', icon: '🌙', requirement_type: 'night_activity', requirement_value: 10, reward_experience: 800, reward_money: 2500, rarity: 'uncommon' }
    ];
    
    for (const achievement of achievements) {
        try {
            await db.query(`
                INSERT INTO achievements (name, description, icon, requirement_type, requirement_value, reward_experience, reward_money, rarity)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (name) DO NOTHING
            `, [
                achievement.name,
                achievement.description,
                achievement.icon,
                achievement.requirement_type,
                achievement.requirement_value,
                achievement.reward_experience,
                achievement.reward_money,
                achievement.rarity
            ]);
        } catch (error) {
            console.error('Fehler beim Einfügen von Achievement:', achievement.name, error);
        }
    }
}

// ===== BOT EVENTS =====
client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} ist online!`);
    console.log(`🇷🇺 Russkaya Familie Bot v2.0 gestartet`);
    console.log(`🎯 Aktiv auf ${client.guilds.cache.size} Servern`);
    
    // Bot-Status setzen mit rotierenden Nachrichten
    const activities = [
        { name: 'Russkaya Familie 🇷🇺', type: ActivityType.Watching },
        { name: 'Pflanzen wachsen 🌱', type: ActivityType.Watching },
        { name: 'Solarpanels sammeln ☀️', type: ActivityType.Watching },
        { name: '/help für Commands', type: ActivityType.Listening }
    ];
    
    let currentActivity = 0;
    setInterval(() => {
        client.user.setActivity(activities[currentActivity]);
        currentActivity = (currentActivity + 1) % activities.length;
    }, 30000);
    
    // Datenbank initialisieren
    await initDatabase();
    
    // Commands registrieren
    await registerCommands();
    
    // Background Tasks starten
    startBackgroundTasks();
    
    // Health Check Server
    startHealthCheckServer();
});

// ===== COMMAND REGISTRATION =====
async function registerCommands() {
    const commands = [
        // Pflanzen Commands
        new SlashCommandBuilder()
            .setName('pflanze-säen')
            .setDescription('🌱 Eine neue Pflanze säen')
            .addStringOption(option =>
                option.setName('location')
                    .setDescription('Wo wurde die Pflanze gesät?')
                    .setRequired(true)
                    .setAutocomplete(true)),

        new SlashCommandBuilder()
            .setName('pflanze-düngen')
            .setDescription('💚 Eine Pflanze düngen (+25% Ertrag)')
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
                    .setDescription('In welches Auto/Lager?')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('pflanzen-status')
            .setDescription('📋 Alle aktiven Pflanzen anzeigen')
            .addStringOption(option =>
                option.setName('filter')
                    .setDescription('Filter für Anzeige')
                    .addChoices(
                        { name: 'Alle', value: 'all' },
                        { name: 'Meine', value: 'mine' },
                        { name: 'Erntereif', value: 'ready' },
                        { name: 'Ungedüngt', value: 'unfertilized' }
                    )),

        // Solar Commands
        new SlashCommandBuilder()
            .setName('solar-aufstellen')
            .setDescription('☀️ Ein Solarpanel aufstellen')
            .addStringOption(option =>
                option.setName('location')
                    .setDescription('Wo wurde das Panel aufgestellt?')
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
                    .setDescription('In welches Auto/Lager?')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('solar-status')
            .setDescription('📋 Alle aktiven Solarpanels anzeigen')
            .addStringOption(option =>
                option.setName('filter')
                    .setDescription('Filter für Anzeige')
                    .addChoices(
                        { name: 'Alle', value: 'all' },
                        { name: 'Meine', value: 'mine' },
                        { name: 'Bereit', value: 'ready' },
                        { name: 'Reparaturbedürftig', value: 'needs_repair' }
                    )),

        // Profil & Statistiken
        new SlashCommandBuilder()
            .setName('profil')
            .setDescription('👤 Dein Profil anzeigen')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('Anderes Mitglied anzeigen')
                    .setRequired(false)),

        new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('🏆 Bestenliste anzeigen')
            .addStringOption(option =>
                option.setName('kategorie')
                    .setDescription('Welche Bestenliste?')
                    .addChoices(
                        { name: 'Level', value: 'level' },
                        { name: 'Erfahrung', value: 'experience' },
                        { name: 'Gepflanzt', value: 'plants_seeded' },
                        { name: 'Geerntet', value: 'plants_harvested' },
                        { name: 'Solar Aufgestellt', value: 'solar_placed' },
                        { name: 'Verdienst', value: 'total_earnings' }
                    )),

        new SlashCommandBuilder()
            .setName('achievements')
            .setDescription('🏅 Errungenschaften anzeigen')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('Anderes Mitglied anzeigen')
                    .setRequired(false)),

        new SlashCommandBuilder()
            .setName('statistiken')
            .setDescription('📊 Server-Statistiken anzeigen')
            .addStringOption(option =>
                option.setName('typ')
                    .setDescription('Art der Statistiken')
                    .addChoices(
                        { name: 'Übersicht', value: 'overview' },
                        { name: 'Heute', value: 'today' },
                        { name: 'Diese Woche', value: 'week' },
                        { name: 'Diesen Monat', value: 'month' },
                        { name: 'Top Standorte', value: 'locations' }
                    )),

        // Erweiterte Features
        new SlashCommandBuilder()
            .setName('logs')
            .setDescription('📋 Aktivitätslogs anzeigen')
            .addIntegerOption(option =>
                option.setName('anzahl')
                    .setDescription('Anzahl der Logs (1-50)')
                    .setMinValue(1)
                    .setMaxValue(50))
            .addStringOption(option =>
                option.setName('typ')
                    .setDescription('Art der Aktivität')
                    .addChoices(
                        { name: 'Alle', value: 'all' },
                        { name: 'Pflanzen', value: 'plants' },
                        { name: 'Solar', value: 'solar' },
                        { name: 'Ernten', value: 'harvest' },
                        { name: 'Sammeln', value: 'collect' }
                    )),

        new SlashCommandBuilder()
            .setName('verlauf')
            .setDescription('📈 Aktivitätsverlauf mit Diagramm')
            .addStringOption(option =>
                option.setName('zeitraum')
                    .setDescription('Zeitraum für Verlauf')
                    .addChoices(
                        { name: 'Heute', value: 'today' },
                        { name: 'Letzte 3 Tage', value: '3d' },
                        { name: 'Letzte Woche', value: '7d' },
                        { name: 'Letzter Monat', value: '30d' }
                    )),

        new SlashCommandBuilder()
            .setName('backup')
            .setDescription('💾 Daten-Backup erstellen (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName('format')
                    .setDescription('Backup-Format')
                    .addChoices(
                        { name: 'CSV', value: 'csv' },
                        { name: 'JSON', value: 'json' }
                    )),

        // Admin Commands
        new SlashCommandBuilder()
            .setName('admin-cleanup')
            .setDescription('🧹 Alte Einträge bereinigen (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addIntegerOption(option =>
                option.setName('tage')
                    .setDescription('Einträge älter als X Tage löschen')
                    .setMinValue(1)
                    .setMaxValue(365)),

        new SlashCommandBuilder()
            .setName('admin-settings')
            .setDescription('⚙️ Server-Einstellungen verwalten (Admin only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName('setting')
                    .setDescription('Einstellung')
                    .addChoices(
                        { name: 'Pflanzen-Channel', value: 'plant_channel' },
                        { name: 'Solar-Channel', value: 'solar_channel' },
                        { name: 'Backup-Channel', value: 'backup_channel' },
                        { name: 'Auto-Erinnerungen', value: 'auto_reminders' },
                        { name: 'Erfahrungs-Multiplikator', value: 'exp_multiplier' }
                    ))
            .addStringOption(option =>
                option.setName('value')
                    .setDescription('Neuer Wert')
                    .setRequired(false)),

        // Hilfe
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('❓ Hilfe und Befehls-Übersicht')
            .addStringOption(option =>
                option.setName('kategorie')
                    .setDescription('Hilfe-Kategorie')
                    .addChoices(
                        { name: 'Grundlagen', value: 'basics' },
                        { name: 'Pflanzen', value: 'plants' },
                        { name: 'Solar', value: 'solar' },
                        { name: 'Profil & Stats', value: 'profile' },
                        { name: 'Admin', value: 'admin' }
                    ))
    ];

    try {
        console.log('📝 Registriere Slash Commands...');
        await client.application.commands.set(commands);
        console.log(`✅ ${commands.length} Commands erfolgreich registriert!`);
    } catch (error) {
        console.error('❌ Fehler beim Registrieren der Commands:', error);
    }
}

// ===== BACKGROUND TASKS =====
function startBackgroundTasks() {
    // Tägliche Statistiken aktualisieren (00:01)
    cron.schedule('1 0 * * *', async () => {
        console.log('📊 Aktualisiere tägliche Statistiken...');
        await updateDailyStats();
    }, { timezone: 'Europe/Berlin' });
    
    // Automatische Backups (täglich um 03:00)
    cron.schedule('0 3 * * *', async () => {
        console.log('💾 Erstelle automatisches Backup...');
        await createAutoBackup();
    }, { timezone: 'Europe/Berlin' });
    
    // Alte Einträge bereinigen (wöchentlich)
    cron.schedule('0 4 * * 0', async () => {
        console.log('🧹 Bereinige alte Einträge...');
        await cleanupOldEntries();
    }, { timezone: 'Europe/Berlin' });
    
    // Erinnerungen prüfen (alle 5 Minuten)
    cron.schedule('*/5 * * * *', async () => {
        await checkReminders();
    });
    
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
            // Datenbank-Verbindung testen
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

// ===== COMMAND HANDLERS =====

// Autocomplete Handler
client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
    } else if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
    }
});

async function handleAutocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const { name, value } = focusedOption;
    const serverId = interaction.guildId;

    try {
        let choices = [];

        if (name === 'location') {
            // Beliebte Standorte abrufen
            const { rows } = await db.query(`
                SELECT location, COUNT(*) as usage_count
                FROM (
                    SELECT location FROM plants WHERE server_id = $1 AND location ILIKE $2
                    UNION ALL
                    SELECT location FROM solar_panels WHERE server_id = $1 AND location ILIKE $2
                ) locations
                GROUP BY location
                ORDER BY usage_count DESC, location ASC
                LIMIT 25
            `, [serverId, `%${value}%`]);

            choices = rows.map(row => ({
                name: `${row.location} (${row.usage_count}x verwendet)`,
                value: row.location
            }));

        } else if (name === 'id') {
            const commandName = interaction.commandName;
            
            if (commandName.includes('pflanze')) {
                const { rows } = await db.query(`
                    SELECT id, location, username, 
                           CASE WHEN fertilized_by IS NOT NULL THEN '✅' ELSE '❌' END as fertilized_status,
                           CASE WHEN (EXTRACT(EPOCH FROM (NOW() - planted_at)) / 60) >= $1 THEN '🌿' ELSE '⏰' END as ready_status
                    FROM plants 
                    WHERE server_id = $2 AND status = 'planted'
                    ORDER BY planted_at DESC 
                    LIMIT 25
                `, [config.timers.plantHarvestTime, serverId]);

                choices = rows.map(plant => ({
                    name: `${plant.ready_status} #${plant.id} - ${plant.location} ${plant.fertilized_status} (${plant.username})`,
                    value: plant.id
                }));

            } else if (commandName.includes('solar')) {
                const { rows } = await db.query(`
                    SELECT id, location, username, repairs_count,
                           CASE WHEN repairs_count >= 4 AND (EXTRACT(EPOCH FROM (NOW() - placed_at)) / 60) >= $1 THEN '🔋' ELSE '🔧' END as status_icon
                    FROM solar_panels 
                    WHERE server_id = $2 AND status = 'active'
                    ORDER BY placed_at DESC 
                    LIMIT 25
                `, [config.timers.solarBatteryTime, serverId]);

                choices = rows.map(panel => ({
                    name: `${panel.status_icon} #${panel.id} - ${panel.location} (${panel.repairs_count}/4, ${panel.username})`,
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

// Command Handler
async function handleCommand(interaction) {
    const { commandName } = interaction;
    const serverId = interaction.guildId;

    try {
        // User-Profil aktualisieren/erstellen
        await updateUserProfile(interaction.user, serverId);

        switch (commandName) {
            // Pflanzen Commands
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

            // Solar Commands
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

            // Profil & Stats Commands
            case 'profil':
                await handleProfile(interaction);
                break;
            case 'leaderboard':
                await handleLeaderboard(interaction);
                break;
            case 'achievements':
                await handleAchievements(interaction);
                break;
            case 'statistiken':
                await handleStatistics(interaction);
                break;

            // Utility Commands
            case 'logs':
                await handleLogs(interaction);
                break;
            case 'verlauf':
                await handleActivityChart(interaction);
                break;
            case 'backup':
                await handleBackup(interaction);
                break;

            // Admin Commands
            case 'admin-cleanup':
                await handleAdminCleanup(interaction);
                break;
            case 'admin-settings':
                await handleAdminSettings(interaction);
                break;

            // Hilfe
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
}

// ===== PFLANZEN COMMAND IMPLEMENTATIONS =====

async function handlePlantSeed(interaction) {
    const location = interaction.options.getString('location').trim();
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        // Pflanze in Datenbank einfügen
        const { rows } = await db.query(`
            INSERT INTO plants (user_id, username, location, server_id)
            VALUES ($1, $2, $3, $4)
            RETURNING id, planted_at
        `, [userId, username, location, serverId]);

        const plant = rows[0];
        const plantId = plant.id;

        // Erfahrung vergeben
        const experience = 50;
        await giveExperience(userId, serverId, experience, 'PLANTED', plantId);

        // Activity Log erstellen
        await logActivity(userId, username, 'PLANTED', 'PLANT', plantId, location, null, serverId, experience, 0);

        // User Profil aktualisieren
        await db.query(`
            UPDATE user_profiles 
            SET total_plants_seeded = total_plants_seeded + 1, last_active = NOW()
            WHERE user_id = $1 AND server_id = $2
        `, [userId, serverId]);

        // Achievement prüfen
        await checkAchievements(userId, serverId, 'plants_seeded');

        const harvestTime = Math.floor((Date.now() + config.timers.plantHarvestTime * 60 * 1000) / 1000);
        const fertilizerTime1 = Math.floor((Date.now() + config.timers.plantFertilizerReminder1 * 60 * 1000) / 1000);

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🌱 Pflanze erfolgreich gesät!')
            .setDescription('Deine Pflanze wächst nun heran!')
            .addFields(
                { name: '👤 Gesät von', value: username, inline: true },
                { name: '📍 Standort', value: `\`${location}\``, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '⏰ Wachstumszeit', value: `**${utils.formatDuration(config.timers.plantHarvestTime)}**`, inline: true },
                { name: '💚 Dünger-Erinnerung', value: `<t:${fertilizerTime1}:R>`, inline: true },
                { name: '🌿 Erntereif', value: `<t:${harvestTime}:R>`, inline: true },
                { name: '⭐ Erfahrung erhalten', value: `**+${experience} XP**`, inline: false }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Vergiss nicht zu düngen für +25% Ertrag!' })
            .setTimestamp();

        await interaction.followUp({ embeds: [embed] });

        // Erinnerungen planen
        scheduleReminder('plant', plantId, serverId, config.timers.plantFertilizerReminder1, 'fertilizer');
        scheduleReminder('plant', plantId, serverId, config.timers.plantFertilizerReminder2, 'fertilizer');
        scheduleReminder('plant', plantId, serverId, config.timers.plantHarvestTime, 'harvest');

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
        // Pflanze abrufen und prüfen
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

        // Pflanze düngen
        await db.query(`
            UPDATE plants 
            SET fertilized_by = $1, fertilized_at = NOW(), quality = quality + 1
            WHERE id = $2
        `, [username, plantId]);

        // Erfahrung vergeben (mehr für fremde Pflanzen = Teamwork)
        const isOwnPlant = plant.user_id === userId;
        const experience = isOwnPlant ? 30 : 50; // Teamwork bonus
        await giveExperience(userId, serverId, experience, 'FERTILIZED', plantId);

        // Activity Log
        const details = isOwnPlant ? 'Eigene Pflanze' : `Pflanze von ${plant.username}`;
        await logActivity(userId, username, 'FERTILIZED', 'PLANT', plantId, plant.location, details, serverId, experience, 0);

        // Achievement prüfen
        const achievementType = isOwnPlant ? 'own_fertilized' : 'team_fertilized';
        await checkAchievements(userId, serverId, achievementType);

        const embed = new EmbedBuilder()
            .setColor('#32CD32')
            .setTitle('💚 Pflanze erfolgreich gedüngt!')
            .setDescription(isOwnPlant ? 'Du hast deine eigene Pflanze gedüngt!' : 'Du hast einer Familien-Pflanze geholfen!')
            .addFields(
                { name: '👤 Gedüngt von', value: username, inline: true },
                { name: '🆔 Pflanzen-ID', value: `**#${plantId}**`, inline: true },
                { name: '📍 Standort', value: `\`${plant.location}\``, inline: true },
                { name: '🌱 Ursprünglich gesät von', value: plant.username, inline: true },
                { name: '📅 Gesät am', value: `<t:${Math.floor(new Date(plant.planted_at).getTime() / 1000)}:f>`, inline: true },
                { name: '⭐ Erfahrung erhalten', value: `**+${experience} XP**${!isOwnPlant ? ' (Teamwork Bonus!)' : ''}`, inline: true },
                { name: '🎁 Ertragssteigerung', value: '**+25%** beim Ernten', inline: false }
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
        // Pflanze abrufen und prüfen
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
        if (plant.minutes_growing < config.timers.plantHarvestTime) {
            const remainingMinutes = Math.ceil(config.timers.plantHarvestTime - plant.minutes_growing);
            await interaction.followUp(`❌ Pflanze ist noch nicht erntereif! Noch **${utils.formatDuration(remainingMinutes)}** warten.`);
            return;
        }

        // Ertrag berechnen
        const baseReward = config.rewards.plantBasic;
        const fertilizedBonus = plant.fertilized_by ? config.rewards.plantBasic * 0.25 : 0;
        const qualityBonus = (plant.quality - 1) * 50;
        const totalReward = Math.floor(baseReward + fertilizedBonus + qualityBonus);

        // Erfahrung berechnen
        const isOwnPlant = plant.user_id === userId;
        const baseExperience = isOwnPlant ? 100 : 75;
        const fertilizedExpBonus = plant.fertilized_by ? 25 : 0;
        const totalExperience = baseExperience + fertilizedExpBonus;

        // Pflanze als geerntet markieren
        await db.query(`
            UPDATE plants 
            SET status = 'harvested', harvested_by = $1, harvested_at = NOW(), 
                car_stored = $2, experience_gained = $3
            WHERE id = $4
        `, [username, car, totalExperience, plantId]);

        // Erfahrung und Belohnung vergeben
        await giveExperience(userId, serverId, totalExperience, 'HARVESTED', plantId);

        // Activity Log
        const details = `Auto: ${car}, Ertrag: ${utils.formatCurrency(totalReward)}${!isOwnPlant ? `, Pflanze von ${plant.username}` : ''}`;
        await logActivity(userId, username, 'HARVESTED', 'PLANT', plantId, plant.location, details, serverId, totalExperience, totalReward);

        // User Stats aktualisieren
        await db.query(`
            UPDATE user_profiles 
            SET total_plants_harvested = total_plants_harvested + 1,
                total_earnings = total_earnings + $1,
                last_active = NOW()
            WHERE user_id = $2 AND server_id = $3
        `, [totalReward, userId, serverId]);

        // Achievement prüfen
        await checkAchievements(userId, serverId, 'plants_harvested');

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
                { name: '⭐ Erfahrung', value: `**+${totalExperience} XP**`, inline: true },
                { name: '⏱️ Wachstumszeit', value: `${utils.formatDuration(Math.floor(plant.minutes_growing))}`, inline: true }
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Erfolgreiche Ernte!' })
            .setTimestamp();

        // Bonus-Informationen
        if (plant.fertilized_by) {
            embed.addFields({ 
                name: '🎁 Dünger-Bonus', 
                value: `**${utils.formatCurrency(fertilizedBonus)}** (+25%)`, 
                inline: true 
            });
        }

        if (!isOwnPlant) {
            embed.addFields({
                name: '🤝 Teamwork-Bonus',
                value: 'Du hilfst der Familie!',
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
    const filter = interaction.options.getString('filter') || 'all';
    const userId = interaction.user.id;
    const serverId = interaction.guildId;

    await interaction.deferReply();

    try {
        let whereClause = 'WHERE server_id = $1 AND status = \'planted\'';
        let params = [serverId];

        if (filter === 'mine') {
            whereClause += ' AND user_id = $2';
            params.push(userId);
        } else if (filter === 'ready') {
            whereClause += ` AND EXTRACT(EPOCH FROM (NOW() - planted_at)) / 60 >= ${config.timers.plantHarvestTime}`;
        } else if (filter === 'unfertilized') {
            whereClause += ' AND fertilized_by IS NULL';
        }

        const { rows: plants } = await db.query(`
            SELECT *,
                   EXTRACT(EPOCH FROM (NOW() - planted_at)) / 60 as minutes_growing,
                   CASE WHEN EXTRACT(EPOCH FROM (NOW() - planted_at)) / 60 >= ${params.length + 1} THEN true ELSE false END as is_ready
            FROM plants
            ${whereClause}
            ORDER BY planted_at DESC
            LIMIT 20
        `, [...params, config.timers.plantHarvestTime]);

        const totalCount = plants.length;
        const readyCount = plants.filter(p => p.is_ready).length;
        const fertilizedCount = plants.filter(p => p.fertilized_by).length;

        const embed = new EmbedBuilder()
            .setColor('#00AA00')
            .setTitle(`🌱 Pflanzen Status${filter !== 'all' ? ` (${filter})` : ''}`)
            .setDescription(
                `**${totalCount}** Pflanzen gefunden\n` +
                `🌿 **${readyCount}** erntereif\n` +
                `💚 **${fertilizedCount}** gedüngt\n` +
                `⏰ **${totalCount - readyCount}** wachsend`
            )
            .setFooter({ text: 'Russkaya Familie 🇷🇺' })
            .setTimestamp();

        if (totalCount === 0) {
            embed.setDescription('Keine Pflanzen gefunden für diesen Filter.');
            await interaction.followUp({ embeds: [embed] });
            return;
        }

        plants.forEach((plant, index) => {
            if (index >= 10) return;

            const plantedTime = Math.floor(new Date(plant.planted_at).getTime() / 1000);
            let status = '';

            if (plant.is_ready) {
                status = '🌿 **ERNTEREIF**';
            } else {
                const remainingMinutes = Math.ceil(config.timers.plantHarvestTime - plant.minutes_growing);
                status = `⏰ Noch ${utils.formatDuration(remainingMinutes)}`;
            }

            const fertilizerStatus = plant.fertilized_by ? `✅ Gedüngt von ${plant.fertilized_by}` : '❌ Nicht gedüngt';
            const qualityIndicator = plant.quality > 1 ? ` ⭐${plant.quality}` : '';

            embed.addFields({
                name: `Pflanze #${plant.id} - ${plant.location}${qualityIndicator}`,
                value: `👤 **${plant.username}** • ${status}\n💚 ${fertilizerStatus}\n📅 <t:${plantedTime}:R>`,
                inline: true
            });
        });

        if (totalCount > 10) {
            embed.setDescription(embed.data.description + `\n\n*Zeige erste 10 von ${totalCount} Pflanzen*`);
        }

        await interaction.followUp({ embeds: [embed] });

    } catch (error) {
        console.error('❌ Plants Status Error:', error);
        await interaction.followUp('❌ Fehler beim Abrufen der Pflanzen!');
    }
}

// ===== HELPER FUNCTIONS =====

async function updateUserProfile(user, serverId) {
    const userId = user.id;
    const username = user.displayName || user.username;

    try {
        await db.query(`
            INSERT INTO user_profiles (user_id, username, server_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE SET
                username = EXCLUDED.username,
                last_active = NOW()
        `, [userId, username, serverId]);
    } catch (error) {
        console.error('❌ Update User Profile Error:', error);
    }
}

async function giveExperience(userId, serverId, amount, reason, itemId) {
    try {
        const { rows } = await db.query(`
            UPDATE user_profiles 
            SET experience = experience + $1,
                level = (SQRT((experience + $1) / 100))::integer + 1
            WHERE user_id = $2 AND server_id = $3
            RETURNING level, experience
        `, [amount, userId, serverId]);

        if (rows.length > 0) {
            const { level, experience } = rows[0];
            
            // Level-Up prüfen
            const previousLevel = utils.calculateLevel(experience - amount);
            if (level > previousLevel) {
                await handleLevelUp(userId, serverId, level);
            }
        }
    } catch (error) {
        console.error('❌ Give Experience Error:', error);
    }
}

async function handleLevelUp(userId, serverId, newLevel) {
    try {
        const user = await client.users.fetch(userId);
        const guild = client.guilds.cache.get(serverId);
        
        if (!user || !guild) return;

        // Level Achievement prüfen
        await checkAchievements(userId, serverId, 'level');

        // Level-Up Benachrichtigung senden
        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('🎉 LEVEL UP!')
            .setDescription(`Herzlichen Glückwunsch ${user.displayName || user.username}!`)
            .addFields(
                { name: '🆙 Neues Level', value: `**${newLevel}**`, inline: true },
                { name: '🎁 Belohnung', value: `**${utils.formatCurrency(newLevel * 1000)}**`, inline: true },
                { name: '⭐ Bonus XP', value: `**+${newLevel * 50} XP**`, inline: true }
            )
            .setThumbnail(user.displayAvatarURL())
            .setFooter({ text: 'Russkaya Familie 🇷🇺 • Weiter so!' })
            .setTimestamp();

        // Level-Up Belohnung vergeben
        await db.query(`
            UPDATE user_profiles 
            SET total_earnings = total_earnings + $1,
                experience = experience + $2
            WHERE user_id = $3 AND server_id = $4
        `, [newLevel * 1000, newLevel * 50, userId, serverId]);

        // In einem passenden Channel posten
        const channels = guild.channels.cache.filter(c => 
            c.type === 0 && (
                c.name.includes('level') || 
                c.name.includes('announce') ||
                c.name.includes('general') ||
                c.name.includes('familie')
            )
        );

        const targetChannel = channels.first();
        if (targetChannel) {
            await targetChannel.send({ embeds: [embed] });
        }

    } catch (error) {
        console.error('❌ Level Up Handler Error:', error);
    }
}

async function checkAchievements(userId, serverId, type) {
    try {
        // User Stats abrufen
        const { rows: profileRows } = await db.query(`
            SELECT * FROM user_profiles 
            WHERE user_id = $1 AND server_id = $2
        `, [userId, serverId]);

        if (profileRows.length === 0) return;
        
        const profile = profileRows[0];
        const currentAchievements = JSON.parse(profile.achievements || '[]');

        // Relevante Achievements abrufen
        const { rows: achievements } = await db.query(`
            SELECT * FROM achievements 
            WHERE requirement_type = $1
            AND name NOT IN (${currentAchievements.map((_, i) => `${i + 2}`).join(',') || 'NULL'})
            ORDER BY requirement_value ASC
        `, [type, ...currentAchievements]);

        for (const achievement of achievements) {
            let currentValue = 0;
            
            // Aktuellen Wert ermitteln
            switch (type) {
                case 'plants_seeded':
                    currentValue = profile.total_plants_seeded;
                    break;
                case 'plants_harvested':
                    currentValue = profile.total_plants_harvested;
                    break;
                case 'solar_placed':
                    currentValue = profile.total_solar_placed;
                    break;
                case 'solar_collected':
                    currentValue = profile.total_solar_collected;
                    break;
                case 'level':
                    currentValue = profile.level;
                    break;
                case 'total_repairs':
                    currentValue = profile.total_repairs;
                    break;
                // Weitere Achievement-Typen hier hinzufügen
            }

            // Achievement prüfen
            if (currentValue >= achievement.requirement_value) {
                await grantAchievement(userId, serverId, achievement);
            }
        }

    } catch (error) {
        console.error('❌ Check Achievements Error:', error);
    }
}

async function grantAchievement(userId, serverId, achievement) {
    try {
        // Achievement zur Liste hinzufügen
        const { rows } = await db.query(`
            UPDATE user_profiles 
            SET achievements = COALESCE(achievements::jsonb, '[]'::jsonb) || $1::jsonb,
                experience = experience + $2,
                total_earnings = total_earnings + $3
            WHERE user_id = $4 AND server_id = $5
            RETURNING username, level, experience
        `, [
            JSON.stringify([achievement.name]),
            achievement.reward_experience,
            achievement.reward_money,
            userId,
