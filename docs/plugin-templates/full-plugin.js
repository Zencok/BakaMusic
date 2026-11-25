/* Offline contract demonstrator. All .invalid URLs are deliberately nonplayable.
 * To test media, supply mediaBaseUrl pointing to YOUR HTTPS fixtures described in README.
 * Fixture recognition below is NOT an audio fingerprinting implementation.
 */
const PLATFORM = "Example Offline";
const ORIGIN = "https://catalog.example.invalid";
const VERSION = "fixture-snapshot-1";
const clone = value => JSON.parse(JSON.stringify(value));
const art = ORIGIN + "/cover.jpg";
const songs = ["Sunrise", "Moonlight", "Starlight"].map((title, index) => ({
    id: "song-" + (index + 1), platform: PLATFORM, title, artist: "Example Artist",
    album: "Example Album", albumId: "album-1", artistId: "artist-1",
    artwork: art, duration: 180 + index, mv: "video-" + (index + 1),
}));
const album = { id: "album-1", platform: PLATFORM, title: "Example Album", artist: "Example Artist",
    artwork: art, description: "An offline example album", date: "2026-01-01", worksNum: 3 };
const artist = { id: "artist-1", platform: PLATFORM, name: "Example Artist", avatar: art,
    description: "An offline example artist", fans: 42 };
const sheets = [1, 2, 3].map(i => ({ id: "sheet-" + i, platform: PLATFORM,
    title: "Example Playlist " + i, artwork: art, description: "Offline fixture", worksNum: 3 }));
const comments = [1, 2, 3].map(i => ({ id: "comment-" + i, nickName: "Listener " + i,
    comment: "Example comment " + i, createAt: 1767225600000 + i, like: i,
    replies: i === 1 ? [{ id: "reply-1", nickName: "Example Artist", comment: "Thank you!" }] : [] }));
