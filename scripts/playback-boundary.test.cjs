const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    LOCAL_MEDIA_PROTOCOL,
    createLocalMediaUrl,
    parseLocalMediaUrl,
    resolveLocalMediaByteRange,
} = require("../src/shared/local-media/common.ts");
const { autoDecryptLyric } = require(
    "../src/shared/plugin-manager/main/lyric-decrypt.ts",
);
const pakoForPlugins = require(
    "../src/shared/plugin-manager/utility/pako-compat.ts",
).default;

const projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function testLocalMediaUrlContract() {
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

function testPlaybackBoundaryIntegration() {
    const localMediaMain = read("src/shared/local-media/main.ts");
    assert.match(localMediaMain, /registerSchemesAsPrivileged/);
    assert.match(localMediaMain, /protocol\.handle\(LOCAL_MEDIA_PROTOCOL/);
    assert.match(localMediaMain, /assertPathAccess\(requestedPath/);
    assert.match(localMediaMain, /extensions: supportLocalMediaType/);
    assert.match(localMediaMain, /fileStat\.isFile\(\)/);
    assert.match(localMediaMain, /status: 416/);
    assert.match(localMediaMain, /const status = byteRange \? 206 : 200/);
    assert.match(localMediaMain, /signal: request\.signal/);

    const mainSource = read("src/main/index.ts");
    assert.ok(
        mainSource.indexOf("registerLocalMediaProtocolScheme();")
            < mainSource.indexOf("app.whenReady().then"),
        "the local-media scheme must be registered before app ready",
    );
    const readySource = mainSource.slice(mainSource.indexOf("app.whenReady().then"));
    assert.ok(
        readySource.indexOf("setupLocalMediaMain();")
            < readySource.indexOf("windowManager.showMainWindow();"),
        "the local-media handler must be installed before the first window",
    );

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
    assert.match(
        securitySource,
        /media-src[^\n]+bakamusic-media:[^\n]+bakamusic-theme:/,
    );
    assert.match(securitySource, /details\.resourceType !== "image"/);
    assert.match(securitySource, /"Access-Control-Allow-Origin", \["\*"\]/);

    const forgeSource = read("forge.config.ts");
    assert.match(
        forgeSource,
        /media-src[^\n]+bakamusic-media:[^\n]+bakamusic-theme:/,
    );

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
testLyricDecryptionCompatibility();
testPlaybackBoundaryIntegration();

console.log("playback-boundary: all assertions passed");
