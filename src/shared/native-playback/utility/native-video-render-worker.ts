import { parentPort, workerData } from "node:worker_threads";
import koffi from "koffi";
import { getVideoFrameSize } from "../video-frame";

// This worker shares the utility process address space, NOT Electron's main
// process. Keep render calls off the thread issuing synchronous mpv commands.
if (!parentPort) throw new Error("Video rendering requires a worker thread");
const port = parentPort;
const library = koffi.load(workerData.libraryPath);
const param = koffi.struct("baka_mpv_render_param", { type: "int", data: "void *" });
const params = koffi.pointer(param);
const create = library.func("mpv_render_context_create", "int", [
    koffi.out(koffi.pointer("void *")), "void *", params,
]);
const update = library.func("uint64_t mpv_render_context_update(void *)");
const render = library.func("mpv_render_context_render", "int", ["void *", params]);
const frameInfo = koffi.struct("baka_mpv_render_frame_info", { flags: "uint64_t", targetTime: "int64_t" });
const getInfo = library.func("mpv_render_context_get_info", "int", ["void *", param]);
const free = library.func("void mpv_render_context_free(void *)");
const output: unknown[] = [null];
const code = create(output, BigInt(workerData.playerAddress), [
    { type: 1, data: Buffer.from("sw\0") },
    { type: 0, data: null },
]);
if (code < 0) throw new Error(`libmpv software render initialization failed (${code})`);
const context = output[0];
let size = getVideoFrameSize(workerData.width, workerData.height);
let sourceId = "";
let frameId = 0;
let inFlight = 0;
let dirty = false;
let resized = false;
let hasFrame = false;
let pixels = Buffer.alloc(size.width * size.height * 4);
let closed = false;

port.on("message", (message) => {
    if (message.type === "ack" && message.frameId === inFlight) inFlight = 0;
    if (message.type === "source") {
        sourceId = message.sourceId;
        hasFrame = false;
        dirty = false;
    }
    if (message.type === "size") {
        const next = getVideoFrameSize(message.width, message.height);
        if (next.width === size.width && next.height === size.height) return;
        size = next;
        pixels = Buffer.alloc(size.width * size.height * 4);
        resized = hasFrame;
    }
    if (message.type === "dispose") dispose();
});

function dispose() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    free(context);
    library.unload();
    port.close();
}

const timer = setInterval(() => {
    try {
        const changed = (BigInt(update(context)) & 1n) !== 0n;
        if (changed || resized) {
            const info = koffi.alloc(frameInfo, 1);
            let present = false;
            try {
                if (getInfo(context, { type: 11, data: info }) >= 0) {
                    present = (BigInt(koffi.decode(info, frameInfo).flags) & 1n) !== 0n;
                }
            } finally {
                koffi.free(info);
            }
            // rgb0's fourth byte is unspecified, not alpha. Fill it before IPC.
            const result = render(context, [
                { type: 17, data: new Int32Array([size.width, size.height]) },
                { type: 18, data: Buffer.from("rgb0\0") },
                { type: 19, data: new BigUint64Array([BigInt(size.width * 4)]) },
                { type: 20, data: pixels },
                { type: 0, data: null },
            ]);
            if (result < 0) throw new Error(`libmpv software render failed (${result})`);
            hasFrame = hasFrame || present;
            dirty = true;
            resized = false;
        }
        // One frame end-to-end in flight. Continue rendering while the window
        // is hidden/slow, retaining only the latest frame (including on pause).
        if (sourceId && hasFrame && dirty && !inFlight) {
            for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
            const copy = Uint8Array.from(pixels);
            inFlight = ++frameId;
            dirty = false;
            port.postMessage({
                type: "frame",
                frame: { sourceId, frameId, ...size, pixels: copy },
            }, [copy.buffer]);
        }
    } catch (error) {
        port.postMessage({ type: "render-error", error: String(error) });
        dispose();
    }
}, 1000 / 30);
port.postMessage({ type: "ready" });
