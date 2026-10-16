const db = require("../../db");

// ── Subscriptions ────────────────────────────────────────────────────────

function setSubscription(userId, type, enabled) {
    const column = type === "queue" ? "queueAlerts" : "serverStatus";
    db.prepare(`INSERT INTO notification_subscribers (userId, ${column}) VALUES (?, ?)
        ON CONFLICT(userId) DO UPDATE SET ${column} = excluded.${column}`)
        .run(userId, enabled ? 1 : 0);
}

function isSubscribed(userId, type) {
    const row = db.prepare("SELECT * FROM notification_subscribers WHERE userId = ?").get(userId);
    if (!row) return false;
    return type === "queue" ? !!row.queueAlerts : !!row.serverStatus;
}

function getSubscribers(type) {
    const column = type === "queue" ? "queueAlerts" : "serverStatus";
    return db.prepare(`SELECT userId FROM notification_subscribers WHERE ${column} = 1`).all().map(r => r.userId);
}

// ── Roblox linking (needed for queue alerts — ERLC's queue is Roblox-side) ──

function linkRoblox(discordId, robloxId, robloxUsername) {
    db.prepare(`INSERT INTO roblox_links (discordId, robloxId, robloxUsername) VALUES (?, ?, ?)
        ON CONFLICT(discordId) DO UPDATE SET robloxId = excluded.robloxId, robloxUsername = excluded.robloxUsername`)
        .run(discordId, String(robloxId), robloxUsername);
}

function unlinkRoblox(discordId) {
    db.prepare("DELETE FROM roblox_links WHERE discordId = ?").run(discordId);
}

function getRobloxLink(discordId) {
    return db.prepare("SELECT * FROM roblox_links WHERE discordId = ?").get(discordId) || null;
}

/**
 * Returns [{ discordId, robloxId, robloxUsername }] for everyone who is both
 * linked to a Roblox account AND subscribed to queue alerts.
 */
function getQueueSubscribersWithLinks() {
    return db.prepare(`
        SELECT rl.discordId, rl.robloxId, rl.robloxUsername
        FROM roblox_links rl
        JOIN notification_subscribers ns ON ns.userId = rl.discordId
        WHERE ns.queueAlerts = 1
    `).all();
}

// ── DM sending ───────────────────────────────────────────────────────────

/**
 * DMs a list of Discord user IDs with a small delay between each send to stay
 * well under Discord's rate limits. Silently skips users with DMs closed.
 */
async function dmUsers(client, userIds, payload) {
    for (const userId of userIds) {
        try {
            const user = await client.users.fetch(userId);
            await user.send(payload);
        } catch (err) {
            // Most common cause: user has DMs disabled / blocked the bot — not worth logging loudly
            console.warn(`[NOTIFY] Could not DM ${userId}: ${err.message}`);
        }
        await new Promise(res => setTimeout(res, 350));
    }
}

module.exports = {
    setSubscription,
    isSubscribed,
    getSubscribers,
    linkRoblox,
    unlinkRoblox,
    getRobloxLink,
    getQueueSubscribersWithLinks,
    dmUsers,
};
