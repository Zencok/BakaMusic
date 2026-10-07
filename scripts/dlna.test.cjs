const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const common = require("../src/shared/dlna/common.ts");
const { parseDescription, parseXml, xmlValue, requestXml, disposeDlnaClient } = require("../src/shared/dlna/client.ts");
const { DlnaMediaServer } = require("../src/shared/dlna/media-server.ts");
const { DlnaSession } = require("../src/shared/dlna/session.ts");
const testAgent = new http.Agent({ keepAlive: true, proxyEnv: {} });

const location = "http://192.168.1.25:1400/device.xml";
const description = '<root xmlns="urn:schemas-upnp-org:device-1-0"><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Living &amp; room</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/transport</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:2</serviceType><controlURL>/volume</controlURL></service></serviceList></device></root>';
const device = parseDescription(description, location, "192.168.1.25", "192.168.1.10");
const loadRequest = {
    deviceId: device.id, sourceId: "track-1", url: "https://example.com/a.mp3?secret=value&next=2",
    title: "<title>&\"", artist: "Artist", album: "Album",
};

function protocolTests() {
    assert.equal(common.formatDlnaTime(3661.9), "01:01:01");
    assert.equal(common.parseDlnaTime("01:01:01.500"), 3661);
    assert.equal(common.parseDlnaTime("NOT_IMPLEMENTED"), 0);
    assert.equal(common.parseDlnaTime("9".repeat(1000) + ":00:00"), 0);
    assert.equal(common.parseDlnaTime("00:90:00"), 0);
    assert.equal(common.audioMime("https://example.com/audio.FLAC?token=1"), "audio/flac");
    assert.equal(common.escapeXml("<&>\"'"), "&lt;&amp;&gt;&quot;&apos;");
    for (const address of ["10.0.0.1", "172.16.0.1", "172.31.1.1", "192.168.1.1", "169.254.1.2"]) {
        assert.equal(common.isLanAddress(address), true, address);
    }
    for (const address of ["127.0.0.1", "8.8.8.8", "172.32.0.1", "192.168.256.1", "010.0.0.1", "::1", "0.0.0.0"]) {
        assert.equal(common.isLanAddress(address), false, address);
    }
    assert.equal(device.name, "Living & room");
    assert.equal(device.transport.url, "http://192.168.1.25:1400/transport");
    assert.equal(device.rendering.type, "urn:schemas-upnp-org:service:RenderingControl:2");
    assert.equal(device.volumeSupported, true);
    assert.equal(parseDescription(description.replace("MediaRenderer:1", "MediaServer:1"), location, device.address, device.localAddress), null);
    assert.equal(parseDescription(description.replace("AVTransport:1", "ContentDirectory:1"), location, device.address, device.localAddress), null);
    assert.equal(parseDescription(description.replace(/<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:2[\s\S]*?<\/service>/, ""), location, device.address, device.localAddress).volumeSupported, false);
    for (const url of ["http://127.0.0.1/control", "http://8.8.8.8/control", "http://192.168.1.24/control", "http://user:pass@192.168.1.25:1400/control", "file:///etc/passwd", "https://192.168.1.25/control"]) {
        assert.throws(() => common.validateDeviceUrl(url, device.address));
    }
    assert.throws(() => parseDescription(description.replace("/transport", "http://127.0.0.1/control"), location, device.address, device.localAddress));
    assert.throws(() => parseDescription(description.replace("/transport", "http://192.168.1.25:22/control"), location, device.address, device.localAddress));
    assert.throws(() => parseXml('<!DOCTYPE x [<!ENTITY external SYSTEM "file:///secret">]><x>&external;</x>'));
    assert.throws(() => parseXml("x".repeat(256 * 1024 + 1)));
    assert.equal(xmlValue('<s:Envelope xmlns:s="soap"><s:Body><u:RelTime xmlns:u="transport">00:01:03</u:RelTime></s:Body></s:Envelope>', "RelTime"), "00:01:03");
    const metadata = common.buildMetadata(loadRequest, loadRequest.url, "audio/mpeg");
    assert.match(metadata, /&lt;title&gt;&amp;&quot;/);
    assert.match(metadata, /secret=value&amp;next=2/);
    assert.match(metadata, /http-get:\*:audio\/mpeg:\*/);
}

