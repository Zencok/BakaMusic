const assert = require("node:assert/strict");

const {
    createPlaybackConsole,
    emitPlaybackLifecycle,
    runWithPlaybackLog,
} = require("../src/shared/plugin-manager/utility/playback-console.ts");
const {
    isPluginPlaybackLogEvent,
    PLUGIN_PLAYBACK_LOG_LIMIT,
} = require("../src/shared/plugin-manager/playback-log.ts");

const baseContext = {
    callId: "plugin-test-call",
    kind: "plugin",
    pluginHash: "a".repeat(64),
    pluginName: "Fixture Music",
    platform: "Fixture Music",
    quality: "320k",
};

async function main() {
    const events = [];
    const pluginConsole = createPlaybackConsole((event) => events.push(event));
    const originalMethods = Object.fromEntries(
        ["debug", "log", "info", "warn", "error", "group", "groupEnd"]
            .map((level) => [level, console[level]]),
    );
    for (const level of Object.keys(originalMethods)) {
        console[level] = () => undefined;
    }

    try {
        pluginConsole.log("outside playback");
        assert.equal(events.length, 0);

        await runWithPlaybackLog(baseContext, async () => {
            pluginConsole.group("resolve");
            pluginConsole.info("quality", { value: "320k" });
            await Promise.resolve();
            pluginConsole.warn("fallback");
            pluginConsole.groupEnd();
        });
    } finally {
        Object.assign(console, originalMethods);
    }

    assert.deepEqual(
        events.map((event) => event.level),
        ["group", "info", "warn", "groupEnd"],
    );
    assert.ok(events.every((event) => event.phase === "console"));
    assert.ok(events.every(isPluginPlaybackLogEvent));
    assert.match(events[1].message, /quality.*320k/);

    emitPlaybackLifecycle((event) => events.push(event), baseContext, "request");
    emitPlaybackLifecycle((event) => events.push(event), baseContext, "success", {
        durationMs: 12.5,
    });
    assert.equal(events.at(-2).phase, "request");
    assert.equal(events.at(-1).durationMs, 12.5);
    assert.equal(PLUGIN_PLAYBACK_LOG_LIMIT, 500);

    console.log("Plugin playback log tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
