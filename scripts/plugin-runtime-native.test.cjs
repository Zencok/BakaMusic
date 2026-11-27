const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { client } = require("./plugin-runtime-smoke.cjs");

const pluginId = "test.native.integration";
const source = `// @baka-provider 2
module.exports={manifest:{apiVersion:2,kind:"provider",id:"${pluginId}",name:"Native integration",author:"BakaMusic",version:"1.0.0",sourceId:"native-test",capabilities:["search","entities.get","media.resolve","auth.login"]},handlers:{
search:async(request)=>{if(request.delayMs)await new Promise(r=>setTimeout(r,request.delayMs));return {items:[{id:request.cursor?"42":42}],nextCursor:request.bad?request.cursor:request.cursor?null:"next",total:2}},
entities:{get:async(request,sdk)=>{if(request.operation==="increment"){const value=Number(await sdk.storage.get("count")||"0")+1;await sdk.storage.set("count",String(value));return {count:value}}return {id:request.id,settings:sdk.settings,lean:[typeof require,typeof process,typeof Buffer,typeof axios].every(v=>v==="undefined")}}},
media:{resolve:async(request,sdk)=>{if(request.operation==="coded"){const error=new Error("credential=do-not-transport");error.code="quality_unavailable";throw error}if(request.operation==="pending")return new Promise(()=>{});if(request.delayMs)await new Promise(r=>setTimeout(r,request.delayMs));if(request.url)return (await sdk.http.request({url:request.url,responseType:"text"})).body;return request}},
auth:{login:()=>({authenticated:true})}}};`;

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "baka-native-integration-"));
    const storageRoot = path.join(root, "storage");
    const requests = [];
    let slowStarted;
    let slowClosed;
    const started = new Promise((resolve) => { slowStarted = resolve; });
    const closed = new Promise((resolve) => { slowClosed = resolve; });
    const sockets = new Set();
    const server = http.createServer((request, response) => {
        requests.push(request.url);
        if (request.url === "/slow") {
            slowStarted(); request.socket.once("close", slowClosed);
        } else response.end("native-http-ok");
    });
    server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    let service = client();
    const load = (settings = { token: "fixture-setting" }, code = source) => service.call("load", { pluginId, code, settings, storageRoot });
    const invoke = (capability, request) => service.call("invoke", { pluginId, capability, request });
    const expectCode = (code) => (error) => { assert.equal(error.data.code, code); return true; };
    try {
        const inspected = await service.call("inspect", { code: source, settings: {} });
        assert.equal(inspected.runtime, "rust-quickjs-v2");
        assert.equal(inspected.id, pluginId);
        assert.equal(inspected.manifest.author, "BakaMusic");
        await assert.rejects(service.call("inspect", { code: source.replace("// @baka-provider 2", "// legacy"), settings: {} }));
        await assert.rejects(service.call("inspect", { code: source + `\n__baka.http(JSON.stringify({url:${JSON.stringify(origin)}}));`, settings: {} }));
        assert.equal(requests.length, 0, "inspection must never perform network I/O");
        await assert.rejects(service.call("eval", { code: "42" }), expectCode("method_not_found"));
        await assert.rejects(load([], source), expectCode("invalid_params"));
        await load();
        assert.deepEqual(await invoke("entities.get", { id: 42 }), { id: 42, settings: { token: "fixture-setting" }, lean: true });
        assert.equal((await invoke("entities.get", { id: "42" })).id, "42");
        const first = await invoke("search", { cursor: null, limit: 1 });
        const second = await invoke("search", { cursor: first.nextCursor, limit: 1 });
        assert.equal(first.items[0].id, 42);
        assert.equal(second.items[0].id, "42");
        assert.equal(second.nextCursor, null);
        await assert.rejects(invoke("search", { cursor: "next", limit: 1, bad: true }));
        await assert.rejects(invoke("search", { cursor: null, limit: 0 }));
        await assert.rejects(invoke("undeclared", {}));
        await assert.rejects(invoke("media.resolve", { operation: "coded" }), (error) => {
            assert.equal(error.data.failureCode, "quality_unavailable");
            assert.doesNotMatch(error.message, /do-not-transport/); return true;
        });
        assert.deepEqual(await invoke("entities.get", { operation: "increment" }), { count: 1 });
        await assert.rejects(load({ token: "bad-update" }, source.replace(`id:"${pluginId}"`, 'id:"test.other"')));
        assert.equal((await invoke("entities.get", {})).settings.token, "fixture-setting", "failed replacement preserves old host");
        await load({ token: "reloaded" });
        assert.deepEqual(await invoke("entities.get", { operation: "increment" }), { count: 2 });
        assert.equal((await invoke("entities.get", {})).settings.token, "reloaded");
        await service.close(); service = client(); await load({ token: "restarted" });
        assert.deepEqual(await invoke("entities.get", { operation: "increment" }), { count: 3 }, "SQLite survives process restart");
        assert.equal(await invoke("media.resolve", { url: `${origin}/healthy` }), "native-http-ok");
        const slow = service.request("invoke", { pluginId, capability: "media.resolve", request: { url: `${origin}/slow` } });
        const rejectedSlow = assert.rejects(slow.promise, expectCode("cancelled"));
        await started;
        assert.equal(await service.call("cancel", { requestId: slow.id }), true);
        await rejectedSlow;
        await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error("Native HTTP was not cancelled")), 2000))]);
        const delayed = service.request("invoke", { pluginId, capability: "media.resolve", request: { delayMs: 120, url: `${origin}/cancelled-late` } });
        const rejectedDelayed = assert.rejects(delayed.promise, expectCode("cancelled"));
        assert.equal(await service.call("cancel", { requestId: delayed.id }), true);
        await rejectedDelayed;
        await new Promise((resolve) => setTimeout(resolve, 180));
        assert.ok(!requests.includes("/cancelled-late"), "cancelled timer must not start later HTTP");
        const page = service.request("invoke", { pluginId, capability: "search", request: { cursor: null, limit: 1, delayMs: 120 } });
        const stalePage = assert.rejects(page.promise, /account changed/);
        await new Promise((resolve) => setTimeout(resolve, 30));
        await invoke("auth.login", {}); await stalePage;
        const pending = service.request("invoke", { pluginId, capability: "media.resolve", request: { operation: "pending" } });
        const retired = assert.rejects(pending.promise);
        await service.call("unload", { pluginId }); await retired;
        await assert.rejects(invoke("entities.get", {}), expectCode("not_loaded"));
        await load();
        // A job completion while the next frame is fragmented cannot consume
        // the prefix of that frame; this exercises real streaming input.
        const ticking = invoke("media.resolve", { delayMs: 40 });
        const fragmented = service.request("health", {}, "fragmented", false);
        service.child.stdin.write('{"jsonrpc":"2.0","id":"fragmented",');
        await ticking;
        service.child.stdin.write('"method":"health","params":{}}\n');
        assert.equal((await fragmented.promise).runtime, "rust-quickjs-v2");
        const held = Array.from({ length: 4 }, () => service.request("invoke", {
            pluginId, capability: "media.resolve", request: { operation: "pending" },
        }));
        const heldResults = held.map((job) => assert.rejects(job.promise));
        const queuedLoad = service.request("load", { pluginId, code: source, settings: {}, storageRoot });
        const retiredLoad = assert.rejects(queuedLoad.promise, expectCode("host_stopped"));
        await service.call("unload", { pluginId });
        await Promise.all([...heldResults, retiredLoad]);
        await assert.rejects(invoke("entities.get", {}), expectCode("not_loaded"), "queued load must not resurrect an unloaded plugin");
        await load();
        const saturated = Array.from({ length: 128 }, () => service.request("invoke", {
            pluginId, capability: "media.resolve", request: { operation: "pending" },
        }));
        const saturatedResults = saturated.map((job) => assert.rejects(job.promise));
        await assert.rejects(invoke("entities.get", {}), expectCode("busy"));
        assert.equal((await service.call("health")).protocolVersion, 2, "control requests bypass saturated execution slots");
        await service.call("clear");
        await Promise.all(saturatedResults);
        await assert.rejects(invoke("entities.get", {}), expectCode("not_loaded"));
        await load();
        const blocking = Array.from({ length: 4 }, () => service.request("invoke", {
            pluginId, capability: "media.resolve", request: { operation: "pending" },
        }));
        const blockingResults = blocking.map((job) => assert.rejects(job.promise));
        const queuedImport = service.request("prepareImport", {
            source: `lx.request(${JSON.stringify(`${origin}/retired-import`)},{},()=>{});`,
            kind: "lx", name: "queued-lx.js",
        });
        const retiredImport = assert.rejects(queuedImport.promise, expectCode("host_stopped"));
        await service.call("clear");
        await Promise.all([...blockingResults, retiredImport]);
        assert.ok(!requests.includes("/retired-import"), "queued LX preparation cannot start I/O after clear");
        console.log("plugin-runtime-native: V2 inspection, typed IDs, cursor pages, HTTP, storage, coded failure, cancellation and revocation passed");
    } finally {
        await service.close();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
