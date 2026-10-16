const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");
const { linkRoblox, unlinkRoblox, getRobloxLink } = require("../../utils/notifications");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("link-roblox")
        .setDescription("Link your Roblox account so queue alerts can find you.")
        .addStringOption(opt =>
            opt.setName("username")
                .setDescription("Your exact Roblox username (leave blank to unlink)")
                .setRequired(false)),
    async execute(interaction) {
        const username = interaction.options.getString("username");
        const userId = interaction.user.id;

        if (!username) {
            const existing = getRobloxLink(userId);
            if (!existing) {
                await interaction.reply({ content: "You don't have a Roblox account linked.", flags: [64] });
                return;
            }
            unlinkRoblox(userId);
            await interaction.reply({ content: `🔗 Unlinked **${existing.robloxUsername}**.`, flags: [64] });
            return;
        }

        await interaction.deferReply({ flags: [64] }).catch(() => null);

        try {
            const res = await axios.post(
                "https://users.roblox.com/v1/usernames/users",
                { usernames: [username], excludeBannedUsers: false },
                { timeout: 8000 }
            );

            const match = res.data?.data?.[0];
            if (!match) {
                await interaction.editReply({
                    content: `❌ Couldn't find a Roblox user named **${username}**. Double check the spelling.`,
                });
                return;
            }

            linkRoblox(userId, match.id, match.name);
            await interaction.editReply({
                content: `✅ Linked to Roblox account **${match.name}** (ID: ${match.id}). You can now enable \`/notify queue\`.`,
            });
        } catch (err) {
            console.error("[LINK ROBLOX ERROR]", err.response?.data || err.message);
            await interaction.editReply({
                content: "❌ Couldn't reach Roblox's servers right now. Please try again in a moment.",
            }).catch(() => null);
        }
    },
};
