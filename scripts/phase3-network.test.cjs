const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { fork } = require("node:child_process");
const { Readable, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const {
    createDownloadPartPath,
    createDownloadResponsePlan,
    validateCompletedDownload,
    validateMediaFileSignature,
} = require("../src/webworkers/download-integrity");
const {
    getDownloadProgressPercent,
} = require("../src/renderer/core/downloader/progress");
const {
    assertSafeTargetUrlSync,
    createByteLimitTransform,
    createSessionStore,
    lookupPublic,
    requestUpstream,
    sanitizeHeaders,
} = require("../res/.service/proxy-common.cjs");

function headers(values) {
    const normalized = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]),
    );
    return {
        get(name) {
            return normalized[name.toLowerCase()] ?? null;
        },
    };
}

function readSource(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function request(port, pathname) {
    return new Promise((resolve, reject) => {
        const req = http.get({ hostname: "127.0.0.1", port, path: pathname }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve({
                status: res.statusCode,
                body: Buffer.concat(chunks).toString("utf8"),
            }));
        });
        req.on("error", reject);
    });
}

function lookup(hostname, options) {
    return new Promise((resolve, reject) => {
        lookupPublic(hostname, options, (error, address, family) => {
            if (error) {
                reject(error);
                return;
            }
            resolve({ address, family });
        });
    });
}

function canLoadProxyNative(fileName) {
    // Prebuilt service natives in res/.service/native are platform-specific.
    // validate-source runs on Linux while committed .node files are typically Windows.
    const nativeName = fileName === "mflac-proxy.cjs"
        ? "qmc2.node"
        : fileName === "luna-proxy.cjs"
            ? "ence.node"
            : null;
    if (!nativeName) {
        return false;
    }
    try {
        require(path.join(__dirname, "../res/.service/native", nativeName));
        return true;
    } catch {
        return false;
    }
}

async function startNativeProxy(fileName, envKey) {
    const child = fork(path.join(__dirname, `../res/.service/${fileName}`), [], {
        env: { ...process.env, [envKey]: "0" },
        silent: true,
    });
    const stderrChunks = [];
    child.stderr?.on("data", (chunk) => {
        stderrChunks.push(Buffer.from(chunk));
    });
    const port = await new Promise((resolve, reject) => {
        const fail = (reason) => {
            clearTimeout(timeout);
            const detail = Buffer.concat(stderrChunks).toString("utf8").trim();
            reject(new Error(detail ? `${reason}: ${detail}` : reason));
        };
        const timeout = setTimeout(() => fail(`${fileName} start timeout`), 5_000);
        child.once("error", (error) => fail(error.message || String(error)));
        child.once("exit", (code, signal) => {
            fail(`${fileName} exited before ready (code=${code}, signal=${signal})`);
        });
        child.on("message", (message) => {
            if (message?.type === "port") {
                clearTimeout(timeout);
                resolve(message.port);
            }
        });
    });
    return { child, port };
}

function waitForRpcReply(child, requestId) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`RPC ${requestId} timeout`)), 5_000);
        const handler = (message) => {
            if (message?.requestId === requestId) {
                clearTimeout(timeout);
                child.removeListener("message", handler);
                resolve(message);
            }
        };
        child.on("message", handler);
    });
}

