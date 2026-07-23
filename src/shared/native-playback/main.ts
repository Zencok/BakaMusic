import {
    app,
    ipcMain,
    utilityProcess,
    UtilityProcess,
} from "electron";
import fs from "fs";
import path from "path";
import { supportLocalMediaType } from "@/common/constant";
import type { IWindowManager } from "@/types/window-manager";
import {
    assertBoolean,
    assertFiniteNumber,
    assertIpcPayload,
    assertIpcSender,
    assertPathAccess,
    assertPlainObject,
    assertString,
    assertUrl,
} from "@shared/ipc-security/main";
import { parseLocalMediaUrl } from "@shared/local-media/common";
import logger from "@shared/logger/main";
import ServiceManager from "@shared/service-manager/main";
import {
    getMpvRuntimeDirectory,
    hasNativePlaybackRuntime,
} from "./runtime-path";
import {
    INativePlaybackCapabilities,
    INativePlaybackSnapshot,
    NativePlaybackRuntimeCommand,
} from "./common";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PENDING_REQUESTS = 32;
const MAX_RPC_BYTES = 512 * 1024;
const MAX_RUNTIME_WORKING_SET_KB = 2 * 1024 * 1024;
const MAX_MEDIA_HEADERS = 64;
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

function createPlaybackEnvironment(): NodeJS.ProcessEnv {
    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
    const localNoProxy = [noProxy, "127.0.0.1", "localhost"]
        .filter(Boolean)
        .join(",");
    return {
        ...process.env,
        NO_PROXY: localNoProxy,
        no_proxy: localNoProxy,
    };
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

function payloadBytes(value: unknown) {
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? null : Buffer.byteLength(serialized, "utf8");
    } catch {
        return null;
    }
}

function validateSourceId(value: unknown) {
    assertString(value, "native playback source id", 128);
    if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
        throw new Error("Native playback source id is invalid");
    }
    return value;
}

function resolveNativeSource(value: unknown) {
    assertString(value, "native playback URL", 32_768);
    const managedMediaUrl = ServiceManager.resolveManagedMediaProxyUrl(value);
    if (managedMediaUrl) {
        return {
            sourceType: "location" as const,
            value: managedMediaUrl,
        };
    }
    if (value.startsWith("http:") || value.startsWith("https:")) {
        return {
            sourceType: "location" as const,
            value: assertUrl(
                value,
                ["https:", "http:"],
                32_768,
                { allowCredentials: true },
            ).toString(),
        };
    }
    const requestedPath = parseLocalMediaUrl(value);
    const grantedPath = assertPathAccess(requestedPath, {
        extensions: supportLocalMediaType,
    });
    const realPath = fs.realpathSync.native(grantedPath);
    assertPathAccess(realPath, { extensions: supportLocalMediaType });
    if (!fs.statSync(realPath).isFile()) {
        throw new Error("Native playback source is not a file");
    }
    return {
        sourceType: "path" as const,
        value: realPath,
    };
}

function validateHeaders(value: unknown) {
    if (value === undefined) {
        return undefined;
    }
    assertPlainObject(value, "native playback headers");
    const entries = Object.entries(value);
    if (entries.length > MAX_MEDIA_HEADERS) {
        throw new Error("Native playback has too many headers");
    }
    return Object.fromEntries(entries.map(([rawName, rawValue]) => {
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
            throw new Error("Native playback header is not accepted");
        }
        return [rawName, rawValue];
    })) as Record<string, string>;
}

function validateCommand(value: unknown): NativePlaybackRuntimeCommand {
    assertPlainObject(value, "native playback command");
    assertIpcPayload(value, 64 * 1024);
    assertString(value.operation, "native playback operation", 32);
    const sourceId = validateSourceId(value.sourceId);
    switch (value.operation) {
        case "load": {
            const source = resolveNativeSource(value.url);
            return {
                operation: "load",
                sourceId,
                url: source.value,
                sourceType: source.sourceType,
                ...(value.headers !== undefined
                    ? { headers: validateHeaders(value.headers) }
                    : {}),
            };
        }
        case "play":
        case "pause":
        case "stop":
            return { operation: value.operation, sourceId };
        case "seek":
            assertFiniteNumber(value.seconds, "native playback seek time", 0, 7 * 24 * 3600);
            return { operation: "seek", sourceId, seconds: value.seconds };
        case "volume":
            assertFiniteNumber(value.volume, "native playback volume", 0, 1);
            return { operation: "volume", sourceId, volume: value.volume };
        case "speed":
            assertFiniteNumber(value.speed, "native playback speed", 0.25, 4);
            return { operation: "speed", sourceId, speed: value.speed };
        case "pitch":
            assertFiniteNumber(value.semitones, "native playback pitch", -12, 12);
            return { operation: "pitch", sourceId, semitones: value.semitones };
        case "loop":
            assertBoolean(value.enabled, "native playback loop state");
            return { operation: "loop", sourceId, enabled: value.enabled };
        case "output-device":
            assertString(value.deviceId, "native playback output device", 512, true);
            return { operation: "output-device", sourceId, deviceId: value.deviceId };
        default:
            throw new Error("Native playback operation is not supported");
    }
}

