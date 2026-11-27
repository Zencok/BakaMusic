const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ts = require("typescript");
const project = path.resolve(__dirname, "..");
const cache = new Map();
const mocks = new Map();
function load(relative) {
    const file = path.resolve(project, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", output)((name) => {
        if (mocks.has(name)) return mocks.get(name);
        if (name.endsWith(".scss")) return {};
        const local = name.startsWith("@/") ? path.join(project, "src", name.slice(2))
            : name.startsWith("@renderer/") ? path.join(project, "src/renderer", name.slice(10))
                : name.startsWith(".") ? path.resolve(path.dirname(file), name) : null;
        if (local) return load(fs.existsSync(local + ".ts") ? local + ".ts" : fs.existsSync(local + ".tsx") ? local + ".tsx" : local);
        return require(name);
    }, module, module.exports);
    return module.exports;
}
const { CursorSession } = load("src/renderer/utils/cursor-session.ts");
const { RequestStateCode, localPluginName } = load("src/common/constant.ts");
const media = load("src/common/media-util.ts");
const imports = load("src/renderer/core/music-sheet/import-sync.ts");
const { ImportSyncFetcher } = load("src/renderer/core/music-sheet/sync-fetcher.ts");
const backup = load("src/renderer/core/backup-resume/format.ts");
const statistics = load("src/renderer/core/listening-statistics/model.ts");
const { createIndexMap } = load("src/common/index-map.ts");
const { createUniqueMap } = load("src/common/unique-map.ts");
const { default: normalizeComment } = load("src/renderer/utils/normalize-comment.ts");
const identity = load("src/common/music-identity.ts");
const bindings = load("src/renderer/core/track-player/plugin-media.ts");
const track = (id, platform = "org.example.music") => ({ id, platform, title: String(id), artist: "Fixture" });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function cursorTests() {
    const first = deferred();
    const session = new CursorSession();
    const requests = [];
    const fetch = (cursor) => { requests.push(cursor); return first.promise; };
    const pending = session.load(fetch);
    assert.equal(session.load(fetch), pending, "concurrent load must reuse the actual request");
    await Promise.resolve();
    assert.deepEqual(requests, [null]);
    first.resolve({ items: [track(7)], nextCursor: "next-opaque", revision: "r1" });
    await pending;
    await session.load(async (cursor) => { requests.push(cursor); throw new Error("network failed"); });
    assert.equal(session.getSnapshot().status, RequestStateCode.ERROR);
    assert.equal(session.getSnapshot().nextCursor, "next-opaque");
    assert.deepEqual(session.getSnapshot().items.map((item) => item.id), [7]);
    await session.load(async (cursor) => { requests.push(cursor); return { items: [track("7")], nextCursor: null, revision: "r1" }; });
    assert.deepEqual(requests, [null, "next-opaque", "next-opaque"], "retry must use the unconsumed token");
    assert.deepEqual(session.getSnapshot().items.map((item) => item.id), [7, "7"]);
    await session.load(() => { throw new Error("terminal cursor should not fetch"); });
    assert.equal(session.getSnapshot().status, RequestStateCode.FINISHED);

    const empty = new CursorSession();
    await empty.load(async () => ({ items: [], nextCursor: "empty-but-continuing" }));
    assert.equal(empty.getSnapshot().status, RequestStateCode.ERROR, "empty pages cannot advertise continuation");
    await empty.load(async () => ({ items: [track(0)], nextCursor: "empty-but-continuing" }));
    await empty.load(async () => ({ items: [track(1)], nextCursor: "empty-but-continuing" }));
    assert.equal(empty.getSnapshot().status, RequestStateCode.ERROR);
    assert.deepEqual(empty.getSnapshot().items.map((item) => item.id), [0], "repeated token must not partially append data");
    await empty.load(async () => ({ items: [track(2)], nextCursor: null }));
    assert.deepEqual(empty.getSnapshot().items.map((item) => item.id), [0, 2]);

    const stale = new CursorSession();
    const delayed = deferred();
    const old = stale.load(() => delayed.promise);
    await Promise.resolve();
    stale.invalidate();
    await stale.load(async () => ({ items: [track("fresh")], nextCursor: null }));
    delayed.resolve({ items: [track("obsolete")], nextCursor: "old-token" });
    await old;
    assert.deepEqual(stale.getSnapshot().items.map((item) => item.id), ["fresh"], "obsolete request must not overwrite refreshed data");

    const owned = new CursorSession(track(7));
    await owned.load(async () => ({ items: [track(1)], entity: track("7"), nextCursor: null }));
    assert.equal(owned.getSnapshot().status, RequestStateCode.ERROR);
    assert.deepEqual(owned.getSnapshot().items, [], "foreign entity metadata must not be merged or appended");

    const changing = new CursorSession();
    await changing.load(async () => ({ items: [track(1)], nextCursor: "c1", revision: "a" }));
    await changing.load(async () => ({ items: [track(2)], nextCursor: null, revision: "b" }));
    assert.equal(changing.getSnapshot().status, RequestStateCode.ERROR);
    assert.deepEqual(changing.getSnapshot().items.map((item) => item.id), [1]);
}
async function identityAndImportTests() {
    const comment = normalizeComment({ id: 0, content: "Canonical comment", username: "Listener", timestamp: 1700000000000, replies: [{ content: "Reply", user: { name: "Reply author" } }] });
    assert.equal(comment.id, 0);
    assert.equal(comment.comment, "Canonical comment");
    assert.equal(comment.nickName, "Listener");
    assert.equal(comment.replies[0].nickName, "Reply author");
    const indexed = createIndexMap([track(42), track("42"), track(42, "legacy")]);
    assert.equal(indexed.indexOf(track(42)), 0);
    assert.equal(indexed.indexOf(track("42")), 1);
    assert.equal(indexed.indexOf(track("42", "legacy")), 2);
    const unique = createUniqueMap([track(42)]);
    assert.equal(unique.has(track("42")), false);
    unique.add(track("42"));
    unique.remove(track(42));
    assert.equal(unique.has(track("42")), true);
    unique.add(track(42, "legacy"));
    assert.equal(unique.has(track("42", "legacy")), true);
    const linked = { ...track(7), artists: [{ id: 0, name: "Numeric artist" }, { id: "0", name: "String artist" }], album: { id: 0, title: "Numeric album" } };
    assert.deepEqual(identity.getNavigableArtists(linked).map((item) => item.artistItem.id), [0, "0"]);
    assert.equal(identity.buildAlbumItemFromMusic(linked).id, 0);
    assert.equal(JSON.parse(identity.buildMusicAlbumCopyPayload(linked)).albumId, 0);
    assert.equal(JSON.parse(identity.buildMusicArtistCopyPayload(linked)).artists[0].artistId, 0);
    assert.equal(JSON.parse(identity.buildMusicSongCopyPayload(track(0))).id, 0);
    assert.equal(identity.buildFallbackMusicDetailUrl(track(7, "org.qq.catalog")), "", "V2 routing IDs must not be guessed as platform names");
    assert.equal(identity.buildAlbumItemFromMusic({ ...track(7, "legacy"), albumId: 7, album: "Legacy album" }).id, "7");
    assert.notEqual(media.getMediaPrimaryKey(track(7)), media.getMediaPrimaryKey(track("7")));
    assert.equal(media.isSameMedia(track(7), track("7")), false);
    assert.equal(media.getMediaPrimaryKey(track("old", localPluginName)), `${localPluginName}@old`);
    assert.equal(media.getMediaPrimaryKey(track(7, "Legacy music")), "Legacy music@7");
    assert.equal(media.isSameMedia(track(7, "Legacy music"), track("7", "Legacy music")), true);
    assert.notEqual(statistics.getListeningStatisticsKey(track(7)), statistics.getListeningStatisticsKey(track("7")));
    assert.deepEqual(imports.mergeImportedTracks([], [track(7), track("7"), track(7)]).map((item) => item.id), [7, "7"]);
    assert.deepEqual(imports.mergeImportedTracks([], [track(7, "legacy"), track("7", "legacy")]).map((item) => item.id), [7]);
    const source = { pluginHash: "org.example.music", platform: "org.example.music", input: "https://example.test/playlist" };
    const initial = imports.planImportedSheetSync([], [], [source], [{ source, musicList: [track(7), track("7")] }]);
    assert.deepEqual(initial.importOwnership.map((entry) => entry.id), [7, "7"]);
    const retained = imports.planImportedSheetSync(initial.musicList, initial.importOwnership, [source], [{ source, musicList: [track("7")] }]);
    assert.deepEqual(retained.musicList.map((item) => item.id), ["7"]);
    assert.throws(() => imports.planImportedSheetSync(initial.musicList, initial.importOwnership, [source], []), /Incomplete/);
    const manual = { platform: "org.example.music", id: 9, manual: true, sourceKeys: [] };
    assert.deepEqual(imports.planImportedSheetSync([track(9)], [manual], [source], [{ source, musicList: [] }]).musicList.map((item) => item.id), [9]);
    const sheet = { id: 0, platform: "org.example.music", title: "Typed collection", importSources: [source], importOwnership: initial.importOwnership, musicList: initial.musicList };
    assert.deepEqual(backup.parseBackupPayload(backup.createBackupPayload([sheet])), [sheet]);
    const plugin = { id: source.pluginHash, hash: source.pluginHash, platform: source.platform };
    const response = deferred();
    let calls = 0;
    const fetcher = new ImportSyncFetcher(async () => { calls++; return response.promise; });
    const work = fetcher.fetch(source, plugin);
    fetcher.invalidate();
    response.resolve({ ...sheet, syncVersion: "revision-1" });
    await assert.rejects(work, /context changed/i);
    assert.equal(calls, 1);
    const complete = new ImportSyncFetcher(async (_plugin, _input, options) => options?.knownVersion
        ? { notModified: true, syncVersion: options.knownVersion }
        : { ...sheet, syncVersion: "revision-1" });
    assert.deepEqual((await complete.fetch(source, plugin)).musicList.map((item) => item.id), [7, "7"]);
    assert.deepEqual((await complete.fetch(source, plugin)).musicList.map((item) => item.id), [7, "7"]);
    const bound = bindings.bindMediaToPlugin({ ...track(7), hash: "provider-song-hash" }, { id: plugin.id, platform: plugin.platform });
    assert.equal(bound.hash, "provider-song-hash");
    assert.equal(bindings.getMediaPluginDelegate(bound).id, plugin.id);
    bindings.cachePrefetchedMediaSource(bound, "128k", { url: "https://example.test/number" });
    bindings.cachePrefetchedMediaSource({ ...bound, id: "7" }, "128k", { url: "https://example.test/string" });
    assert.equal(bindings.getPrefetchedMediaSource(bound, ["128k"]).mediaSource.url, "https://example.test/number");
    assert.equal(bindings.getPrefetchedMediaSource({ ...bound, id: "7" }, ["128k"]).mediaSource.url, "https://example.test/string");
    const oldRevision = bindings.getPrefetchedMediaSourceRevision();
    bindings.invalidatePrefetchedMediaSources();
    assert.equal(bindings.getPrefetchedMediaSource(bound, ["128k"]), null, "registry/settings changes must clear prefetched URLs");
    bindings.cachePrefetchedMediaSource(bound, "128k", { url: "https://example.test/stale" }, oldRevision);
    assert.equal(bindings.getPrefetchedMediaSource(bound, ["128k"]), null, "in-flight responses from the prior source revision must not repopulate cache");
    assert.equal(bindings.buildPlayByIdMusicItem(plugin.id, "input", { id: 7 }).id, 7);
    assert.deepEqual(bindings.createMusicIdentifierBase(plugin.id, "input"), { platform: plugin.id, id: "input" });
}
async function sourcePolicyTests() {
    const provider = { id: "org.example.music", hash: "org.example.music", platform: "org.example.music", capabilities: ["media.resolve", "search"] };
    const other = { ...provider, id: "org.example.other", platform: "org.example.other", hash: "org.example.other" };
    let revision = 0;
    let binding = null;
    const calls = [];
    let respond = async (_delegate, capability) => capability === "search" ? { items: [track(7, other.platform)], nextCursor: null } : { url: "https://example.test/source" };
    mocks.set("@shared/plugin-manager/renderer", {
        getRegistryRevision: () => revision,
        getResolverBinding: () => binding,
        getSourcePluginCandidates: () => [provider, other],
        filterMediaQualityOrder: (_item, order) => order,
        invoke: (delegate, capability, request) => { calls.push({ delegate, capability, request }); return respond(delegate, capability, request); },
    });
    mocks.set("@shared/app-config/renderer", { getConfig: () => true });
    const { resolveMediaSourceWithFallback } = load("src/renderer/core/source-fallback.ts");
    const options = { musicItem: track(7), mode: "playback", qualityOrder: ["320k", "128k"] };
    respond = async (_delegate, _capability, request) => {
        if (request.quality === "320k") throw Object.assign(new Error("quality unavailable"), { code: "quality_unavailable" });
        return { url: "https://example.test/lower" };
    };
    assert.equal((await resolveMediaSourceWithFallback(options)).quality, "128k");
    assert.deepEqual(calls.map((call) => call.request.quality), ["320k", "128k"]);
    calls.length = 0;
    respond = async () => { throw Object.assign(new Error("sign in"), { code: "authentication_required" }); };
    await assert.rejects(resolveMediaSourceWithFallback(options), { code: "authentication_required" });
    assert.equal(calls.length, 1, "auth failures must not trigger another quality or provider");
    calls.length = 0;
    binding = "org.example.resolver";
    respond = async () => null;
    assert.equal(await resolveMediaSourceWithFallback(options), null);
    assert.equal(calls.length, 1, "bound resolver null must not switch quality/provider");
    calls.length = 0;
    const delayed = deferred();
    respond = () => delayed.promise;
    const pending = resolveMediaSourceWithFallback(options);
    revision++;
    delayed.resolve({ url: "https://example.test/obsolete" });
    assert.equal(await pending, null, "responses from the prior source settings must not be applied");
}
async function pluginImportUiTests() {
    const formats = load("src/renderer/pages/main-page/views/plugin-manager-view/import-format.ts");
    assert.deepEqual(formats.pluginImportKinds, ["auto", "v2", "lx"]);
    const lx = {
        apiVersion: 2, id: "org.example.lx", hash: "org.example.lx", platform: "org.example.lx", path: "fixture.js",
        kind: "resolver", name: "Obfuscated original", author: "Fixture", version: "0.0.0", srcUrl: "https://example.test/obfuscated.js",
        capabilities: ["media.resolve"], sources: ["cc.baka.qq.v1"],
        conversion: { format: "lx-to-v2", originalVersion: "2026.11 original", originalId: "unchanged" },
    };
    const v2 = { ...lx, id: "org.example.v2", name: "LX in a display name is not format evidence", conversion: undefined };
    assert.equal(formats.isLxPlugin(lx), true);
    assert.equal(formats.getPluginDisplayVersion(lx), "2026.11 original");
    assert.deepEqual(formats.getPluginUpdateOptions(lx), { kind: "lx" });
    assert.equal(formats.isLxPlugin(v2), false);
    assert.deepEqual(formats.getPluginUpdateOptions(v2), { kind: "auto" });
    assert.deepEqual(formats.getSubscriptionUpdateOptions([lx], lx.srcUrl), { kind: "lx" });
    assert.deepEqual(formats.getSubscriptionUpdateOptions([lx], "https://example.test/unknown.json"), { kind: "auto" });
    assert.deepEqual(formats.getSubscriptionUpdateOptions([lx, v2], lx.srcUrl), { kind: "auto" }, "mixed subscription URLs must retain automatic format selection");
    assert.equal(formats.getPluginDisplayVersion({ ...lx, conversion: { format: "lx-to-v2", originalVersion: "" } }), "0.0.0");
    for (const locale of ["en-US", "zh-CN", "zh-TW"]) {
        const strings = JSON.parse(fs.readFileSync(path.join(project, "res/lang", locale + ".json"), "utf8")).plugin_management_page;
        for (const key of ["import_format", "import_format_auto", "import_format_v2", "import_format_lx", "import_auto_hint", "import_v2_hint", "import_lx_hint", "plugin_files"]) {
            assert.equal(typeof strings[key], "string", `${locale} must translate ${key}`);
            assert.ok(strings[key].length);
        }
    }

    const originalMocks = new Map(mocks);
    let hookIndex = 0;
    let hookValues = [];
    let menu;
    let modal;
    let canceled = false;
    let activePlugins = [];
    let subscriptions = [];
    const installs = [];
    const empty = () => null;
    const defaultModule = (value) => ({ __esModule: true, default: value });
    const manager = {
        installPluginFromLocal: async (input, options) => { installs.push({ source: "file", input, options }); },
        installPluginFromRemote: async (input, options) => { installs.push({ source: "url", input, options }); },
    };
    const click = { stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ right: 100, bottom: 200 }) } };
    function elements(node) {
        if (Array.isArray(node)) return node.flatMap(elements);
        if (!node || typeof node !== "object" || !node.props) return [];
        return [node, ...elements(node.props.children)];
    }
    function textContent(node) {
        if (Array.isArray(node)) return node.map(textContent).join("");
        return node && typeof node === "object" ? textContent(node.props?.children) : String(node ?? "");
    }
    try {
        mocks.set("react", {
            useState(initial) {
                const slot = hookIndex++;
                if (!(slot in hookValues)) hookValues[slot] = typeof initial === "function" ? initial() : initial;
                return [hookValues[slot], (next) => { hookValues[slot] = typeof next === "function" ? next(hookValues[slot]) : next; }];
            },
            useRef: (initial) => ({ current: initial }), useEffect() {}, useLayoutEffect() {},
        });
        mocks.set("react-i18next", { useTranslation: () => ({ t: (key) => key }), Trans: empty });
        mocks.set("react-toastify", { toast: { success() {}, warn() {}, error() {} } });
        mocks.set("@/renderer/components/Modal", { hideModal() {}, showModal: (_type, props) => { modal = props; } });
        mocks.set("@/renderer/components/ContextMenu", { showContextMenu: (props) => { menu = props; } });
        mocks.set("@/renderer/components/A", defaultModule(empty));
        mocks.set("@/renderer/components/SvgAsset", defaultModule(empty));
        mocks.set("@/renderer/components/Condition", defaultModule(empty));
        mocks.set("@/renderer/components/Empty", defaultModule(empty));
        mocks.set("@/renderer/components/Panel", { showPanel() {} });
        mocks.set("@/renderer/utils/user-perference", { getUserPreference: () => subscriptions, useUserPreference: () => [subscriptions] });
        mocks.set("@/hooks/useAppConfig", defaultModule(() => ({})));
        mocks.set("@shared/utils/renderer", { dialogUtil: { showOpenDialog: async () => ({ canceled, filePaths: ["C:/fixtures/unmarked-obfuscated.js"] }) } });
        mocks.set("@shared/plugin-manager/renderer", {
            ...defaultModule(manager), useSortedPlugins: () => activePlugins, usePluginRegistryState: () => ({ resolverBindings: [], retiredPlugins: [] }),
        });
        mocks.set("./components/plugin-table", defaultModule(empty));
        mocks.set("./components/resolver-bindings", defaultModule(empty));
        mocks.set("./components/plugin-log-console", defaultModule(empty));
        const Manager = load("src/renderer/pages/main-page/views/plugin-manager-view/index.tsx").default;
        const renderManager = () => { hookIndex = 0; return Manager(); };
        let tree = renderManager();
        assert.equal(elements(tree).find((node) => node.type === "select").props.value, "auto");
        for (const kind of formats.pluginImportKinds) {
            elements(tree).find((node) => node.type === "select").props.onChange({ currentTarget: { value: kind } });
            tree = renderManager();
            const selector = elements(tree).find((node) => node.type === "select");
            assert.deepEqual(elements(selector).filter((node) => node.type === "option").map((node) => node.props.value), ["auto", "v2", "lx"]);
            elements(tree).find((node) => node.props.className === "plugin-manager-install-button").props.onClick(click);
            menu.menuItems[0].onClick();
            await new Promise((done) => setImmediate(done));
            assert.deepEqual(installs.at(-1), { source: "file", input: "C:/fixtures/unmarked-obfuscated.js", options: { kind } }, "file format must be forwarded without inspecting original script text");
            menu.menuItems[1].onClick();
            assert.ok(modal.title.includes(`import_format_${kind}`), "URL dialog must show selected format");
            assert.deepEqual(modal.hints, [`plugin_management_page.import_${kind}_hint`]);
            await modal.onOk("  https://example.test/unmarked-obfuscated.js  ");
            assert.deepEqual(installs.at(-1), { source: "url", input: "https://example.test/unmarked-obfuscated.js", options: { kind } });
            const count = installs.length;
            await assert.rejects(modal.onOk("http://example.test/insecure.js"));
            assert.equal(installs.length, count, "invalid URL must not reach install transport");
        }
        canceled = true;
        const count = installs.length;
        menu.menuItems[0].onClick();
        await new Promise((done) => setImmediate(done));
        assert.equal(installs.length, count, "canceling file selection must not install");
        for (const [plugins, url, kind] of [
            [[lx], lx.srcUrl, "lx"],
            [[lx], "https://example.test/unknown.json", "auto"],
            [[lx, v2], lx.srcUrl, "auto"],
        ]) {
            activePlugins = plugins;
            subscriptions = [{ srcUrl: `  ${url}  ` }];
            tree = renderManager();
            elements(tree).find((node) => node.props.className === "plugin-manager-more-button").props.onClick(click);
            menu.menuItems[1].onClick();
            await new Promise((done) => setImmediate(done));
            assert.deepEqual(installs.at(-1), { source: "url", input: url, options: { kind } }, "batch subscription updates must preserve known LX and leave unknown/mixed URLs automatic");
        }

        mocks.set("@shared/app-config/renderer", defaultModule({ getConfig: () => ({}), setConfig() {} }));
        mocks.set("@/shared/i18n/renderer", { i18n: { t: (key) => key } });
        const Table = load("src/renderer/pages/main-page/views/plugin-manager-view/components/plugin-table/index.tsx").default;
        hookValues = [];
        hookIndex = 0;
        const table = Table({ plugins: [lx, v2] });
        const cards = elements(table).filter((node) => node.type === "article");
        assert.equal(cards.length, 2);
        const originalVersion = elements(cards[0]).find((node) => node.props.className === "plugin-card-meta").props.children[0];
        assert.equal(textContent(originalVersion), "2026.11 original", "LX card must display unchanged original script version, not the semver fallback");
        assert.equal(elements(cards[0]).filter((node) => node.props["data-source"] === "lx").length, 1);
        assert.equal(elements(cards[1]).filter((node) => node.props["data-source"] === "lx").length, 0);
        elements(cards[0]).find((node) => node.props.className === "plugin-manager-row-menu-button").props.onClick(click);
        await menu.menuItems[0].onClick();
        assert.deepEqual(installs.at(-1), { source: "url", input: lx.srcUrl, options: { kind: "lx" } }, "updating converted LX must retain explicit format for unmarked obfuscated scripts");
    } finally {
        mocks.clear();
        for (const [key, value] of originalMocks) mocks.set(key, value);
    }
}
async function completedSearchRevisionTests() {
    const originalMocks = new Map(mocks);
    const listeners = new Set();
    const provider = { id: "org.example.search", platform: "org.example.search", hash: "org.example.search", capabilities: ["search"] };
    const registry = [provider];
    const requests = [];
    let revision = 0;
    let callback;
    let callbackDependencies;
    let effectDependencies;
    let previousProps;
    let bodyRenders = 0;
    const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const empty = () => null;
    const defaultModule = (value) => ({ __esModule: true, default: value });
    try {
        mocks.set("react", {
            useCallback(next, dependencies) {
                if (!same(callbackDependencies, dependencies)) {
                    callback = next;
                    callbackDependencies = dependencies;
                }
                return callback;
            },
            useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
            useEffect(effect, dependencies) {
                if (!same(effectDependencies, dependencies)) {
                    effectDependencies = dependencies;
                    effect();
                }
            },
            memo: (component, compare) => ({ component, compare }),
        });
        mocks.set("@shared/plugin-manager/renderer", {
            ...defaultModule({
                onPluginsChanged: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
                getRegistryRevision: () => revision,
                getSortedSearchablePlugins: () => registry,
                invoke: async (_plugin, capability, request) => {
                    assert.equal(capability, "search");
                    requests.push({ revision, ...request });
                    return {
                        items: [track(`${revision}:${request.cursor ?? "first"}`, provider.id)],
                        nextCursor: revision > 0 && request.cursor === null ? `cursor-${revision}` : null,
                    };
                },
            }),
            useSortedPlugins: () => registry,
        });
        for (const name of ["@/renderer/components/Condition", "@/renderer/components/Loading", "./AlbumResult", "./MusicResult", "./ArtistResult", "./SheetResult"]) mocks.set(name, defaultModule(empty));
        mocks.set("@/renderer/components/SwitchCase", defaultModule({ Switch: empty, Case: empty }));
        const store = load("src/renderer/pages/main-page/views/search-view/store/search-result.ts").searchResultsStore;
        store.useValue = store.getValue;
        const SearchResult = load("src/renderer/pages/main-page/views/search-view/components/SearchResult/index.tsx").default;
        const props = { query: "retained query", type: "music", pluginHash: provider.id };
        const render = () => {
            const element = SearchResult(props);
            if (!previousProps || !element.type.compare(previousProps, element.props)) {
                previousProps = element.props;
                bodyRenders++;
                element.type.component(element.props);
            }
        };
        const settle = () => new Promise((done) => setImmediate(done));
        render();
        await settle();
        assert.equal(store.getValue().music[provider.id].state, RequestStateCode.FINISHED);
        assert.deepEqual(requests, [{ revision: 0, query: props.query, kind: "music", cursor: null, limit: 50 }]);
        render();
        await settle();
        assert.equal(requests.length, 1, "ordinary renders must retain the completed session");
        assert.equal(bodyRenders, 1);
        for (const change of ["registry", "authentication", "settings"]) {
            revision++;
            for (const listener of listeners) listener();
            render();
            await settle();
            const result = store.getValue().music[provider.id];
            assert.equal(result.state, RequestStateCode.PARTLY_DONE, `${change} after a completed search must fetch a fresh first page`);
            assert.equal(result.query, props.query);
            assert.deepEqual(result.data.map((item) => item.id), [`${revision}:first`]);
            assert.deepEqual(requests.at(-1), { revision, query: props.query, kind: "music", cursor: null, limit: 50 });
            await previousProps.search(undefined, "music", provider.id);
            assert.equal(store.getValue().music[provider.id].state, RequestStateCode.FINISHED);
            assert.deepEqual(requests.at(-1), { revision, query: props.query, kind: "music", cursor: `cursor-${revision}`, limit: 50 }, "load more must retain the refreshed query and use its actual continuation");
        }
        assert.equal(bodyRenders, 4, "revision changes must pass the actual component memo boundary");
    } finally {
        mocks.clear();
        for (const [key, value] of originalMocks) mocks.set(key, value);
    }
}
async function recommendationTagIdentityTests() {
    const originalMocks = new Map(mocks);
    const defaultModule = (value) => ({ __esModule: true, default: value });
    const empty = () => null;
    const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    let slots = [];
    let hookIndex = 0;
    let effects = [];
    let dirty = false;
    let snapshot = { items: [], loaded: false, status: RequestStateCode.IDLE };
    let selected;
    const loadTags = () => Promise.resolve();
    try {
        mocks.set("react", {
            useState(initial) {
                const index = hookIndex++;
                if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
                return [slots[index], (next) => {
                    const value = typeof next === "function" ? next(slots[index]) : next;
                    if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; }
                }];
            },
            useMemo(factory, dependencies) {
                const index = hookIndex++;
                if (!same(slots[index]?.dependencies, dependencies)) slots[index] = { dependencies, value: factory() };
                return slots[index].value;
            },
            useEffect(effect, dependencies) {
                const index = hookIndex++;
                if (!same(slots[index], dependencies)) { slots[index] = dependencies; effects.push(effect); }
            },
            useRef: (value) => ({ current: value }), useId: () => "review-tag-panel",
        });
        mocks.set("@renderer/utils/use-cursor-page", defaultModule(() => [snapshot, loadTags]));
        mocks.set("@shared/plugin-manager/renderer", defaultModule({ invoke() { throw Error("tag fixture must use the cursor boundary"); } }));
        mocks.set("../../hooks/useRecommendSheets", defaultModule((_plugin, tag) => { selected = tag; return [empty, [], RequestStateCode.FINISHED]; }));
        mocks.set("react-router-dom", { useNavigate: () => empty });
        mocks.set("react-i18next", { useTranslation: () => ({ t: (key) => key }) });
        mocks.set("@/shared/i18n/renderer", { i18n: { t: (key) => key }, isCN: () => false });
        for (const name of ["@renderer/utils/get-source-name", "@/renderer/utils/get-source-name", "./tag-panel", "@/renderer/components/Condition", "@/renderer/components/Loading", "@/renderer/components/LazyImage", "@/renderer/utils/get-compact-artwork-src", "@/renderer/components/BottomLoadingState", "@/renderer/components/Empty", "@/renderer/components/SvgAsset"]) mocks.set(name, defaultModule(empty));
        mocks.set("@/renderer/utils/default-album-cover", defaultModule("fixture-cover"));
        mocks.set("@/renderer/utils/img-on-error", { setFallbackAlbum() {} });
        mocks.set("../../../discovery-pages", { getDiscoveryMetaText: () => "" });
        const useTags = load("src/renderer/pages/main-page/views/recommend-sheets-view/hooks/useRecommendListTags.ts").default;
        const Body = load("src/renderer/pages/main-page/views/recommend-sheets-view/components/Body/index.tsx").default;
        for (const supportsTags of [false, true]) {
            const plugin = { id: `org.example.tags-${supportsTags}`, hash: `org.example.tags-${supportsTags}`, version: "1.0.0", capabilities: supportsTags ? ["discovery.playlists", "discovery.playlistTags"] : ["discovery.playlists"] };
            snapshot = { items: [], loaded: supportsTags, status: supportsTags ? RequestStateCode.FINISHED : RequestStateCode.IDLE };
            slots = []; hookIndex = 0; effects = [];
            const first = useTags(plugin);
            hookIndex = 0;
            assert.equal(useTags(plugin), first, "unchanged optional/empty tags must retain object identity");
            slots = [];
            let renders = 0;
            do {
                dirty = false; hookIndex = 0; effects = [];
                Body({ plugin });
                for (const effect of effects) effect();
                assert.ok(++renders <= 3, "default-tag selection must settle instead of repeatedly replacing state");
            } while (dirty);
            assert.equal(selected.id, "", "playlist-only and empty-tag providers must still query the default recommendation tag");
            assert.equal(renders, 2);
        }
    } finally {
        mocks.clear();
        for (const [key, value] of originalMocks) mocks.set(key, value);
    }
}
async function typedAlbumRouteTests() {
    const originalMocks = new Map(mocks);
    const previousHistory = globalThis.history;
    const defaultModule = (value) => ({ __esModule: true, default: value });
    let location = { state: { albumItem: track(42) } };
    let params = { platform: "org.example.music", id: "42" };
    let dependencies;
    let value;
    let album;
    try {
        globalThis.history = { state: { usr: { albumItem: track(42) } } };
        mocks.set("react", { useMemo(factory, next) {
            if (!dependencies || next.some((item, index) => !Object.is(item, dependencies[index]))) { dependencies = next; value = factory(); }
            return value;
        } });
        mocks.set("react-router-dom", { useLocation: () => location, useParams: () => params });
        mocks.set("@/renderer/components/MusicSheetlikeView", defaultModule(() => null));
        mocks.set("@/renderer/components/MusicSheetFavoriteOption", defaultModule(() => null));
        mocks.set("./hooks/useAlbumDetail", defaultModule((item) => { album = item; return [RequestStateCode.FINISHED, item, [], () => {}]; }));
        const AlbumView = load("src/renderer/pages/main-page/views/album-view/index.tsx").default;
        for (const id of [42, "42", 0, "0"]) {
            params = { ...params, id: String(id) };
            location = { state: { albumItem: { ...track(id), title: `Album ${typeof id}` } } };
            AlbumView();
            assert.equal(album.id, id, "same-path album navigation must read the new route state and preserve ID type");
            assert.equal(album.title, `Album ${typeof id}`);
        }
        location = { state: null };
        globalThis.history = { state: null };
        AlbumView();
        assert.equal(album.id, "0", "direct URL entry must fall back to its string parameter without history state");
    } finally {
        if (previousHistory === undefined) delete globalThis.history; else globalThis.history = previousHistory;
        mocks.clear();
        for (const [key, entry] of originalMocks) mocks.set(key, entry);
    }
}
(async () => {
    await cursorTests();
    await identityAndImportTests();
    await sourcePolicyTests();
    await pluginImportUiTests();
    await completedSearchRevisionTests();
    await recommendationTagIdentityTests();
    await typedAlbumRouteTests();
    console.log("V2 consumers passed: opaque cursors, retries, stale responses, revisions after completed searches, typed IDs, complete import snapshots, preserved local/legacy keys and explicit V2/LX file/URL imports.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
