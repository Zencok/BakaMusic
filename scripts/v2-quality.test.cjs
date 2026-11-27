const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const cache = new Map();
const configuration = { "private.pluginMeta": {}, "playMusic.sourcePriority": [], "download.sourcePriority": [] };
const configListeners = [];
const calls = [];
let updatePlugins;
let updateRegistry;
let invocation = async () => null;
const bridge = {
    onPluginUpdated: (callback) => { updatePlugins = callback; },
    onRegistryUpdated: (callback) => { updateRegistry = callback; },
    onPlaybackLogAppended: () => () => undefined,
    invoke: async (...args) => {
        calls.push(args);
        try { return { ok: true, value: await invocation(...args) }; }
        catch (error) { return { ok: false, error: { code: error.code || "temporary_unavailable", message: error.message } }; }
    },
    setResolverBinding: async (...args) => { calls.push(["setResolverBinding", ...args]); },
    reloadPlugins: async () => undefined,
};
const previousWindow = global.window;
global.window = { "@shared/plugin-manager": bridge };
const stubs = {
    "@shared/app-config/renderer": {
        getConfig: (key) => configuration[key],
        onConfigUpdate: (callback) => configListeners.push(callback),
    },
    "@/hooks/useAppConfig": () => undefined,
    "@shared/logger/renderer": { logInfo() {}, logError() {} },
};
function load(relative) {
    let filename = path.resolve(root, relative);
    if (!fs.existsSync(filename)) filename += ".ts";
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", output)((name) => {
        if (Object.hasOwn(stubs, name)) return stubs[name];
        const local = name.startsWith("@/") ? path.join(root, "src", name.slice(2))
            : name.startsWith("@shared/") ? path.join(root, "src/shared", name.slice(8))
                : name.startsWith(".") ? path.resolve(path.dirname(filename), name) : null;
        return local ? load(local) : require(name);
    }, module, module.exports);
    return module.exports;
}
const manager = load("src/shared/plugin-manager/renderer.ts").default;
const qualities = load("src/renderer/utils/music-quality.ts");
const metadata = load("src/renderer/utils/music-quality-metadata.ts");
const media = load("src/common/media-util.ts");
const bindings = load("src/renderer/core/track-player/plugin-media.ts");
const { localPluginName } = load("src/common/constant.ts");
const providerId = "org.fixture.provider";
const otherProvider = "org.fixture.other";
const resolverId = "org.fixture.resolver";
const delegate = (id, capabilities, extra = {}) => ({ id, platform: id, hash: id, name: id, capabilities, ...extra });
const track = (id = 42, extra = {}) => ({ platform: providerId, id, title: "Song", artist: "Artist", ...extra });
const translate = (key) => key;

