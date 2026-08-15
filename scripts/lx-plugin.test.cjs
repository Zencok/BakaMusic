const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");

function read(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

const {
    getLxMusicQualityKeys,
    getLxQualityFallbacks,
    parseLxScriptInfo,
    replaceLxMusicQualities,
    toLxMusicInfo,
} = require("../src/shared/plugin-manager/lx-adapter.ts");
const {
    getLxSourceForPlatform,
} = require("../src/shared/plugin-manager/lx-types.ts");

for (const [platform, source] of [
    ["网易云音乐", "wy"],
    ["QQ音乐", "tx"],
    ["酷狗音乐", "kg"],
    ["酷我音乐", "kw"],
    ["咪咕音乐", "mg"],
]) {
    assert.equal(getLxSourceForPlatform(platform), source);
}
assert.equal(getLxSourceForPlatform("Bilibili"), null);

const scriptInfo = parseLxScriptInfo(`/*
 * @name Fixture LX Source
 * @description Playback only
 * @version v26
 * @author Fixture Author
 * @homepage https://example.com/lx
 */
lx.send(lx.EVENT_NAMES.inited, {});
`, "fallback");
assert.deepEqual(scriptInfo, {
    name: "Fixture LX Source",
    description: "Playback only",
    version: "v26",
    author: "Fixture Author",
    homepage: "https://example.com/lx",
});
assert.equal(parseLxScriptInfo("(()=>{})()", "remote-lx").name, "remote-lx");

const baseMusic = {
    id: "base-id",
    title: "Fixture Song",
    artist: "Fixture Artist",
    album: "Fixture Album",
    albumId: "album-id",
    artwork: "https://example.com/cover.jpg",
    duration: 185000,
    songmid: "song-mid",
    qualities: {
        "128k": { size: 1000 },
        "320k": { size: 2000 },
        flac: { size: 3000 },
        hires: { size: 4000 },
    },
};

const wy = toLxMusicInfo("wy", baseMusic);
assert.equal(wy.source, "wy");
assert.equal(wy.name, "Fixture Song");
assert.equal(wy.singer, "Fixture Artist");
assert.equal(wy.songmid, "song-mid");
assert.equal(wy.interval, "03:05");
assert.equal(wy.meta.albumId, "album-id");

const tx = toLxMusicInfo("tx", {
    ...baseMusic,
    songmid: "qq-song-mid",
    mediaMid: "qq-media-mid",
    albumMid: "qq-album-mid",
    songId: 123,
});
assert.equal(tx.strMediaMid, "qq-media-mid");
assert.equal(tx.albumMid, "qq-album-mid");
assert.equal(tx.songId, 123);

const kg = toLxMusicInfo("kg", {
    ...baseMusic,
    songmid: undefined,
    audio_id: 456,
    hash: "kg-base-hash",
    "320hash": "kg-320-hash",
    sqhash: "kg-flac-hash",
    ResFileHash: "kg-hires-hash",
});
assert.equal(kg.songmid, 456);
assert.equal(kg.hash, "kg-base-hash");
assert.equal(kg._types["320k"].hash, "kg-320-hash");
assert.equal(kg._types.flac.hash, "kg-flac-hash");
assert.equal(kg._types.hires.hash, "kg-hires-hash");

const mg = toLxMusicInfo("mg", {
    ...baseMusic,
    copyrightId: "mg-copyright-id",
    lrcUrl: "https://example.com/lyric.lrc",
});
assert.equal(mg.copyrightId, "mg-copyright-id");
assert.equal(mg.meta.lrcUrl, "https://example.com/lyric.lrc");

const replacedMusic = replaceLxMusicQualities({
    ...baseMusic,
    qualities: { ...baseMusic.qualities },
}, ["320k", "hires", "master"]);
assert.deepEqual(
    getLxMusicQualityKeys(baseMusic, ["320k", "hires", "master"]),
    ["320k", "hires"],
);
assert.deepEqual(
    getLxMusicQualityKeys(baseMusic, ["320k", "hires", "master"], true),
    ["320k", "hires", "master"],
);
assert.deepEqual(Object.keys(replacedMusic.qualities), ["320k", "hires"]);
assert.deepEqual(replacedMusic.qualities["320k"], { size: 2000 });
assert.equal(replacedMusic.qualities.master, undefined);
assert.equal(replacedMusic.qualities["128k"], undefined);
assert.equal(replacedMusic.qualities.flac, undefined);

assert.deepEqual(
    getLxQualityFallbacks("flac", ["128k", "320k", "flac", "master"]),
    ["flac", "320k", "128k"],
);
assert.deepEqual(
    getLxQualityFallbacks("128k", ["128k", "320k", "flac"]),
    ["128k"],
);

const managerSource = read("src/shared/plugin-manager/main/lx-plugin-manager.ts");
const hostSource = read("src/shared/plugin-manager/utility/lx-plugin-host.ts");
const methodsSource = read("src/shared/plugin-manager/main/plugin-methods.ts");
const sectionSource = read(
    "src/renderer/pages/main-page/views/plugin-manager-view/components/lx-plugin-section/index.tsx",
);

assert.match(managerSource, /assertUrl\(urlLike\.trim\(\), \["https:"\], 8192\)/);
assert.doesNotMatch(managerSource, /LX plugin URL must end with \.js/);
assert.doesNotMatch(sectionSource, /pathname[\s\S]{0,80}endsWith\("\.js"\)/);
assert.match(sectionSource, /\{plugin\.version \|\| "-"\}/);
assert.doesNotMatch(sectionSource, /`v\$\{plugin\.version\}`/);
assert.match(sectionSource, /setActiveLxPlugin\(null\)/);
assert.match(managerSource, /activeSelection\.configured/);
assert.match(managerSource, /getLxQualityFallbacks/);
assert.match(managerSource, /quality: candidateQuality/);
assert.match(managerSource, /LX_MEDIA_PROBE_ATTEMPTS = 2/);
assert.match(managerSource, /LX media URL probe failed/);

assert.match(hostSource, /type !== "music"/);
assert.match(hostSource, /actions\.includes\("musicUrl"\)/);
assert.match(hostSource, /action: "musicUrl"/);
assert.match(hostSource, /probeLxMediaUrl/);
assert.match(hostSource, /Range: "bytes=0-1"/);
assert.match(hostSource, /lx-update-alert/);
assert.match(hostSource, /updateUrl/);
assert.match(managerSource, /handleUpdateAlert/);
assert.match(managerSource, /pendingUpdateAlerts/);
assert.match(managerSource, /expectedName/);
assert.match(
    managerSource,
    /getLxMusicQualityKeys\(musicItem, sourceDescriptor\.qualities, true\)\.includes\(quality\)/,
);
assert.match(methodsSource, /getLxMusicQualityKeys\(musicItem, lxQualityKeys, true\)/);

const extensionlessUrl = new URL("https://source.example.com/api/script/lx?key=fixture");
assert.equal(extensionlessUrl.protocol, "https:");
assert.equal(extensionlessUrl.pathname, "/api/script/lx");

console.log("LX plugin compatibility tests passed.");
