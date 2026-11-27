const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { PluginManager, app, downloads, taskRoot, provider, providerId } = require("./v2-registry.test.cjs");
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function main() {
    const manager = new PluginManager();
    const script = provider();
    const hash = digest(script);
    try {
        await manager.setup({ mainWindow: { isDestroyed: () => false, webContents: { send() {} } } });
        for (const suffix of ["/plugin", "/plugin?token=fixture", "/plugin.js?v=2", "/plugin.txt", "/plugin.json"]) {
            const url = `https://plugins.example${suffix}`;
            downloads.set(url, script);
            await manager.installPluginFromRemoteUrl(`  ${url}#sha256=${hash}  `);
            assert.equal(manager.plugins.length, 1);
            assert.equal(manager.plugins[0].id, providerId);
        }
        for (const suffix of ["/subscription", "/subscription.json?token=fixture", "/subscription.js"]) {
            const url = `https://plugins.example${suffix}`;
            downloads.set(url, '\uFEFF' + JSON.stringify({ apiVersion: 2, plugins: [{ id: providerId, url: "./child?version=1", sha256: hash }] }));
            downloads.set("https://plugins.example/child?version=1", script);
            await manager.installPluginFromRemoteUrl(url);
            assert.equal(manager.plugins[0].id, providerId);
        }
        for (const body of ["null", "[]", "{}", '{"plugins":"invalid"}', JSON.stringify({ plugins: [{ url: "./child" }] }), '<html>Not a plugin</html>']) {
            downloads.set("https://plugins.example/invalid", body);
            await assert.rejects(manager.installPluginFromRemoteUrl("https://plugins.example/invalid"));
            assert.equal(manager.plugins.length, 1);
        }
        downloads.set("https://plugins.example/duplicate", JSON.stringify({ apiVersion: 2, plugins: [{ id: providerId, url: "./child" }, { id: providerId, url: "./child2" }] }));
        await assert.rejects(manager.installPluginFromRemoteUrl("https://plugins.example/duplicate"), /duplicate package IDs/);
        downloads.set("https://plugins.example/oversized", JSON.stringify({ apiVersion: 2, plugins: [], padding: "x".repeat(1024 * 1024) }));
        await assert.rejects(manager.installPluginFromRemoteUrl("https://plugins.example/oversized"), /manifest exceeds/);
        downloads.set("https://plugins.example/bad-hash", script);
        await assert.rejects(manager.installPluginFromRemoteUrl(`https://plugins.example/bad-hash#sha256=${"0".repeat(64)}`), /SHA-256 verification/);
        await assert.rejects(manager.installPluginFromRemoteUrl("http://plugins.example/plugin"));
        const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
        const signature = crypto.sign(null, Buffer.from(script), privateKey).toString("base64");
        const pem = publicKey.export({ type: "spki", format: "pem" });
        downloads.set("https://plugins.example/signed-catalog", JSON.stringify({ apiVersion: 2, plugins: [{ id: providerId, url: "./signed", signature, publicKey: pem }] }));
        downloads.set("https://plugins.example/signed", script);
        await manager.installPluginFromRemoteUrl("https://plugins.example/signed-catalog");
        downloads.set("https://plugins.example/signed", script + "\n// altered");
        await assert.rejects(manager.installPluginFromRemoteUrl("https://plugins.example/signed-catalog"), /signature verification failed/);
        assert.equal(manager.plugins.length, 1);
        // HTTPS redirect checks run on every download option, including extensionless URLs.
        const source = fs.readFileSync(path.join(__dirname, "../src/shared/plugin-manager/main/index.ts"), "utf8");
        assert.match(source, /options\.protocol !== "https:"/);
        assert.match(source, /maxRedirects: 5/);
        assert.match(source, /maxContentLength: MAX_PLUGIN_CODE_BYTES/);
        const normalizedId = "test.signed.normalized";
        const normalizedOriginal = "\uFEFF \r\n" + provider("1.0.0", normalizedId);
        const normalizedSignature = crypto.sign(null, Buffer.from(normalizedOriginal), privateKey).toString("base64");
        downloads.set("https://plugins.example/normalized-catalog", JSON.stringify({ apiVersion: 2, plugins: [{ id: normalizedId, url: "./normalized", signature: normalizedSignature, publicKey: pem }] }));
        downloads.set("https://plugins.example/normalized", normalizedOriginal);
        await manager.installPluginFromRemoteUrl("https://plugins.example/normalized-catalog");
        const normalizedPlugin = manager.plugins.find((plugin) => plugin.id === normalizedId);
        assert.equal(fs.readFileSync(`${normalizedPlugin.path}.source`, "utf8"), normalizedOriginal, "normalization preserves the originally signed bytes");
        await manager.loadAllPlugins();
        assert.ok(manager.plugins.some((plugin) => plugin.id === normalizedId), "signed normalized source remains verifiable after restart");
        const catalogUrl = "https://plugins.example/shared-catalog";
        const catalogIds = ["test.catalog.first", "test.catalog.second"];
        const catalogScript = (id, version) => provider(version, id).replace('sourceId:"fixture"', `srcUrl:${JSON.stringify(catalogUrl)},sourceId:"fixture"`);
        downloads.set(catalogUrl, JSON.stringify({ apiVersion: 2, plugins: catalogIds.map((id, index) => ({ id, url: `./catalog-child-${index}` })) }));
        for (const [index, id] of catalogIds.entries()) downloads.set(`https://plugins.example/catalog-child-${index}`, catalogScript(id, "1.0.0"));
        await manager.installPluginFromRemoteUrl(catalogUrl);
        await manager.installPluginFromRemoteUrl(catalogUrl);
        assert.ok(catalogIds.every((id) => manager.plugins.some((plugin) => plugin.id === id)), "a shared manifest srcUrl never pins a multi-package catalog to its first package");
        for (const [index, id] of catalogIds.entries()) downloads.set(`https://plugins.example/catalog-child-${index}`, catalogScript(id, "1.1.0"));
        await manager.installPluginFromRemoteUrl(catalogUrl, catalogIds[1]);
        assert.equal(manager.plugins.find((plugin) => plugin.id === catalogIds[0]).manifest.version, "1.0.0", "an explicit catalog update only replaces the expected package");
        assert.equal(manager.plugins.find((plugin) => plugin.id === catalogIds[1]).manifest.version, "1.1.0");
        const tamperedNormalized = fs.readFileSync(normalizedPlugin.path, "utf8").replace("Registry provider", "Tampered provider");
        const normalizedIntegrity = JSON.parse(fs.readFileSync(`${normalizedPlugin.path}.integrity.json`, "utf8"));
        fs.writeFileSync(normalizedPlugin.path, tamperedNormalized);
        fs.writeFileSync(`${normalizedPlugin.path}.integrity.json`, JSON.stringify({ ...normalizedIntegrity, sha256: digest(tamperedNormalized) }));
        await manager.loadAllPlugins();
        assert.ok(!manager.plugins.some((plugin) => plugin.id === normalizedId), "a signed original cannot authorize a different normalized executable body");
        console.log("Plugin imports passed: real V2 inspection, extensionless URLs, explicit catalogs, relative URLs, invalid/legacy content, identity, SHA-256 and signatures.");
    } finally {
        const child = manager.host.child;
        const stopped = child && child.exitCode === null ? once(child, "exit") : Promise.resolve();
        app.emit("before-quit"); await stopped;
        fs.rmSync(taskRoot, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