async function main() {
    try {
        updatePlugins([
            delegate(providerId, ["entities.get", "media.prepare", "media.resolve"], { kind: "provider", sourceId: "fixture" }),
            delegate(otherProvider, ["search", "media.resolve"], { kind: "provider", sourceId: "other" }),
            delegate(resolverId, ["media.resolve"], { kind: "resolver", sources: ["fixture"] }),
        ]);
        configuration["private.pluginMeta"] = { [otherProvider]: { disabled: true } };
        assert.deepEqual(manager.getSupportedPlugin("search"), [], "disabled packages cannot appear as supported sources");
        assert.equal(manager.isSupportFeatureMethod(providerId, "entities.get"), true);
        assert.equal(manager.isSupportFeatureMethod(providerId, "search"), false);
        const declared = track(42, { hash: "track-content-hash", qualities: { "128k": { size: 1024 }, flac: { size: 5 * 1024 ** 2 } } });
        assert.deepEqual(manager.getMediaQualityKeys(declared), ["128k", "flac"]);
        assert.deepEqual(manager.filterMediaQualityOrder(declared, ["master", "flac", "320k", "128k"]), ["flac", "128k"],
            "resolver selection cannot invent undeclared quality tiers");
        assert.deepEqual(media.getQualityOrder("flac", "skip"), ["flac"]);
        assert.deepEqual(manager.filterMediaQualityOrder(declared, media.getQualityOrder("flac", "lower")), ["flac", "128k"]);
        const ready = await qualities.resolveMusicQualityChoices(declared, translate);
        assert.deepEqual(ready.choices.map((choice) => choice.value), ["flac", "128k"]);
        assert.equal(ready.choices[0].sizeText, "5.0MB");
        assert.equal(calls.length, 0, "known quality metadata must not trigger hidden provider requests");
        assert.deepEqual(metadata.getBestMusicQualityInfo(declared), { quality: "flac", label: "SQ", sizeText: "5.0MB" });

        invocation = async () => ({ id: "wrong-id", platform: "wrong-platform", qualities: { "320k": { size: 2048 } }, token: "retained-extra" });
        const original = track(42);
        const fetched = await qualities.resolveMusicQualityChoices(original, translate);
        assert.deepEqual(calls.pop(), [{ platform: providerId }, "entities.get", { entity: original }],
            "metadata is a canonical named capability with exactly one request object");
        assert.equal(fetched.detailMusic.id, 42);
        assert.equal(fetched.detailMusic.platform, providerId);
        assert.equal(fetched.detailMusic.token, "retained-extra");
        assert.deepEqual(fetched.choices.map((choice) => choice.value), ["320k"]);
        assert.equal(fetched.choices[0].sizeText, "2.0KB");
        invocation = async () => { throw new Error("temporary failure"); };
        assert.deepEqual((await qualities.resolveMusicQualityChoices(original, translate)).choices, []);
        calls.length = 0;
        configuration["private.pluginMeta"] = { [providerId]: { disabled: true } };
        assert.deepEqual((await qualities.resolveMusicQualityChoices(original, translate)).choices, []);
        assert.equal(calls.length, 0, "disabled provider cannot be called to repair quality metadata");
        configuration["private.pluginMeta"] = {};

        const downloaded = media.setInternalData({ ...track("local-file"), platform: localPluginName, size: 3072 },
            "downloadData", { path: "/trusted/local-file.flac", quality: "flac" }, true);
        const local = await qualities.resolveMusicQualityChoices(downloaded, translate);
        assert.deepEqual(local.choices.map((choice) => [choice.value, choice.sizeText]), [["flac", "3.0KB"]]);
        assert.equal(calls.length, 0, "local downloads keep their actual stored quality without remote lookup");

        const bound = bindings.bindMediaToPlugin(declared, { platform: providerId, id: providerId });
        assert.equal(bound.hash, "track-content-hash", "source identity must not overwrite a song's content hash");
        assert.deepEqual(bindings.getMediaPluginDelegate(bound), { platform: providerId, id: providerId, hash: providerId });
        const alternate = bindings.bindMediaToPlugin(track(42), { platform: providerId, id: otherProvider });
        bindings.cachePrefetchedMediaSource(bound, "flac", { url: "https://fixture/flac", headers: { "x-fixture": "yes" } });
        assert.equal(bindings.getPrefetchedMediaSource(track("42"), ["flac"]), null, "numeric and string IDs cannot share cached media");
        assert.equal(bindings.getPrefetchedMediaSource(alternate, ["flac"]), null, "different explicit providers cannot share cached media");
        assert.equal(bindings.getPrefetchedMediaSource(bound, ["128k"]), null, "quality keys remain part of the media cache identity");
        assert.equal(bindings.getPrefetchedMediaSource(bound, ["flac"]).mediaSource.headers["x-fixture"], "yes");
        const revision = manager.getRegistryRevision();
        updateRegistry({ retiredPlugins: [], resolverBindings: [{ providerId, resolverId }] });
        assert.ok(manager.getRegistryRevision() > revision);
        await manager.setResolverBinding(providerId, resolverId);
        assert.deepEqual(calls.pop(), ["setResolverBinding", providerId, resolverId]);
        await manager.setResolverBinding(providerId, null);
        assert.deepEqual(calls.pop(), ["setResolverBinding", providerId, null], "clearing a selection is explicit");
        console.log("v2-quality: declared tiers, canonical metadata calls, disabled sources, local downloads, typed cache identity and explicit bindings passed");
    } finally { global.window = previousWindow; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
