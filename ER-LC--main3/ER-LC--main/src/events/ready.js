const { Events, ActivityType, REST, Routes, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const config = require("../../config");
const db = require("../../db");
const { endGiveaway } = require("../utils/giveawayUtil");
const voteStore = require("../utils/voteStore");

// Safe recursive loop: waits for one full cycle to complete before scheduling the next.
// Unlike setInterval, this prevents calls from piling up if the API or Discord is slow.
async function startLivePanelLoop(client) {
    while (true) { // eslint-disable-line no-constant-condition
        // FIXED: Top-level crash guard — any unexpected runtime error (e.g. a TypeError
        // from malformed DB data) is caught here so the loop continues instead of dying
        // silently and stopping all live panel updates forever.
        try {
            await runLivePanelUpdate(client);
        } catch (e) {
            console.error("[LIVE PANEL] Unhandled loop error — will retry in 60s:", e);
        }
        // Wait 60 seconds AFTER the update finishes before running again
        await new Promise(res => setTimeout(res, 60000));
    }
}

async function runLivePanelUpdate(client) {
    if (!config.erlc.serverKey) return;

    const activeSessions = db.prepare("SELECT * FROM sessions WHERE status = 'active'").all();
    if (activeSessions.length === 0) return;

    let serverData;
    try {
        const response = await axios.get(`${config.erlc.baseUrl}/server`, {
            headers: { "Server-Key": config.erlc.serverKey },
            timeout: 10000, // 10-second hard timeout so a hanging request can't block the loop indefinitely
        });
        serverData = response.data;
    } catch (err) {
        // Don't crash the loop on API errors — log and skip this cycle
        console.warn("[LIVE PANEL] Failed to fetch PRC data:", err.response?.data || err.message);
        return;
    }

    const playersCount = serverData.CurrentPlayers || 0;
    const maxPlayers = serverData.MaxPlayers || 40;
    const now = Math.floor(Date.now() / 1000);

    const statusEmbed = new EmbedBuilder()
        .setColor(config.theme.info)
        .setTitle("📡 Live Server Status")
        .setDescription(`**Last Updated:** <t:${now}:R>`)
        .addFields({ name: "Players", value: `\`\`\`\n${playersCount}/${maxPlayers}\n\`\`\``, inline: true })
        .setFooter({ text: `${config.bot.name} | Live Panel` });

    for (const session of activeSessions) {
        try {
            const channel = await client.channels.fetch(session.channelId);
            if (!channel) continue;

            const message = await channel.messages.fetch(session.messageId);
            if (!message) continue;

            const originalEmbeds = message.embeds.filter(e => e.title !== "📡 Live Server Status");
            await message.edit({ embeds: [...originalEmbeds, statusEmbed] });
        } catch (e) {
            if (e.code === 10008) {
                // Unknown Message — the session panel was deleted; mark it as ended
                console.log(`[LIVE PANEL] Session message ${session.messageId} not found, marking as ended.`);
                db.prepare("UPDATE sessions SET status = 'ended' WHERE messageId = ?").run(session.messageId);
            } else if (e.code === 10003) {
                // Unknown Channel — bot was removed from server
                console.warn(`[LIVE PANEL] Channel ${session.channelId} not found. Marking session as ended.`);
                db.prepare("UPDATE sessions SET status = 'ended' WHERE messageId = ?").run(session.messageId);
            } else {
                console.warn(`[LIVE PANEL] Could not update session ${session.messageId}:`, e.message);
            }
        }
        // 1.2-second gap between each message edit to stay under Discord's 5-edits/5s rate limit
        await new Promise(res => setTimeout(res, 1200));
    }
}

// Safe recursive loop for the Components V2 "/session-status" panels.
// Mirrors startLivePanelLoop but edits `components` instead of `embeds`,
// since Components V2 messages can't mix with classic embed edits.
async function startStatusPanelLoop(client) {
    while (true) { // eslint-disable-line no-constant-condition
        try {
            // Lazy-required to avoid a circular require at module load time (session-status.js requires config/db too)
            const { refreshAllPanels } = require("../commands/session/session-status");
            await refreshAllPanels(client);
        } catch (e) {
            console.error("[STATUS PANEL] Unhandled loop error — will retry in 60s:", e);
        }
        await new Promise(res => setTimeout(res, 60000));
    }
}

// Safe recursive loop that watches the ERLC queue for an opening and DMs
// linked+subscribed players who are currently waiting in it.
async function startQueueWatchLoop(client) {
    while (true) { // eslint-disable-line no-constant-condition
        try {
            await runQueueWatch(client);
        } catch (e) {
            console.error("[QUEUE WATCH] Unhandled loop error — will retry in 30s:", e);
        }
        await new Promise(res => setTimeout(res, 30000));
    }
}

async function runQueueWatch(client) {
    if (!config.erlc.serverKey) return;

    const { getQueueSubscribersWithLinks, dmUsers } = require("../utils/notifications");
    const subscribers = getQueueSubscribersWithLinks();

    let serverData;
    try {
        // ER:LC's v2 API is consolidated — Queue comes back as a field on
        // /server itself when requested via the Queue=true flag, not a
        // separate /server/queue path (that now 404s).
        const res = await axios.get(`${config.erlc.baseUrl}/server`, {
            headers: { "Server-Key": config.erlc.serverKey },
            params: { Queue: true },
            timeout: 8000,
        });
        serverData = res.data;
    } catch (err) {
        console.warn("[QUEUE WATCH] Failed to fetch PRC data:", err.response?.data || err.message);
        return;
    }

    const current = serverData.CurrentPlayers ?? 0;
    const max = serverData.MaxPlayers ?? 0;
    const hasRoom = max > 0 && current < max;
    const queueIds = Array.isArray(serverData.Queue) ? serverData.Queue.map(String) : [];

    const stateRow = db.prepare("SELECT hadRoom FROM queue_watch_state WHERE id = 1").get();
    const previouslyHadRoom = !stateRow || stateRow.hadRoom === 1;

    // Only fire on the transition from "full" to "room available" — prevents
    // re-notifying the same people every 30s for as long as room stays open.
    if (hasRoom && !previouslyHadRoom && queueIds.length > 0 && subscribers.length > 0) {
        const toNotify = subscribers.filter(s => queueIds.includes(String(s.robloxId)));
        if (toNotify.length > 0) {
            console.log(`[QUEUE WATCH] Notifying ${toNotify.length} queued player(s) that a slot opened up.`);
            await dmUsers(client, toNotify.map(s => s.discordId), {
                content: `🎉 A spot just opened up on **${config.session.serverName || "the server"}**! Join now before it fills back up.${config.session.quickJoinUrl ? `\n${config.session.quickJoinUrl}` : ""}`,
            });
        }
    }

    db.prepare("INSERT INTO queue_watch_state (id, hadRoom) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET hadRoom = excluded.hadRoom")
        .run(hasRoom ? 1 : 0);
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client, commands) {
        console.log(`\x1b[32m[READY]\x1b[0m Logged in as ${client.user.tag}`);

        // ── Register Slash Commands ───────────────────────────────────────────
        try {
            const rest = new REST().setToken(config.bot.token);
            console.log(`[COMMANDS] Refreshing ${commands.length} slash command(s)...`);
            const data = await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
            console.log(`[COMMANDS] Successfully reloaded ${data.length} slash command(s).`);
        } catch (error) {
            console.error("[COMMANDS] Failed to register slash commands:", error);
        }

        // ── Bot Branding ──────────────────────────────────────────────────────
        if (client.user.username !== config.bot.name) {
            try {
                await client.user.setUsername(config.bot.name);
                console.log(`[BRANDING] Updated bot username to: ${config.bot.name}`);
            } catch (error) {
                // Username changes are heavily rate-limited by Discord (max 2 per hour)
                console.warn(`[BRANDING] Could not update username: ${error.message}`);
            }
        }

        client.user.setPresence({
            activities: [{ name: config.bot.statusText, type: ActivityType.Watching }],
            status: "online",
        });

        // ── Resume Active Giveaways ───────────────────────────────────────────
        try {
            const activeGiveaways = db.prepare("SELECT * FROM giveaways WHERE status = 'active'").all();
            console.log(`[GIVEAWAYS] Resuming ${activeGiveaways.length} active giveaway(s)...`);
            for (const giveaway of activeGiveaways) {
                const remaining = giveaway.endTime - Date.now();
                if (remaining <= 0) {
                    // Ended while bot was offline — end it immediately.
                    // FIXED: was missing await, causing unhandled rejections if endGiveaway threw.
                    await endGiveaway(client, giveaway.messageId);
                } else {
                    setTimeout(() => endGiveaway(client, giveaway.messageId), remaining);
                }
            }
        } catch (e) {
            console.warn("[GIVEAWAYS] Could not resume giveaways:", e.message);
        }

        // ── Resume Active Vote Polls ─────────────────────────────────────────
        // Votes are now DB-backed (src/utils/voteStore.js), so they survive a
        // restart. This just cleans up anything that went stale while offline
        // and re-arms the 1-hour GC timer for polls still within their window.
        try {
            const abandonedOnBoot = voteStore.abandonStalePolls(voteStore.ONE_HOUR_MS);
            if (abandonedOnBoot > 0) {
                console.log(`[VOTE] Abandoned ${abandonedOnBoot} stale vote poll(s) from before restart.`);
            }
            const latestActive = voteStore.getLatestActivePoll();
            if (latestActive) {
                client.activePollId = latestActive.sessionId;
                const remaining = (latestActive.createdAt + voteStore.ONE_HOUR_MS) - Date.now();
                setTimeout(() => {
                    voteStore.abandonStalePolls(voteStore.ONE_HOUR_MS);
                    if (client.activePollId === latestActive.sessionId) client.activePollId = null;
                }, Math.max(remaining, 0));
                console.log(`[VOTE] Resumed active poll ${latestActive.sessionId}.`);
            }
        } catch (e) {
            console.warn("[VOTE] Could not resume vote polls:", e.message);
        }

        // ── Live Panel ────────────────────────────────────────────────────────
        // Start after an initial 10-second delay to let caches warm up, then loop forever
        setTimeout(() => startLivePanelLoop(client), 10000);
        console.log("[LIVE PANEL] Live panel loop scheduled.");

        // ── Session Status Panel ─────────────────────────────────────────────
        setTimeout(() => startStatusPanelLoop(client), 10000);
        console.log("[STATUS PANEL] Session status panel loop scheduled.");

        // ── Queue Watch ───────────────────────────────────────────────────────
        setTimeout(() => startQueueWatchLoop(client), 10000);
        console.log("[QUEUE WATCH] Queue watch loop scheduled.");

        // ── Periodic Vote Poll Cleanup ────────────────────────────────────────
        // Safety net on top of the per-poll GC timers — catches anything missed.
        setInterval(() => {
            const deletedCount = voteStore.abandonStalePolls(7200000); // 2 hours
            if (deletedCount > 0) console.log(`[CLEANUP] Abandoned ${deletedCount} stale vote poll(s).`);
        }, 3600000);
    },
};