async function sessionTests() {
    const calls = [];
    let closeCount = 0;
    let failAction = "";
    const session = new DlnaSession(new Map([[device.id, device]]), async () => ({
        url: loadRequest.url, mime: "audio/mpeg", media: { close() { closeCount += 1; } },
    }), async (_device, action, args, rendering) => {
        calls.push({ action, args, rendering });
        if (action === failAction) {
            throw new Error("offline");
        }
        if (action === "GetTransportInfo") {
            return "<root><CurrentTransportState>PLAYING</CurrentTransportState></root>";
        }
        return "<root><RelTime>00:01:00</RelTime><TrackDuration>00:03:00</TrackDuration></root>";
    });
    await session.command({ operation: "load", request: loadRequest });
    assert.deepEqual(calls.map((call) => call.action), ["Stop", "SetAVTransportURI"]);
    assert.equal(calls[1].args.CurrentURI, loadRequest.url);
    await session.command({ operation: "play", sourceId: "stale-track" });
    assert.equal(calls.length, 2);
    await Promise.all([
        session.command({ operation: "play", sourceId: "track-1" }),
        session.command({ operation: "seek", sourceId: "track-1", value: 64.2 }),
        session.command({ operation: "volume", sourceId: "track-1", value: 0.427 }),
    ]);
    assert.deepEqual(calls.slice(2).map((call) => call.action), ["Play", "Seek", "SetVolume"]);
    assert.equal(calls[3].args.Target, "00:01:04");
    assert.equal(calls[4].args.DesiredVolume, "43");
    assert.equal(calls[4].rendering, true);
    assert.deepEqual(await session.command({ operation: "status", sourceId: "track-1" }), {
        state: "PLAYING", currentTime: 60, duration: 180,
    });
    failAction = "Stop";
    await assert.rejects(session.command({ operation: "stop", sourceId: "track-1" }), /offline/);
    assert.equal(closeCount, 1);
    assert.equal(await session.command({ operation: "status", sourceId: "track-1" }), null);
    failAction = "SetAVTransportURI";
    await assert.rejects(session.command({ operation: "load", request: loadRequest }), /offline/);
    assert.equal(closeCount, 2);
    failAction = "";
    await session.command({ operation: "load", request: loadRequest });
    await session.command({ operation: "stop", sourceId: "track-1" });
    assert.equal(closeCount, 3);
    await assert.rejects(session.command({ operation: "load", request: { ...loadRequest, deviceId: "unknown" } }), /no longer available/);

    let releaseSource;
    let sourceStarted;
    const started = new Promise((resolve) => { sourceStarted = resolve; });
    const pendingSource = new Promise((resolve) => { releaseSource = resolve; });
    let disposedClosed = false;
    const cancelled = new DlnaSession(new Map([[device.id, device]]), async () => {
        sourceStarted();
        await pendingSource;
        return { url: loadRequest.url, mime: "audio/mpeg", media: { close() { disposedClosed = true; } } };
    }, async () => "<root/>");
    const loading = cancelled.command({ operation: "load", request: loadRequest });
    await started;
    cancelled.dispose();
    releaseSource();
    await assert.rejects(loading, /cancelled/);
    assert.equal(disposedClosed, true);

    let releaseControl;
    const gate = new Promise((resolve) => { releaseControl = resolve; });
    const bounded = new DlnaSession(new Map([[device.id, device]]), async () => ({ url: loadRequest.url, mime: "audio/mpeg" }), async () => {
        await gate;
        return "<root/>";
    });
    const pending = Array.from({ length: 16 }, () => bounded.command({ operation: "load", request: loadRequest }));
    await assert.rejects(bounded.command({ operation: "load", request: loadRequest }), /queue is full/);
    releaseControl();
    await Promise.all(pending);
    bounded.dispose();
}

