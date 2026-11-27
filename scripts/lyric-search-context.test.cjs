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

(async () => {
    const providerId = "org.fixture.lyrics";
    const current = { ...item, platform: providerId, id: 123 };
    const states = { IDLE: 0, PENDING_FIRST_PAGE: 1, PENDING_REST_PAGE: 2, PARTLY_DONE: 4, FINISHED: 8, ERROR: 16 };
    const { CursorSession } = load("src/renderer/utils/cursor-session.ts", { "@/common/constant": { RequestStateCode: states } });
    let snapshot = { data: {} };
    let invalidate;
    const calls = [];
    const plugin = { id: providerId, platform: providerId, capabilities: ["search"] };
    const useSearchLyric = load("src/renderer/components/Modal/templates/SearchLyric/hooks/useSearchLyric.ts", {
        react: {
            useRef: (value) => ({ current: value }), useCallback: (callback) => callback,
            useEffect: (effect) => effect(), useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        },
        "./searchResultStore": { default: {
            setValue: (value) => { snapshot = typeof value === "function" ? value(snapshot) : value; },
        }, __esModule: true },
        "@shared/plugin-manager/renderer": {
            onPluginsChanged: (callback) => { invalidate = callback; return () => undefined; }, getRegistryRevision: () => 0,
            getSortedSearchablePlugins: (kind) => { assert.equal(kind, "lyric"); return [plugin]; },
            invoke: async (delegate, capability, request) => {
                calls.push({ delegate, capability, request });
                return { items: [{ id: request.cursor ? "123" : 123, platform: providerId }], nextCursor: request.cursor ? null : "lyric-next" };
            },
        },
        "@shared/plugin-manager/lyric-search": { lyricSearchContext },
        "@renderer/utils/cursor-session": { CursorSession },
    }).default;
    const search = useSearchLyric(current);
    await search(lyricSearchKeyword(current));
    await search(undefined, providerId);
    assert.deepEqual(calls.map((call) => call.request.cursor), [null, "lyric-next"]);
    assert.ok(calls.every((call) => call.delegate === plugin && call.capability === "search" && call.request.kind === "lyric" && call.request.limit === 50));
    assert.deepEqual(calls[0].request.context, lyricSearchContext(current, providerId));
    assert.equal(calls[0].request.context.musicItem.id, 123);
    assert.equal(calls[0].request.context.privateToken, undefined);
    assert.deepEqual(snapshot.data[providerId].data.map((entry) => entry.id), [123, "123"]);
    assert.equal(snapshot.data[providerId].state, states.FINISHED);
    await search(undefined, providerId);
    assert.equal(calls.length, 2, "completed search must not restart page one");
    await search(lyricSearchKeyword(current), providerId, true);
    assert.equal(calls[2].request.cursor, null, "explicit refresh creates a new continuation generation");
    invalidate();
    assert.deepEqual(snapshot, { data: {} }, "plugin/settings changes clear obsolete lyric search results");
    console.log("Lyric search context tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
