const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    LOCAL_MEDIA_PROTOCOL,
    createLocalMediaUrl,
    parseLocalMediaUrl,
    resolveLocalMediaByteRange,
} = require("../src/shared/local-media/common.ts");
const { supportLocalMediaType } = require("../src/common/constant.ts");
const { autoDecryptLyric } = require(
    "../src/shared/plugin-manager/main/lyric-decrypt.ts",
);
const pakoForPlugins = require(
    "../src/shared/plugin-manager/utility/pako-compat.ts",
).default;
const {
    getManagedMediaProxyServiceName,
    resolveManagedMediaProxyUrl,
    ServiceName,
} = require("../src/shared/service-manager/common.ts");

const projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function testLocalMediaUrlContract() {
    for (const extension of [
        ".ape",
        ".dff",
        ".dsf",
        ".tak",
        ".tta",
        ".wv",
    ]) {
        assert.ok(supportLocalMediaType.includes(extension), extension);
    }
    const paths = [
        "C:\\Music\\Baka 音乐\\song.flac",
        "/home/music/Baka Music/song.ogg",
    ];
    for (const filePath of paths) {
        const mediaUrl = createLocalMediaUrl(filePath);
        assert.equal(new URL(mediaUrl).protocol, `${LOCAL_MEDIA_PROTOCOL}:`);
        assert.equal(parseLocalMediaUrl(mediaUrl), filePath);
    }

    assert.throws(
        () => parseLocalMediaUrl(`${LOCAL_MEDIA_PROTOCOL}://other/?path=test.mp3`),
        /invalid/,
    );
    assert.throws(
        () => parseLocalMediaUrl(
            `${LOCAL_MEDIA_PROTOCOL}://local/?path=a.mp3&path=b.mp3`,
        ),
        /invalid/,
    );
    assert.throws(
        () => parseLocalMediaUrl(
            `${LOCAL_MEDIA_PROTOCOL}://local/?path=a.mp3&extra=1`,
        ),
        /invalid/,
    );
}

function testLocalMediaRanges() {
    assert.equal(resolveLocalMediaByteRange(null, 100), null);
    assert.deepEqual(resolveLocalMediaByteRange("bytes=0-9", 100), {
        start: 0,
        end: 9,
    });
    assert.deepEqual(resolveLocalMediaByteRange("bytes=90-", 100), {
        start: 90,
        end: 99,
    });
    assert.deepEqual(resolveLocalMediaByteRange("bytes=-10", 100), {
        start: 90,
        end: 99,
    });
    assert.deepEqual(resolveLocalMediaByteRange("bytes=95-999", 100), {
        start: 95,
        end: 99,
    });
    for (const value of [
        "bytes=",
        "bytes=100-101",
        "bytes=20-10",
        "bytes=0-1,4-5",
        "items=0-1",
    ]) {
        assert.throws(
            () => resolveLocalMediaByteRange(value, 100),
            RangeError,
            value,
        );
    }
}

function testLocalFormatCoverage() {
    assert.equal(new Set(supportLocalMediaType).size, supportLocalMediaType.length);
    for (const extension of [
        ".aac", ".ac4", ".aiff", ".alac", ".ape", ".dff", ".dsf",
        ".dts", ".flac", ".m4a", ".mka", ".mp3", ".ogg", ".opus",
        ".tak", ".tta", ".wav", ".webm", ".wma", ".wv", ".xm",
    ]) {
        assert.ok(supportLocalMediaType.includes(extension), extension);
    }
}

function testLyricDecryptionCompatibility() {
    const syntheticQrc = "0C8D67DD3E549974B64ED2680459F13881AA15D10DB4CC8"
        + "324B86311D0D741BD6AF5D8724F2B7571B2B2BF976BE395E454A23CCB367E4"
        + "64B1DDFE92F44E29E20B5B9888F05C4C7375AC4DF56E28BDD11D00B7DF26D"
        + "990E9DBFB633EE400E1AB9387CEE7E713A899BDC25C77C4C74C6CC";
    assert.equal(
        autoDecryptLyric(syntheticQrc),
        "[0,1000]测(0,500)试(500,500)",
    );

    const compressed = pakoForPlugins.deflate("KRC 文本");
    assert.equal(
        pakoForPlugins.inflate(compressed, { to: "string" }),
        "KRC 文本",
    );
    assert.ok(pakoForPlugins.inflate(compressed) instanceof Uint8Array);
    assert.equal(pakoForPlugins.default, pakoForPlugins);
}

