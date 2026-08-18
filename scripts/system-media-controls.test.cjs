const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dbusChildFlag = "--mpris-dbus-child";

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function testStaticContracts() {
    const controls = read("src/shared/native-playback/system-media-controls.ts");
    const mpris = read("src/shared/native-playback/mpris.ts");
    const nativeMain = read("src/shared/native-playback/main.ts");
    const packageSecurity = read("scripts/package-security-smoke.cjs");
    const nativeInstaller = read("scripts/install-native-modules.cjs");
    const nativeManifestUpdater = read("scripts/update-native-modules-manifest.cjs");

    assert.match(controls, /\["win32", "darwin", "linux"\]/);
    assert.match(controls, /process\.platform === "linux"\s*\? createMprisBinding\(\)/);
    assert.match(controls, /mediaType: "music" \| "video"/);
    assert.match(controls, /setVideoPlaybackSnapshot/);
    assert.match(controls, /endVideo\(\)/);

    assert.match(mpris, /org\.mpris\.MediaPlayer2\.BakaMusic/);
    assert.match(mpris, /org\.mpris\.MediaPlayer2\.Player/);
    assert.match(mpris, /SetPosition: \{ inSignature: "ox" \}/);
    assert.match(mpris, /Seeked: \{ signature: "x" \}/);
    assert.match(mpris, /Fullscreen: \{ signature: "b", access: ACCESS_READWRITE \}/);
    assert.match(mpris, /CanSetFullscreen: \{ signature: "b", access: ACCESS_READ \}/);
    assert.match(mpris, /unexportObject\(MPRIS_OBJECT_PATH\)/);
    assert.doesNotMatch(mpris, /bus\.unexport\(MPRIS_OBJECT_PATH,/);
    assert.doesNotMatch(mpris, /setBigIntCompat/);

    assert.match(nativeMain, /case "volume":\s*messageBus\.sendCommand\("SetPlaybackVolume"/);
    assert.match(nativeMain, /case "rate":\s*messageBus\.sendCommand\("SetPlaybackRate"/);
    assert.match(nativeMain, /messageBus\.sendCommand\("SetRepeatMode", event\.mode\)/);

    assert.match(
        packageSecurity,
        /platform === "win32" \|\| platform === "darwin"/,
    );
    assert.match(packageSecurity, /@particle\/dbus-next\/index\.js/);
    assert.match(
        nativeInstaller,
        /process\.platform === "win32" \|\| process\.platform === "darwin"/,
    );
    assert.match(nativeInstaller, /modules\.add\("smtc"\)/);
    assert.match(
        nativeManifestUpdater,
        /\["qmc2", "ence", "taglib", "transcode", "smtc"\]/,
    );
}

function installTypeScriptAliases() {
    const originalResolveFilename = Module._resolveFilename;
    Module._resolveFilename = function resolveRepoAlias(
        request,
        parent,
        isMain,
        options,
    ) {
        const aliases = [
            ["@/", "src/"],
            ["@main/", "src/main/"],
            ["@shared/", "src/shared/"],
            ["@renderer/", "src/renderer/"],
        ];
        const alias = aliases.find(([prefix]) => request.startsWith(prefix));
        const resolvedRequest = alias
            ? path.join(root, alias[1], request.slice(alias[0].length))
            : request;
        return originalResolveFilename.call(
            this,
            resolvedRequest,
            parent,
            isMain,
            options,
        );
    };
    return () => {
        Module._resolveFilename = originalResolveFilename;
    };
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout(promise, label, timeoutMs = 5_000) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`Timed out during ${label}`)),
                    timeoutMs,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await delay(10);
    }
    throw new Error(message);
}

