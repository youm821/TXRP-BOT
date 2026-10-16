require("dotenv").config();

module.exports = {
    bot: {
        token: process.env.TOKEN,
        ownerId: process.env.OWNER_ID,
        name: process.env.BOT_NAME || "Nova ERLC Manager",
        statusText: process.env.BOT_STATUS_TEXT || "Watching ER:LC Private Server",
    },
    erlc: {
        apiKey: process.env.ERLC_API_KEY,
        serverKey: process.env.ERLC_SERVER_KEY,
        // PRC/ER:LC migrated their API to this domain — the old
        // api.policeroleplay.community domain now 404s on some endpoints.
        baseUrl: process.env.ERLC_BASE_URL || "https://api.erlc.gg/v2",
    },
    guildId: process.env.GUILD_ID,
    channels: {
        logs: process.env.LOGS_CHANNEL_ID,
        session: process.env.SESSION_CHANNEL_ID,
        announcements: process.env.ANNOUNCEMENTS_CHANNEL_ID,
    },
    roles: {
        staff: process.env.STAFF_ROLE_ID,
        notifications: process.env.NOTIFICATIONS_ROLE_ID ? process.env.NOTIFICATIONS_ROLE_ID.split(',').map(id => id.trim()) : [],
    },
    session: {
        serverName: process.env.SERVER_NAME,
        serverOwner: process.env.SERVER_OWNER,
        joinCode: process.env.JOIN_CODE,
        quickJoinUrl: process.env.QUICK_JOIN_URL,
        images: {
            header: process.env.HEADER_IMAGE,
            footer: process.env.FOOTER_IMAGE,
        },
        times: {
            weekday: process.env.WEEKDAY_TIME,
            weekend: process.env.WEEKEND_TIME,
        },
        statusIntro: (process.env.SESSION_STATUS_INTRO ||
            "> Are you prepared for Texas sessions! You are in the right place!\\n" +
            "> Currently our session is online/offline! Next session will be hosted shortly! Vote up and join our sessions to get them full even faster to make our roleplay better!"
        ).replace(/\\n/g, '\n'),
        statusSpoiler: process.env.SESSION_STATUS_SPOILER !== "false", // defaults to true
    },
    emojis: {
        check: process.env.EMOJI_CHECK || "✅",
        users: process.env.EMOJI_USERS || "👥",
        tada: process.env.EMOJI_TADA || "🎉",
        gift: process.env.EMOJI_GIFT || "🎁",
    },
    messages: {
        boost: (process.env.MSG_SESSION_BOOST || "**The session is currently slow!**\\nWe need more players to keep the session active and high quality.\\nPlease consider joining to support the community!").replace(/\\n/g, '\n'),
        full: (process.env.MSG_SESSION_FULL || "**The server is currently full!**\\nIf you're trying to join, please wait in the queue.\\nPlayers are advised to stay in the queue to ensure their spot when someone leaves.").replace(/\\n/g, '\n'),
        shutdown: (process.env.MSG_SESSION_SHUTDOWN ||
            "> **Thank you for joining today's Session. At this time, our server is shut down. Please don't join the game as we have no players in-game. Refrain from pinging Staff Team members to conduct a Session Startup—it will occur when Staff are available.**"
        ).replace(/\\n/g, '\n'),
    },
    shutdownEmbed: {
        headerSpoiler: process.env.SESSION_SHUTDOWN_HEADER_SPOILER !== "false", // defaults to true
    },
    theme: {
        color: "#37373E", // Warm Midnight
        success: "#2ECC71",
        danger: "#E74C3C",
        info: "#3498DB",
    }
};