function testManagedMediaProxyRouting() {
    const token = "d300e9c5c4a5e53b2289a0c4f9cce2b6";
    const hosts = {
        [ServiceName.MflacProxy]: "http://127.0.0.1:21868",
        [ServiceName.LunaProxy]: "http://127.0.0.1:21869",
    };
    const mflacUrl = `${hosts[ServiceName.MflacProxy]}/m/${token}.mp4`;
    const lunaUrl = `${hosts[ServiceName.LunaProxy]}/l/${token}.m4a`;
    assert.equal(
        getManagedMediaProxyServiceName(mflacUrl),
        ServiceName.MflacProxy,
    );
    assert.equal(
        getManagedMediaProxyServiceName(lunaUrl),
        ServiceName.LunaProxy,
    );
    assert.equal(resolveManagedMediaProxyUrl(mflacUrl, hosts), mflacUrl);
    assert.equal(
        resolveManagedMediaProxyUrl(
            `http://127.0.0.1:21870/m/${token}.mp4`,
            hosts,
        ),
        null,
    );
    for (const invalidUrl of [
        `http://localhost:21868/m/${token}.mp4`,
        `http://127.0.0.1:21868/m/${token}.mp4?redirect=1`,
        `http://127.0.0.1:21868/other/${token}.mp4`,
    ]) {
        assert.equal(getManagedMediaProxyServiceName(invalidUrl), null);
    }
}

