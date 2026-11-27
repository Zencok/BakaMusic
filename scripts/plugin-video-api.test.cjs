const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Plugin, taskRoot } = require("./v2-registry.test.cjs");
const { pluginCapabilities } = require("../src/shared/plugin-manager/rpc.ts");
const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

async function main() {
    try {
        assert.ok(pluginCapabilities.includes("media.video"));
        assert.ok(!pluginCapabilities.includes("getMvSource"));
        const pluginTypes = read("src/types/plugin.d.ts");
        assert.match(pluginTypes, /interface IVideoSourceResult/);
        assert.match(pluginTypes, /supportedVideoQualities\?: string\[\]/);
        assert.match(pluginTypes, /expiresAt\?: number/);
        assert.match(pluginTypes, /VideoDynamicRange = "sdr" \| "hdr10" \| "dolby-vision"/);
        const request = { entity: { id: 42 }, quality: "2160p" };
        let received;
        const plugin = new Plugin({ id: "test.video", manifest: { apiVersion: 2, id: "test.video", kind: "provider",
            name: "Video fixture", author: "BakaMusic", version: "1.0.0", capabilities: ["media.video"] } }, "", async (capability, value) => {
            received = { capability, value };
            return { url: "https://cdn.example/video", videoQuality: "2160p", dynamicRange: "dolby-vision", width: 3840, height: 2160,
                expiresAt: 1234567890, codec: "hevc", headers: { Authorization: "fixture", bad: 42 },
                backupUrls: ["https://backup.example/video", "file:///private"],
                availableVideoQualities: [{ key: "2160p", width: 3840, dynamicRange: "dolby-vision" }, { key: "2160p" }, { key: "" }] };
        });
        const result = await plugin.invoke("media.video", request);
        assert.deepEqual(received, { capability: "media.video", value: request });
        assert.equal(result.dynamicRange, "dolby-vision"); assert.equal(result.width, 3840);
        assert.equal(result.expiresAt, 1234567890); assert.equal(result.codec, "hevc");
        assert.deepEqual(result.headers, { Authorization: "fixture" });
        assert.deepEqual(result.backupUrls, ["https://backup.example/video"]);
        assert.equal(result.availableVideoQualities.length, 1);
        const invalid = new Plugin({ id: "test.invalid.video", manifest: { apiVersion: 2, id: "test.invalid.video", kind: "provider",
            name: "Invalid fixture", author: "BakaMusic", version: "1.0.0", capabilities: ["media.video"] } }, "", async () => ({ url: "x".repeat(8193) }));
        assert.equal(await invalid.invoke("media.video", request), null);
        console.log("Plugin video API passed: canonical object calls, Dolby Vision metadata, bounds, headers, quality deduplication and backup filtering.");
    } finally { fs.rmSync(taskRoot, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
