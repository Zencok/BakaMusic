import {
    app,
    type BrowserWindow,
    ipcMain,
    net,
    utilityProcess,
    UtilityProcess,
} from "electron";
import { availableParallelism, totalmem } from "os";
import path from "path";
import type {
    DownloadCoverImageMode,
    IDownloadCoverImage,
    IDownloadPostprocessPayload,
} from "@/common/download-postprocess";
import { prepareDownloadCoverImage } from "@/common/download-cover-image";
import {
    IDownloadTranscodeOptions,
    isDownloadMp3Bitrate,
    isDownloadTranscodeMode,
    resolveNativeTranscodeConcurrency,
    resolveNodeRuntimeWorkingSetLimitBytes,
} from "@/common/audio-transcode";
import { getMpvRuntimeDirectory } from "@shared/native-playback/runtime-path";
import { DownloadState, supportLocalMediaType } from "@/common/constant";
import type { IWindowManager } from "@/types/window-manager";
import {
    assertBoolean,
    assertIpcPayload,
    assertIpcSender,
    assertPathAccess,
    assertPlainObject,
    assertString,
    assertUrl,
} from "@shared/ipc-security/main";
import { toError } from "@/common/error-util";
import logger from "@shared/logger/main";
import {
    DOWNLOAD_PROGRESS_UPDATE_INTERVAL_MS,
    LatestDownloadProgressBuffer,
} from "@/common/download-progress";

/** Default RPC timeout for short operations (postprocess, watcher, abort). */
const RUNTIME_TIMEOUT_MS = 60_000;
/** Release native tag/transcode RSS after the last task becomes idle. */
const RUNTIME_IDLE_TIMEOUT_MS = 60_000;
/**
 * Full media downloads stream through a single RPC. 60s kills multi-minute
 * flac/m4a transfers and leaves the UI stuck after a dead runtime.
 */
const DOWNLOAD_FILE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/**
 * 全库扫描要遍历目录树并解析每个新文件的元信息，几千首在 HDD/NAS 上远超 60s。
 * 超时会 kill 掉这个被下载共用的 utility，把所有在途下载一起打断，
 * 而且重试必然再次撞到同一道墙 —— 所以给扫描单独放宽。
 */
const WATCHER_SCAN_TIMEOUT_MS = 30 * 60 * 1000;
/**
 * 转码要把整首歌解码后重新编码，长专辑单曲 + 慢盘远超 60s；
 * utility 内部另有 15 分钟硬超时，这里留出余量避免先被 RPC 层 kill。
 */