async function run() {
    assert.equal(getDownloadProgressPercent(null), 0);
    assert.equal(getDownloadProgressPercent({ downloaded: 50, total: 200 }), 25);
    assert.equal(getDownloadProgressPercent({ downloaded: -1, total: 200 }), 0);
    assert.equal(getDownloadProgressPercent({ downloaded: 250, total: 200 }), 100);

    const firstPart = createDownloadPartPath("C:/Music/song.mp3", "platform@track-1");
    const samePart = createDownloadPartPath("C:/Music/song.mp3", "platform@track-1");
    const secondPart = createDownloadPartPath("C:/Music/song.mp3", "platform@track-2");
    assert.equal(firstPart, samePart);
    assert.notEqual(firstPart, secondPart);
    assert.match(firstPart, /\.part$/);

    const resumed = createDownloadResponsePlan(206, headers({
        "content-type": "audio/mpeg",
        "content-length": "100",
        "content-range": "bytes 100-199/200",
    }), 100);
    assert.deepEqual(resumed, {
        append: true,
        startSize: 100,
        expectedBodySize: 100,
        totalSize: 200,
    });
    validateCompletedDownload(resumed, 100, 200);
    assert.throws(
        () => validateCompletedDownload(resumed, 99, 199),
        /Received 99 bytes/,
    );
    assert.throws(
        () => createDownloadResponsePlan(206, headers({
            "content-type": "audio/mpeg",
            "content-length": "100",
            "content-range": "bytes 99-198/200",
        }), 100),
        /expected 100/,
    );
    const restarted = createDownloadResponsePlan(200, headers({
        "content-type": "application/octet-stream",
        "content-length": "200",
    }), 100);
    assert.equal(restarted.append, false);
    assert.equal(restarted.startSize, 0);
    assert.throws(
        () => createDownloadResponsePlan(200, headers({
            "content-type": "text/html",
            "content-length": "20",
        }), 0),
        /Unexpected media type/,
    );

    validateMediaFileSignature(Buffer.from("49443304000000000000", "hex"), "song.mp3");
    validateMediaFileSignature(Buffer.from("664c614300000000", "hex"), "song.flac");
    validateMediaFileSignature(Buffer.from("4f67675300000000", "hex"), "song.ogg");
    validateMediaFileSignature(Buffer.from("00000018667479704d344120", "hex"), "song.m4a");
    assert.throws(
        () => validateMediaFileSignature(Buffer.from("3c68746d6c3e", "hex"), "song.mp3"),
        /Media signature/,
    );

    assert.throws(() => assertSafeTargetUrlSync("file:///tmp/music"), /HTTP/);
    assert.throws(() => assertSafeTargetUrlSync("http://127.0.0.1/music"), /Private/);
    assert.throws(() => assertSafeTargetUrlSync("http://localhost/music"), /Private/);
    assert.equal(
        assertSafeTargetUrlSync("https://media.example.com/music.flac").hostname,
        "media.example.com",
    );
    assert.deepEqual(await lookup("93.184.216.34", {}), {
        address: "93.184.216.34",
        family: 4,
    });
    assert.deepEqual(await lookup("93.184.216.34", { all: true }), {
        address: [{ address: "93.184.216.34", family: 4 }],
        family: undefined,
    });
    await assert.rejects(requestUpstream("http://127.0.0.1/music"), /Private/);
    const sanitized = sanitizeHeaders({
        authorization: "Bearer token",
        connection: "keep-alive",
        cookie: "session=value",
        "x-unbounded-plugin-header": "drop-me",
    }, new URL("https://example.com/music"), { range: "bytes=0-9" });
    assert.equal(sanitized.authorization, "Bearer token");
    assert.equal(sanitized.cookie, "session=value");
    assert.equal(sanitized.range, "bytes=0-9");
    assert.equal(sanitized.connection, undefined);
    assert.equal(sanitized["x-unbounded-plugin-header"], undefined);

    const disposed = [];
    const store = createSessionStore({
        maxEntries: 2,
        ttlMs: 10,
        dispose: (session) => disposed.push(session.id),
    });
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
        store.set("a", { id: "a" });
        now++;
        store.set("b", { id: "b" });
        store.get("a");
        now++;
        store.set("c", { id: "c" });
        assert.equal(store.get("b"), undefined);
        assert.deepEqual(disposed, ["b"]);
        now += 20;
        store.sweep();
        assert.equal(store.size, 0);
        assert.deepEqual(new Set(disposed), new Set(["a", "b", "c"]));
    } finally {
        Date.now = originalNow;
        store.close();
    }

    await assert.rejects(
        pipeline(
            Readable.from([Buffer.alloc(3), Buffer.alloc(3)]),
            createByteLimitTransform(5),
            new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
        ),
        /exceeds proxy limit/,
    );

    const workerSource = readSource("src/webworkers/downloader.ts");
    assert.match(workerSource, /createDownloadPartPath\(filePath, taskId\)/);
    assert.match(workerSource, /createWriteStream\(partPath/);
    assert.match(workerSource, /fsPromises\.rename\(partPath, filePath\)/);
    assert.match(workerSource, /coverDownloadSemaphore = new Semaphore\(3\)/);
    assert.match(workerSource, /coverDownloadTimeoutMs = 15_000/);
    assert.doesNotMatch(workerSource, /MAX_COVER|cover.*size.*limit/i);

    const downloaderSource = readSource("src/renderer/core/downloader/index.ts");
    assert.match(downloaderSource, /@shared\/node-runtime\/renderer/);
    assert.match(downloaderSource, /recoverDownloaderWorker/);
    assert.match(downloaderSource, /recoverDownloaderWorker\(toError\(error\)\)/);
    assert.match(downloaderSource, /queueTask\(taskControl\)/);
    assert.match(
        downloaderSource,
        /DownloadStatusUpdated,\s*musicItem,\s*null/,
    );

    const downloadControlSource = readSource(
        "src/renderer/components/MusicDownloaded/index.tsx",
    );
    assert.match(downloadControlSource, /role="progressbar"/);
    assert.match(downloadControlSource, /strokeDashoffset=\{100 - percent\}/);
    assert.doesNotMatch(downloadControlSource, /iconName = "rolling-1s"/);

    const nodeRuntimeSource = readSource("src/shared/node-runtime/main.ts");
    assert.match(nodeRuntimeSource, /utilityProcess\.fork/);
    assert.match(nodeRuntimeSource, /child\.on\("exit"/);
    assert.match(nodeRuntimeSource, /this\.rejectPending/);
    assert.match(nodeRuntimeSource, /child\.kill\(\)/);
    assert.match(nodeRuntimeSource, /if \(this\.watcherState\)/);
    assert.match(nodeRuntimeSource, /"watcher-setup", this\.watcherState/);

    const nativeControllerSource = readSource(
        "src/renderer/core/track-player/controller/libmpv-audio-controller.ts",
    );
    assert.match(nativeControllerSource, /operation: "load"/);
    assert.match(nativeControllerSource, /normalizeHeaders/);
    assert.doesNotMatch(nativeControllerSource, /HTMLAudioElement|hls\.js|AudioContext/);

    for (const servicePath of [
        "res/.service/mflac-proxy.cjs",
        "res/.service/luna-proxy.cjs",
    ]) {
        const serviceSource = readSource(servicePath);
        assert.match(serviceSource, /createSessionStore/);
        assert.match(serviceSource, /destroyDecoder/);
        assert.match(serviceSource, /requestId/);
        assert.match(serviceSource, /req\.once\("aborted", cancel\)/);
        assert.match(serviceSource, /upstream\.pause\(\)/);
        assert.match(serviceSource, /res\.once\("drain"/);
    }

    for (const proxy of [
        {
            fileName: "mflac-proxy.cjs",
            envKey: "MFLAC_PROXY_PORT",
            message: {
                type: "register",
                requestId: "mflac-test-1",
                src: "http://127.0.0.1/private.mflac",
                ekey: "placeholder",
            },
        },
        {
            fileName: "luna-proxy.cjs",
            envKey: "LUNA_PROXY_PORT",
            message: {
                type: "register",
                requestId: "luna-test-1",
                src: "http://127.0.0.1/private.m4a",
                cek: "00000000000000000000000000000000",
            },
        },
    ]) {
        if (!canLoadProxyNative(proxy.fileName)) {
            // Static checks above still cover service source contracts.
            console.log(`phase3-network: skip ${proxy.fileName} process test (native ABI unavailable)`);
            continue;
        }
        const service = await startNativeProxy(proxy.fileName, proxy.envKey);
        try {
            assert.deepEqual(await request(service.port, "/heartbeat"), {
                status: 200,
                body: "OK",
            });
            const replyPromise = waitForRpcReply(service.child, proxy.message.requestId);
            service.child.send(proxy.message);
            const reply = await replyPromise;
            assert.equal(reply.type, "error");
            assert.equal(reply.requestId, proxy.message.requestId);
        } finally {
            service.child.kill();
        }
    }

    console.log("phase3-network: all assertions passed");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