function paginate(items, page = 1) {
    if (!Number.isInteger(page) || page < 1) throw new Error("Page must be a positive integer");
    const start = (page - 1) * 2;
    return { data: clone(items.slice(start, start + 2)), isEnd: start + 2 >= items.length };
}
function song(item) { return songs.find(value => value.id === item?.id); }
function mediaBase() {
    const value = env.getUserVariables().mediaBaseUrl || "https://media.example.invalid";
    if (!/^https:\/\//.test(value)) throw new Error("Media base URL must use HTTPS");
    return value.replace(/\/+$/, "");
}
function fromLink(value, kind) {
    try {
        const url = new URL(value);
        return url.origin === ORIGIN && url.pathname.startsWith("/" + kind + "/")
            ? decodeURIComponent(url.pathname.slice(kind.length + 2)) : null;
    } catch { return null; }
}

module.exports = {
    platform: PLATFORM, version: "1.0.0", author: "BakaMusic example",
    primaryKey: ["id"], defaultSearchType: "music",
    supportedSearchType: ["music", "album", "artist", "sheet", "lyric"],
    supportedQualities: ["128k", "320k", "flac"], supportedVideoQualities: ["720p", "1080p"],
    cacheControl: "no-cache",
    userVariables: [{ key: "mediaBaseUrl", name: "Fixture media server", hint: "Your HTTPS fixture base URL" }],
    hints: { importMusicSheet: [ORIGIN + "/sheet/sheet-1"], importMusicItem: [ORIGIN + "/song/song-1"] },
    async search(query, page, type, context) {
        let items = { music: songs, album: [album], artist: [artist], sheet: sheets,
            lyric: songs.map(item => ({ ...item, rawLrcTxt: "[00:00.00]" + item.title })) }[type] || [];
        // Lyric context.durationMs is milliseconds; song.duration above is seconds.
        if (type === "lyric" && context?.musicItem?.id) {
            items = items.filter(item => item.id === context.musicItem.id);
        } else {
            const key = String(query).trim().toLowerCase();
            const tokens = key.split(/[\s-]+/).filter(Boolean);
            items = tokens.length ? items.filter(item => {
                const text = [item.title || item.name, item.artist].filter(Boolean).join(" ").toLowerCase();
                return tokens.every(token => text.includes(token));
            }) : [];
        }
        return paginate(items, page);
    },
    async getMediaSource(item, quality) {
        if (!song(item) || !["128k", "320k", "flac"].includes(quality)) return null;
        return { url: mediaBase() + "/" + item.id + "-" + quality + (quality === "flac" ? ".flac" : ".mp3"),
            quality, headers: { "X-Example-Fixture": "1" } };
    },
    async getMvSource(item, quality = "720p") {
        if (!song(item) || !["720p", "1080p"].includes(quality)) return null;
        return { url: mediaBase() + "/" + song(item).mv + "-" + quality + ".mp4",
            videoQuality: quality, mimeType: "video/mp4", dynamicRange: "sdr",
            width: quality === "1080p" ? 1920 : 1280, height: quality === "1080p" ? 1080 : 720,
            availableVideoQualities: [{ key: "720p", label: "720p", width: 1280, height: 720 },
                { key: "1080p", label: "1080p", width: 1920, height: 1080 }] };
    },
    async getMusicInfo(item) { return song(item) ? clone(song(item)) : null; },
    async getLyric(item) {
        return song(item) ? { rawLrc: "[00:00.00]" + song(item).title + "\n[00:05.00]A new day",
            translation: "[00:00.00]示例歌词\n[00:05.00]新的一天", romanization: "[00:05.00]A new day" } : null;
    },
    async getAlbumInfo(item, page) {
        if (item.id !== album.id) return null;
        const result = paginate(songs, page);
        return { albumItem: clone(album), musicList: result.data, isEnd: result.isEnd };
    },
    async getMusicSheetInfo(item, page) {
        const sheet = sheets.find(value => value.id === item.id);
        if (!sheet) return null;
        const result = paginate(songs, page);
        return { sheetItem: clone(sheet), musicList: result.data, isEnd: result.isEnd };
    },
    async getArtistWorks(item, page, type) {
        return paginate(item.id === artist.id ? ({ music: songs, album: [album] }[type] || []) : [], page);
    },
    async getArtistInfo(item) { return item.id === artist.id ? clone(artist) : null; },
    async importMusicSheet(urlLike, options) {
        const sheet = sheets.find(value => value.id === fromLink(urlLike, "sheet"));
        if (!sheet) return null;
        // Desktop-only conditional snapshot protocol. Always return ALL tracks in a full snapshot.
        if (options?.knownVersion === VERSION) return { notModified: true, syncVersion: VERSION };
        return { ...clone(sheet), musicList: clone(songs), syncVersion: VERSION };
    },
    async importMusicItem(urlLike) {
        const item = songs.find(value => value.id === fromLink(urlLike, "song"));
        return item ? clone(item) : null;
    },
    async getTopLists() { return [{ title: "Example charts", data: [clone(sheets[0])] }]; },
    async getTopListDetail(item, page) {
        if (item.id !== sheets[0].id) return { musicList: [], isEnd: true };
        const result = paginate(songs, page);
        return { topListItem: clone(sheets[0]), sheetItem: clone(sheets[0]), musicList: result.data, isEnd: result.isEnd };
    },
    async getRecommendSheetTags() {
        return { pinned: [{ id: "all", title: "All" }], data: [{ title: "Mood", data: [{ id: "calm", title: "Calm" }] }] };
    },
    async getRecommendSheetsByTag(tag, page = 1) { return paginate(["all", "calm"].includes(tag.id) ? sheets : [], page); },
    async getMusicComments(item, page = 1) { return paginate(song(item) ? comments : [], page); },
    getMusicDetailPageUrl(item) { return song(item) ? ORIGIN + "/song/" + encodeURIComponent(item.id) : null; },
    async recognize(audioBase64, sampleRate = 8000, channels = 1) {
        // Only a known test sample: four zero PCM bytes. Replace with your actual recognition service.
        return { isEnd: true, data: audioBase64 === "AAAAAA==" && sampleRate === 8000 && channels === 1
            ? [{ ...clone(songs[0]), confidence: 1 }] : [] };
    },
    // Flutter extensions; desktop RPC does not expose these two functions.
    async getHotSearch() { return ["Sunrise", "Moonlight", "Starlight"]; },
    async getDailyRecommendations() {
        const now = new Date();
        const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        return { state: "ready", title: "Example daily playlist", date: new Date(midnight).toISOString().slice(0, 10),
            refreshAt: midnight + 86400000, sheetItem: { ...clone(sheets[0]), musicList: clone(songs) } };
    },
};