const TRANSCODE_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_PENDING_REQUESTS = 256;
const MAX_RPC_BYTES = 128 * 1024 * 1024;
const NATIVE_TRANSCODE_CONCURRENCY = resolveNativeTranscodeConcurrency(
    availableParallelism(),
    totalmem(),
);
const NATIVE_THREAD_POOL_SIZE = Math.max(8, NATIVE_TRANSCODE_CONCURRENCY + 4);
const MAX_RUNTIME_WORKING_SET_KB = Math.floor(
    resolveNodeRuntimeWorkingSetLimitBytes(
        NATIVE_TRANSCODE_CONCURRENCY,
        totalmem(),
    ) / 1024,
);
const MAX_MEDIA_HEADERS = 64;
const MAX_EMBEDDED_LYRIC_BYTES = 16 * 1024 * 1024;
const forbiddenMediaHeaders = new Set([
    "connection",
    "content-length",
    "host",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

interface WatcherState {
    initPaths: string[];
    knownPaths: string[];
}

interface DownloadStatePayload {
    taskId: string;
    state: unknown;
}

function payloadBytes(value: unknown): number | null {
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined
            ? null
            : Buffer.byteLength(serialized, "utf8");
    } catch {
        return null;
    }
}

function validateMediaSource(value: unknown): IMusic.IMusicSource {
    assertPlainObject(value, "media source");
    assertIpcPayload(value, 128 * 1024);
    const sourceUrl = assertUrl(
        value.url,
        ["https:", "http:"],
        8192,
        { allowCredentials: true },
    ).toString();
    let headers: Record<string, string> | undefined;
    if (value.headers !== undefined) {
        assertPlainObject(value.headers, "media source headers");
        const entries = Object.entries(value.headers);
        if (entries.length > MAX_MEDIA_HEADERS) {
            throw new Error("Media source has too many headers");
        }
        headers = Object.fromEntries(entries.map(([rawName, rawValue]) => {
            const name = rawName.toLocaleLowerCase("en-US");
            if (
                !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/.test(rawName)
                || forbiddenMediaHeaders.has(name)
                || name.startsWith("proxy-")
                || name.startsWith("sec-")
                || typeof rawValue !== "string"
                || rawValue.length > 8192
                || /[\r\n]/.test(rawValue)
            ) {
                throw new Error("Media source header is not accepted");
            }
            return [rawName, rawValue];
        }));
    }
    let userAgent: string | undefined;
    if (value.userAgent !== undefined) {
        assertString(value.userAgent, "media source user agent", 8192);
        if (/[\r\n]/.test(value.userAgent)) {
            throw new Error("Media source user agent is not accepted");
        }
        userAgent = value.userAgent;
    }
    return { url: sourceUrl, headers, userAgent };
}

const MAX_COVER_BYTES = 8 * 1024 * 1024;

function validatePostprocessPayload(value: unknown) {
    if (value == null) {
        return;
    }
    assertPlainObject(value, "download postprocess payload");
    assertIpcPayload(value, 16 * 1024 * 1024);
    if (value.coverUrl !== undefined && value.coverUrl !== null) {
        assertString(value.coverUrl, "cover URL", 8192);
        if (!/^data:image\//i.test(value.coverUrl)) {
            assertUrl(
                value.coverUrl,
                ["https:", "http:"],
                8192,
                { allowCredentials: true },
            );
        }
    }
    if (value.coverImage !== undefined && value.coverImage !== null) {
        assertPlainObject(value.coverImage, "cover image");
        assertString(value.coverImage.dataBase64, "cover image data", MAX_COVER_BYTES * 2);
        assertString(value.coverImage.mimeType, "cover image mime", 128);
    }
    if (value.lyricContent !== undefined && value.lyricContent !== null) {
        // An empty string means that the plugin has no lyric for this track.
        // The utility postprocessor already skips empty lyric tags/sidecars, so
        // keep validating the type and size without turning a valid download
        // into an IPC error.
        assertString(value.lyricContent, "lyric content", 8 * 1024 * 1024, true);
    }
}

function sniffImageMime(bytes: Buffer): string | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return "image/png";
    }
    if (
        bytes.length >= 12
        && bytes.subarray(0, 4).toString("ascii") === "RIFF"
        && bytes.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
        return "image/webp";
    }
    return null;
}

function validateDownloadCoverImageMode(value: unknown): DownloadCoverImageMode {
    if (value === "compatible-jpeg" || value === "original") {
        return value;
    }
    throw new Error("cover image mode is outside its enum");
}

function validateTranscodeOptions(value: unknown): IDownloadTranscodeOptions {
    assertPlainObject(value, "transcode options");
    assertIpcPayload(value, 4 * 1024);
    if (!isDownloadTranscodeMode(value.mode)) {
        throw new Error("transcode mode is outside its enum");
    }
    if (!isDownloadMp3Bitrate(value.mp3Bitrate)) {
        throw new Error("transcode mp3 bitrate is outside its enum");
    }
    assertBoolean(value.deleteSource, "transcode deleteSource");
    return {
        mode: value.mode,
        mp3Bitrate: value.mp3Bitrate,
        deleteSource: value.deleteSource,
    };
}

/** Plain Chromium fetch — no custom host/UA/Referer patching. */
async function fetchCoverImageInMain(
    coverUrl: string,
    mode: DownloadCoverImageMode,
): Promise<IDownloadCoverImage> {
    assertUrl(coverUrl, ["https:", "http:"], 8192, { allowCredentials: true });
    const response = await net.fetch(coverUrl, { redirect: "follow" });
    if (!response.ok) {
        throw new Error(`cover HTTP ${response.status}`);
    }
    const buffer = await readResponseBufferLimited(response, MAX_COVER_BYTES);
    if (!buffer.length) {
        throw new Error("cover body empty");
    }
    if (buffer.length > MAX_COVER_BYTES) {
        throw new Error(`cover too large: ${buffer.length}`);
    }
    const mimeType = sniffImageMime(buffer)
        ?? response.headers.get("content-type")?.split(";")[0]?.trim()
        ?? "application/octet-stream";
    if (!mimeType.startsWith("image/")) {
        throw new Error(`cover is not an image (${mimeType})`);
    }

    try {
        const prepared = await prepareDownloadCoverImage(buffer, mimeType, mode);
        return {
            dataBase64: prepared.data.toString("base64"),
            mimeType: prepared.mimeType,
        };
    } catch (error) {
        logger.logError("封面兼容转换失败，保留原始封面", toError(error));
    }

    return {
        dataBase64: buffer.toString("base64"),
        mimeType,
    };
}

