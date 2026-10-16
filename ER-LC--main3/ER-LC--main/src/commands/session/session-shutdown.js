const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
} = require("discord.js");
const config = require("../../../config");
const db = require("../../../db");
const { resolveImageAsset } = require("../../utils/imageAssets");
const { setSessionOnline } = require("../../utils/sessionState");

/**
 * Posts the "Session Shutdown" announcement and flips the persisted on-air
 * state to offline (so the status panel's button turns red). Does NOT stop
 * live tracking — the status panel keeps auto-refreshing every 60s, it'll
 * just show Offline until /session-vote flips it back to Online.
 * Shared by both the /session-shutdown command and the status panel's
 * shutdown button.
 */
async function announceShutdown(client, channel) {
    const { session, messages, shutdownEmbed } = config;

    const container = new ContainerBuilder();
    const files = [];

    // Falls back to the shared session-header/footer images if no shutdown-specific ones exist
    const header = resolveImageAsset(["shutdown-header", "session-header"], session.images?.header);
    if (header) {
        const item = new MediaGalleryItemBuilder()
            .setURL(header.url)
            .setSpoiler(shutdownEmbed.headerSpoiler);
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item));
        if (header.attachment) files.push(header.attachment);
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("# Session Shutdown"));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(messages.shutdown));

    const footer = resolveImageAsset(["shutdown-footer", "session-footer"], session.images?.footer);
    if (footer) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(footer.url)
            )
        );
        if (footer.attachment) files.push(footer.attachment);
    }

    if (channel) {
        await channel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [container],
            files,
        });
    }

    // Flip the on-air indicator to offline/red — this is what the status panel button reads
    setSessionOnline(false);

    // Clean up voting map so a stale poll can't auto-start a new session
    if (client.voteMap) {
        client.voteMap.clear();
        client.activePollId = null;
    }

    // Mark the classic /session-start announcement as ended (unrelated to the
    // Components V2 status panel — status_panels is intentionally left alone
    // here so live tracking keeps running).
    try {
        db.prepare("UPDATE sessions SET status = 'ended' WHERE status = 'active'").run();
    } catch (e) {
        console.error("Database error in announceShutdown:", e);
    }

    // Instantly flip any live status panels to red/Offline instead of waiting for the next loop tick
    const { refreshAllPanels } = require("./session-status");
    await refreshAllPanels(client).catch(err => console.warn("[SHUTDOWN] Could not refresh status panels:", err.message));
}

module.exports = {
    staffOnly: true,
    announceShutdown,
    data: new SlashCommandBuilder()
        .setName("session-shutdown")
        .setDescription("Announce the session shutdown."),
    async execute(interaction, client) {
        // Defer immediately to prevent "Unknown Interaction" (10062) if API is slow
        await interaction.deferReply({ flags: [64] }).catch(() => null);

        const { channels } = config;

        try {
            let channel;
            if (channels.session) {
                channel = await client.channels.fetch(channels.session).catch(() => null);
            }
            if (!channel) {
                channel = interaction.channel;
            }

            await announceShutdown(client, channel);

            await interaction.editReply({
                content: "**Successfully** announced the session shutdown.",
            });
        } catch (error) {
            console.error("[SHUTDOWN COMMAND ERROR]", error);
            await interaction.editReply({
                content: "❌ An error occurred during shutdown. Please check the logs channel.",
            }).catch(() => null);
        }
    },
};
