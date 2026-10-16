const { MessageFlags } = require("discord.js");
const config = require("../../config");
const { fetchServerData, buildStatusContainer, SHUTDOWN_BUTTON_ID } = require("../commands/session/session-status");
const { announceShutdown } = require("../commands/session/session-shutdown");

module.exports = {
    // Matches on the full customId
    customId: SHUTDOWN_BUTTON_ID,
    async execute(interaction, client) {
        // Staff-only gate — same rule as the /session-shutdown command, with an owner bypass
        const member = interaction.member;
        const isOwner = interaction.user.id === config.bot.ownerId;
        if (!isOwner && (!member || !member.roles.cache.has(config.roles.staff))) {
            return interaction.reply({
                content: "You do not have permission to shut down the session.",
                flags: [64],
            }).catch(() => null);
        }

        await interaction.deferUpdate().catch(() => null);

        try {
            await announceShutdown(client, interaction.channel);

            // Rebuild and reflect the now-offline state on this exact panel immediately
            // (announceShutdown already refreshes every tracked panel, but this avoids
            // any race with that loop for the message the user is looking right at).
            const data = await fetchServerData();
            const { container, files } = buildStatusContainer({ session: config.session, data });
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [container],
                files,
            });
        } catch (err) {
            console.error("[SESSION STATUS SHUTDOWN BUTTON ERROR]", err);
            await interaction.followUp({
                content: "⚠️ Couldn't shut down the session right now. Please try /session-shutdown instead.",
                flags: [64],
            }).catch(() => null);
        }
    },
};
