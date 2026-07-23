import {
    app,
    ipcMain,
    utilityProcess,
    UtilityProcess,
} from "electron";
import path from "path";
import type { IDownloadPostprocessPayload } from "@/common/download-postprocess";
import { supportLocalMediaType } from "@/common/constant";
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
import logger from "@shared/logger/main";

const RUNTIME_TIMEOUT_MS = 60_000;
const MAX_PENDING_REQUESTS = 256;
const MAX_RPC_BYTES = 128 * 1024 * 1024;
const MAX_RUNTIME_WORKING_SET_KB = 512 * 1024;
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

function validatePostprocessPayload(value: unknown) {
    if (value == null) {
        return;
    }
    assertPlainObject(value, "download postprocess payload");
    assertIpcPayload(value, 8 * 1024 * 1024);
    if (value.coverUrl === undefined) {
        return;
    }
    assertString(value.coverUrl, "cover URL", 8 * 1024 * 1024);
    if (/^data:image\/(?:bmp|gif|jpeg|jpg|png|webp);base64,/i.test(value.coverUrl)) {
        return;
    }
    assertUrl(
        value.coverUrl,
        ["https:", "http:"],
        8192,
        { allowCredentials: true },
    );
}

class NodeRuntimeManager {
    private child: UtilityProcess | null = null;
    private spawnPromise: Promise<void> | null = null;
    private pending = new Map<string, PendingRequest>();
    private requestCounter = 0;
    private resourceTimer: NodeJS.Timeout | null = null;
    private watcherState: WatcherState | null = null;
    private windowManager!: IWindowManager;
    private shuttingDown = false;

    setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;
        this.setupIpcHandlers();
        app.on("before-quit", () => this.dispose());
    }

    private setupIpcHandlers() {
        ipcMain.handle("@shared/node-runtime/download-file", async (event, taskId, mediaSource, filePath) => {
            assertIpcSender(event, ["main"]);
            assertString(taskId, "download task id", 512);
            const validatedMediaSource = validateMediaSource(mediaSource);
            const targetPath = assertPathAccess(filePath, { allowMissing: true });
            return this.request("download-file", {
                taskId,
                mediaSource: validatedMediaSource,
                filePath: targetPath,
            });
        });
        ipcMain.handle("@shared/node-runtime/abort-download", async (event, taskId, removePartial) => {
            assertIpcSender(event, ["main"]);
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
            return this.request("watcher-scan", state);
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
        const child = utilityProcess.fork(
            path.resolve(__dirname, "node_runtime_host.js"),
            [],
            {
                serviceName: "BakaMusic Node Runtime",
                execArgv: ["--max-old-space-size=384"],
                env: { ...process.env },
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
            this.sendToMainWindow("@shared/node-runtime/download-state", {
                taskId: message.taskId,
                state: message.state,
            });
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

    private requestRaw(child: UtilityProcess, operation: string, payload: unknown) {
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
            }, RUNTIME_TIMEOUT_MS);
            this.pending.set(requestId, { resolve, reject, timer });
            child.postMessage(message);
        });
    }

    private async request(operation: string, payload: unknown) {
        await this.ensureStarted();
        if (!this.child) {
            throw new Error("Node runtime did not start");
        }
        return this.requestRaw(this.child, operation, payload);
    }

    private dispose() {
        this.shuttingDown = true;
        this.stopResourceMonitor();
        this.rejectPending(new Error("Node runtime disposed"));
        this.child?.kill();
        this.child = null;
    }
}

export default new NodeRuntimeManager();
