/* Offline contract checks. This is a fixture runner, not an app/runtime emulator. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const folder = __dirname;
function load(file, modules = {}, vars = {}) {
    const module = { exports: {} };
    const context = vm.createContext({ module, exports: module.exports, URL, console,
        env: { getUserVariables: () => vars }, require(name) {
            assert.ok(Object.hasOwn(modules, name), "Unexpected require: " + name);
            return modules[name];
        } });
    vm.runInContext(fs.readFileSync(path.join(folder, file), "utf8"), context, { timeout: 1000 });
    return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
async function main() {
    const vars = {};
    const plugin = load("full-plugin.js", {}, vars);
    const rpc = fs.readFileSync(path.join(folder, "../../src/shared/plugin-manager/rpc.ts"), "utf8");
    const names = [...rpc.split("] as const;")[0].matchAll(/"([a-zA-Z]+)"/g)].map(match => match[1]);
    assert.equal(names.length, 18);
    const exported = Object.keys(plugin).filter(key => typeof plugin[key] === "function");
    assert.deepEqual(exported.sort(), [...names, "getHotSearch", "getDailyRecommendations"].sort());
    const called = new Set();
    async function call(name, ...args) { called.add(name); return plain(await plugin[name](...args)); }
    async function pages(name, args, field = "data") {
        const first = await call(name, ...args(1));
        const second = await call(name, ...args(2));
        const third = await call(name, ...args(3));
        assert.equal(first[field].length, 2, name);
        assert.equal(first.isEnd, false, name);
        assert.equal(second[field].length, 1, name);
        assert.equal(second.isEnd, true, name);
        assert.deepEqual(third[field], [], name);
        assert.equal(third.isEnd, true, name);
        assert.equal(new Set([...first[field], ...second[field]].map(item => item.id)).size, 3, name);
        return first[field];
    }
    await pages("search", page => ["i", page, "music"]);
    const item = await call("getMusicInfo", { id: "song-1" });
    assert.equal(item.duration, 180); // seconds
    assert.equal(item.platform, plugin.platform);
    assert.equal(await call("getMusicInfo", { id: "missing" }), null);
    assert.deepEqual(await call("search", "absent", 1, "music"), { data: [], isEnd: true });
    for (const type of ["album", "artist", "sheet", "lyric"]) {
        const result = await call("search", type === "lyric" ? "light" : "Example", 1, type);
        assert.ok(result.data.length > 0, type);
        assert.equal(result.data[0].platform, plugin.platform);
    }
    const lyricSearch = await call("search", "ignored", 1, "lyric", {
        title: "Sunrise", artist: "Example Artist", durationMs: 180000, musicItem: { id: "song-1" },
    });
    assert.equal(lyricSearch.data[0].id, "song-1");
    assert.equal(lyricSearch.isEnd, true);
    assert.equal((await call("search", "Example Artist - Sunrise", 1, "lyric")).data[0].id, "song-1");
    const lyric = await call("getLyric", item);
    for (const key of ["rawLrc", "translation", "romanization"]) assert.match(lyric[key], /\[00:/);
    assert.equal(await call("getLyric", { id: "missing" }), null);
    for (const quality of plugin.supportedQualities) {
        const source = await call("getMediaSource", item, quality);
        assert.equal(source.quality, quality);
        assert.equal(new URL(source.url).hostname, "media.example.invalid");
    }
    assert.equal(await call("getMediaSource", item, "unsupported"), null);
    assert.equal(await call("getMediaSource", { id: "missing" }, "128k"), null);
    vars.mediaBaseUrl = "https://fixtures.example.invalid/audio";
    assert.match((await call("getMediaSource", item, "320k")).url, /^https:\/\/fixtures\.example\.invalid\/audio\//);
    for (const quality of plugin.supportedVideoQualities) {
        const source = await call("getMvSource", item, quality);
        assert.equal(source.videoQuality, quality);
        assert.ok(source.availableVideoQualities.some(option => option.key === quality));
        assert.equal(source.mimeType, "video/mp4");
    }
    assert.equal((await call("getMvSource", item)).videoQuality, "720p");
    assert.equal(await call("getMvSource", item, "4k"), null);
    const album = (await call("search", "Example", 1, "album")).data[0];
    const artist = (await call("search", "Example", 1, "artist")).data[0];
    const sheet = (await call("search", "Example", 1, "sheet")).data[0];
    await pages("getAlbumInfo", page => [album, page], "musicList");
    await pages("getMusicSheetInfo", page => [sheet, page], "musicList");
    await pages("getArtistWorks", page => [artist, page, "music"]);
    assert.equal((await call("getArtistWorks", artist, 1, "album")).data[0].id, album.id);
    assert.equal((await call("getArtistInfo", artist)).name, artist.name);
    assert.equal(await call("getArtistInfo", { id: "missing" }), null);
    const link = "https://catalog.example.invalid/sheet/sheet-1";
    const snapshot = await call("importMusicSheet", link);
    assert.equal(snapshot.musicList.length, 3);
    assert.ok(snapshot.syncVersion);
    assert.deepEqual(await call("importMusicSheet", link, { knownVersion: snapshot.syncVersion }),
        { notModified: true, syncVersion: snapshot.syncVersion });
    assert.equal((await call("importMusicSheet", link, { knownVersion: "old" })).musicList.length, 3);
    assert.equal(await call("importMusicSheet", "https://elsewhere.invalid/sheet/sheet-1"), null);
    const songLink = await call("getMusicDetailPageUrl", item);
    assert.equal((await call("importMusicItem", songLink)).id, item.id);
    assert.equal(await call("importMusicItem", "not a URL"), null);
    assert.equal(await call("getMusicDetailPageUrl", { id: "missing" }), null);
    const tops = await call("getTopLists");
    assert.ok(tops[0].data[0].id);
    await pages("getTopListDetail", page => [tops[0].data[0], page], "musicList");
    const tags = await call("getRecommendSheetTags");
    assert.ok(tags.data[0].data[0].id);
    await pages("getRecommendSheetsByTag", page => [tags.pinned[0], page]);
    assert.deepEqual(await call("getRecommendSheetsByTag", { id: "missing" }, 1), { data: [], isEnd: true });
    const comments = await pages("getMusicComments", page => [item, page]);
    assert.ok(comments[0].nickName && comments[0].comment && comments[0].replies.length);
    assert.deepEqual(await call("getMusicComments", { id: "missing" }), { data: [], isEnd: true });
    assert.equal((await call("recognize", "AAAAAA==", 8000, 1)).data[0].confidence, 1);
    assert.deepEqual((await call("recognize", "different", 8000, 1)).data, []);
    assert.deepEqual((await call("recognize", "AAAAAA==", 44100, 2)).data, []);
    assert.equal((await call("getHotSearch")).length, 3);
    const daily = await call("getDailyRecommendations");
    assert.equal(daily.state, "ready");
    assert.match(daily.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(daily.refreshAt > Date.now());
    assert.equal(daily.sheetItem.musicList.length, 3);
    assert.deepEqual([...called].sort(), exported.sort());

    const requests = [];
    const token = { token: "first" };
    let response;
    const minimal = load("minimal-plugin.js", { axios: { async get(url, options) {
        requests.push({ url, options }); return { data: response };
    } } }, token);
    response = { items: [{ id: 7, title: "Track", artist: "Artist", durationSeconds: 180 }], hasMore: true };
    assert.equal((await minimal.search("track", 1, "music")).isEnd, false);
    assert.equal(requests[0].options.headers.Authorization, "Bearer first");
    response = { items: [], hasMore: false };
    assert.deepEqual(plain(await minimal.search("track", 2, "music")), { data: [], isEnd: true });
    assert.deepEqual(plain(await minimal.search("", 1, "music")), { data: [], isEnd: true });
    assert.deepEqual(plain(await minimal.search("track", 1, "sheet")), { data: [], isEnd: true });
    token.token = "second";
    response = JSON.stringify({ url: "https://audio.example.invalid/song.mp3", headers: { Referer: "https://example.invalid" } });
    assert.equal((await minimal.getMediaSource({ id: "7" }, "320k")).quality, "320k");
    assert.equal(requests.at(-1).options.headers.Authorization, "Bearer second");
    assert.equal(requests.at(-1).options.timeout, 10000);
    response = { unavailable: true };
    assert.equal(await minimal.getMediaSource({ id: "7" }, "128k"), null);
    assert.equal(await minimal.getMediaSource({ id: "7" }, "flac"), null);
    response = { items: "bad" };
    await assert.rejects(minimal.search("track", 1, "music"), /invalid search/);
    response = { url: "http://bad.invalid" };
    await assert.rejects(minimal.getMediaSource({ id: "7" }, "128k"), /invalid audio/);
    response = { items: [{ id: "unknown-duration", title: "Track", artist: "Artist" }], hasMore: false };
    assert.equal(Object.hasOwn((await minimal.search("track", 1, "music")).data[0], "duration"), false);

    let lxHandler, lxDeclaration;
    const lxEvents = [];
    let initResolve;
    const initialized = new Promise(resolve => { initResolve = resolve; });
    const lxContext = vm.createContext({ console, lx: {
        EVENT_NAMES: { request: "request", inited: "inited" },
        async on(event, handler) {
            assert.equal(event, "request");
            assert.equal(typeof handler, "function");
            lxEvents.push(event); lxHandler = handler;
        },
        async send(event, declaration) {
            assert.equal(event, "inited");
            assert.equal(typeof lxHandler, "function");
            lxEvents.push(event); lxDeclaration = plain(declaration); initResolve();
        },
    } });
    vm.runInContext(fs.readFileSync(path.join(folder, "lx-source.js"), "utf8"), lxContext, { timeout: 1000 });
    await initialized;
    assert.deepEqual(lxEvents, ["request", "inited"]);
    assert.deepEqual(Object.keys(lxDeclaration.sources).sort(), ["kw", "wy"]);
    for (const [source, declaration] of Object.entries(lxDeclaration.sources)) {
        assert.equal(declaration.type, "music");
        assert.deepEqual(declaration.actions, ["musicUrl"]);
        for (const quality of declaration.qualitys) {
            const url = await lxHandler({ source, action: "musicUrl", info: { type: quality, musicInfo: { songmid: "test/id" } } });
            assert.equal(new URL(url).hostname, "lx-media.example.invalid");
            assert.ok(url.includes("test%2Fid-" + quality));
        }
    }
    await assert.rejects(lxHandler({ source: "tx", action: "musicUrl", info: { type: "128k" } }), /Unsupported LX source/);
    await assert.rejects(lxHandler({ source: "kw", action: "search", info: {} }), /Unsupported LX action/);
    await assert.rejects(lxHandler({ source: "kw", action: "musicUrl", info: { type: "flac" } }), /Unsupported LX source/);
    await assert.rejects(lxHandler({ source: "wy", action: "musicUrl", info: { type: "128k", musicInfo: {} } }), /Missing source/);
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.example.json"), "utf8"));
    assert.equal(manifest.plugins.length, 2);
    for (const entry of manifest.plugins) assert.equal(new URL(entry.url).protocol, "https:");
    console.log("Plugin templates: all 20 full methods, minimal API mapping, LX events/sources, pagination and manifests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
