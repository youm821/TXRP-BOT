const { SlashCommandBuilder } = require("discord.js");
const { setSubscription, isSubscribed, getRobloxLink } = require("../../utils/notifications");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("notify")
        .setDescription("Subscribe or unsubscribe from DM alerts.")
        .addSubcommand(sub =>
            sub.setName("server-status")
                .setDescription("Get DM'd the moment the session goes online.")
                .addBooleanOption(opt =>
                    opt.setName("enabled")
                        .setDescription("Turn this alert on or off")
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName("queue")
                .setDescription("Get DM'd when a queue spot opens up (requires /link-roblox first).")
                .addBooleanOption(opt =>
                    opt.setName("enabled")
                        .setDescription("Turn this alert on or off")
                        .setRequired(true))),
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const enabled = interaction.options.getBoolean("enabled");
        const userId = interaction.user.id;

        if (sub === "queue" && enabled && !getRobloxLink(userId)) {
            await interaction.reply({
                content: "⚠️ You need to link your Roblox account first — run `/link-roblox` before turning this on.",
                flags: [64],
            });
            return;
        }

        setSubscription(userId, sub, enabled);

        const label = sub === "queue" ? "queue spot" : "session online";
        await interaction.reply({
            content: enabled
                ? `✅ You'll now get a DM when the **${label}** alert fires.`
                : `🔕 You've been unsubscribed from **${label}** alerts.`,
            flags: [64],
        });
    },
};
