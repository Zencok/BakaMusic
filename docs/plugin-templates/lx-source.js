/**
 * @name Example LX Offline
 * @description Two-source musicUrl contract fixture; .invalid URLs cannot play
 * @version 1.0.0
 * @author BakaMusic example
 */
// Install as an LX source. This is not a module.exports catalog plugin.
// Replace MEDIA_BASE with your own HTTPS fixture host and provide real files.
const MEDIA_BASE = "https://lx-media.example.invalid";
const QUALITIES = { kw: ["128k", "320k"], wy: ["128k", "flac"] };

(async function initialize() {
    await lx.on(lx.EVENT_NAMES.request, async ({ source, action, info }) => {
        if (action !== "musicUrl") throw new Error("Unsupported LX action");
        const quality = info?.type;
        if (!QUALITIES[source]?.includes(quality)) throw new Error("Unsupported LX source or quality");
        // The host adapter supplies songmid from native catalog identity.
        const id = info.musicInfo?.songmid;
        if (id == null || String(id).length === 0) throw new Error("Missing source song identity");
        const extension = quality === "flac" ? ".flac" : ".mp3";
        return MEDIA_BASE + "/" + source + "/" + encodeURIComponent(String(id)) + "-" + quality + extension;
    });
    await lx.send(lx.EVENT_NAMES.inited, {
        sources: {
            kw: { name: "Example Kuwo fixture", type: "music", actions: ["musicUrl"], qualitys: QUALITIES.kw },
            wy: { name: "Example NetEase fixture", type: "music", actions: ["musicUrl"], qualitys: QUALITIES.wy },
        },
    });
})().catch(error => console.error("LX fixture initialization failed:", error.message));
