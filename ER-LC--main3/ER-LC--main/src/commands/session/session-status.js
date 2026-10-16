const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require("discord.js");
const axios = require("axios");
const config = require("../../../config");
const db = require("../../../db");
const { resolveImageAsset } = require("../../utils/imageAssets");
const { isSessionOnline } = require("../../utils/sessionState");

const SHUTDOWN_BUTTON_ID = "sessionStatus:shutdown";

/**
 * Pulls live server data (with staff/players/vehicles included) from the PRC
 * (ERLC) API. ER:LC's v2 API is consolidated into a single /server endpoint —
 * staff, queue, players, vehicles, etc. are all opt-in via query flags
 * (?Staff=true&Players=true&Vehicles=true) rather than separate paths like
 * /server/staff or /server/queue, which now 404.
 * Returns null if no server key is configured or the request fails, so the
 * panel can gracefully fall back to config-only values.
 */
async function fetchServerData() {
    if (!config.erlc.serverKey) return null;

    try {
        const res = await axios.get(`${config.erlc.baseUrl}/server`, {
            headers: { "Server-Key": config.erlc.serverKey },
            params: { Staff: true, Players: true, Vehicles: true },
            timeout: 8000,
        });
        return {
            server: res.data,
            staff: res.data.Staff || null,
            players: res.data.Players || null,
            vehicles: res.data.Vehicles || null,
        };
    } catch (err) {
        console.warn("[SESSION STATUS] Failed to fetch PRC data:", err.response?.data || err.message);
        return null;
    }
}

/**
 * ER:LC's v2 API returns Staff sections as objects keyed by Roblox ID
 * (e.g. { "54249787": "Black_Hallow" }) under Admins/Mods/Helpers, rather
 * than the older array-of-"Name:Id"-strings shape. This handles either
 * shape defensively in case that changes again.
 */
function extractNames(section) {
    if (!section) return [];
    if (Array.isArray(section)) {
        return section.map(entry => String(entry).split(":")[0]);
    }
    if (typeof section === "object") {
        return Object.values(section).map(String);
    }
    return [];
}

function formatOnDutyStaff(staffData) {
    if (!staffData) return "*Unavailable*";

    const all = [
        ...extractNames(staffData.CoOwners),
        ...extractNames(staffData.Admins),
        ...extractNames(staffData.Mods),
        ...extractNames(staffData.Helpers),
    ];

    if (all.length === 0) return "*No staff currently on duty*";

    const MAX_SHOWN = 15;
    const names = all.slice(0, MAX_SHOWN);
    const overflow = all.length - names.length;

    return names.join(", ") + (overflow > 0 ? ` +${overflow} more` : "");
}

/**
 * Players come back as [{ Player: "Name:Id", Permission, Callsign, Team }].
 * Shows names grouped loosely with their team, capped so the panel stays short.
 */
function formatPlayerList(playersData) {
    if (!playersData) return "*Unavailable*";
    if (!Array.isArray(playersData) || playersData.length === 0) return "*No players currently in-game*";

    const MAX_SHOWN = 15;
    const entries = playersData.slice(0, MAX_SHOWN).map(p => {
        const name = String(p.Player || p.Name || p.player || "Unknown").split(":")[0];
        const team = p.Team || p.team;
        return team ? `${name} (${team})` : name;
    });
    const overflow = playersData.length - entries.length;

    return entries.join(", ") + (overflow > 0 ? ` +${overflow} more` : "");
}

/**
 * Vehicles come back as [{ Name, Owner, Texture }]. Shows "Car (owner)",
 * capped so the panel stays short even with a lot of cars spawned.
 */
