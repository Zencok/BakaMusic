const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { client } = require("./plugin-runtime-smoke.cjs");

const ORIGINAL = `/**
 * @name Unchanged LX fixture
 * @author Original contributor
 * @version v3.2 beta
 */
(async()=>{
 const {EVENT_NAMES,on,send}=globalThis.lx;
 await on(EVENT_NAMES.request,({source,action,info})=>{
   if(action!=="musicUrl"||source!=="tx"||info.musicInfo.songmid!==42)throw Error("original request changed");
   return "https://fixture.invalid/"+info.musicInfo.songmid+"?q="+info.type;
 });
 await send(EVENT_NAMES.inited,{sources:{tx:{type:"music",actions:["musicUrl"],qualitys:["128k","flac"]}}});
})();`;
const context = { protocol: "lx", source: "qq", musicInfo: { songmid: 42 } };
const ready = `lx.on("request",()=>"https://fixture.invalid/ok");lx.send("inited",{sources:{tx:{actions:["musicUrl"],qualitys:["128k"]}}});`;
const timeout = (promise, message, milliseconds = 3000) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]).finally(() => clearTimeout(timer));
};

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "baka-lx-import-"));
    const requests = [];
    const sockets = new Set();
    const started = new Map();
    const closed = new Map();
    const observe = (map, key) => {
        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        map.set(key, resolve);
        return promise;
    };
    const server = http.createServer((request, response) => {
        requests.push(request.url);
        started.get(request.url)?.();
        request.socket.once("close", () => closed.get(request.url)?.());
        if (request.url.endsWith("/slow") || request.url.endsWith("/clear")) return;
        response.setHeader("Content-Type", "text/plain");
        response.end(JSON.stringify({ url: "https://fixture.invalid/native-callback" }));
    });
    server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const service = client();
    const prepare = (source, extra = {}) => service.call("prepareImport", { source, name: "fixture.js", ...extra });
    const load = (prepared, settings = {}) => service.call("load", { pluginId: prepared.id, code: prepared.source, settings, storageRoot: path.join(root, "storage") });
    const invoke = (prepared, quality = "128k") => service.call("invoke", { pluginId: prepared.id, capability: "media.resolve", request: { quality, context } });
    try {
        const prepared = await prepare(ORIGINAL);
        assert.match(prepared.id, /^org\.baka\.lx\.s[a-f0-9]{64}$/);
        assert.equal(prepared.originalId, "lx:name:Unchanged LX fixture");
        assert.deepEqual(prepared.manifest.sources, ["qq.v1"]);
        assert.deepEqual(prepared.manifest.supportedQualities, ["128k", "flac"]);
        assert.equal(prepared.manifest.version, "1.0.0");
        assert.equal(prepared.manifest.conversion.originalVersion, "v3.2 beta");
        assert.ok(prepared.source.includes(JSON.stringify(ORIGINAL)), "original source must remain byte-for-byte inside the generated string");
        assert.deepEqual((await service.call("inspect", { code: prepared.source, settings: {} })).manifest, prepared.manifest);
        await load(prepared);
        assert.equal((await invoke(prepared, "flac")).url, "https://fixture.invalid/42?q=flac");
        await assert.rejects(invoke(prepared, "master"), (error) => error.data.failureCode === "quality_unavailable");
        assert.equal((await prepare(ORIGINAL, { name: "renamed.js", locator: "https://fixture.invalid/new" })).id, prepared.id);
        assert.equal((await prepare(ORIGINAL.replace("Unchanged LX fixture", "Changed title"), { id: prepared.id })).id, prepared.id);
        for (const source of ["const = ;", "throw Error('broken initialization')", "lx.send('inited',{sources:[]})"]) {
            await assert.rejects(prepare(source, { kind: "lx", id: prepared.id }));
            assert.equal((await invoke(prepared)).url, "https://fixture.invalid/42?q=128k", "invalid replacement preparation cannot disturb the installed resolver");
        }
        for (const kind of ["auto", "v2", "lx"]) {
            const invalid = "// @baka-provider 2\nconst = ; // lx.";
            const marked = await prepare(`\uFEFF \r\n${invalid}`, { kind });
            assert.deepEqual(marked, { source: invalid });
            await assert.rejects(service.call("inspect", { code: marked.source, settings: {} }));
        }
        await assert.rejects(prepare(ORIGINAL, { kind: "v2" }));
        const hiddenBody = `const api=globalThis['l'+'x'];if(Function('lx','return lx.utils.crypto.md5("abc")')(api)!=='900150983cd24fb0d6963f7d28e17f72')throw Error('dynamic crypto');api.on('request',()=> 'https://fixture.invalid/packed');api.send('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['128k']}}});`;
        const packed = `eval(String.fromCharCode(${[...hiddenBody].map((value) => value.charCodeAt(0)).join(",")}));`;
        await assert.rejects(prepare(packed, { kind: "auto" }), /select LX/);
        const obfuscated = await prepare(packed, { kind: "lx", id: "packed-installed" });
        assert.ok(obfuscated.source.includes(JSON.stringify(packed)));
        await load(obfuscated);
        assert.equal((await invoke(obfuscated)).url, "https://fixture.invalid/packed");
        const dynamicLookups = [
            "Function('return this')().lx",
            "Function('return lx')()",
            "(0,eval)('lx')",
            "({}).constructor.constructor('return this')().lx",
        ];
        for (const [index, lookup] of dynamicLookups.entries()) {
            const source = `const api=${lookup};if(Function('return this')()!==globalThis||window!==globalThis||self!==globalThis||global!==globalThis)throw Error('global identity changed');if(Function('return env.retained')()!==true||!Object.isFrozen(Function('return env')()))throw Error('dynamic settings lost');api.on('request',()=>new Promise(resolve=>{let ticks=0;const interval=Function('return setInterval')()(()=>{if(++ticks===2){Function('return clearInterval')()(interval);resolve('https://fixture.invalid/dynamic-${index}');}},2);}));Function('return setTimeout')()(()=>api.send('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['128k']}}}),2);`;
            const dynamic = await prepare(source, { kind: "lx", name: `dynamic-${index}.js`, variables: { retained: true } });
            assert.ok(dynamic.source.includes(JSON.stringify(source)), "dynamic lookup source remains unchanged");
            await load(dynamic, { retained: true });
            assert.equal((await invoke(dynamic)).url, `https://fixture.invalid/dynamic-${index}`);
        }
        // Converted packages have distinct actual globals; the ordinary V2
        // context never executes the compatibility initializer at all.
        assert.equal((await invoke(obfuscated)).url, "https://fixture.invalid/packed");
        const leanId = "test.lx.isolation";
        const leanSource = `// @baka-provider 2\nmodule.exports={manifest:{apiVersion:2,id:'${leanId}',kind:'provider',name:'Isolation',author:'Test',version:'1.0.0',sourceId:'isolation',capabilities:['entities.get']},handlers:{entities:{get:()=>({types:[typeof lx,typeof Buffer,typeof window,typeof self,typeof global,typeof env]})}}};`;
        await service.call("load", { pluginId: leanId, code: leanSource, settings: {}, storageRoot: path.join(root, "storage") });
        const lean = await service.call("invoke", { pluginId: leanId, capability: "entities.get", request: {} });
        assert.deepEqual(lean.types, Array(6).fill("undefined"), "ordinary V2 packages remain lean after LX initialization");

        const disabledSource = `/** @name Disabled fixture */\nlx.request(${JSON.stringify(`${origin}/disabled`)},{},()=>{});throw Error('disabled original executed');`;
        const disabled = await prepare(disabledSource, { installedLx: [{ id: "previous-id", name: "Disabled fixture", enabled: false, variables: { retained: true } }], enabled: true });
        assert.equal(disabled.originalId, "previous-id");
        assert.equal(disabled.manifest.conversion.initializationVerified, false);
        assert.ok(!requests.includes("/disabled"));
        await assert.rejects(prepare("const = ;", { kind: "lx", enabled: false }));
        const variableSource = `/** @name Variable fixture */\nif(env.retained!==true)throw Error('settings lost');${ready}`;
        const variables = await prepare(variableSource, { variables: { retained: false }, installedLx: [{ id: "settings-id", name: "Variable fixture", enabled: true, variables: { retained: true } }] });
        await load(variables, { retained: true });
        assert.equal((await invoke(variables)).url, "https://fixture.invalid/ok");

        const callbackSource = `const {buffer,crypto,zlib}=lx.utils;
lx.on('request',async()=>{
 if(buffer.bufToString(buffer.from('YWJj','base64'))!=='abc')throw Error('base64');
 if(crypto.md5('abc')!=='900150983cd24fb0d6963f7d28e17f72')throw Error('md5');
 if(crypto.randomBytes(8).length!==8)throw Error('random');
 const encrypted=crypto.aesEncrypt(buffer.from('00000000000000000000000000000000','hex'),'aes-128-ecb',buffer.from('00000000000000000000000000000000','hex'),null);
 if(encrypted.toString('hex').slice(0,32)!=='66e94bd4ef8a2c3b884cfa59ca342b2e')throw Error('AES');
 const plain=await zlib.inflate(buffer.from('789c4b4c4a0600024d0127','hex'));
 if((await zlib.inflate(await zlib.deflate(plain))).toString()!=='abc')throw Error('zlib');
 return new Promise((resolve,reject)=>lx.request(${JSON.stringify(`${origin}/callback`)},{headers:{'x-lx-fixture':42}},(error,response,body)=>{if(error)return reject(error);if(response.statusCode!==200||!response.raw.toString().includes('native-callback'))return reject(Error('callback envelope'));resolve(body);}));
});lx.send('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['128k']}}});`;
        const callback = await prepare(callbackSource);
        await load(callback);
        assert.equal((await invoke(callback)).url, "https://fixture.invalid/native-callback");
        const proxySource = `lx.on('request',()=>null);lx.request('http://lx-fixture.invalid/proxy',{},(error)=>{if(error)throw error;lx.send('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['128k']}}});});`;
        await prepare(proxySource, { proxyUrl: origin });
        assert.ok(requests.includes("http://lx-fixture.invalid/proxy"), "configured proxy applies to import initialization");
        for (const operation of ["cancel", "clear"]) {
            const endpoint = operation === "cancel" ? "/slow" : "/clear";
            const began = observe(started, endpoint);
            const ended = observe(closed, endpoint);
            const source = `lx.on('request',()=>null);lx.request(${JSON.stringify(origin + endpoint)},{},()=>lx.send('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['128k']}}}));`;
            const pending = service.request("prepareImport", { source, kind: "lx", name: "pending.js" });
            const rejected = assert.rejects(pending.promise);
            await timeout(began, "LX initialization HTTP did not start");
            if (operation === "cancel") assert.equal(await service.call("cancel", { requestId: pending.id }), true);
            else await service.call("clear");
            await rejected;
            await timeout(ended, "Cancelled LX initialization left its socket open");
        }
        const delayed = service.request("prepareImport", { source: `lx.on('request',()=>null);setTimeout(()=>lx.request(${JSON.stringify(`${origin}/late`)},{},()=>{}),200);`, kind: "lx", name: "delayed.js" });
        const retired = assert.rejects(delayed.promise);
        await service.call("cancel", { requestId: delayed.id });
        await retired;
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.ok(!requests.includes("/late"));
        const began = Date.now();
        await assert.rejects(prepare("lx.on('request',()=>null);", { kind: "lx", name: "timeout.js" }), /timed out/);
        assert.ok(Date.now() - began < 14_000, "LX initialization has a bounded deadline");
        assert.equal((await service.call("health")).runtime, "rust-quickjs-v2");
        console.log("lx-import-native: unchanged/packed LX, dynamic global lookup/isolation, stable identity, disabled/settings, native HTTP/crypto/proxy, rollback, cancellation, revocation and deadline passed");
    } finally {
        await service.close();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
