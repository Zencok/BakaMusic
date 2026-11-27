const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function runtimeBinary() {
    const optionIndex = process.argv.indexOf("--binary");
    return optionIndex >= 0 ? path.resolve(process.argv[optionIndex + 1]) : path.resolve(
        __dirname, "../res/.service/plugin-v2", `${process.platform}-${process.arch}`,
        `baka-plugin-runtime${process.platform === "win32" ? ".exe" : ""}`,
    );
}

function client(binary = runtimeBinary()) {
    assert.ok(fs.existsSync(binary), `Native plugin runtime is missing: ${binary}`);
    const child = spawn(binary, [], { stdio: "pipe", shell: false, windowsHide: true });
    const pending = new Map();
    let sequence = 0;
    let buffered = Buffer.alloc(0);
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-8192); });
    const rejectAll = (error) => {
        for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); }
        pending.clear();
    };
    child.on("error", rejectAll);
    child.stdin.on("error", rejectAll);
    child.on("exit", (code) => rejectAll(new Error(`Native runtime exited (${code}): ${stderr}`)));
    child.stdout.on("data", (chunk) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.length > 16 * 1024 * 1024) {
            rejectAll(new Error("Native RPC response exceeded limit")); child.kill(); return;
        }
        let end;
        while ((end = buffered.indexOf(10)) >= 0) {
            const line = buffered.subarray(0, end).toString("utf8");
            buffered = buffered.subarray(end + 1);
            let message;
            try { message = JSON.parse(line); } catch { rejectAll(new Error("Native stdout contains non-protocol data")); child.kill(); return; }
            const job = pending.get(message.id);
            if (!job) continue;
            pending.delete(message.id); clearTimeout(job.timer);
            if (message.error) {
                const error = new Error(message.error.message);
                error.data = message.error.data; error.code = message.error.code;
                job.reject(error);
            } else job.resolve(message.result);
        }
    });
    const request = (method, params = {}, id = `smoke-${++sequence}`, write = true) => {
        const promise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native ${method} timed out`)); child.kill(); }, 15_000);
            pending.set(id, { resolve, reject, timer });
            if (write) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        });
        return { id, promise };
    };
    return {
        child, request,
        call: (method, params) => request(method, params).promise,
        close: async () => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const exited = new Promise((resolve) => child.once("exit", resolve));
            child.stdin.end();
            const timer = setTimeout(() => child.kill(), 2000);
            await exited; clearTimeout(timer);
        },
    };
}

async function smoke(binary = runtimeBinary()) {
    const service = client(binary);
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "baka-plugin-smoke-"));
    const code = `// @baka-provider 2
module.exports={manifest:{apiVersion:2,kind:"provider",id:"test.native.smoke",name:"Native smoke",author:"BakaMusic",version:"1.0.0",sourceId:"test-native",capabilities:["entities.get"]},handlers:{entities:{get:(request,sdk)=>({id:request.id,setting:sdk.settings.value,lean:[typeof require,typeof process,typeof Buffer,typeof axios].every(v=>v==="undefined")})}}};`;
    try {
        assert.deepEqual(await service.call("health"), { protocolVersion: 2, runtime: "rust-quickjs-v2" });
        const inspected = await service.call("inspect", { code, settings: { value: "native" } });
        assert.equal(inspected.id, "test.native.smoke");
        await service.call("load", { pluginId: inspected.id, code, settings: { value: "native" }, storageRoot });
        const result = await service.call("invoke", { pluginId: inspected.id, capability: "entities.get", request: { id: 42 } });
        assert.deepEqual(result, { id: 42, setting: "native", lean: true });
        await service.call("clear");
    } finally {
        await service.close(); fs.rmSync(storageRoot, { recursive: true, force: true });
    }
    console.log("plugin-runtime-smoke: native QuickJS V2 execution passed");
}

if (require.main === module) smoke().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { client, runtimeBinary, smoke };