function formatVehicleList(vehiclesData) {
    if (!vehiclesData) return "*Unavailable*";
    if (!Array.isArray(vehiclesData) || vehiclesData.length === 0) return "*No vehicles currently spawned*";

    const MAX_SHOWN = 12;
    const entries = vehiclesData.slice(0, MAX_SHOWN).map(v => {
        const name = v.Name || v.name || "Unknown vehicle";
        const owner = v.Owner || v.owner;
        return owner ? `${name} (${owner})` : name;
    });
    const overflow = vehiclesData.length - entries.length;

    return entries.join(", ") + (overflow > 0 ? ` +${overflow} more` : "");
}

/**
 * Builds the Components V2 "Session Status" container.
 * Shared by the slash command, the shutdown button, and the auto-update loop
 * so every surface renders an identical panel.
 *
 * Returns { container, files } — `files` holds any local assets/ images that
 * need to be attached alongside the message for attachment:// URLs to resolve.
 */
function buildStatusContainer({ session, data }) {
    const container = new ContainerBuilder()
        .setSpoiler(session.statusSpoiler)
        .setAccentColor(0);

    const files = [];

    const header = resolveImageAsset("session-header", session.images?.header);
    if (header) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(header.url)
            )
        );
        if (header.attachment) files.push(header.attachment);
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(session.statusIntro));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    const joinCode = data?.server?.JoinKey || session.joinCode || "Not Configured";
    const ownerTag = session.serverOwner
        ? (session.serverOwner.startsWith("@") ? session.serverOwner : `@${session.serverOwner}`)
        : "Not Configured";

    const infoLines = [
        "# Server Information",
        "",
        `> **Server Name:** ${session.serverName || "Not Configured"}`,
        `> **Join Code:** ${joinCode}`,
        `> **Server Owner:** ${ownerTag}`,
        `> **On-Duty Staff:** ${formatOnDutyStaff(data?.staff)}`,
        `> **Players:** ${data?.server?.CurrentPlayers ?? "?"}/${data?.server?.MaxPlayers ?? "?"}`,
    ].join("\n");
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(infoLines));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    const liveLines = [
        `> **🚓 In-Game Players:** ${formatPlayerList(data?.players)}`,
        `> **🚗 Vehicles In Use:** ${formatVehicleList(data?.vehicles)}`,
    ].join("\n");
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(liveLines));

    // No separator here — last-updated sits directly under the live players/vehicles block
    const nowUnix = Math.floor(Date.now() / 1000);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Last updated: <t:${nowUnix}:R>`));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    const row = new ActionRowBuilder();
    const isValidJoinUrl = session.quickJoinUrl && /^https?:\/\//i.test(session.quickJoinUrl);
    if (isValidJoinUrl) {
        row.addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("Join up")
                .setURL(session.quickJoinUrl)
        );
    }

    // This is a manual on-air indicator (see src/utils/sessionState.js), not a live API check —
    // staff pressing this button flips it red/Offline, and /session-vote flips it back green/Online.
    const online = isSessionOnline();
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(SHUTDOWN_BUTTON_ID)
            .setStyle(online ? ButtonStyle.Success : ButtonStyle.Danger)
            .setLabel(online ? "🟢 Online" : "🔴 Offline")
    );
    container.addActionRowComponents(row);

    const footer = resolveImageAsset("session-footer", session.images?.footer);
    if (footer) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(footer.url)
            )
        );
        if (footer.attachment) files.push(footer.attachment);
    }

    return { container, files };
}

/**
 * Finds the current active status panel and edits it in place with fresh data.
 * If no active panel exists (or the tracked message/channel is gone), posts a new
 * one and starts tracking it instead. Used by both /session-status and /session-start
 * so a new session never spams a duplicate panel — it just updates the existing one.
 */
async function upsertStatusPanel(client, channel) {
    const data = await fetchServerData();
    const { container, files } = buildStatusContainer({ session: config.session, data });

    const existing = db.prepare("SELECT * FROM status_panels WHERE status = 'active' ORDER BY id DESC LIMIT 1").get();

    if (existing) {
        try {
            const existingChannel = existing.channelId === channel.id
                ? channel
                : await client.channels.fetch(existing.channelId).catch(() => null);

            if (existingChannel) {
                const message = await existingChannel.messages.fetch(existing.messageId).catch(() => null);
                if (message) {
                    await message.edit({
                        flags: MessageFlags.IsComponentsV2, // Required on every edit, not just the initial send
                        components: [container],
                        files,
                    });
                    return { messageId: existing.messageId, channelId: existingChannel.id, updated: true };
                }
            }
        } catch (err) {
            console.warn("[SESSION STATUS] Could not edit existing panel, will post a new one:", err.message);
        }
        // Tracked message/channel is gone — stop tracking it so we don't keep retrying
        db.prepare("UPDATE status_panels SET status = 'ended' WHERE id = ?").run(existing.id);
    }

    const msg = await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [container],
        files,
    });
    try {
        db.prepare("INSERT INTO status_panels (channelId, messageId) VALUES (?, ?)").run(channel.id, msg.id);
    } catch (err) {
        console.error("Failed to insert status panel tracking:", err);
    }
    return { messageId: msg.id, channelId: channel.id, updated: false };
}

/**
 * Edits every currently-tracked (status = 'active') status panel with fresh data.
 * Used by the 60-second auto-update loop, and also called right after actions
 * that change the on-air state (shutdown button, /session-vote) so panels flip
 * color immediately instead of waiting for the next loop tick.
 */
async function refreshAllPanels(client) {
    const activePanels = db.prepare("SELECT * FROM status_panels WHERE status = 'active'").all();
    if (activePanels.length === 0) return;

    const data = await fetchServerData();
    const { container, files } = buildStatusContainer({ session: config.session, data });

    for (const panel of activePanels) {
        try {
            const channel = await client.channels.fetch(panel.channelId);
            if (!channel) continue;

            const message = await channel.messages.fetch(panel.messageId);
            if (!message) continue;

            await message.edit({
                flags: MessageFlags.IsComponentsV2,
                components: [container],
                files,
            });
        } catch (e) {
            if (e.code === 10008 || e.code === 10003) {
                console.log(`[SESSION STATUS] Panel ${panel.messageId} not found, marking as ended.`);
                db.prepare("UPDATE status_panels SET status = 'ended' WHERE messageId = ?").run(panel.messageId);
            } else {
                console.warn(`[SESSION STATUS] Could not refresh panel ${panel.messageId}:`, e.message);
            }
        }
        // 1.2-second gap between each message edit to stay under Discord's 5-edits/5s rate limit
        await new Promise(res => setTimeout(res, 1200));
    }
}

module.exports = {
    staffOnly: true,
    SHUTDOWN_BUTTON_ID,
    fetchServerData,
    buildStatusContainer,
    upsertStatusPanel,
    refreshAllPanels,
    data: new SlashCommandBuilder()
        .setName("session-status")
        .setDescription("Post or refresh the live-updating session status panel."),
    async execute(interaction, client) {
        // Defer immediately to prevent "Unknown Interaction" (10062) if the PRC API is slow
        await interaction.deferReply({ flags: [64] }).catch(() => null);

        const { channels } = config;

        try {
            let channel;
            if (channels.session) {
                channel = await client.channels.fetch(channels.session).catch(() => null);
            }
            if (!channel) {
                channel = interaction.channel; // Fallback to current channel if not configured
            }

            if (!channel) {
                await interaction.editReply({ content: "❌ Could not resolve a channel to post the panel in." });
                return;
            }

            const { updated } = await upsertStatusPanel(client, channel);

            await interaction.editReply({
                content: updated
                    ? "**Successfully** refreshed the existing session status panel."
                    : "**Successfully** posted the session status panel.",
            });
        } catch (error) {
            console.error("[SESSION STATUS COMMAND ERROR]", error);
            await interaction.editReply({
                content: "❌ An error occurred while posting the session status panel. Please check the logs channel.",
            }).catch(() => null);
        }
    },
};
