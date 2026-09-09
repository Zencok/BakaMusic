// Platform-neutral libmpv render smoke. No NSView/HWND, network, or GUI needed.
require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { Worker } = require("node:worker_threads");
const koffi = require("koffi");
const { execFileSync } = require("node:child_process");
const { isNativeVideoFrame, getVideoFrameSize } = require("../src/shared/native-playback/video-frame.ts");

assert.deepEqual(getVideoFrameSize(3840, 2160), { width: 1280, height: 720 });
assert.deepEqual(getVideoFrameSize(720, 1280), { width: 405, height: 720 });
assert.deepEqual(getVideoFrameSize(NaN, 0), { width: 1280, height: 720 });
for (const frame of [null, {}, { width: 999999, height: 1, pixels: new Uint8Array() }]) {
    assert.equal(isNativeVideoFrame(frame), false);
}

const directory = path.resolve(__dirname, `../res/.runtime/mpv/${process.platform}-${process.arch}`);
const libraryPath = path.join(directory, process.platform === "win32" ? "libmpv-2.dll"
    : process.platform === "darwin" ? "lib/libmpv.2.dylib" : "lib/libmpv.so.2");
if (!fs.existsSync(libraryPath)) {
    console.log("Frame validation passed; native render smoke skipped (runtime not installed).");
    process.exit(0);
}

// Run the complete utility host as well as the render worker: a worker-only
// test would miss invalid bootstrap options and RPC/first-frame integration.
if (process.argv.includes("--host")) {
    const { EventEmitter } = require("node:events");
    const Module = require("node:module");
    const ts = require("typescript");
    const port = new EventEmitter();
    const pending = new Map();
    let sequence = 0;
    let frameCount = 0;
    Object.assign(process.env, {
        BAKAMUSIC_MPV_DIR: directory,
        BAKAMUSIC_MPV_VIDEO_RENDER: "software",
        BAKAMUSIC_MPV_VIDEO_WIDTH: "320",
        BAKAMUSIC_MPV_VIDEO_HEIGHT: "180",
        BAKAMUSIC_MPV_WID: "",
    });
    process.parentPort = port;
    port.postMessage = (message) => {
        if (message.type === "response") {
            const request = pending.get(message.requestId);
            pending.delete(message.requestId);
            if (message.error) request.reject(new Error(message.error.message));
            else request.resolve(message.result);
        }
        if (message.type === "frame") {
            const frame = message.frame;
            assert.ok(isNativeVideoFrame(frame));
            assert.equal(frame.sourceId, "fixture");
            const offset = (Math.floor(frame.height / 2) * frame.width + Math.floor(frame.width / 2)) * 4;
            assert.ok(frame.pixels[offset] > 180);
            assert.equal(frame.pixels[offset + 3], 255);
            port.emit("message", { data: { type: "ack", frameId: frame.frameId } });
            if (++frameCount === 3) {
                console.log("Software utility host passed: bootstrap, RPC, decoded frames and acknowledgements.");
                process.exit(0);
            }
        }
    };
    const filename = path.resolve(__dirname, "../src/shared/native-playback/utility/native-playback-host.ts");
    // The package smoke checks the bundled .js sibling. Here ts-node loads the
    // same worker directly from source, without writing build artifacts.
    const source = fs.readFileSync(filename, "utf8")
        .replace('"native_video_render_worker.js"', '"native-video-render-worker.ts"');
    const host = new Module(filename, module);
    host.filename = filename;
    host.paths = Module._nodeModulePaths(path.dirname(filename));
    host._compile(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
    }).outputText, filename);
    const request = (operation, payload) => new Promise((resolve, reject) => {
        const requestId = String(++sequence);
        pending.set(requestId, { resolve, reject });
        port.emit("message", { data: { type: "request", requestId, operation, payload } });
    });
    (async () => {
        await request("capabilities");
        await request("command", {
            operation: "load", sourceId: "fixture", sourceType: "path",
            url: "av://lavfi:color=c=red:s=320x180:r=30:d=3",
        });
        await request("command", { operation: "play", sourceId: "fixture" });
    })().catch((error) => { console.error(error); process.exit(1); });
    setTimeout(() => { console.error("Software host timed out"); process.exit(1); }, 15000);
} else {
    main().then(() => {
        execFileSync(process.execPath, ["-r", "ts-node/register/transpile-only", __filename, "--host"], {
            stdio: "inherit", windowsHide: true, timeout: 20000,
        });
    }).catch((error) => { console.error(error); process.exit(1); });
}