async function controllerTests() {
    const Module = require("node:module");
    const originalLoad = Module._load;
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const originalMetadata = globalThis.MediaMetadata;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timers = new Map();
    const commands = [];
    let timerId = 0;
    let snapshot = { state: "PLAYING", currentTime: 60, duration: 180 };
    let loadGate = null;
    let loadFailure = null;
    let statusFailure = false;
    let volumeFailure = false;
    let seekFailure = false;
    const bridge = {
        async command(command) {
            commands.push(command);
            if (command.operation === "volume" && volumeFailure) throw new Error("volume unavailable");
            if (command.operation === "seek" && seekFailure) throw new Error("seek unavailable");
            if (command.operation === "load") {
                if (loadFailure) throw loadFailure;
                if (loadGate) await loadGate;
            }
            if (command.operation === "status") {
                if (statusFailure) throw new Error("offline");
                return snapshot;
            }
            return null;
        },
    };
    const state = { None: 0, Playing: 1, Paused: 2, Buffering: 3 };
    Module._load = function (request, parent, isMain) {
        if (request === "@/common/constant") return { PlayerState: state };
        if (request === "@shared/dlna/renderer") return { __esModule: true, default: bridge };
        if (request === "i18next") return { __esModule: true, default: { t: (key) => key } };
        return originalLoad.call(this, request, parent, isMain);
    };
    let Controller;
    try {
        Controller = require("../src/renderer/core/track-player/controller/dlna-audio-controller.ts").default;
    } finally {
        Module._load = originalLoad;
    }
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaSession: {} } });
    globalThis.MediaMetadata = class { constructor(value) { Object.assign(this, value); } };
    globalThis.setTimeout = (callback) => { const identifier = ++timerId; timers.set(identifier, callback); return identifier; };
    globalThis.clearTimeout = (identifier) => { timers.delete(identifier); };
    const flush = async () => { for (let index = 0; index < 16; index += 1) await Promise.resolve(); };
    const tick = async () => {
        const entry = timers.entries().next().value;
        assert.ok(entry, "poll timer must exist");
        timers.delete(entry[0]);
        entry[1]();
        await flush();
    };
    let controller;
    try {
        controller = new Controller(device);
        const music = { id: "song", platform: "test", title: "Song", artist: "Artist", duration: 180 };
        let ended = 0;
        const errors = [];
        controller.onEnded = () => { ended += 1; };
        controller.onError = (_reason, error) => errors.push(error.message);
        controller.setTrackSource({ url: loadRequest.url }, music);
        controller.seekTo(64);
        controller.play();
        await flush();
        assert.deepEqual(commands.map((command) => command.operation), ["load", "volume", "seek", "play"]);
        await tick();
        assert.equal(controller.playerState, state.Playing);
        snapshot = { state: "STOPPED", currentTime: 0, duration: 0 };
        await tick();
        assert.equal(ended, 0, "manual stop mid-track must not advance the queue");
        snapshot = { state: "PLAYING", currentTime: 179, duration: 180 };
        await tick();
        snapshot = { state: "STOPPED", currentTime: 0, duration: 0 };
        await tick();
        await tick();
        assert.equal(ended, 1, "natural end is reported once");
        controller.reset();
        await flush();
        assert.equal(timers.size, 0);

        volumeFailure = true;
        controller.setTrackSource({ url: loadRequest.url }, music);
        controller.play();
        await flush();
        assert.equal(controller.hasSource, true, "optional initial volume failure must not cancel casting");
        seekFailure = true;
        controller.seekTo(40);
        await flush();
        assert.equal(controller.hasSource, true, "optional seek failure must not cancel casting");
        assert.equal(errors.at(-1), "dlna.seek_error");
        volumeFailure = false;
        seekFailure = false;
        controller.reset();
        await flush();
        errors.length = 0;

        let release;
        loadGate = new Promise((resolve) => { release = resolve; });
        controller.setTrackSource({ url: loadRequest.url }, music);
        const cancelledId = commands.at(-1).request.sourceId;
        controller.play();
        controller.reset();
        loadGate = null;
        release();
        await flush();
        assert.equal(commands.filter((command) => command.operation === "play" && command.sourceId === cancelledId).length, 0);
        assert.equal(timers.size, 0, "cancelled load cannot start polling");

        loadFailure = new Error("DLNA_SOURCE_HEADERS_UNSUPPORTED");
        controller.setTrackSource({ url: loadRequest.url, headers: { Referer: "https://example.com" } }, music);
        controller.play();
        await flush();
        assert.equal(controller.hasSource, false);
        assert.deepEqual(errors, ["dlna.source_headers"]);
        loadFailure = null;
        controller.setTrackSource({ url: loadRequest.url }, music);
        await flush();
        statusFailure = true;
        await tick();
        await tick();
        await tick();
        assert.equal(controller.hasSource, false);
        assert.equal(controller.playerState, state.Paused);
        assert.equal(errors.at(-1), "dlna.playback_error");
        assert.equal(timers.size, 0, "offline device cannot leave an infinite poll loop");
    } finally {
        controller?.destroy();
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
        globalThis.MediaMetadata = originalMetadata;
        if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
        else delete globalThis.navigator;
    }
}
function get(url, options = {}) {
    return new Promise((resolve, reject) => {
        const request = http.request(url, { agent: testAgent, ...options }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolve({ code: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
            response.on("error", reject);
        });
        request.on("error", (error) => reject(new Error("HTTP test request failed: " + url + " " + error.message, { cause: error })));
        request.end();
    });
}

async function mediaServerTests() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "baka-dlna-test-"));
    const mediaPath = path.join(directory, "track.mp3");
    await fs.writeFile(mediaPath, "0123456789");
    let media;
    try {
        const opened = await DlnaMediaServer.create(mediaPath, "audio/mpeg", "127.0.0.1", "127.0.0.1");
        media = opened.media;
        assert.equal((await get(opened.url)).body.toString(), "0123456789");
        const range = await get(opened.url, { headers: { Range: "bytes=2-4" } });
        assert.equal(range.code, 206);
        assert.equal(range.body.toString(), "234");
        assert.equal(range.headers["content-range"], "bytes 2-4/10");
        assert.equal((await get(opened.url, { headers: { Range: "bytes=-3" } })).body.toString(), "789");
        assert.equal((await get(opened.url, { headers: { Range: "bytes=20-" } })).code, 416);
        assert.equal((await get(opened.url, { headers: { Range: "bytes=0-1,3-4" } })).code, 416);
        const head = await get(opened.url, { method: "HEAD" });
        assert.equal(head.code, 200);
        assert.equal(head.body.length, 0);
        assert.equal(head.headers["content-length"], "10");
        assert.equal((await get(opened.url, { method: "POST" })).code, 405);
        assert.equal((await get(new URL("/unauthorized", opened.url))).code, 404);
        assert.equal((await get(opened.url + "?path=" + encodeURIComponent(mediaPath))).code, 404);
        const denied = await DlnaMediaServer.create(mediaPath, "audio/mpeg", "127.0.0.1", "127.0.0.2");
        try {
            assert.equal((await get(denied.url)).code, 404);
        } finally {
            denied.media.close();
        }
        const concurrent = await Promise.all(Array.from({ length: 4 }, () => get(opened.url, { headers: { Range: "bytes=5-7" } })));
        assert.ok(concurrent.every((response) => response.body.toString() === "567"));
        media.close();
        media.close();
        await assert.rejects(get(opened.url));
    } finally {
        media?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
}

