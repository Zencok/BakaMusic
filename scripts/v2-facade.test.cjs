const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function load(relative, stubs = {}) {
    const filename = path.join(root, relative);
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = loaded.require.bind(loaded);
    loaded.require = name => Object.hasOwn(stubs, name) ? stubs[name] : original(name);
    loaded._compile(compiled, filename);
    return loaded.exports;
}
const logTypes = load("src/shared/plugin-manager/playback-log.ts");
const ipc = new EventEmitter();
let bridge;
let dispatch;
ipc.invoke = async (channel, ...args) => JSON.parse(JSON.stringify(await dispatch(channel, ...args)));
load("src/shared/plugin-manager/preload.ts", {
    electron: { ipcRenderer: ipc }, "@/preload/expose-in-main-world": (_key, value) => { bridge = value; },
    "./playback-log": logTypes,
});
const configuration = { "private.pluginMeta": {} };
let configUpdated;
global.window = { "@shared/plugin-manager": bridge };
const Store = load("src/common/store.ts").default;
const facade = load("src/shared/plugin-manager/renderer.ts", {
    "@/common/store": Store,
    "@shared/app-config/renderer": { getConfig: key => configuration[key], onConfigUpdate: callback => { configUpdated = callback; } },
    "@/common/media-util": { getDeclaredQualityKeys: entity => Object.keys(entity.qualities ?? {}), filterQualityOrderByDeclaredQualities: (_entity, order) => order },
    "@/hooks/useAppConfig": () => configuration["private.pluginMeta"],
    "@shared/logger/renderer": { logInfo() {} }, "./playback-log": logTypes,
}).default;
const provider = { id: "test.facade.provider", platform: "test.facade.provider", hash: "test.facade.provider", name: "Provider", capabilities: ["search", "media.resolve", "links.resolve", "collections.members"] };
const entity = { id: 9, platform: provider.id, title: "Collection" };
let pages;
let requests;
let mutate;
function setup(nextPages) {
    pages = [...nextPages]; requests = [];
    dispatch = async (channel, data) => {
        if (channel === "@shared/plugin-manager/invoke") {
            requests.push(data);
            if (data.capability.startsWith("auth.")) return {ok:true,value:true};
            if (data.capability === "links.resolve") return { ok: true, value: entity };
            if (mutate) { const callback = mutate; mutate = undefined; await callback(); }
            return { ok: true, value: pages.shift() };
        }
        throw new Error("Unexpected channel " + channel);
    };
}
const member = id => ({id, platform: provider.id, title: "Track"});
async function main() {
    ipc.emit("@/shared/plugin-manager/sync-plugins", {}, [provider]);
    assert.equal(facade.getPluginByPlatform(provider.id).name, "Provider");
    assert.equal(facade.getPluginByPlatform("Provider"), undefined);
    const prepareOnly = {...provider,id:"test.prepare.provider",platform:"test.prepare.provider",kind:"provider",sourceId:"fixture",capabilities:["media.prepare"]};
    const resolver = {...provider,id:"test.resolver",platform:"test.resolver",kind:"resolver",sources:["fixture"],capabilities:["media.resolve"]};
    ipc.emit("@/shared/plugin-manager/sync-plugins", {}, [provider,prepareOnly]);
    assert.equal(facade.getSourcePluginCandidates("playback").some(plugin=>plugin.id===prepareOnly.id),false);
    ipc.emit("@shared/plugin-manager/state-updated",{}, {retiredPlugins:[],resolverBindings:[{providerId:prepareOnly.id,resolverId:"test.resolver"}]});
    assert.equal(facade.getSourcePluginCandidates("playback").some(plugin=>plugin.id===prepareOnly.id),false);
    ipc.emit("@/shared/plugin-manager/sync-plugins", {}, [provider,prepareOnly,resolver]);
    assert.equal(facade.getSourcePluginCandidates("playback").some(plugin=>plugin.id===prepareOnly.id),true);
    assert.equal(facade.getSourcePluginCandidates("playback").some(plugin=>plugin.id===resolver.id),false);
    configuration["private.pluginMeta"] = {[resolver.id]:{disabled:true}};
    assert.equal(facade.getSourcePluginCandidates("playback").some(plugin=>plugin.id===prepareOnly.id),false);
    configuration["private.pluginMeta"] = {};
    ipc.emit("@/shared/plugin-manager/sync-plugins", {}, [provider,prepareOnly,{...resolver,sources:["other"]}]);
    assert.equal(facade.getSourcePluginCandidates("playback").some(plugin=>plugin.id===prepareOnly.id),false);
    ipc.emit("@/shared/plugin-manager/sync-plugins", {}, [provider,prepareOnly,resolver]);
    setup([{items:[member(7)], nextCursor:"second", total:2, revision:"v1"}, {items:[member("7")], nextCursor:null, total:2, revision:"v1"}]);
    const result = await facade.importCollection(provider, "https://example.test/collection");
    assert.deepEqual(result.musicList.map(item => item.id), [7,"7"]);
    assert.equal(result.syncVersion, "v1");
    assert.deepEqual(requests.map(request => request.capability), ["links.resolve","collections.members","collections.members"]);
    assert.deepEqual(requests.slice(1).map(request => request.request.cursor), [null,"second"]);
    assert.ok(requests.every(request => request.providerId === provider.id && !Object.hasOwn(request,"args")));
    setup([]);
    await facade.invoke({...member(7),hash:"opaque-media-content-hash"},"auth.status",{payload:{}});
    assert.equal(requests[0].providerId,provider.id);
    for (const [capability, value, changed] of [
        ["auth.login", {authenticated:true}, true], ["auth.callback", {ok:true}, true],
        ["auth.logout", null, true], ["auth.logout", {authenticated:false}, true],
        ["auth.login", {url:"https://example.test/login"}, false], ["auth.login", null, false],
        ["auth.login", {authenticated:true,ok:false}, false], ["auth.callback", {success:true,error:"failed"}, false],
        ["auth.logout", false, false], ["auth.status", {authenticated:true}, false],
    ]) {
        dispatch = async () => ({ok:true,value});
        const revision = facade.getRegistryRevision();
        await facade.invoke(provider,capability,{payload:{}});
        assert.equal(facade.getRegistryRevision() > revision,changed,`${capability} ${JSON.stringify(value)}`);
    }
    const invalidPages = [
        [{items:[member(1)],nextCursor:"same"},{items:[member(2)],nextCursor:"same"}],
        [{items:[],nextCursor:"next"}],
        [{items:[member(1)],nextCursor:null,total:2}],
        [{items:[member(1)],nextCursor:"next",revision:"a"},{items:[member(2)],nextCursor:null,revision:"b"}],
        [{items:[member(1)],nextCursor:"next",accountRevision:"a"},{items:[member(2)],nextCursor:null}],
        [{items:[member(1)],nextCursor:null,entity:{...entity,id:"9"}}],
        [{items:[{...member(1),platform:"test.other.provider"}],nextCursor:null}],
    ];
    for (const batch of invalidPages) { setup(batch); await assert.rejects(facade.importCollection(provider,"https://example.test/collection")); }
    setup([{items:[member(1)],nextCursor:null}]);
    mutate = () => configUpdated({"private.pluginMeta":{}});
    await assert.rejects(facade.importCollection(provider,"https://example.test/collection"), /changed/);
    setup([{items:[member(1)],nextCursor:null}]);
    mutate = () => facade.invoke(provider,"auth.logout",{payload:{}});
    await assert.rejects(facade.importCollection(provider,"https://example.test/collection"), /changed/);
    for (const code of ["quality_unavailable","track_unavailable","authentication_required","permission_denied","rate_limited","temporary_unavailable","signature_expired"]) {
        dispatch = async () => ({ok:false,error:{message:"Coded failure",code}});
        await assert.rejects(facade.invoke(provider,"media.resolve",{entity:member(7),quality:"flac"}), error => error.code === code);
    }
    let mv;
    let mvCalls = 0;
    const mvIpc = {invoke: async () => {mvCalls++; return {ok:true,value:{url:"https://example.test/video"}};}};
    load("src/shared/plugin-manager/preload-mv.ts", {electron:{ipcRenderer:mvIpc},"@/preload/expose-in-main-world":(_key,value)=>{mv=value;}});
    await assert.rejects(mv.invoke(provider,"search",{}), /only resolve video/);
    assert.equal(mvCalls,0);
    assert.equal(mv.installPluginFromLocal,undefined);
    assert.equal((await mv.invoke(provider,"media.video",{entity:member(7)})).value.url,"https://example.test/video");
    console.log("v2-facade: complete imports, ownership, typed IDs, invalidation, seven error codes and MV bridge passed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
