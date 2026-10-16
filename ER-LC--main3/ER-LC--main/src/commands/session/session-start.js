const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const config = require("../../../config");
const crypto = require("crypto");
const { upsertStatusPanel } = require("./session-status");
const voteStore = require("../../utils/voteStore");

module.exports = {
    staffOnly: true,
    data: new SlashCommandBuilder()
        .setName("session-start")
        .setDescription("Host a session start up."),
    async execute(interaction, client) {
        // Defer immediately to prevent "Unknown Interaction" (10062) if API is slow
        await interaction.deferReply({ flags: [64] }).catch(() => null);

        const { session, theme, roles, channels } = config;


        let joinBlock = "> **Server Name**: " + (session.serverName || "Not Configured") + "\n" +
            "> **Server Owner**: " + (session.serverOwner || "Not Configured") + "\n" +
            "> **Join Code**: " + (session.joinCode || "Not Configured") + "\n\n";

        let isValidHttpUrl = false;
        if (session.quickJoinUrl) {
            isValidHttpUrl = session.quickJoinUrl.match(/^https?:\/\//i) || session.quickJoinUrl.match(/^discord:\/\//i);
        }

        if (!session.quickJoinUrl) {
            joinBlock += "> *Note: No quick join link configured. Use the Join Code directly in-game.*";
        } else if (!isValidHttpUrl) {
            joinBlock += "> **Direct Link**: " + session.quickJoinUrl + "\n";
        }

        const embedHeader = new EmbedBuilder().setColor(theme.color);
        if (session.images?.header?.startsWith("http")) embedHeader.setImage(session.images.header);

        const embedMain = new EmbedBuilder()
            .setColor(theme.color)
            .setTitle("**Session Startup**")
            .setDescription(
                "> A server start-up has been initiated! Please ensure you have read and understood our regulations prior to joining.\n\n" +
                "**Game Information**\n" +
                joinBlock
            )
            .setFooter({ text: client.user.username });
        if (session.images?.footer?.startsWith("http")) embedMain.setImage(session.images.footer);

        const components = [];
        if (session.quickJoinUrl && isValidHttpUrl) {
            const startLinkButton = new ButtonBuilder()
                .setLabel("Quick Join")
                .setURL(session.quickJoinUrl)
                .setStyle(ButtonStyle.Link);
            components.push(new ActionRowBuilder().addComponents(startLinkButton));
        }

        // Fetch voters if any — falls back to the DB's latest active poll if the
        // in-memory pointer was lost (e.g. the bot restarted since the vote started).
        let votersList = "**No voters recorded!**";
        const pollId = client.activePollId || voteStore.getLatestActivePoll()?.sessionId;
        if (pollId) {
            const voters = voteStore.getVoters(pollId);
            if (voters.length > 0) {
                votersList = voters.map((v) => `<@${v.userId}>`).join(", ");
            }
        }

        try {
            let channel;
            if (channels.session) {
                channel = await client.channels.fetch(channels.session).catch(() => null);
            }
            if (!channel) {
                channel = interaction.channel; // Fallback to current channel if not configured
            }

            if (channel) {
                const pings = roles.notifications.map(id => {
                    if (id.toLowerCase() === "everyone") return "@everyone";
                    if (id.toLowerCase() === "here") return "@here";
                    return `<@&${id}>`;
                }).join(" ");

                const msg = await channel.send({
                    content: `${pings}\n-# ${votersList}`,
                    embeds: embedHeader.data.image ? [embedHeader, embedMain] : [embedMain],
                    components: components
                });

                // Save to DB for Live Auto-Updating Panel
                const db = require("../../../db");
                const sessionIdStr = client.activePollId || crypto.randomBytes(6).toString("hex");
                try {
                    db.prepare("INSERT INTO sessions (id, channelId, messageId) VALUES (?, ?, ?)").run(sessionIdStr, channel.id, msg.id);
                } catch (err) {
                    console.error("Failed to insert session tracking:", err);
                }

                // Refresh the existing live Session Status panel (button, players, staff, etc.)
                // rather than posting a brand new one each time a session starts.
                // If no active panel exists yet, this posts one and starts tracking it.
                try {
                    await upsertStatusPanel(client, channel);
                } catch (err) {
                    console.error("[SESSION START] Failed to update session status panel:", err);
                }
            }

            await interaction.editReply({
                content: "**Successfully** hosted a session start up.",
            });
        } catch (error) {
            console.error("[STARTUP COMMAND ERROR]", error);
            await interaction.editReply({
                content: "❌ An error occurred while starting the session. Please check the logs channel.",
            }).catch(() => null);
        }
    },
};
