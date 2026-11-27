const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { PluginManager, app, config, configuration, downloads, taskRoot } = require("./v2-registry.test.cjs");
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
function lx(name = "Original LX", version = "1.0.0", token = "env.token||'none'") {
    return `/** @name ${name}\n * @version ${version}\n * @author Original author\n */
lx.on('request',({source,action,info})=>{if(source!=='tx'||action!=='musicUrl')throw Error('original source changed');return 'https://lx.example/'+info.musicInfo.songmid+'/'+info.type+'/'+(${token})});
lx.send('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['128k','flac']}}});`;
}
const publicProvider = (id = "cc.baka.qq", sourceId = "qq.v1") => `// @baka-provider 2
module.exports={manifest:{apiVersion:2,id:${JSON.stringify(id)},kind:'provider',name:'Prepared music source',author:'BakaMusic',version:'1.0.0',sourceId:${JSON.stringify(sourceId)},capabilities:['media.prepare','media.resolve']},handlers:{media:{prepare:r=>({entity:r.entity,context:{protocol:'lx',source:'tx',musicInfo:{songmid:r.entity.id}}}),resolve:r=>({url:'https://direct.example/'+r.entity.id,quality:r.quality})}}};`;
async function main() {
    const manager = new PluginManager();
    const write = async (name, code) => { const file = path.join(taskRoot, name); await fs.promises.writeFile(file, code); return file; };
    const resolve = (id = 42, providerId = "cc.baka.qq") => manager.invoke({ providerId, capability: "media.resolve", request: { entity: { id }, quality: "128k" } });
    try {
        const legacy = path.join(taskRoot, "bakamusic-lx-plugins"); fs.mkdirSync(legacy);
        const original = lx(); const oldHash = digest(original);
        const oldPath = path.join(legacy, `${oldHash}.js`);
        fs.writeFileSync(oldPath, original);
        fs.writeFileSync(`${oldPath}.integrity.json`, JSON.stringify({ sha256: oldHash, sourceUrl: "https://plugins.example/legacy-lx" }));
        fs.writeFileSync(path.join(legacy, "state.json"), JSON.stringify({ activeHash: oldHash }));
        const disabledSource = "/** @name Disabled LX */\nthrow Error('disabled LX must not execute');";
        const disabledHash = digest(disabledSource);
        const disabledPath = path.join(legacy, `${disabledHash}.js`);
        fs.writeFileSync(disabledPath, disabledSource);
        fs.writeFileSync(`${disabledPath}.integrity.json`, JSON.stringify({ sha256: disabledHash }));
        configuration["private.pluginMeta"] = { [oldHash]: { userVariables: { token: "retained" } },
            [disabledHash]: { disabled: true, userVariables: { token: "disabled-retained" } } };
        const retired = path.join(taskRoot, "bakamusic-plugins"); fs.mkdirSync(retired);
        fs.writeFileSync(path.join(retired, "old.js"), "throw Error('retired Baka must not execute')");
        await manager.setup({ mainWindow: { isDestroyed: () => false, webContents: { send() {} } } });
        const migrated = manager.plugins.find((plugin) => plugin.id === `org.baka.lx.s${digest(`lx:electron:${oldHash}`)}`);
        assert.ok(migrated, "verified original LX script migrates at startup");
        assert.match(migrated.id, /^org\.baka\.lx\.s[a-f0-9]{64}$/);
        assert.equal(fs.readFileSync(oldPath, "utf8"), original);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(legacy, "state.json"), "utf8")), { activeHash: oldHash });
        assert.equal(fs.readFileSync(`${migrated.path}.lx-source`, "utf8"), original);
        const provenance = JSON.parse(fs.readFileSync(`${migrated.path}.integrity.json`, "utf8"));
        assert.equal(provenance.lx.legacyHash, oldHash); assert.equal(provenance.lx.rawSha256, oldHash);
        assert.equal(configuration["private.pluginMeta"][migrated.id].userVariables.token, "retained");
        const disabledId = `org.baka.lx.s${digest(`lx:electron:${disabledHash}`)}`;
        assert.equal(configuration["private.pluginMeta"][disabledId].disabled, true);
        assert.equal(configuration["private.pluginMeta"][disabledId].userVariables.token, "disabled-retained");
        assert.equal(manager.host.registrations.has(disabledId), false, "disabled LX source remains unexecuted");
        assert.equal(manager.registryState.retiredPlugins.some((entry) => entry.path === oldPath), false);
        assert.equal(manager.registryState.retiredPlugins.filter((entry) => entry.reason === "legacy_format").length, 1);
        await manager.installPluginFromLocalFile(await write("provider.js", publicProvider()));
        assert.equal(configuration["private.pluginResolverBindings"]["cc.baka.qq"], migrated.id, "old activeHash selection waits for exact public provider identity");
        assert.equal((await resolve()).url, "https://lx.example/42/128k/retained");
        const forgedWrapper = fs.readFileSync(migrated.path, "utf8").replaceAll("https://lx.example/", "https://tampered.example/");
        fs.writeFileSync(migrated.path, forgedWrapper);
        fs.writeFileSync(`${migrated.path}.integrity.json`, JSON.stringify({ ...provenance, sha256: digest(forgedWrapper) }));
        await manager.loadAllPlugins();
        assert.equal((await resolve()).url, "https://lx.example/42/128k/retained", "startup executes the native wrapper of the verified original, never an independently modified generated body");
        await manager.installPluginFromLocalFile(await write("internal-provider.js", publicProvider("cc.baka.internal.qq")));
        assert.equal(configuration["private.pluginResolverBindings"]["cc.baka.internal.qq"], undefined);
        assert.equal((await resolve(42, "cc.baka.internal.qq")).url, "https://direct.example/42");
        config.setConfig({ "private.pluginMeta": { ...configuration["private.pluginMeta"], [migrated.id]: { userVariables: { token: "updated" } } } });
        assert.equal((await resolve("42")).url, "https://lx.example/42/128k/updated");
        await manager.setResolverBinding("cc.baka.qq", null);
        await manager.loadAllPlugins();
        assert.equal(configuration["private.pluginResolverBindings"]["cc.baka.qq"], undefined, "explicit direct selection survives migration replay");
        assert.equal((await resolve()).url, "https://direct.example/42");
        await manager.setResolverBinding("cc.baka.qq", migrated.id);
        downloads.set("https://plugins.example/legacy-lx", lx("Renamed LX", "1.1.0"));
        await manager.installPluginFromRemoteUrl("https://plugins.example/legacy-lx");
        const updated = manager.plugins.find((plugin) => plugin.id === migrated.id);
        assert.equal(updated.name, "Renamed LX"); assert.equal(updated.manifest.version, "1.1.0");
        assert.equal((await resolve()).url, "https://lx.example/42/128k/updated");
        const stableCode = fs.readFileSync(updated.path, "utf8");
        const stableRaw = fs.readFileSync(`${updated.path}.lx-source`, "utf8");
        const loadPlugin = manager.host.loadPlugin.bind(manager.host);
        let failActivation = true;
        manager.host.loadPlugin = async (...args) => { if (failActivation) { failActivation = false; throw Error("LX activation fixture"); } return loadPlugin(...args); };
        downloads.set("https://plugins.example/legacy-lx", lx("Broken update", "1.2.0"));
        await assert.rejects(manager.installPluginFromRemoteUrl("https://plugins.example/legacy-lx"), /LX activation fixture/);
        manager.host.loadPlugin = loadPlugin;
        assert.equal(fs.readFileSync(updated.path, "utf8"), stableCode);
        assert.equal(fs.readFileSync(`${updated.path}.lx-source`, "utf8"), stableRaw);
        assert.equal((await resolve()).url, "https://lx.example/42/128k/updated");
        downloads.set("https://plugins.example/legacy-lx", lx("Delayed update", "1.3.0").replace("lx.send(", "setTimeout(()=>lx.send(").replace(/;$/, ",80);"));
        const changingSettings = assert.rejects(manager.installPluginFromRemoteUrl("https://plugins.example/legacy-lx"), /settings changed during import/);
        await new Promise((resolve) => setTimeout(resolve, 25));
        config.setConfig({ "private.pluginMeta": { ...configuration["private.pluginMeta"], [migrated.id]: { userVariables: { token: "changed-during-import" } } } });
        await changingSettings;
        assert.equal(fs.readFileSync(updated.path, "utf8"), stableCode, "an import prepared with stale settings cannot replace the installed source");
        assert.equal(configuration["private.pluginMeta"][migrated.id].userVariables.token, "changed-during-import");
        assert.equal((await resolve()).url, "https://lx.example/42/128k/changed-during-import");
        const obfuscated = "globalThis['l'+'x']['on']('request',()=> 'https://hidden.example/song');globalThis['l'+'x']['send']('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['128k']}}});";
        const hiddenFile = await write("hidden.js", obfuscated);
        await assert.rejects(manager.installPluginFromLocalFile(hiddenFile), /select LX|detect plugin format/i);
        await manager.installPluginFromLocalFile(hiddenFile, { kind: "lx" });
        const hidden = manager.plugins.find((plugin) => plugin.id !== migrated.id && plugin.id !== disabledId && plugin.manifest.kind === "resolver");
        assert.ok(hidden); await manager.setResolverBinding("cc.baka.qq", hidden.id);
        assert.equal((await resolve()).url, "https://hidden.example/song");
        for (const kind of ["auto", "v2", "lx"]) {
            const invalid = await write("marked-invalid.js", "// @baka-provider 2\nlx.send('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['128k']}}});module.exports={};");
            await assert.rejects(manager.installPluginFromLocalFile(invalid, { kind }), /V2|contract|manifest|lx is not defined/i);
        }
        await manager.uninstallPlugin(migrated.id);
        await manager.loadAllPlugins();
        assert.ok(!manager.plugins.some((plugin) => plugin.id === migrated.id), "preserved legacy originals never resurrect an explicitly uninstalled migration");
        assert.equal(fs.readFileSync(oldPath, "utf8"), original);
        console.log("LX imports passed: original and obfuscated scripts, native wrapping, provenance, delayed exact-identity binding, settings, explicit selection, stable update, rollback, strict V2 marking and preserved originals.");
    } finally {
        const child = manager.host.child;
        const stopped = child && child.exitCode === null ? once(child, "exit") : Promise.resolve();
        app.emit("before-quit"); await stopped;
        fs.rmSync(taskRoot, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
