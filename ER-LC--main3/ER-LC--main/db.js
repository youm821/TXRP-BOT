const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "database.sqlite"));
db.pragma('journal_mode = WAL'); // Enable Write-Ahead Logging for better concurrency
db.pragma('foreign_keys = ON');  // Enable FK enforcement so ON DELETE CASCADE fires

// Initialize tables
db.exec(`
    CREATE TABLE IF NOT EXISTS infractions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        moderatorId TEXT NOT NULL,
        reason TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        moderatorId TEXT NOT NULL,
        oldRank TEXT,
        newRank TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        channelId TEXT NOT NULL,
        messageId TEXT NOT NULL,
        status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS status_panels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channelId TEXT NOT NULL,
        messageId TEXT NOT NULL,
        status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS session_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        online INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS giveaways (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId TEXT NOT NULL UNIQUE,
        channelId TEXT NOT NULL,
        prize TEXT NOT NULL,
        winnersCount INTEGER NOT NULL,
        endTime INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS giveaway_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId TEXT NOT NULL,
        userId TEXT NOT NULL,
        enteredAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        UNIQUE(messageId, userId),
        FOREIGN KEY(messageId) REFERENCES giveaways(messageId) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_subscribers (
        userId TEXT PRIMARY KEY,
        serverStatus INTEGER NOT NULL DEFAULT 0,
        queueAlerts INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS roblox_links (
        discordId TEXT PRIMARY KEY,
        robloxId TEXT NOT NULL,
        robloxUsername TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS queue_watch_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        hadRoom INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS vote_polls (
        sessionId TEXT PRIMARY KEY,
        channelId TEXT NOT NULL,
        messageId TEXT NOT NULL,
        requiredVotes INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS vote_entries (
        sessionId TEXT NOT NULL,
        userId TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (sessionId, userId),
        FOREIGN KEY (sessionId) REFERENCES vote_polls(sessionId) ON DELETE CASCADE
    );
`);

// Make sure the single session_state row always exists (defaults to online)
db.prepare("INSERT OR IGNORE INTO session_state (id, online) VALUES (1, 1)").run();
db.prepare("INSERT OR IGNORE INTO queue_watch_state (id, hadRoom) VALUES (1, 1)").run();

module.exports = db;
