const fs = require("fs");
const path = require("path");
const { AttachmentBuilder } = require("discord.js");

// Drop an image here (e.g. assets/session-header.png) to use a local file instead of
// a hosted URL — it's attached to the message directly and referenced as attachment://
const ASSETS_DIR = path.join(__dirname, "../../assets");
const SUPPORTED_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];

/**
 * Looks for a local image in /assets before falling back to a hosted URL.
 * `baseNames` can be a single name or an array checked in priority order —
 * e.g. ["shutdown-header", "session-header"] lets a command-specific image
 * override the shared branding image, while still falling back to it by default.
 * Returns { url, attachment } or null if nothing is available.
 */
function resolveImageAsset(baseNames, fallbackUrl) {
    const names = Array.isArray(baseNames) ? baseNames : [baseNames];

    for (const baseName of names) {
        for (const ext of SUPPORTED_EXTS) {
            const filename = `${baseName}.${ext}`;
            const localPath = path.join(ASSETS_DIR, filename);
            if (fs.existsSync(localPath)) {
                return {
                    url: `attachment://${filename}`,
                    attachment: new AttachmentBuilder(localPath, { name: filename }),
                };
            }
        }
    }

    if (fallbackUrl && fallbackUrl.startsWith("http")) {
        return { url: fallbackUrl, attachment: null };
    }

    return null;
}

module.exports = { resolveImageAsset, ASSETS_DIR, SUPPORTED_EXTS };
