const { EmbedBuilder } = require("discord.js");
const config = require("../../config");
const voteStore = require("../../utils/voteStore");

module.exports = {
    customIdPrefix: "viewvote:button",
    async execute(interaction, client) {
        const sessionId = interaction.customId.split("_")[1];
        const voters = voteStore.getVoters(sessionId);

        if (!voters || voters.length === 0) {
            return interaction.reply({ content: "No votes yet!", flags: [64] });
        }

        const votersList = voters.map(v => `<@${v.userId}>`).join("\n");
        const embed = new EmbedBuilder()
            .setColor(config.theme.color)
            .setTitle("📋 Current Voters")
            .setDescription(votersList)
            .setFooter({ text: `${voters.length} total voter(s)` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: [64] });
    },
};
