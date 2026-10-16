const db = require("../../db");

/**
 * The status panel's button color/label is a manual on-air indicator, not a
 * live reflection of the PRC API — staff flip it "offline" (red) by pressing
 * the shutdown button, and it flips back "online" (green) automatically the
 * next time /session-vote is run. This just persists that single boolean.
 */
function isSessionOnline() {
    const row = db.prepare("SELECT online FROM session_state WHERE id = 1").get();
    return !row || row.online === 1; // default to online if the row is somehow missing
}

function setSessionOnline(online) {
    db.prepare("INSERT OR IGNORE INTO session_state (id, online) VALUES (1, 1)").run();
    db.prepare("UPDATE session_state SET online = ? WHERE id = 1").run(online ? 1 : 0);
}

module.exports = { isSessionOnline, setSessionOnline };
