Drop images here (PNG/JPG/JPEG/GIF/WEBP) to attach them locally instead of using a hosted URL.
No external image hosting needed — the bot attaches the file directly and references it.

Used by /session-status:
- session-header.png — top image
- session-footer.png — bottom image

Used by /session-shutdown (falls back to the session-header/footer images above if these aren't present):
- shutdown-header.png — top image (shown blurred/spoilered by default)
- shutdown-footer.png — bottom image

If none of the above local files exist, HEADER_IMAGE / FOOTER_IMAGE from .env are used instead.
