const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require("discord.js");
const config = require("../../config");
const voteStore = require("../../utils/voteStore");

// Tracks pending message edit timers per sessionId to debounce rapid updates.
// Purely a UI-smoothing concern — safe to keep in memory since a lost debounce
// timer on restart just means one stale button label, not a lost vote.
const editDebounceTimers = new Map();

// Sends DMs to voters one at a time to avoid triggering Discord's DM rate limits
async function sendDMQueue(client, votersArray, components) {
    for (const v of votersArray) {
        let retries = 3;
        while (retries > 0) {
            try {
                const user = await client.users.fetch(v.userId);
                const dmEmbed = new EmbedBuilder()
                    .setColor(config.theme.color)
                    .setDescription(
                        `Hey <@${v.userId}>, thanks for voting! The session is starting now. ` +
                        `Please join to avoid moderation.`
                    );
                await user.send({ embeds: [dmEmbed], components: components });
                break; // Success, move to next user
            } catch (e) {
                // Rate limit (429) or other temporary error - retry with backoff
                if (e.status === 429 || e.status === 500) {
                    retries--;
                    if (retries > 0) {
                        const delay = (4 - retries) * 2000;
                        console.warn(`[DM RETRY] Retrying DM for ${v.userId} in ${delay}ms...`);
                        await new Promise(res => setTimeout(res, delay));
                        continue;
                    }
                }

                // DMs can be closed or other permanent errors — skip user
                console.warn(`[DM SKIP] Could not DM user ${v.userId}: ${e.message}`);
                break;
            }
        }
        // 1-second gap between each DM to stay well within Discord's rate limits
        await new Promise(res => setTimeout(res, 1000));
    }
}

module.exports = {
    // Matches on the action prefix (split by "_")
    customIdPrefix: "vote:button",
    async execute(interaction, client) {
        // Parse the customId: "vote:button_<sessionId>_<requiredVotes>"
        const parts = interaction.customId.split("_");
        const sessionId = parts[1];
        const REQUIRED_VOTES = parseInt(parts[2]) || 7;

        const userId = interaction.user.id;
        const result = voteStore.toggleVote(sessionId, userId);

        // null means the poll doesn't exist or already concluded — this now also
        // correctly catches polls that were GC'd for going stale, instead of the
        // old behavior where a late click could accidentally resurrect them.
        if (!result) {
            return interaction.reply({ content: "This vote has already concluded!", flags: [64] });
        }

        await interaction.reply({
            content: result.voted ? "Your vote has been counted!" : "Your vote has been removed.",
            flags: [64],
        });

        const count = result.count;

        // --- DEBOUNCED message edit ---
        // Cancel any pending edit timer for this session and set a fresh one.
        // This means no matter how many people click at once, the message is
        // only ever edited once per 1.5 seconds, protecting against rate limits.
        if (editDebounceTimers.has(sessionId)) {
            clearTimeout(editDebounceTimers.get(sessionId));
        }
        editDebounceTimers.set(sessionId, setTimeout(async () => {
            editDebounceTimers.delete(sessionId);

            // Re-read the live vote count at the time of editing (may have changed)
            const liveCount = voteStore.getVoteCount(sessionId);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`vote:button_${sessionId}_${REQUIRED_VOTES}`)
                    .setEmoji(config.emojis.check)
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`viewvote:button_${sessionId}`)
                    .setLabel(`View Voters (${liveCount})`)
                    .setEmoji(config.emojis.users)
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.message.edit({ components: [row] }).catch(() => null);
        }, 1500));

        // --- ATOMIC session start ---
        // endPollIfActive only returns true for the ONE click that actually flips
        // active -> ended, so concurrent clicks past the threshold can't double-fire.
        if (count >= REQUIRED_VOTES && voteStore.endPollIfActive(sessionId)) {
            const votersArray = voteStore.getVoters(sessionId);

            // Cancel any pending debounced edit since we're deleting the message anyway
            if (editDebounceTimers.has(sessionId)) {
                clearTimeout(editDebounceTimers.get(sessionId));
                editDebounceTimers.delete(sessionId);
            }

            if (client.activePollId === sessionId) client.activePollId = null;

            const votersMentions = votersArray.map(v => `<@${v.userId}>`).join(", ");
            const { session, theme, roles } = config;

            let descriptionText = "> The session has reached the required votes and is now starting!\n\n" +
                "**Game Information**\n" +
                "> **Server Name**: " + (session.serverName || "N/A") + "\n" +
                "> **Join Code**: " + (session.joinCode || "N/A") + "\n\n";

            const quickJoinLink = session.quickJoinUrl || "https://policeroleplay.community/";
            const isValidHttpUrl = quickJoinLink.match(/^https?:\/\//i) || quickJoinLink.match(/^discord:\/\//i);

            if (!isValidHttpUrl) {
                descriptionText += "> **Direct Link**: " + quickJoinLink + "\n\n";
            }

            const embedMain = new EmbedBuilder()
                .setColor(theme.success)
                .setTitle("**Session Started!**")
                .setDescription(descriptionText);
            if (session.images?.header?.startsWith("http")) embedMain.setImage(session.images.header);

            const components = [];
            if (isValidHttpUrl) {
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel("Quick Join")
                        .setURL(quickJoinLink)
                        .setStyle(ButtonStyle.Link)
                ));
            }

            const pings = roles.notifications.map(id => {
                if (id.toLowerCase() === "everyone") return "@everyone";
                if (id.toLowerCase() === "here") return "@here";
                return `<@&${id}>`;
            }).join(" ");

            try {
                await interaction.channel.send({
                    content: `${pings} Session is starting thanks to: ${votersMentions}`,
                    embeds: [embedMain],
                    components: components,
                });
            } catch (e) {
                console.error("[SESSION START ERROR] Could not send session started message:", e.message);
            }

            // Delete the voting panel
            try { await interaction.message.delete(); } catch (e) {}

            // Fire and forget the DM queue — doesn't block the interaction response.
            sendDMQueue(client, votersArray, components).catch(e =>
                console.error("[DM QUEUE ERROR] sendDMQueue threw unexpectedly:", e.message)
            );
        }
    },
};
