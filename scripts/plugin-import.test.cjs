const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const ts = require("typescript");

const responses = new Map();
const requests = [];
const installed = [];
const source = fs.readFileSync(path.join(__dirname, "../src/shared/plugin-manager/main/index.ts"), "utf8");
const mocks = {
    electron: {},
    axios: {
        async get(url, options) {
            const request = new URL(url);
            request.searchParams.delete("_bakamusic_cache");
            requests.push({ url: request.toString(), options });
            assert.ok(responses.has(request.toString()), `Unexpected request: ${request}`);
            return { data: responses.get(request.toString()) };
        },
    },
    "compare-versions": {},
    crypto,
    fs,
    "fs/promises": fs.promises,
    path,
    rimraf: {},
    "@/common/constant": {},
    "@/common/error-util": {},
    "@shared/app-config/main": {},
    "@shared/ipc-security/main": {
        assertUrl(value, protocols) {
            const url = new URL(value);
            assert.ok(protocols.includes(url.protocol), "Invalid URL protocol");
            return url;
        },
        assertPlainObject(value) {
            assert.ok(value && typeof value === "object" && !Array.isArray(value), "Invalid object");
        },
        assertString(value) {
            assert.equal(typeof value, "string");
            assert.ok(value.length);
        },
    },
    "@shared/logger/main": {},
    "../rpc": { pluginMethodNames: [] },
    "./internal-plugins/local-plugin": {},
    "./plugin": {},
    "./plugin-host-client": class {},
    "./lx-plugin-manager": class {},
    "./playback-log-store": class {},
};
const loaded = { exports: {} };
const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
new Function("require", "module", "exports", output)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
}, loaded, loaded.exports);
const manager = loaded.exports.default;
manager.syncPlugins = () => {};
manager.installPluginCode = async (code, integrity) => {
    const module = { exports: {} };
    vm.runInNewContext(code, { module });
    assert.ok(module.exports.name, "Invalid plugin");
    installed.push({ code, integrity });
};
const script = 'module.exports = { name: "Import fixture", version: "1.0.0" };';
const hash = crypto.createHash("sha256").update(script).digest("hex");

async function main() {
    for (const suffix of ["/plugin", "/plugin?token=fixture", "/plugin.js?v=2", "/plugin.txt", "/plugin.json"]) {
        const url = `https://plugins.example${suffix}`;
        responses.set(url, script);
        await manager.installPluginFromRemoteUrl(`  ${url}#sha256=${hash}  `);
        assert.equal(installed.at(-1).code, script);
        assert.equal(installed.at(-1).integrity.sourceUrl, url);
        assert.equal(installed.at(-1).integrity.sha256, hash);
    }
    for (const suffix of ["/subscription", "/subscription.json?token=fixture", "/subscription.js"]) {
        const url = `https://plugins.example${suffix}`;
        responses.set(url, '\uFEFF' + JSON.stringify({ plugins: [{ url: "./child?version=1", sha256: hash }] }));
        responses.set("https://plugins.example/child?version=1", script);
        await manager.installPluginFromRemoteUrl(url);
        assert.equal(installed.at(-1).integrity.sourceUrl, "https://plugins.example/child?version=1");
    }
    const count = installed.length;
    for (const body of ["null", "[]", "{}", '{"plugins":"invalid"}', '<html>Not a plugin</html>']) {
        responses.set("https://plugins.example/invalid", body);
        await assert.rejects(manager.installPluginFromRemoteUrl("https://plugins.example/invalid"));
        assert.equal(installed.length, count);
    }
    responses.set("https://plugins.example/oversized", JSON.stringify({ plugins: [], padding: "x".repeat(1024 * 1024) }));
    await assert.rejects(manager.installPluginFromRemoteUrl("https://plugins.example/oversized"), /manifest exceeds/);
    responses.set("https://plugins.example/bad-hash", script);
    await assert.rejects(manager.installPluginFromRemoteUrl(`https://plugins.example/bad-hash#sha256=${"0".repeat(64)}`), /SHA-256 verification/);
    await assert.rejects(manager.installPluginFromRemoteUrl("http://plugins.example/plugin"));
    for (const { options } of requests) {
        assert.equal(options.maxContentLength, 5 * 1024 * 1024);
        assert.equal(options.timeout, 20000);
        assert.throws(() => options.beforeRedirect({ protocol: "http:" }));
        options.beforeRedirect({ protocol: "https:" });
    }
    console.log("Plugin imports passed: extensionless scripts/subscriptions, query strings, relative URLs, invalid content and integrity checks.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
