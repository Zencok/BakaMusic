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
    DOWNLOAD_PROGRESS_UPDATE_INTERVAL_MS,
    LatestDownloadProgressBuffer,
    MAX_BUFFERED_DOWNLOAD_PROGRESS_TASKS,
} = require("../src/common/download-progress");
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
    // FLAC body with wrong .mp3 path: detect + correct, do not only throw.
    {
        const {
            detectMediaExtension,
            resolveDownloadedFilePath,
        } = require("../src/webworkers/download-integrity");
        const flacBytes = Buffer.from("664c614300000000", "hex");
        assert.equal(detectMediaExtension(flacBytes), ".flac");
        const wrongPath = path.join("D:", "Downloads", "track.mp3");
        const fixedPath = path.join("D:", "Downloads", "track.flac");
        assert.deepEqual(
            resolveDownloadedFilePath(wrongPath, flacBytes),
            { filePath: fixedPath, detectedExt: ".flac" },
        );
        assert.throws(
            () => validateMediaFileSignature(flacBytes, "song.mp3"),
            /Media signature does not match \.mp3/,
        );
    }

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
    // 完整性校验通过后才原子 rename；最终容器扩展名由 magic bytes 兜底修正。
    assert.match(workerSource, /validateCompletedDownload\(responsePlan, receivedBytes, completedStat\.size\)/);
    assert.match(workerSource, /resolveDownloadedFilePath\(\s*filePath,/);
    assert.match(workerSource, /fsPromises\.rename\(partPath, finalPath\)/);
    // Progress is human-visible state, not a frame stream. A lower rate limits
    // utility -> main traffic before main applies its latest-per-task buffer.
    assert.equal(DOWNLOAD_PROGRESS_UPDATE_INTERVAL_MS, 250);
    assert.equal(MAX_BUFFERED_DOWNLOAD_PROGRESS_TASKS, 256);
    const backgroundProgress = new LatestDownloadProgressBuffer();
    // Default concurrency over two background minutes formerly produced about
    // 9k IPC frames. The retained buffer now remains one entry per task.
    for (let index = 0; index < 10_000; index++) {
        backgroundProgress.upsert({
            taskId: `task-${index % 5}`,
            downloaded: index,
        });
    }
    assert.equal(backgroundProgress.size, 5);
    const latestProgress = backgroundProgress.drain();
    assert.equal(latestProgress.length, 5);
    assert.equal(Math.max(...latestProgress.map((item) => item.downloaded)), 9_999);
    for (let index = 0; index < 300; index++) {
        backgroundProgress.upsert({ taskId: `unique-${index}`, downloaded: index });
    }
    assert.equal(backgroundProgress.size, MAX_BUFFERED_DOWNLOAD_PROGRESS_TASKS);
    assert.match(workerSource, /DOWNLOAD_PROGRESS_UPDATE_INTERVAL_MS/);
    assert.doesNotMatch(workerSource, /}, 64, \{/);
    // 封面改由 main 进程 net.fetch 拉取后以 base64 交给 utility 嵌入，
    // utility 后处理不再自行触网；跨 IPC 传输因此必须有显式体积与类型上限。
    assert.match(workerSource, /payload\.coverImage\?\.dataBase64/);
    const coverFetchSource = readSource("src/shared/node-runtime/main.ts");
    assert.match(coverFetchSource, /const MAX_COVER_BYTES = 8 \* 1024 \* 1024/);
    assert.match(coverFetchSource, /async function fetchCoverImageInMain/);
    assert.match(coverFetchSource, /readResponseBufferLimited\(response, MAX_COVER_BYTES\)/);
    assert.match(coverFetchSource, /receivedBytes > maximumBytes/);
    assert.doesNotMatch(coverFetchSource, /response\.arrayBuffer\(\)/);
    assert.match(coverFetchSource, /buffer\.length > MAX_COVER_BYTES/);
    assert.match(coverFetchSource, /mimeType\.startsWith\("image\/"\)/);
    assert.match(coverFetchSource, /validateDownloadCoverImageMode/);
    assert.match(coverFetchSource, /prepareDownloadCoverImage\(buffer, mimeType, mode\)/);
    const coverPrepareSource = readSource("src/common/download-cover-image.ts");
    assert.match(coverPrepareSource, /COMPATIBLE_COVER_MAX_EDGE = 800/);
    assert.match(coverPrepareSource, /COMPATIBLE_COVER_MAX_BYTES = 1024 \* 1024/);
    assert.match(coverPrepareSource, /progressive: false/);
    assert.match(coverPrepareSource, /mimeType: "image\/jpeg"/);
    const downloadPostprocessSource = readSource("src/renderer/core/downloader/postprocess.ts");
    assert.match(downloadPostprocessSource, /fetchCover\(coverUrl, options\.coverImageMode\)/);
    // A missing lyric is represented as an empty string by several plugins.
    // It must remain a valid optional postprocess value instead of failing IPC.
    assert.match(
        coverFetchSource,
        /assertString\(value\.lyricContent, "lyric content", 8 \* 1024 \* 1024, true\)/,
    );

    const downloaderSource = readSource("src/renderer/core/downloader/index.ts");
    assert.match(downloaderSource, /@shared\/node-runtime\/renderer/);
    assert.match(downloaderSource, /recoverDownloaderWorker/);
    // 只有运行时自身不可用才重排全部任务：单曲失败（无音源/插件报错/媒体源被拒）
    // 必须原地报错，否则会连带重启其他在途下载，失败任务自己还会无限重排。
    assert.match(downloaderSource, /function isRuntimeTransportFailure/);
    assert.match(
        downloaderSource,
        /worker === downloaderWorker && isRuntimeTransportFailure\(toError\(error\)\)/,
    );
    assert.match(downloaderSource, /taskControl\.recoveryCount >= maxAutoRecoveryPerTask/);
    assert.match(downloaderSource, /queueTask\(taskControl\)/);
    // One batched IPC delivery must clone/publish the task array only once,
    // and per-track subscribers should not all run for another track's tick.
    assert.match(downloaderSource, /queueMicrotask\(\(\) =>/);
    assert.match(downloaderSource, /getDownloadStatusEvent\(taskId\)/);
    assert.match(downloaderSource, /downloadMetadataQueue = new PQueue\(\{ concurrency: 4 \}\)/);
    assert.match(
        downloaderSource,
        /downloadMetadataQueue\.add\(async \(\) => \{\s*const payload = await buildDownloadPostprocessPayload/,
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
    // The heavyweight utility is lazy and exits after downloads/postprocessing
    // are idle, allowing native working-set memory to return to the OS.
    assert.match(nodeRuntimeSource, /const RUNTIME_IDLE_TIMEOUT_MS = 60_000/);
    assert.match(nodeRuntimeSource, /scheduleIdleShutdown\(child\)/);
    assert.match(nodeRuntimeSource, /!this\.pending\.size\s*&& !this\.watcherState/);
    assert.doesNotMatch(
        nodeRuntimeSource,
        /Cold-start the utility process[\s\S]*?void this\.ensureStarted\(\)/,
    );
    // Minimized/background renderers must receive at most the newest progress
    // sample for each task. Terminal states stay immediate because they release
    // the renderer queue and start postprocessing.
    assert.match(nodeRuntimeSource, /new LatestDownloadProgressBuffer/);
    assert.match(nodeRuntimeSource, /isMainWindowForeground/);
    assert.match(nodeRuntimeSource, /"@shared\/node-runtime\/download-state-batch"/);
    assert.match(
        nodeRuntimeSource,
        /stateName === DownloadState\.DONE \|\| stateName === DownloadState\.ERROR/,
    );
    const nodeRuntimePreloadSource = readSource("src/shared/node-runtime/preload.ts");
    assert.match(
        nodeRuntimePreloadSource,
        /"@shared\/node-runtime\/download-state-batch"/,
    );
    // 全库扫描不能用 60s 默认超时：超时会 kill 掉下载共用的 utility。
    assert.match(nodeRuntimeSource, /const WATCHER_SCAN_TIMEOUT_MS = 30 \* 60 \* 1000/);
    assert.match(
        nodeRuntimeSource,
        /this\.request\("watcher-scan", state, WATCHER_SCAN_TIMEOUT_MS\)/,
    );

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