async function runMprisIntegration() {
    const restoreAliases = installTypeScriptAliases();
    const dbus = require("@particle/dbus-next");
    const createMprisBinding = require(
        path.join(root, "src/shared/native-playback/mpris.ts"),
    ).default;
    const actions = [];
    const binding = createMprisBinding();
    let client = null;

    try {
        assert.equal(binding.isSupported(), true);
        await withTimeout(
            binding.initialize(Buffer.alloc(0), (event) => actions.push(event)),
            "MPRIS service initialization",
        );
        console.log("system-media-controls: MPRIS service initialized");

        client = dbus.sessionBus();
        const object = await withTimeout(
            client.getProxyObject(
                "org.mpris.MediaPlayer2.BakaMusic",
                "/org/mpris/MediaPlayer2",
            ),
            "MPRIS client introspection",
        );
        const rootInterface = object.getInterface("org.mpris.MediaPlayer2");
        const player = object.getInterface("org.mpris.MediaPlayer2.Player");
        const properties = object.getInterface("org.freedesktop.DBus.Properties");

        const identity = await withTimeout(
            properties.Get("org.mpris.MediaPlayer2", "Identity"),
            "MPRIS Identity property",
        );
        assert.equal(identity.value, "BakaMusic");
        const canRaise = await properties.Get("org.mpris.MediaPlayer2", "CanRaise");
        assert.equal(canRaise.value, true);
        const fullscreen = await properties.Get("org.mpris.MediaPlayer2", "Fullscreen");
        assert.equal(fullscreen.value, false);
        await assert.rejects(
            properties.Set(
                "org.mpris.MediaPlayer2",
                "Fullscreen",
                new dbus.Variant("b", true),
            ),
            /NotSupported|fullscreen/i,
        );

        const changedEvents = [];
        properties.on("PropertiesChanged", (interfaceName, changed) => {
            if (interfaceName === "org.mpris.MediaPlayer2.Player") {
                changedEvents.push(changed);
            }
        });
        const seekedEvents = [];
        player.on("Seeked", (position) => seekedEvents.push(position));

        binding.update({
            mediaType: "video",
            title: "MPRIS Video Smoke",
            artist: "BakaMusic",
            album: "System Media Controls",
            artwork: "https://example.invalid/cover.png",
            appMediaId: "video:mpris-smoke",
            state: "playing",
            position: 5,
            duration: 0,
            playbackRate: 1,
            volume: 0.75,
            repeatMode: "queue-repeat",
            nextEnabled: true,
            previousEnabled: true,
            updateMetadata: true,
        });

        const playbackStatus = await properties.Get(
            "org.mpris.MediaPlayer2.Player",
            "PlaybackStatus",
        );
        assert.equal(playbackStatus.value, "Playing");
        const position = await properties.Get(
            "org.mpris.MediaPlayer2.Player",
            "Position",
        );
        assert.equal(position.value, 5_000_000n);
        const metadata = await properties.Get(
            "org.mpris.MediaPlayer2.Player",
            "Metadata",
        );
        assert.equal(metadata.value["xesam:title"].value, "MPRIS Video Smoke");
        assert.equal(metadata.value["mpris:length"].value, 0n);
        const trackId = metadata.value["mpris:trackid"].value;
        const videoLoopStatus = await properties.Get(
            "org.mpris.MediaPlayer2.Player",
            "LoopStatus",
        );
        assert.equal(videoLoopStatus.value, "None");
        await assert.rejects(
            properties.Set(
                "org.mpris.MediaPlayer2.Player",
                "LoopStatus",
                new dbus.Variant("s", "Track"),
            ),
            /NotSupported|repeat/i,
        );
        console.log("system-media-controls: MPRIS metadata verified");

        changedEvents.length = 0;
        binding.update({
            mediaType: "video",
            title: "MPRIS Video Smoke",
            artist: "BakaMusic",
            album: "System Media Controls",
            artwork: "https://example.invalid/cover.png",
            appMediaId: "video:mpris-smoke",
            state: "playing",
            position: 5,
            duration: 120,
            playbackRate: 1,
            volume: 0.75,
            repeatMode: "queue-repeat",
            nextEnabled: true,
            previousEnabled: true,
            updateMetadata: false,
        });
        await waitFor(
            () => changedEvents.some((changed) => changed.Metadata),
            "MPRIS duration change did not publish refreshed metadata",
        );

        binding.update({
            mediaType: "music",
            title: "MPRIS Audio Smoke",
            artist: "BakaMusic",
            album: "System Media Controls",
            artwork: "https://example.invalid/cover.png",
            appMediaId: "video:mpris-smoke",
            state: "playing",
            position: 5,
            duration: 120,
            playbackRate: 1,
            volume: 0.75,
            repeatMode: "queue-repeat",
            nextEnabled: true,
            previousEnabled: true,
            updateMetadata: true,
        });

        await withTimeout(rootInterface.Raise(), "MPRIS Raise command");
        await withTimeout(player.Pause(), "MPRIS Pause command");
        await withTimeout(player.Play(), "MPRIS Play command");
        await withTimeout(player.Next(), "MPRIS Next command");
        await withTimeout(player.Previous(), "MPRIS Previous command");
        await withTimeout(player.Seek(2_000_000n), "MPRIS relative seek command");
        await withTimeout(
            player.SetPosition(trackId, 20_000_000n),
            "MPRIS absolute seek command",
        );
        await withTimeout(
            properties.Set(
                "org.mpris.MediaPlayer2.Player",
                "Volume",
                new dbus.Variant("d", 0.4),
            ),
            "MPRIS Volume property",
        );
        await withTimeout(
            properties.Set(
                "org.mpris.MediaPlayer2.Player",
                "Rate",
                new dbus.Variant("d", 1.5),
            ),
            "MPRIS Rate property",
        );
        await withTimeout(
            properties.Set(
                "org.mpris.MediaPlayer2.Player",
                "LoopStatus",
                new dbus.Variant("s", "Track"),
            ),
            "MPRIS LoopStatus property",
        );
        await withTimeout(
            properties.Set(
                "org.mpris.MediaPlayer2.Player",
                "Shuffle",
                new dbus.Variant("b", true),
            ),
            "MPRIS Shuffle property",
        );
        console.log("system-media-controls: MPRIS commands verified");

        await waitFor(
            () => actions.some((event) => event.action === "repeat"),
            "MPRIS commands did not reach the application callback",
        );
        assert.ok(actions.some((event) => event.action === "raise"));
        assert.ok(actions.some((event) => event.action === "pause"));
        assert.ok(actions.some((event) => event.action === "play"));
        assert.ok(actions.some((event) => event.action === "next"));
        assert.ok(actions.some((event) => event.action === "previous"));
        assert.ok(actions.some(
            (event) => event.action === "seek" && event.position === 7,
        ));
        assert.ok(actions.some(
            (event) => event.action === "seek" && event.position === 20,
        ));
        assert.ok(actions.some(
            (event) => event.action === "volume" && event.volume === 0.4,
        ));
        assert.ok(actions.some(
            (event) => event.action === "rate" && event.rate === 1.5,
        ));
        assert.ok(actions.some(
            (event) => event.action === "repeat" && event.mode === "loop",
        ));
        assert.ok(actions.some(
            (event) => event.action === "repeat" && event.mode === "shuffle",
        ));
        await waitFor(
            () => seekedEvents.length >= 2,
            "MPRIS seek commands did not emit Seeked signals",
        );
        assert.deepEqual(seekedEvents.slice(-2), [7_000_000n, 20_000_000n]);

        binding.clear();
        const stoppedStatus = await withTimeout(
            properties.Get(
                "org.mpris.MediaPlayer2.Player",
                "PlaybackStatus",
            ),
            "cleared MPRIS PlaybackStatus property",
        );
        assert.equal(stoppedStatus.value, "Stopped");
        console.log("system-media-controls: MPRIS clear verified");
    } finally {
        binding.dispose();
        await delay(50);
        client?.disconnect();
        restoreAliases();
    }
}

function runInSessionBus() {
    const result = spawnSync(
        "dbus-run-session",
        [
            "--",
            process.execPath,
            "-r",
            "ts-node/register/transpile-only",
            __filename,
            dbusChildFlag,
        ],
        {
            cwd: root,
            env: process.env,
            stdio: "inherit",
        },
    );
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "Linux MPRIS D-Bus integration failed");
}

async function main() {
    testStaticContracts();
    if (process.platform === "linux") {
        if (process.argv.includes(dbusChildFlag)) {
            await runMprisIntegration();
        } else {
            runInSessionBus();
        }
    }
    console.log(
        process.platform === "linux"
            ? "system-media-controls: static contracts and MPRIS integration passed"
            : "system-media-controls: static contracts passed",
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
