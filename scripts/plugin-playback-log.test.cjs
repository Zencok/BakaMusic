const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { Host, LogStore, logTypes, taskRoot, provider, providerId } = require("./v2-registry.test.cjs");

async function main() {
    const events = [];
    const host = new Host((event) => events.push(event));
    const store = new LogStore(() => {});
    try {
        await host.loadPlugin(providerId, provider(), { os: process.platform, appVersion: "1.0.0", userVariables: {} }, path.join(taskRoot, "storage"));
        await host.invokePlugin(providerId, "media.resolve", { entity: { id: 42 }, quality: "320k" }, "Fixture music");
        await assert.rejects(host.invokePlugin(providerId, "media.resolve", { entity: { id: 42, coded: true }, quality: "flac" }, "Fixture music"));
        assert.deepEqual(events.map((event) => event.phase), ["request", "success", "request", "error"]);
        assert.ok(events.every(logTypes.isPluginPlaybackLogEvent));
        assert.equal(events[0].callId, events[1].callId);
        assert.equal(events[2].callId, events[3].callId);
        assert.notEqual(events[0].callId, events[2].callId);
        assert.equal(events[0].quality, "320k");
        assert.ok(events[1].durationMs >= 0);
        assert.doesNotMatch(events[3].message, /do-not-leak/);
        assert.equal(logTypes.PLUGIN_PLAYBACK_LOG_LIMIT, 500);
        const longId = "test." + "a".repeat(123);
        assert.ok(logTypes.isPluginPlaybackLogEvent({ ...events[0], pluginHash: longId }));
        assert.ok(!logTypes.isPluginPlaybackLogEvent({ ...events[0], pluginHash: longId + "a" }));
        assert.ok(!logTypes.isPluginPlaybackLogEvent({ ...events[0], message: "x".repeat(8193) }));
        for (let i = 0; i < 505; i++) store.append({ ...events[0], timestamp: i });
        await store.persist();
        assert.equal(store.getEntries().length, 500);
        const restored = new LogStore(() => {}); await restored.setup();
        assert.equal(restored.getEntries().length, 500);
        await restored.clear();
        assert.deepEqual(restored.getEntries(), []);
        console.log("Plugin playback logs passed: real native lifecycle, correlation, coded-failure redaction, bounds, persistence and clear.");
    } finally {
        const child = host.child;
        const stopped = child && child.exitCode === null ? once(child, "exit") : Promise.resolve();
        host.dispose(); await stopped;
        fs.rmSync(taskRoot, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
