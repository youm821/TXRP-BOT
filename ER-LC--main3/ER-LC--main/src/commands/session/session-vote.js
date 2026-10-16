const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const crypto = require("crypto");
const config = require("../../../config");
const { setSessionOnline } = require("../../utils/sessionState");
const { refreshAllPanels } = require("./session-status");
const { getSubscribers, dmUsers } = require("../../utils/notifications");
const voteStore = require("../../utils/voteStore");

module.exports = {
    staffOnly: true,
    data: new SlashCommandBuilder()
        .setName("session-vote")
        .setDescription("Host a session vote.")
        .addIntegerOption(option => 
            option.setName("required_votes")
                .setDescription("The number of votes required to automatically start the session.")
                .setRequired(true)
                .setMinValue(1)),
    generateSessionId() {
        return crypto.randomBytes(6).toString("hex");
    },
    async execute(interaction, client) {
        // Defer immediately to prevent "Unknown Interaction" (10062) if API is slow
        await interaction.deferReply({ flags: [64] }).catch(() => null);

        const pollSessionId = this.generateSessionId();
        const requiredVotes = interaction.options.getInteger("required_votes");
        const { session, theme, roles, channels, emojis } = config;

        const pings = roles.notifications.map(id => {
            if (id.toLowerCase() === "everyone") return "@everyone";
            if (id.toLowerCase() === "here") return "@here";
            return `<@&${id}>`;
        }).join(" ");


        const embedHeader = new EmbedBuilder().setColor(theme.color);
        if (session.images?.header?.startsWith("http")) embedHeader.setImage(session.images.header);

        const embedMain = new EmbedBuilder()
            .setColor(theme.color)
            .setTitle("Session Vote")
            .setDescription(
                `> Please cast your vote below for the upcoming session. We require **${requiredVotes} votes** to start a session. \n\n` +
                `> If you vote, you are committing to join. Failure to participate after voting will result in moderation.`
            )
            .setFooter({ text: client.user.username });
        if (session.images?.footer?.startsWith("http")) embedMain.setImage(session.images.footer);


        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`vote:button_${pollSessionId}_${requiredVotes}`)
                .setEmoji(emojis.check)
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`viewvote:button_${pollSessionId}`)
                .setLabel("View Voters")
                .setEmoji(emojis.users)
                .setStyle(ButtonStyle.Secondary)
        );

        try {
            let channel;
            if (channels.session) {
                channel = await client.channels.fetch(channels.session).catch(() => null);
            }
            
            if (!channel) {
                channel = interaction.channel; // Fallback to current channel if not configured
            }

            const msg = await channel.send({
                content: pings || null,
                embeds: embedHeader.data.image ? [embedHeader, embedMain] : [embedMain],
                components: [row],
            });

            // Persist the poll to the database — this is what survives a bot
            // restart, instead of the old in-memory-only client.voteMap.
            voteStore.createPoll(pollSessionId, channel.id, msg.id, requiredVotes);
            client.activePollId = pollSessionId; // fast in-memory pointer, DB is always the source of truth

            // GC: abandon the poll if it never reaches the vote threshold within 1 hour.
            // This survives independently of the in-memory pointer since abandonStalePolls
            // re-checks against the DB's createdAt — ready.js also re-schedules this on boot
            // for any poll that was still active when the bot last restarted.
            setTimeout(() => {
                voteStore.abandonStalePolls(voteStore.ONE_HOUR_MS);
                if (client.activePollId === pollSessionId) client.activePollId = null;
            }, voteStore.ONE_HOUR_MS);

            await interaction.editReply({
                content: `**Successfully** hosted a session vote requiring ${requiredVotes} votes.`,
            });

            // Flip the on-air indicator back to green/Online and refresh any live status panels
            setSessionOnline(true);
            await refreshAllPanels(client).catch(err => console.warn("[VOTE] Could not refresh status panels:", err.message));

            // DM everyone subscribed to server-status alerts
            const subscribers = getSubscribers("serverStatus");
            if (subscribers.length > 0) {
                const joinLine = session.quickJoinUrl ? `\nJoin here: ${session.quickJoinUrl}` : "";
                dmUsers(client, subscribers, {
                    content: `🟢 **${session.serverName || "The session"}** is now online! A vote just started — ${requiredVotes} votes needed.${joinLine}`,
                }).catch(err => console.warn("[VOTE] Could not send server-status DMs:", err.message));
            }
        } catch (error) {
            console.error("[VOTE COMMAND ERROR]", error);
            await interaction.editReply({
                content: "❌ An error occurred while sending the vote message. Please check the logs channel.",
            }).catch(() => null);
        }
    },
};