function testPlaybackBoundaryIntegration() {
    assert.equal(fs.existsSync(path.join(
        projectRoot,
        "src/shared/local-media/alac-transcoder.ts",
    )), false);

    const forgeSource = read("forge.config.ts");
    assert.match(forgeSource, /extraResource: \[path\.resolve\(__dirname, "res"\)\]/);
    assert.match(forgeSource, /createExternalRuntimePlugin\([\s\S]+"koffi"/);

    const runtimePathSource = read("src/shared/native-playback/runtime-path.ts");
    assert.match(runtimePathSource, /getMpvRuntimeDirectory/);
    assert.match(runtimePathSource, /libmpv-2\.dll/);
    assert.match(runtimePathSource, /mediaBackend === "librempeg"/);
    assert.doesNotMatch(runtimePathSource, /ffmpeg|ffprobe/i);

    const nativeMain = read("src/shared/native-playback/main.ts");
    assert.match(nativeMain, /utilityProcess\.fork/);
    assert.match(nativeMain, /assertIpcSender\(event, \["main"\]\)/);
    assert.match(nativeMain, /resolveNativeSource/);
    assert.match(nativeMain, /resolveManagedMediaProxyUrl/);
    assert.match(nativeMain, /assertUrl\(/);
    assert.match(nativeMain, /validateHeaders/);
    assert.doesNotMatch(nativeMain, /runFfprobe|native-playback\/probe/);
    assert.match(nativeMain, /MAX_RUNTIME_WORKING_SET_KB/);

    const nativeHost = read(
        "src/shared/native-playback/utility/native-playback-host.ts",
    );
    assert.match(nativeHost, /mpv_create/);
    assert.match(nativeHost, /mpv_initialize/);
    assert.match(nativeHost, /mpv_command/);
    assert.match(nativeHost, /mpv_get_property/);
    assert.match(nativeHost, /LibreMPEG AC-4 decoder/);
    assert.match(nativeHost, /runCommand\("loadfile", command\.url, "replace"\)/);
    assert.match(nativeHost, /http-header-fields/);
    assert.match(nativeHost, /rubberband=pitch=/);
    assert.doesNotMatch(nativeHost, /child_process|spawn\(/);

    const runtimeManifest = JSON.parse(read("scripts/media-runtime-manifest.json"));
    assert.equal(runtimeManifest.mpv.engine, "libmpv");
    assert.equal(runtimeManifest.mpv.mediaBackend, "librempeg");
    assert.ok(runtimeManifest.mpv.decoders.includes("ac4"));
    assert.match(
        runtimeManifest.mpv.releaseManifest.url,
        /^https:\/\/github\.com\/Zencok\/mpv-libre-runtime\/releases\/download\//,
    );
    assert.match(runtimeManifest.mpv.releaseManifest.sha256, /^[a-f0-9]{64}$/);
    assert.match(runtimeManifest.mpv.build, /^runtime-mpv-/);
    for (const source of ["builder", "mpv", "librempeg", "libplacebo"]) {
        assert.match(runtimeManifest.mpv.sourceCommits[source], /^[a-f0-9]{40}$/);
    }
    for (const target of [
        "win32-x64",
        "darwin-x64",
        "darwin-arm64",
        "linux-x64",
        "linux-arm64",
    ]) {
        const artifact = runtimeManifest.mpv.platforms[target];
        assert.match(
            artifact.url,
            /^https:\/\/github\.com\/Zencok\/mpv-libre-runtime\/releases\/download\//,
        );
        assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    }
    const runtimeInstaller = read("scripts/install-media-runtimes.cjs");
    assert.match(runtimeInstaller, /archiveUrlPath\.endsWith\("\.tar\.xz"\)/);
    assert.match(runtimeInstaller, /safeArchivePath\(entryPath\)/);
    assert.match(runtimeInstaller, /validateReleaseDescriptor/);
    assert.match(runtimeInstaller, /platformDescriptor\.size/);
    assert.match(runtimeInstaller, /releaseManifest: descriptor\.releaseManifest/);
    assert.match(runtimeInstaller, /pruneMpvCommandLineTools/);
    const runtimeUpdater = read("scripts/update-media-runtime-manifest.cjs");
    assert.match(runtimeUpdater, /value\.complete === true/);
    assert.match(runtimeUpdater, /value\.phase === "complete"/);
    assert.match(runtimeUpdater, /Zencok\/mpv-libre-runtime/);
    const packageJson = JSON.parse(read("package.json"));
    assert.equal(packageJson.scripts["runtime:build:mpv"], undefined);
    assert.match(packageJson.scripts.make, /runtime:install/);
    assert.equal(fs.existsSync(path.join(projectRoot, "scripts/media-runtime")), false);

    const nativeController = read(
        "src/renderer/core/track-player/controller/libmpv-audio-controller.ts",
    );
    assert.match(nativeController, /class LibmpvAudioController/);
    assert.match(nativeController, /operation: "load"/);
    assert.match(nativeController, /headers: this\.normalizeHeaders/);
    assert.match(nativeController, /operation: "pitch"/);
    assert.doesNotMatch(nativeController, /activateBrowser|new Audio\(|\.probe\(/);
    assert.equal(fs.existsSync(path.join(
        projectRoot,
        "src/renderer/core/track-player/controller/audio-controller.ts",
    )), false);

    const pluginHost = read("src/shared/plugin-manager/main/plugin-host-client.ts");
    const environmentSource = pluginHost.slice(
        pluginHost.indexOf("function createPluginHostEnvironment"),
        pluginHost.indexOf("function assertRpcRequestId"),
    );
    assert.match(environmentSource, /"SystemRoot"/);
    assert.match(environmentSource, /"WINDIR"/);

    const localPlugin = read(
        "src/shared/plugin-manager/main/internal-plugins/local-plugin.ts",
    );
    assert.match(localPlugin, /grantPathAccess\(localFilePath\)/);

    const securitySource = read("src/main/electron-security.ts");
    assert.doesNotMatch(securitySource, /bakamusic-media:/);
    assert.match(securitySource, /details\.resourceType !== "image"/);
    assert.match(securitySource, /"Access-Control-Allow-Origin", \["\*"\]/);

    assert.doesNotMatch(forgeSource, /bakamusic-media:/);

    const mySheetsSource = read(
        "src/renderer/pages/main-page/components/SideBar/widgets/MySheets/index.tsx",
    );
    const matchSource = mySheetsSource.slice(
        mySheetsSource.indexOf("const sheetIdMatch"),
        mySheetsSource.indexOf("const currentSheetId"),
    );
    assert.match(matchSource, /\$\{localPluginName\}/);
    assert.doesNotMatch(matchSource, /encodeURIComponent/);
}

testLocalMediaUrlContract();
testLocalMediaRanges();
testLocalFormatCoverage();
testLyricDecryptionCompatibility();
testManagedMediaProxyRouting();
testPlaybackBoundaryIntegration();

console.log("playback-boundary: all assertions passed");
