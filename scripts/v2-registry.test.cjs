const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { EventEmitter, once } = require("node:events");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "baka-v2-registry-"));
const handlers = new Map();
const configListeners = new Set();
const configuration = { "normal.language": "en-US", "private.pluginMeta": {}, "private.pluginResolverBindings": {} };
const app = Object.assign(new EventEmitter(), { getPath: () => taskRoot, getVersion: () => "1.0.0" });
const config = {
    getConfig: (key) => configuration[key],
    setConfig: (patch) => { Object.assign(configuration, patch); for (const listener of configListeners) listener(patch, configuration, "main"); },
    onConfigUpdated: (callback) => configListeners.add(callback), offConfigUpdated: (callback) => configListeners.delete(callback),
};
const logger = { logError() {}, logInfo() {} };
const pathGrants = new Map();
const security = {
    assertPlainObject(value) { assert.ok(value && typeof value === "object" && !Array.isArray(value)); },
    assertString(value, _name, limit) { assert.equal(typeof value, "string"); assert.ok(value.length <= limit); },
    assertIpcPayload(value, limit) { assert.ok(Buffer.byteLength(JSON.stringify(value)) <= limit); },
    assertIpcSender(event, roles) { assert.ok(roles.includes(event.role)); return event.role; },
    assertPathAccess(value, options = {}) {
        assert.equal(typeof value, "string");
        const resolved = path.resolve(value);
        const real = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : options.allowMissing ? resolved : fs.realpathSync.native(resolved);
        if (options.extensions?.length) assert.ok(options.extensions.includes(path.extname(real).toLowerCase()), "Path extension is not accepted");
        const within = (candidate, directory) => { const relative = path.relative(directory, candidate); return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
        const roots = [fs.realpathSync.native(taskRoot), ...(options.extraRoots ?? []).map((entry) => fs.realpathSync.native(entry)), ...[...pathGrants].filter(([, recursive]) => recursive).map(([entry]) => entry)];
        assert.ok(pathGrants.has(real) || roots.some((directory) => within(real, directory)), "Path is outside the granted roots");
        return real;
    },
    grantPathAccess(value, recursive = false) { pathGrants.set(fs.realpathSync.native(value), recursive); },
    assertUrl(value, protocols) { const url = new URL(value); assert.ok(protocols.includes(url.protocol)); return url; },
};
function load(relative, stubs = {}) {
    const filename = path.join(root, relative);
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
    }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = loaded.require.bind(loaded);
    loaded.require = (name) => Object.prototype.hasOwnProperty.call(stubs, name) ? stubs[name] : original(name);
    loaded._compile(compiled, filename);
    return loaded.exports;
}
const shared = "src/shared/plugin-manager/";
const rpc = load(shared + "rpc.ts");
const logTypes = load(shared + "playback-log.ts");
const { default: Host } = load(shared + "main/plugin-host-client.ts", {
    "@/common/get-resource-path": (relative) => path.join(root, "res", relative),
    "@shared/logger/main": logger, "@/common/error-util": { toError: (error) => error instanceof Error ? error : new Error(String(error)) },
});
const fileUtil = {
    safeStat: (value) => fs.promises.stat(value).catch(() => undefined), addFileScheme: (value) => `file://${value}`,
    parseLocalMusicItem: async (value) => ({ id: value, platform: "本地", title: "Local file" }),
    parseLocalMusicItemFolder: async (directory) => fs.readdirSync(directory).filter((name) => name.endsWith(".mp3"))
        .map((name) => ({ id: path.join(directory, name), platform: "本地", title: name })), parseLocalMusicLyric: async () => undefined,
};
const sourceAccess = load(shared + "main/internal-plugins/local-file-access.ts", {
    electron: { app }, "@shared/ipc-security/main": security,
    "@/common/constant": { supportLocalMediaType: [".mp3", ".flac", ".wav"] },
});
const { default: Methods } = load(shared + "main/plugin-methods.ts", {
    "@/common/media-util": { getDeclaredQualityKeys: (entity) => Object.keys(entity.qualities ?? {}), getInternalData: () => undefined },
    "@/common/file-util": fileUtil, "./lyric-decrypt": { autoDecryptLyric: (value) => value },
    "@shared/service-manager/main": { registerMflacStream: async () => null, registerLunaStream: async () => null },
    "@shared/ipc-security/main": security, "./internal-plugins/local-file-access": sourceAccess,
});
const { Plugin } = load(shared + "main/plugin.ts", { "./plugin-methods": Methods });
const { default: localPlugin } = load(shared + "main/internal-plugins/local-plugin.ts", {
    "@/common/constant": { localPluginHash: "本地", localPluginName: "本地" }, "../plugin": { Plugin },
    "@/common/file-util": fileUtil, "@shared/ipc-security/main": security,
    "./local-file-access": sourceAccess,
    "@shared/local-media/common": { LOCAL_MEDIA_PROTOCOL: "bakamusic-local", parseLocalMediaUrl: (value) => value },
});
const { default: LogStore } = load(shared + "main/playback-log-store.ts", {
    electron: { app }, "@shared/logger/main": logger,
    "@/common/error-util": { toError: (error) => error }, "../playback-log": logTypes,
});
const downloads = new Map();
const lxImportStore = load(shared + "main/lx-import-store.ts");
const { PluginManager } = load(shared + "main/index.ts", {
    electron: { app, ipcMain: { handle: (name, callback) => handlers.set(name, callback) } },
    axios: { get: async (url) => { const parsed = new URL(url); parsed.searchParams.delete("_bakamusic_cache");
        const code = downloads.get(parsed.toString()); if (code === undefined) throw new Error("missing fixture URL"); return { data: code }; } },
    "@/common/constant": { localPluginHash: "本地", localPluginName: "本地" },
    "@/common/error-util": { toError: (error) => error }, "@shared/app-config/main": config,
    "@shared/ipc-security/main": security, "@shared/logger/main": logger, "../rpc": rpc,
    "./internal-plugins/local-plugin": localPlugin, "./plugin": { Plugin },
    "./lx-import-store": lxImportStore,
    "./plugin-host-client": { default: Host, ...load(shared + "main/plugin-host-client.ts", {
        "@/common/get-resource-path": (relative) => path.join(root, "res", relative), "@shared/logger/main": logger,
        "@/common/error-util": { toError: (error) => error },
    }), __esModule: true }, "./playback-log-store": LogStore,
});
const providerId = "test.registry.provider";
const authCapabilities = ["auth.login", "auth.callback", "auth.logout", "auth.status"];
const authHandlers = `auth:{login:authResult,callback:authResult,logout:authResult,status:()=>({authenticated:true})}`;
const authResult = `const authResult=r=>{if(r.payload?.fail){const e=new Error("fixture authentication failed");e.code="authentication_required";throw e}return r.payload?.result!==undefined?r.payload.result:{ok:true}};`;
function provider(version = "1.0.0", id = providerId) {
    return `// @baka-provider 2\n${authResult}module.exports={manifest:{apiVersion:2,id:${JSON.stringify(id)},kind:"provider",name:"Registry provider",author:"BakaMusic",version:${JSON.stringify(version)},sourceId:"fixture",capabilities:["search","entities.get","media.prepare","media.resolve","lyrics.get",...${JSON.stringify(authCapabilities)}]},handlers:{${authHandlers},lyrics:{get:()=>null},search:r=>({items:[{id:r.cursor?"42":42,title:"Song"}],nextCursor:r.cursor?null:"next",total:2}),entities:{get:async(r,sdk)=>({id:r.entity.id,version:${JSON.stringify(version)},setting:sdk.settings.token,lean:[typeof require,typeof process,typeof Buffer].every(v=>v==="undefined")})},media:{prepare:async r=>{if(r.entity.prepareDelay)await new Promise(resolve=>setTimeout(resolve,80));return {entity:r.entity,context:{token:"prepared"}}},resolve:r=>{if(r.entity.pending)return new Promise(()=>{});if(r.entity.coded){const e=new Error("do-not-leak");e.code="quality_unavailable";throw e}return {url:"https://provider.example/"+r.entity.id,quality:r.quality}}}}};`;
}
const resolverId = "test.registry.resolver";
const resolver = `// @baka-provider 2\nmodule.exports={manifest:{apiVersion:2,id:"${resolverId}",kind:"resolver",name:"Explicit resolver",author:"BakaMusic",version:"1.0.0",sources:["fixture"],capabilities:["media.resolve"]},handlers:{media:{resolve:async r=>{if(r.entity.resolveDelay)await new Promise(resolve=>setTimeout(resolve,80));return {url:"https://resolver.example/"+r.entity.id+"/"+r.context.token,quality:r.quality}}}}};`;
async function main() {
    const manager = new PluginManager();
    const write = async (name, code) => { const file = path.join(taskRoot, name); await fs.promises.writeFile(file, code); return file; };
    const invoke = (capability, request) => manager.invoke({ providerId, capability, request });
    const sentEvents = [];
    const stateEvents = () => sentEvents.filter(([channel]) => channel === "@shared/plugin-manager/state-updated").length;
    let child;
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "baka-v2-private-source-"));
    try {
        const legacyPath = path.join(taskRoot, "bakamusic-plugins"); fs.mkdirSync(legacyPath);
        fs.writeFileSync(path.join(legacyPath, "retired.js"), 'throw new Error("legacy code must never execute")');
        await manager.setup({ mainWindow: { isDestroyed: () => false, webContents: { send: (...args) => sentEvents.push(args) } } });
        assert.equal(manager.registryState.retiredPlugins[0].reason, "legacy_format");
        assert.equal(manager.plugins.length, 0);
        await assert.rejects(manager.installPluginFromLocalFile(await write("legacy.js", 'module.exports={platform:"Old"}')));
        for (const location of ["local", "remote"]) {
            for (const kind of ["v2", "lx"]) {
                const id = `test.ipc.${location}.${kind}`;
                const code = kind === "v2" ? provider("1.0.0", id)
                    : `/** @name IPC LX ${location} */\nlx.on('request',()=> 'https://ipc.example/song');lx.send('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['128k']}}});`;
                const source = location === "local" ? await write(`ipc-${kind}.js`, code) : `https://plugins.example/ipc-${kind}`;
                if (location === "remote") downloads.set(source, code);
                const result = await handlers.get(`@shared/plugin-manager/install-plugin-${location}`)({ role: "main" }, source, { kind });
                assert.equal(structuredClone(result), undefined, `${location} ${kind} import returns a cloneable void IPC result`);
                assert.equal(manager.plugins.length, 1, `${location} ${kind} import completes before IPC responds`);
                const installed = manager.plugins[0];
                assert.equal(installed.manifest.kind, kind === "v2" ? "provider" : "resolver");
                assert.equal(manager.host.registrations.has(installed.id), true);
                await manager.uninstallPlugin(installed.id);
            }
        }
        await manager.installPluginFromLocalFile(await write("provider.js", provider()));
        assert.equal(manager.plugins[0].delegate.id, providerId);
        assert.equal(manager.plugins[0].delegate.platform, providerId);
        assert.equal(manager.plugins[0].delegate.supportedMethod, undefined);
        const first = await invoke("search", { query: "a", kind: "music", cursor: null, limit: 1 });
        const second = await invoke("search", { query: "a", kind: "music", cursor: first.nextCursor, limit: 1 });
        assert.equal(first.items[0].id, 42); assert.equal(second.items[0].id, "42");
        assert.equal(first.items[0].platform, providerId);
        const originalPath = manager.plugins[0].path;
        fs.writeFileSync(originalPath, 'throw new Error("modified disk must not become live code")');
        assert.equal((await invoke("entities.get", { entity: { id: 42 } })).version, "1.0.0");
        configuration["private.pluginMeta"] = { [providerId]: { userVariables: { token: "updated" } } };
        const updated = await invoke("entities.get", { entity: { id: 42 } });
        assert.equal(updated.setting, "updated"); assert.equal(updated.lean, true);
        // Installation restores files from immutable original records on a failed native replacement.
        const loadPlugin = manager.host.loadPlugin.bind(manager.host);
        let fail = true;
        manager.host.loadPlugin = async (...args) => { if (fail) { fail = false; throw new Error("fixture activation failure"); } return loadPlugin(...args); };
        await assert.rejects(manager.installPluginFromLocalFile(await write("update.js", provider("1.1.0"))), /activation failure/);
        assert.equal(fs.readFileSync(originalPath, "utf8"), provider());
        assert.equal((await invoke("entities.get", { entity: { id: 42 } })).version, "1.0.0");
        manager.host.loadPlugin = loadPlugin;
        downloads.set("https://plugins.example/provider", provider("1.1.0"));
        await manager.installPluginFromRemoteUrl("https://plugins.example/provider");
        downloads.set("https://plugins.example/provider", provider("1.2.0", "test.other.package"));
        await assert.rejects(manager.installPluginFromRemoteUrl("https://plugins.example/provider"), /package ID changed/);
        assert.equal(manager.plugins.length, 1);
        await manager.installPluginFromLocalFile(await write("resolver.js", resolver));
        for (const capability of authCapabilities) {
            const before = stateEvents();
            const result = await handlers.get("@shared/plugin-manager/invoke")({ role: "main" }, { providerId, capability, request: { payload: {} } });
            assert.equal(result.ok, true);
            assert.equal(stateEvents(), before + (capability === "auth.status" ? 0 : 1), `${capability} broadcasts before IPC completion`);
            if (capability !== "auth.status") {
                const failed = await handlers.get("@shared/plugin-manager/invoke")({ role: "main" }, { providerId, capability, request: { payload: { fail: true } } });
                assert.equal(failed.ok, false); assert.equal(failed.error.code, "authentication_required");
                assert.equal(stateEvents(), before + 1, "failed authentication must not invalidate renderer state");
                for (const rejected of [false, { ok: false }, { success: false }, { error: "failed", ok: true }]) {
                    const rejectedResult = await handlers.get("@shared/plugin-manager/invoke")({ role: "main" }, { providerId, capability, request: { payload: { result: rejected } } });
                    assert.equal(rejectedResult.ok, true);
                    assert.equal(stateEvents(), before + 1, "fulfilled failed-authentication results must not invalidate renderer state");
                }
            }
        }
        const request = { entity: { id: 42 }, quality: "128k" };
        assert.match((await invoke("media.resolve", request)).url, /provider\.example/);
        await manager.setResolverBinding(providerId, resolverId);
        await assert.rejects(manager.invoke({ providerId: resolverId, capability: "media.resolve", request }), /compatible music source/);
        assert.equal((await invoke("media.resolve", request)).url, "https://resolver.example/42/prepared");
        for (const phase of ["prepareDelay", "resolveDelay"]) {
            const changing = invoke("media.resolve", { entity: { id: 42, [phase]: true }, quality: "128k" });
            const changed = assert.rejects(changing, /source changed|resolver is unavailable/);
            await new Promise((resolve) => setTimeout(resolve, 25));
            await manager.setResolverBinding(providerId, null);
            await changed;
            await manager.setResolverBinding(providerId, resolverId);
        }
        config.setConfig({ "private.pluginMeta": { [resolverId]: { disabled: true } } });
        await assert.rejects(invoke("media.resolve", request), /selected resolver is unavailable/);
        await manager.setResolverBinding(providerId, null);
        assert.match((await invoke("media.resolve", request)).url, /provider\.example/);
        const envelope = await handlers.get("@shared/plugin-manager/invoke")({ role: "main" }, { providerId, capability: "media.resolve", request: { entity: { id: 42, coded: true }, quality: null } });
        assert.equal(envelope.ok, false); assert.equal(envelope.error.code, "quality_unavailable");
        assert.doesNotMatch(envelope.error.message, /do-not-leak/);
        const denied = await handlers.get("@shared/plugin-manager/invoke")({ role: "mv" }, { providerId, capability: "search", request: {} });
        assert.equal(denied.error.code, "permission_denied");
        const pending = invoke("media.resolve", { entity: { id: 42, pending: true }, quality: null });
        const revoked = assert.rejects(pending);
        await new Promise((resolve) => setTimeout(resolve, 30));
        config.setConfig({ "private.pluginMeta": { [providerId]: { disabled: true } } });
        await revoked; await assert.rejects(invoke("entities.get", { entity: { id: 42 } }));
        config.setConfig({ "private.pluginMeta": {} });
        await invoke("entities.get", { entity: { id: 42 } });
        child = manager.host.child; const exited = once(child, "exit"); child.kill(); await exited;
        assert.equal((await invoke("entities.get", { entity: { id: 42 } })).version, "1.1.0", "native restart restores current enabled snapshot");
        await manager.uninstallPlugin(providerId);
        await assert.rejects(invoke("entities.get", { entity: { id: 42 } }));
        const localFile = await write("local.mp3", "fixture");
        const local = await manager.invoke({ providerId: "本地", capability: "links.resolve", request: { url: localFile } });
        assert.equal(local.id, fs.realpathSync.native(localFile));
        const folder = path.join(taskRoot, "music-folder"); fs.mkdirSync(folder);
        for (const name of ["a.mp3", "b.mp3", "c.mp3"]) fs.writeFileSync(path.join(folder, name), "fixture");
        const collection = await manager.invoke({ providerId: "本地", capability: "links.resolve", request: { url: folder, kind: "sheet" } });
        const firstLocal = await manager.invoke({ providerId: "本地", capability: "collections.members", request: { entity: collection, kind: "music", cursor: null, limit: 2 } });
        const secondLocal = await manager.invoke({ providerId: "本地", capability: "collections.members", request: { entity: collection, kind: "music", cursor: firstLocal.nextCursor, limit: 2 } });
        assert.equal(firstLocal.items.length, 2); assert.equal(secondLocal.items.length, 1);
        assert.equal(secondLocal.nextCursor, null); assert.equal(firstLocal.revision, secondLocal.revision);
        await assert.rejects(manager.invoke({ providerId: "本地", capability: "collections.members", request: { entity: collection, kind: "music", cursor: "-1", limit: 2 } }));
        const privateFile = path.join(externalRoot, "private.mp3"); fs.writeFileSync(privateFile, "private");
        fs.writeFileSync(path.join(externalRoot, "private.lrc"), "[00:01]private lyric");
        for (const capability of ["media.resolve", "entities.get", "lyrics.get"]) {
            await assert.rejects(manager.invoke({ providerId: "本地", capability, request: { entity: { id: privateFile, $$localPath: privateFile }, quality: null } }), /granted roots/);
        }
        assert.equal(pathGrants.size, 0, "forged local entities must not mint authorization");
        // An explicit picker grant may be remembered; a future session restores only that original identity.
        security.grantPathAccess(privateFile);
        await manager.invoke({ providerId: "本地", capability: "links.resolve", request: { url: privateFile } });
        pathGrants.clear();
        const replay = await manager.invoke({ providerId: "本地", capability: "media.resolve", request: { entity: { id: privateFile, $$localPath: privateFile }, quality: null } });
        assert.ok(replay.url.includes("private.mp3"));
        const lyrics = await manager.invoke({ providerId: "本地", capability: "lyrics.get", request: { entity: { id: privateFile, $$localPath: privateFile } } });
        assert.equal(lyrics.rawLrc, "[00:01]private lyric");
        const unauthorized = path.join(externalRoot, "other.mp3"); fs.writeFileSync(unauthorized, "private");
        await manager.installPluginFromLocalFile(await write("reimport.js", provider("1.1.0")));
        await assert.rejects(invoke("lyrics.get", { entity: { id: 42, $$localPath: unauthorized } }), /granted roots/);
        assert.ok(fs.existsSync(path.join(taskRoot, "local-source-authorizations.json")));
        const duplicateA = await write("duplicate-a.js", provider("2.0.0"));
        await manager.installPluginFromLocalFile(duplicateA);
        const installed = manager.plugins.find((plugin) => plugin.id === providerId).path;
        fs.copyFileSync(installed, path.join(path.dirname(installed), "duplicate.js"));
        fs.copyFileSync(installed + ".integrity.json", path.join(path.dirname(installed), "duplicate.js.integrity.json"));
        await manager.loadAllPlugins();
        assert.ok(!manager.plugins.some((plugin) => plugin.id === providerId));
        assert.equal(manager.registryState.retiredPlugins.filter((entry) => entry.reason === "duplicate_id").length, 2);
        console.log("v2-registry: strict native loading, typed IDs, immutable snapshots, rollback, identity, resolver selection, settings, revocation, restart, IPC and local actions passed");
    } finally {
        child = manager.host.child;
        const stopped = child && child.exitCode === null ? once(child, "exit") : Promise.resolve();
        app.emit("before-quit"); await stopped;
        fs.rmSync(taskRoot, { recursive: true, force: true });
        fs.rmSync(externalRoot, { recursive: true, force: true });
    }
}
module.exports = { main, load, Methods, Plugin, Host, PluginManager, LogStore, app, config, configuration,
    handlers, downloads, taskRoot, provider, providerId, resolver, resolverId, logTypes, security, sourceAccess };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
