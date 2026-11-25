/* Replace the .invalid API with an HTTPS service you control. Install this single file. */
const axios = require("axios");
const PLATFORM = "Example API";
const API = "https://api.example.invalid/v1";

function variables() {
    return env.getUserVariables(); // Read at call time; never capture credentials at load.
}

function music(row) {
    if (!row || row.id == null || typeof row.title !== "string" || typeof row.artist !== "string") {
        throw new Error("The music service returned an invalid song");
    }
    const duration = Number(row.durationSeconds);
    return { id: String(row.id), platform: PLATFORM, title: row.title, artist: row.artist,
        album: row.album || "", artwork: row.artwork,
        ...(row.durationSeconds != null && Number.isFinite(duration) && duration >= 0 ? { duration } : {}) };
}

async function request(path, params) {
    const token = variables().token;
    const response = await axios.get(API + path, {
        params, timeout: 10000,
        headers: token ? { Authorization: "Bearer " + token } : {},
    });
    return typeof response.data === "string" ? JSON.parse(response.data) : response.data;
}

module.exports = {
    platform: PLATFORM,
    version: "1.0.0",
    author: "Your name",
    primaryKey: ["id"],
    supportedSearchType: ["music"],
    supportedQualities: ["128k", "320k"],
    cacheControl: "no-cache",
    userVariables: [{ key: "token", name: "API token", hint: "Optional account token" }],
    async search(query, page, type) {
        if (type !== "music" || !query.trim()) return { data: [], isEnd: true };
        const result = await request("/songs", { q: query, page });
        if (!Array.isArray(result.items) || typeof result.hasMore !== "boolean") {
            throw new Error("The music service returned an invalid search result");
        }
        return { data: result.items.map(music), isEnd: !result.hasMore };
    },
    async getMediaSource(item, quality) {
        if (!["128k", "320k"].includes(quality)) return null;
        const result = await request("/songs/" + encodeURIComponent(item.id) + "/source", { quality });
        if (result.unavailable === true) return null;
        if (typeof result.url !== "string" || !/^https:\/\//.test(result.url)) {
            throw new Error("The music service returned an invalid audio URL");
        }
        return { url: result.url, quality, headers: result.headers || {} };
    },
};