async function main() {
    const library = koffi.load(libraryPath);
    const create = library.func("void *mpv_create(void)");
    const option = library.func("int mpv_set_option_string(void *, const char *, const char *)");
    const init = library.func("int mpv_initialize(void *)");
    const command = library.func("int mpv_command(void *, const char **)");
    const destroy = library.func("void mpv_terminate_destroy(void *)");
    const player = create();
    for (const [name, value] of Object.entries({
        config: "no", vo: "libmpv", ao: "null", hwdec: "no", idle: "yes",
        "keep-open": "yes",
    })) assert.ok(option(player, name, value) >= 0, name);
    assert.equal(init(player), 0);
    const worker = new Worker(path.resolve(__dirname, "../src/shared/native-playback/utility/native-video-render-worker.ts"), {
        execArgv: ["-r", "ts-node/register/transpile-only"],
        workerData: { libraryPath, playerAddress: koffi.address(player).toString(), width: 320, height: 180 },
    });
    let count = 0;
    let lastFrame;
    const timeout = setTimeout(() => { console.error("Native render smoke timed out"); process.exit(1); }, 15000);
    await new Promise((resolve, reject) => {
        worker.on("error", reject);
        worker.on("message", (message) => {
            try {
                if (message.type === "render-error") throw new Error(message.error);
                if (message.type === "ready") {
                    worker.postMessage({ type: "source", sourceId: "fixture" });
                    assert.equal(command(player, ["loadfile", "av://lavfi:color=c=red:s=320x180:r=30:d=4", "replace", null]), 0);
                }
                if (message.type !== "frame") return;
                const frame = message.frame;
                assert.equal(isNativeVideoFrame(frame), true);
                assert.equal(frame.sourceId, "fixture");
                const offset = (Math.floor(frame.height / 2) * frame.width + Math.floor(frame.width / 2)) * 4;
                assert.ok(frame.pixels[offset] > 180, `red pixel was ${frame.pixels.slice(offset, offset + 4)}`);
                assert.ok(frame.pixels[offset + 1] < 70);
                assert.equal(frame.pixels[offset + 3], 255);
                lastFrame = frame;
                count++;
                if (count === 1) {
                    // No acknowledgement: the producer must retain/drop, not queue.
                    setTimeout(() => {
                        try {
                            assert.equal(count, 1);
                            worker.postMessage({ type: "size", width: 640, height: 360 });
                            worker.postMessage({ type: "ack", frameId: frame.frameId });
                        } catch (error) { reject(error); }
                    }, 250);
                } else if (count === 2) {
                    assert.equal(frame.width, 640);
                    assert.equal(frame.height, 360);
                    assert.equal(option(player, "pause", "yes"), 0);
                    worker.postMessage({ type: "size", width: 720, height: 1280 });
                    worker.postMessage({ type: "ack", frameId: frame.frameId });
                } else {
                    // Non-64-byte stride and letterboxing, while paused.
                    assert.equal(frame.width, 405);
                    assert.equal(frame.height, 720);
                    resolve();
                }
            } catch (error) { reject(error); }
        });
    });
    assert.ok(lastFrame.frameId > 1);
    command(player, ["stop", null]);
    await new Promise((resolve) => {
        worker.once("exit", resolve);
        worker.postMessage({ type: "dispose" });
    });
    destroy(player);
    library.unload();
    clearTimeout(timeout);
    console.log("Native render smoke passed: real decoded RGB, opaque alpha, resize, bounded backpressure, disposal.");
}