async function httpTests() {
    let requests = 0;
    const server = http.createServer((request, response) => {
        requests += 1;
        if (request.url === "/redirect") {
            response.writeHead(302, { Location: "/ok" }).end();
        } else if (request.url === "/large") {
            response.end("x".repeat(256 * 1024 + 1));
        } else {
            response.end("<root/>");
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    try {
        assert.equal(await requestXml(new URL(base + "/ok")), "<root/>");
        await assert.rejects(requestXml(new URL(base + "/redirect")), /302/);
        assert.equal(requests, 2);
        await assert.rejects(requestXml(new URL(base + "/large")), /size limit/);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}

function favoriteIconTests() {
    const { createElement } = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const { createHash } = require("node:crypto");
    const { ClassicStarIcon } = require("../src/renderer/components/MusicDetail/widgets/ClassicAmlLDetail/icons.tsx");
    const outlined = renderToStaticMarkup(createElement(ClassicStarIcon, { active: false }));
    const selected = renderToStaticMarkup(createElement(ClassicStarIcon, { active: true }));
    for (const markup of [outlined, selected]) {
        assert.match(markup, /viewBox="0 0 60 60"/);
        assert.match(markup, /aria-hidden="true"/);
        assert.match(markup, /fill="currentColor" fill-rule="evenodd"/);
    }
    const paths = (markup) => [...markup.matchAll(/<path class="([^"]+)" d="([^"]+)"[^>]*opacity="([01])"/g)];
    const outlinedPaths = paths(outlined);
    const selectedPaths = paths(selected);
    assert.equal(outlinedPaths.length, 2);
    assert.equal(selectedPaths.length, 2);
    assert.deepEqual(outlinedPaths.map((entry) => [entry[1], entry[3]]), [
        ["classic-amll-star-outline", "1"], ["classic-amll-star-filled", "0"],
    ]);
    assert.deepEqual(selectedPaths.map((entry) => [entry[1], entry[3]]), [
        ["classic-amll-star-outline", "0"], ["classic-amll-star-filled", "1"],
    ]);
    const hashPath = (entry) => createHash("sha256").update(entry[2]).digest("hex");
    for (const entries of [outlinedPaths, selectedPaths]) {
        assert.equal(hashPath(entries[0]), "c2cdf28576f95efd9382294fe6bbe14643a19d2095d4cbf7d75e360808c391ea");
        assert.equal(hashPath(entries[1]), "79bec76b0c9344579123e270250954019bb0721dcf451601a58a747bab475d38");
    }
}

async function boundaryTests() {
    const root = path.resolve(__dirname, "..");
    const preload = await fs.readFile(path.join(root, "src/preload/index.ts"), "utf8");
    const extension = await fs.readFile(path.join(root, "src/preload/extension.ts"), "utf8");
    assert.match(preload, /@shared\/dlna\/preload/);
    assert.doesNotMatch(extension, /dlna/);
    const extra = await fs.readFile(path.join(root, "src/renderer/components/MusicBar/widgets/Extra/index.tsx"), "utf8");
    const classic = await fs.readFile(path.join(root, "src/renderer/components/MusicDetail/widgets/ClassicAmlLDetail/index.tsx"), "utf8");
    const dialog = await fs.readFile(path.join(root, "src/renderer/components/Modal/templates/Dlna/index.tsx"), "utf8");
    assert.doesNotMatch(extra, /dlna|Dlna|DLNA/);
    assert.match(classic, /classic-amll-output-button/);
    assert.match(classic, /classic-amll-favorite-button[\s\S]*?ClassicStarIcon[\s\S]*?className="classic-amll-menu-button"/);
    assert.match(dialog, /void refresh\(\);/);
    assert.match(dialog, /initialFocusRef=\{localButton\}/);
    assert.doesNotMatch(dialog, /device\.address|dlna-limitations/);
    for (const language of ["en-US", "zh-CN", "zh-TW"]) {
        const resource = JSON.parse(await fs.readFile(path.join(root, "res/lang", language + ".json"), "utf8"));
        for (const key of ["title", "hint", "local", "local_hint", "nearby", "wireless", "scanning", "refresh", "scan_error", "source_headers"]) {
            assert.ok(resource.dlna[key], language + ": missing DLNA copy " + key);
        }
        assert.doesNotMatch(Object.values(resource.dlna).join(" "), /HTTP|proxy|代理|標頭|请求头|组播|多播|multicast|client isolation/i);
    }
}

(async () => {
    protocolTests();
    favoriteIconTests();
    console.log("DLNA protocol and Apple Music favorite icon states passed");
    await sessionTests();
    console.log("DLNA session passed");
    await controllerTests();
    console.log("DLNA renderer controller passed");
    await mediaServerTests();
    console.log("DLNA media server passed");
    await httpTests();
    await boundaryTests();
    console.log("DLNA protocol, session, media streaming and boundary regression passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    testAgent.destroy();
    disposeDlnaClient();
});
