const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(relative, mocks = {}) {
    const filename = path.join(__dirname, "..", relative);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", output)((name) => {
        if (name in mocks) return mocks[name];
        throw new Error(`Unexpected dependency: ${name}`);
    }, module, module.exports);
    return module.exports;
}

const { lyricSearchKeyword, lyricSearchContext } = load("src/shared/plugin-manager/lyric-search.ts");
const item = { platform: "KG", id: "123", hash: "ABC", kg_song_id: "123", album_audio_id: 456,
    title: "My Heart Will Go On", artist: "Celine Dion", duration: 273.456, privateToken: "hidden" };
assert.equal(lyricSearchKeyword(item), "Celine Dion - My Heart Will Go On");
assert.equal(lyricSearchKeyword({ ...item, artist: "" }), item.title);
const context = lyricSearchContext(item, "KG");
assert.equal(context.durationMs, 273456);
assert.deepEqual(context.musicItem, { id: "123", hash: "ABC", kg_song_id: "123", album_audio_id: 456 });
assert.equal(lyricSearchContext(item, "QQ").musicItem, undefined);
for (const duration of [undefined, NaN, Infinity, -1, 0]) {
    assert.equal(lyricSearchContext({ ...item, duration }, "KG").durationMs, undefined);
}

const PluginMethods = load("src/shared/plugin-manager/main/plugin-methods.ts", {
    "@/common/media-util": { resetMediaItem: (row, platform) => { row.platform = platform; } },
    "fs/promises": {}, "@/common/time-util": {}, axios: {}, crypto: require("node:crypto"),
    "@/common/file-util": {}, path: require("node:path"), "./lyric-decrypt": {},
    "@shared/service-manager/main": {}, "../lx-adapter": {},
}).default;

(async () => {
    let received;
    const methods = new PluginMethods({ name: "KG", instance: {
        search: async (...args) => { received = args; return { data: [{ id: "lyric" }] }; },
    } });
    const result = await methods.search(lyricSearchKeyword(item), 1, "lyric", context);
    assert.deepEqual(received, ["Celine Dion - My Heart Will Go On", 1, "lyric", context]);
    assert.equal(result.data[0].platform, "KG");
    const legacy = new PluginMethods({ name: "Legacy", instance: {
        search: async (query, page, type) => ({ data: [{ id: `${query}:${page}:${type}` }] }),
    } });
    assert.equal((await legacy.search("song", 1, "lyric", context)).data[0].id, "song:1:lyric");
    console.log("Lyric search context tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
