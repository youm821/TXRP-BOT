const db = require("../../db");

const ONE_HOUR_MS = 3600000;

function createPoll(sessionId, channelId, messageId, requiredVotes) {
    db.prepare(`INSERT INTO vote_polls (sessionId, channelId, messageId, requiredVotes, createdAt, status)
        VALUES (?, ?, ?, ?, ?, 'active')`)
        .run(sessionId, channelId, messageId, requiredVotes, Date.now());
}

function getPoll(sessionId) {
    return db.prepare("SELECT * FROM vote_polls WHERE sessionId = ?").get(sessionId) || null;
}

function isPollActive(sessionId) {
    const poll = getPoll(sessionId);
    return !!poll && poll.status === "active";
}

/**
 * Most recently created still-active poll — used as a fallback when the
 * in-memory `client.activePollId` pointer was lost (e.g. after a restart).
 */
function getLatestActivePoll() {
    return db.prepare("SELECT * FROM vote_polls WHERE status = 'active' ORDER BY createdAt DESC LIMIT 1").get() || null;
}

function getVoters(sessionId) {
    return db.prepare("SELECT userId, timestamp FROM vote_entries WHERE sessionId = ? ORDER BY timestamp ASC").all(sessionId);
}

function getVoteCount(sessionId) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM vote_entries WHERE sessionId = ?").get(sessionId);
    return row ? row.count : 0;
}

/**
 * Toggles a user's vote for a poll. Returns null if the poll doesn't exist
 * or has already concluded (caller should treat that as "vote closed").
 */
function toggleVote(sessionId, userId) {
    if (!isPollActive(sessionId)) return null;

    const existing = db.prepare("SELECT 1 FROM vote_entries WHERE sessionId = ? AND userId = ?").get(sessionId, userId);

    if (existing) {
        db.prepare("DELETE FROM vote_entries WHERE sessionId = ? AND userId = ?").run(sessionId, userId);
        return { voted: false, count: getVoteCount(sessionId) };
    }

    db.prepare("INSERT INTO vote_entries (sessionId, userId, timestamp) VALUES (?, ?, ?)").run(sessionId, userId, Date.now());
    return { voted: true, count: getVoteCount(sessionId) };
}

/**
 * Atomically marks a poll as ended, returning true only for the caller that
 * actually won the race (i.e. the UPDATE changed a row). Safe under Node's
 * single-threaded event loop since better-sqlite3 runs this synchronously —
 * no other JS can run between the check and the write.
 */
function endPollIfActive(sessionId) {
    const result = db.prepare("UPDATE vote_polls SET status = 'ended' WHERE sessionId = ? AND status = 'active'").run(sessionId);
    return result.changes > 0;
}

/**
 * Ends any poll that's been active longer than maxAgeMs without concluding.
 * Called both periodically and once on bot startup.
 */
function abandonStalePolls(maxAgeMs = ONE_HOUR_MS) {
    const cutoff = Date.now() - maxAgeMs;
    const result = db.prepare("UPDATE vote_polls SET status = 'ended' WHERE status = 'active' AND createdAt < ?").run(cutoff);
    return result.changes;
}

module.exports = {
    ONE_HOUR_MS,
    createPoll,
    getPoll,
    isPollActive,
    getLatestActivePoll,
    getVoters,
    getVoteCount,
    toggleVote,
    endPollIfActive,
    abandonStalePolls,
};