async function readResponseBufferLimited(response: Response, maximumBytes: number) {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`cover too large: ${declaredLength}`);
    }
    if (!response.body) {
        throw new Error("cover body empty");
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            receivedBytes += value.byteLength;
            if (receivedBytes > maximumBytes) {
                await reader.cancel().catch(() => undefined);
                throw new Error(`cover too large: >${maximumBytes}`);
            }
            chunks.push(Buffer.from(value));
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, receivedBytes);
}

class NodeRuntimeManager {
    private child: UtilityProcess | null = null;
    private spawnPromise: Promise<void> | null = null;
    private pending = new Map<string, PendingRequest>();
    private requestCounter = 0;
    private resourceTimer: NodeJS.Timeout | null = null;
    private idleTimer: NodeJS.Timeout | null = null;
    private watcherState: WatcherState | null = null;
    private windowManager!: IWindowManager;
    private shuttingDown = false;
    /**
     * Chromium may throttle a minimized renderer. Keep only the newest
     * non-terminal sample per task in main instead of filling Electron's IPC
     * queue with progress frames that are already obsolete when the user
     * restores the window.
     */
    private pendingDownloadStates =
        new LatestDownloadProgressBuffer<DownloadStatePayload>();
    private downloadStateFlushTimer: NodeJS.Timeout | null = null;
    private observedMainWindows = new WeakSet<BrowserWindow>();

    setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;
        if (windowManager.mainWindow) {
            this.observeMainWindow(windowManager.mainWindow);
        }
        windowManager.on("WindowCreated", ({ windowName, browserWindow }) => {
            if (windowName === "main") {
                this.observeMainWindow(browserWindow);
            }
        });
        this.setupIpcHandlers();
        app.on("before-quit", () => this.dispose());
    }

    private setupIpcHandlers() {
        ipcMain.handle("@shared/node-runtime/warm-up", async (event) => {
            assertIpcSender(event, ["main"]);
            await this.ensureStarted();
            return true;
        });
        // Cover fetch runs in main (Chromium net), not utility undici.
        ipcMain.handle("@shared/node-runtime/fetch-cover-image", async (
            event,
            coverUrl,
            coverImageMode,
        ) => {
            assertIpcSender(event, ["main"]);
            assertString(coverUrl, "cover URL", 8192);
            return fetchCoverImageInMain(
                coverUrl,
                validateDownloadCoverImageMode(coverImageMode),
            );
        });
        ipcMain.handle("@shared/node-runtime/download-file", async (event, taskId, mediaSource, filePath) => {
            assertIpcSender(event, ["main", "mv"]);
            assertString(taskId, "download task id", 512);
            const validatedMediaSource = validateMediaSource(mediaSource);
            const targetPath = assertPathAccess(filePath, { allowMissing: true });
            return this.request("download-file", {
                taskId,
                mediaSource: validatedMediaSource,
                filePath: targetPath,
            }, DOWNLOAD_FILE_TIMEOUT_MS);
        });
        ipcMain.handle("@shared/node-runtime/probe-media-size", async (event, mediaSource) => {
            assertIpcSender(event, ["main", "mv"]);
            return this.request("probe-media-size", {
                mediaSource: validateMediaSource(mediaSource),
            });
        });
        ipcMain.handle("@shared/node-runtime/abort-download", async (event, taskId, removePartial) => {
            assertIpcSender(event, ["main", "mv"]);
            assertString(taskId, "download task id", 512);
            if (removePartial !== undefined) {
                assertBoolean(removePartial, "removePartial");
            }
            return this.request("abort-download", { taskId, removePartial });
        });
        ipcMain.handle("@shared/node-runtime/postprocess-download", async (event, filePath, payload) => {
            assertIpcSender(event, ["main"]);
            validatePostprocessPayload(payload);
            const targetPath = assertPathAccess(filePath);
            return this.request("postprocess-download", {
                filePath: targetPath,
                payload: payload as IDownloadPostprocessPayload | null,
            });
        });
        ipcMain.handle("@shared/node-runtime/transcode-download", async (event, filePath, options) => {
            assertIpcSender(event, ["main"]);
            const targetPath = assertPathAccess(filePath);
            return this.request(
                "transcode-download",
                {
                    filePath: targetPath,
                    options: validateTranscodeOptions(options),
                },
                TRANSCODE_TIMEOUT_MS,
            );
        });
        ipcMain.handle("@shared/node-runtime/overwrite-embedded-lyric", async (
            event,
            filePath,
            lyricContent,
        ) => {
            assertIpcSender(event, ["main"]);
            assertString(
                lyricContent,
                "embedded lyric content",
                MAX_EMBEDDED_LYRIC_BYTES,
            );
            assertIpcPayload({ lyricContent }, MAX_EMBEDDED_LYRIC_BYTES);
            const targetPath = assertPathAccess(filePath, {
                extensions: supportLocalMediaType,
            });
            return this.request("overwrite-embedded-lyric", {
                filePath: targetPath,
                lyricContent,
            });
        });
        ipcMain.handle("@shared/node-runtime/watcher-setup", async (event, initPaths, knownPaths) => {
            assertIpcSender(event, ["main"]);
            const state = this.validateWatcherState(initPaths, knownPaths);
            await this.request("watcher-setup", state);
            this.watcherState = state;
        });
        ipcMain.handle("@shared/node-runtime/watcher-close", async (event) => {
            assertIpcSender(event, ["main"]);
            this.watcherState = null;
            return this.request("watcher-close", null);
        });
        ipcMain.handle("@shared/node-runtime/watcher-change", async (event, addPaths, removePaths) => {
            assertIpcSender(event, ["main"]);
            const additions = this.validatePathList(addPaths, 128, false);
            const removals = this.validatePathList(removePaths, 128, true);
            await this.request("watcher-change", {
                addPaths: additions,
                removePaths: removals,
            });
            if (this.watcherState) {
                const removed = new Set(removals.map((value) => path.resolve(value)));
                this.watcherState.initPaths = [
                    ...this.watcherState.initPaths.filter((value) => !removed.has(path.resolve(value))),
                    ...additions,
                ];
            }
        });
        ipcMain.handle("@shared/node-runtime/watcher-scan", async (event, initPaths, knownPaths) => {
            assertIpcSender(event, ["main"]);
            const state = this.validateWatcherState(initPaths, knownPaths);
            return this.request("watcher-scan", state, WATCHER_SCAN_TIMEOUT_MS);
        });
    }

    private validatePathList(value: unknown, maximum: number, allowMissing: boolean) {
        if (!Array.isArray(value) || value.length > maximum) {
            throw new Error("Path list exceeds the accepted length");
        }
        return value.map((filePath) => assertPathAccess(filePath, { allowMissing }));
    }

    private validateWatcherState(initPaths: unknown, knownPaths: unknown): WatcherState {
        assertIpcPayload({ initPaths, knownPaths }, 64 * 1024 * 1024);
        return {
            initPaths: this.validatePathList(initPaths, 128, false),
            knownPaths: this.validatePathList(knownPaths, 100_000, true),
        };
    }

    private async ensureStarted() {
        if (this.child?.pid) {
            return;
        }
        if (this.spawnPromise) {
            return this.spawnPromise;
        }
        this.spawnPromise = this.spawn();
        try {
            await this.spawnPromise;
        } finally {
            this.spawnPromise = null;
        }
    }

    private async spawn() {
        if (this.shuttingDown) {
            throw new Error("Node runtime is shutting down");
        }
        // The bundled libmpv doubles as the download transcoder. Exporting its
        // directory here keeps the utility from having to resolve app paths.
        const mpvRuntimeDirectory = getMpvRuntimeDirectory();
        const child = utilityProcess.fork(
            path.resolve(__dirname, "node_runtime_host.js"),
            [],
            {
                serviceName: "BakaMusic Node Runtime",
                execArgv: ["--max-old-space-size=384"],
                env: {
                    ...process.env,
                    BAKAMUSIC_MPV_DIR: mpvRuntimeDirectory,
                    // N-API AsyncWorker uses libuv. Reserve four lanes for
                    // downloads, fs metadata and watcher work while every
                    // native encoder has a dedicated lane.
                    UV_THREADPOOL_SIZE: `${NATIVE_THREAD_POOL_SIZE}`,
                    PATH: `${mpvRuntimeDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
                },
                stdio: "pipe",
            },
        );
        this.child = child;
        child.on("message", (message) => this.handleMessage(child, message));
        child.on("exit", (code) => {
            if (this.child !== child) {
                return;
            }
            this.child = null;
            this.stopIdleShutdown();
            this.stopResourceMonitor();
            this.rejectPending(new Error(`Node runtime exited with code ${code}`));
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            logger.logError("Node runtime stderr", new Error(chunk.toString("utf8").trim()));
        });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Node runtime spawn timed out")), 10_000);
            child.once("spawn", () => {
                clearTimeout(timer);
                resolve();
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                reject(new Error(`Node runtime exited during startup (${code})`));
            });
        });
        this.startResourceMonitor(child);
        if (this.watcherState) {
            await this.requestRaw(child, "watcher-setup", this.watcherState);
        }
        this.scheduleIdleShutdown(child);
    }

    private startResourceMonitor(child: UtilityProcess) {
        this.stopResourceMonitor();
        this.resourceTimer = setInterval(() => {
            if (!child.pid || this.child !== child) {
                return;
            }
            const metric = app.getAppMetrics().find((item) => item.pid === child.pid);
            if (metric && metric.memory.workingSetSize > MAX_RUNTIME_WORKING_SET_KB) {
                logger.logError(
                    "Node runtime memory limit exceeded",
                    new Error(`${metric.memory.workingSetSize} KiB`),
                );
                child.kill();
            }
        }, 5000);
        this.resourceTimer.unref();
    }

    private stopResourceMonitor() {
        if (this.resourceTimer) {
            clearInterval(this.resourceTimer);
            this.resourceTimer = null;
        }
    }

    private handleMessage(child: UtilityProcess, message: any) {
        if (this.child !== child || !message || typeof message !== "object") {
            return;
        }
        if (message.type === "download-state") {
            this.handleDownloadState(message.taskId, message.state);
            return;
        }
        if (message.type === "watcher-add") {
            this.sendToMainWindow("@shared/node-runtime/watcher-add", message.musicItems);
            return;
        }
        if (message.type === "watcher-remove") {
            this.sendToMainWindow("@shared/node-runtime/watcher-remove", message.filePaths);
            return;
        }
        if (message.type !== "response" || typeof message.requestId !== "string") {
            return;
        }
        const pending = this.pending.get(message.requestId);
        if (!pending) {
            return;
        }
        this.pending.delete(message.requestId);
        clearTimeout(pending.timer);
        const responseBytes = payloadBytes(message);
        if (responseBytes === null) {
            pending.reject(new Error("Node runtime response is not serializable"));
        } else if (responseBytes > MAX_RPC_BYTES) {
            pending.reject(new Error("Node runtime response exceeds the limit"));
        } else if (message.error) {
            const error = new Error(String(message.error.message ?? "Node runtime error"));
            error.name = String(message.error.name ?? "Error");
            error.stack = typeof message.error.stack === "string" ? message.error.stack : undefined;
            pending.reject(error);
        } else {
            pending.resolve(message.result);
        }
        this.scheduleIdleShutdown(child);
    }

    private scheduleIdleShutdown(child: UtilityProcess) {
        this.stopIdleShutdown();
        if (this.child !== child || this.pending.size || this.watcherState) {
            return;
        }
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (
                this.child === child
                && !this.pending.size
                && !this.watcherState
            ) {
                child.kill();
            }
        }, RUNTIME_IDLE_TIMEOUT_MS);
        this.idleTimer.unref();
    }

    private stopIdleShutdown() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private observeMainWindow(mainWindow: BrowserWindow) {
        if (this.observedMainWindows.has(mainWindow)) {
            return;
        }
        this.observedMainWindows.add(mainWindow);
        const flush = () => this.flushDownloadStates();
        mainWindow.on("show", flush);
        mainWindow.on("restore", flush);
        mainWindow.on("focus", flush);
    }

    private isMainWindowForeground() {
        const mainWindow = this.windowManager.mainWindow;
        return Boolean(
            mainWindow
            && !mainWindow.isDestroyed()
            && mainWindow.isVisible()
            && !mainWindow.isMinimized()
            && mainWindow.isFocused(),
        );
    }

    private handleDownloadState(taskId: unknown, state: unknown) {
        if (typeof taskId !== "string" || !taskId || taskId.length > 512) {
            return;
        }

        const payload = { taskId, state };
        const stateName = state && typeof state === "object"
            ? (state as { state?: unknown }).state
            : undefined;
        if (stateName === DownloadState.DONE || stateName === DownloadState.ERROR) {
            // Terminal states drive renderer-side finalization and queue release,
            // so they must never wait for the window to become foreground.
            this.pendingDownloadStates.delete(taskId);
            this.sendToMainWindow("@shared/node-runtime/download-state", payload);
            return;
        }

        this.pendingDownloadStates.upsert(payload);
        this.scheduleDownloadStateFlush();
    }

    private scheduleDownloadStateFlush() {
        if (this.downloadStateFlushTimer || !this.isMainWindowForeground()) {
            return;
        }
        this.downloadStateFlushTimer = setTimeout(() => {
            this.downloadStateFlushTimer = null;
            this.flushDownloadStates();
        }, DOWNLOAD_PROGRESS_UPDATE_INTERVAL_MS);
        this.downloadStateFlushTimer.unref();
    }

    private flushDownloadStates() {
        if (!this.isMainWindowForeground() || !this.pendingDownloadStates.size) {
            return;
        }
        if (this.downloadStateFlushTimer) {
            clearTimeout(this.downloadStateFlushTimer);
            this.downloadStateFlushTimer = null;
        }
        const batch = this.pendingDownloadStates.drain();
        this.sendToMainWindow("@shared/node-runtime/download-state-batch", batch);
    }

    private sendToMainWindow(channel: string, payload: unknown) {
        const mainWindow = this.windowManager.mainWindow;
        const bytes = payloadBytes(payload);
        if (
            mainWindow
            && !mainWindow.isDestroyed()
            && bytes !== null
            && bytes <= MAX_RPC_BYTES
        ) {
            mainWindow.webContents.send(channel, payload);
        }
    }

    private rejectPending(error: Error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }

    private requestRaw(
        child: UtilityProcess,
        operation: string,
        payload: unknown,
        timeoutMs: number = RUNTIME_TIMEOUT_MS,
    ) {
        this.stopIdleShutdown();
        if (this.pending.size >= MAX_PENDING_REQUESTS) {
            throw new Error("Node runtime concurrency limit reached");
        }
        const requestId = `node-${++this.requestCounter}`;
        const message = { type: "request", requestId, operation, payload };
        const requestBytes = payloadBytes(message);
        if (requestBytes === null) {
            throw new Error("Node runtime request is not serializable");
        }
        if (requestBytes > MAX_RPC_BYTES) {
            throw new Error("Node runtime request exceeds the limit");
        }
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`Node runtime request timed out: ${operation}`));
                if (this.child === child) {
                    child.kill();
                }
            }, timeoutMs);
            this.pending.set(requestId, { resolve, reject, timer });
            child.postMessage(message);
        });
    }

    private async request(
        operation: string,
        payload: unknown,
        timeoutMs: number = RUNTIME_TIMEOUT_MS,
    ) {
        await this.ensureStarted();
        if (!this.child) {
            throw new Error("Node runtime did not start");
        }
        return this.requestRaw(this.child, operation, payload, timeoutMs);
    }

    private dispose() {
        this.shuttingDown = true;
        if (this.downloadStateFlushTimer) {
            clearTimeout(this.downloadStateFlushTimer);
            this.downloadStateFlushTimer = null;
        }
        this.pendingDownloadStates.clear();
        this.stopIdleShutdown();
        this.stopResourceMonitor();
        this.rejectPending(new Error("Node runtime disposed"));
        this.child?.kill();
        this.child = null;
    }
}

export default new NodeRuntimeManager();