class NativePlaybackManager {
    private child: UtilityProcess | null = null;
    private spawnPromise: Promise<void> | null = null;
    private pending = new Map<string, PendingRequest>();
    private requestCounter = 0;
    private resourceTimer: NodeJS.Timeout | null = null;
    private windowManager!: IWindowManager;
    private shuttingDown = false;

    setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;
        ipcMain.handle("@shared/native-playback/capabilities", (event) => {
            assertIpcSender(event, ["main"]);
            return this.getCapabilities();
        });
        ipcMain.handle("@shared/native-playback/command", async (event, command) => {
            assertIpcSender(event, ["main"]);
            return this.request("command", validateCommand(command));
        });
        app.on("before-quit", () => this.dispose());
    }

    private async getCapabilities(): Promise<INativePlaybackCapabilities> {
        if (!hasNativePlaybackRuntime()) {
            return { available: false, engine: "libmpv" };
        }
        return this.request("capabilities", null) as Promise<INativePlaybackCapabilities>;
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
        if (this.shuttingDown || !hasNativePlaybackRuntime()) {
            throw new Error("libmpv with LibreMPEG runtime is not installed");
        }
        const runtimeDirectory = getMpvRuntimeDirectory();
        const child = utilityProcess.fork(
            path.resolve(__dirname, "native_playback_host.js"),
            [],
            {
                serviceName: "BakaMusic libmpv Playback",
                execArgv: ["--max-old-space-size=256"],
                env: {
                    ...createPlaybackEnvironment(),
                    BAKAMUSIC_MPV_DIR: runtimeDirectory,
                    PATH: `${runtimeDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
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
            this.stopResourceMonitor();
            this.rejectPending(new Error(`libmpv playback runtime exited with code ${code}`));
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8").trim();
            if (text) {
                logger.logInfo("libmpv playback runtime", text);
            }
        });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("libmpv playback runtime startup timed out")),
                10_000,
            );
            child.once("spawn", () => {
                clearTimeout(timer);
                resolve();
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                reject(new Error(`libmpv playback runtime exited during startup (${code})`));
            });
        });
        this.startResourceMonitor(child);
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
                    "libmpv playback runtime memory limit exceeded",
                    new Error(`${metric.memory.workingSetSize} KiB`),
                );
                child.kill();
            }
        }, 5_000);
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
        if (message.type === "snapshot") {
            const bytes = payloadBytes(message.snapshot);
            if (bytes !== null && bytes <= MAX_RPC_BYTES) {
                this.sendSnapshot(message.snapshot as INativePlaybackSnapshot);
            }
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
        const bytes = payloadBytes(message);
        if (bytes === null || bytes > MAX_RPC_BYTES) {
            pending.reject(new Error("libmpv playback runtime response is invalid"));
        } else if (message.error) {
            const error = new Error(String(message.error.message ?? "libmpv runtime error"));
            error.name = String(message.error.name ?? "Error");
            error.stack = typeof message.error.stack === "string" ? message.error.stack : undefined;
            pending.reject(error);
        } else {
            pending.resolve(message.result);
        }
    }

    private sendSnapshot(snapshot: INativePlaybackSnapshot) {
        const mainWindow = this.windowManager.mainWindow;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("@shared/native-playback/snapshot", snapshot);
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
            throw new Error("libmpv playback concurrency limit reached");
        }
        const requestId = `mpv-${++this.requestCounter}`;
        const message = { type: "request", requestId, operation, payload };
        const bytes = payloadBytes(message);
        if (bytes === null || bytes > MAX_RPC_BYTES) {
            throw new Error("libmpv playback request is invalid");
        }
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`libmpv playback request timed out: ${operation}`));
                if (this.child === child) {
                    child.kill();
                }
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(requestId, { resolve, reject, timer });
            child.postMessage(message);
        });
    }

    private async request(operation: string, payload: unknown) {
        await this.ensureStarted();
        if (!this.child) {
            throw new Error("libmpv playback runtime did not start");
        }
        return this.requestRaw(this.child, operation, payload);
    }

    private dispose() {
        this.shuttingDown = true;
        this.stopResourceMonitor();
        this.rejectPending(new Error("libmpv playback runtime disposed"));
        this.child?.kill();
        this.child = null;
    }
}

export default new NativePlaybackManager();
