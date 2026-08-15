import {
    app,
    session,
    utilityProcess,
    type UtilityProcess,
} from "electron";
import path from "path";
import { toError } from "@/common/error-util";
import logger from "@shared/logger/main";
import type {
    LxPluginHostDescriptor,
    LxPluginHostInvokePayload,
    LxPluginHostLoadPayload,
    LxPluginHostMessage,
    LxPluginHostRequest,
    LxPluginHostUpdateAlert,
} from "../lx-rpc";
import {
    isPluginPlaybackLogEvent,
    type PluginPlaybackLogEvent,
} from "../playback-log";

const LOAD_TIMEOUT_MS = 12_000;
const INVOKE_TIMEOUT_MS = 30_000;
const MAX_PENDING_REQUESTS = 64;
const MAX_RPC_BYTES = 16 * 1024 * 1024;
const MAX_WORKING_SET_KB = 256 * 1024;

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

type LxPluginRegistration = LxPluginHostLoadPayload;

function estimateRpcBytes(value: unknown) {
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
        throw new Error("LX plugin RPC payload is not serializable");
    }
}

function createLxHostEnvironment() {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of [
        "LANG",
        "LC_ALL",
        "LC_MESSAGES",
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_DIR",
        "SSL_CERT_FILE",
        "TEMP",
        "TMP",
        "TMPDIR",
        "TZ",
        "SystemRoot",
        "WINDIR",
    ]) {
        const value = process.env[key];
        if (value !== undefined && value.length <= 32_768) {
            environment[key] = value;
        }
    }
    return environment;
}

export default class LxPluginHostClient {
    private child: UtilityProcess | null = null;
    private spawnPromise: Promise<void> | null = null;
    private pending = new Map<string, PendingRequest>();
    private registrations = new Map<string, LxPluginRegistration>();
    private requestCounter = 0;
    private resourceTimer: NodeJS.Timeout | null = null;
    private shuttingDown = false;

    constructor(
        private readonly onPlaybackLog?: (event: PluginPlaybackLogEvent) => void,
        private readonly onUpdateAlert?: (event: LxPluginHostUpdateAlert) => void,
    ) {}

    private get hostPath() {
        return path.resolve(__dirname, "lx_plugin_host.js");
    }

    private async ensureStarted() {
        if (this.child?.pid) {
            return;
        }
        if (this.spawnPromise) {
            return this.spawnPromise;
        }
        this.spawnPromise = this.spawnAndRestore();
        try {
            await this.spawnPromise;
        } finally {
            this.spawnPromise = null;
        }
    }

    private async spawnAndRestore() {
        if (this.shuttingDown) {
            throw new Error("LX plugin host is shutting down");
        }
        const child = utilityProcess.fork(this.hostPath, [], {
            serviceName: "BakaMusic LX Plugin Host",
            execArgv: ["--max-old-space-size=192"],
            cwd: app.getPath("userData"),
            env: createLxHostEnvironment(),
            session: session.defaultSession,
            stdio: "pipe",
            allowLoadingUnsignedLibraries: false,
            disclaim: process.platform === "darwin",
        });
        this.child = child;
        child.on("message", (message) => {
            this.handleMessage(child, message as LxPluginHostMessage);
        });
        child.on("exit", (code) => {
            if (this.child !== child) {
                return;
            }
            this.child = null;
            this.stopResourceMonitor();
            this.rejectAll(new Error(`LX plugin host exited with code ${code}`));
        });
        child.on("error", (_type, location) => {
            logger.logError("LX plugin host fatal error", new Error(location));
        });
        child.stdout?.on("data", (chunk: Buffer) => {
            logger.logInfo(`[lx-plugin-host] ${chunk.toString("utf8").trim()}`);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            logger.logError("LX plugin host stderr", new Error(chunk.toString("utf8").trim()));
        });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("LX plugin host spawn timed out")),
                LOAD_TIMEOUT_MS,
            );
            child.once("spawn", () => {
                clearTimeout(timer);
                resolve();
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                reject(new Error(`LX plugin host exited during startup (${code})`));
            });
        });
        this.startResourceMonitor(child);

        for (const registration of this.registrations.values()) {
            try {
                await this.requestRaw<LxPluginHostDescriptor>(
                    child,
                    "load",
                    registration,
                    LOAD_TIMEOUT_MS,
                );
            } catch (error) {
                logger.logError("LX plugin host failed to restore a plugin", toError(error), {
                    hash: registration.hash,
                });
                if (this.child !== child || !child.pid) {
                    throw error;
                }
            }
        }
    }

    private startResourceMonitor(child: UtilityProcess) {
        this.stopResourceMonitor();
        this.resourceTimer = setInterval(() => {
            if (!child.pid || this.child !== child) {
                return;
            }
            const metric = app.getAppMetrics().find((item) => item.pid === child.pid);
            if (metric && metric.memory.workingSetSize > MAX_WORKING_SET_KB) {
                logger.logError(
                    "LX plugin host memory limit exceeded",
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

    private rejectAll(error: Error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }

    private handleMessage(child: UtilityProcess, message: LxPluginHostMessage) {
        if (this.child !== child || !message || typeof message !== "object") {
            return;
        }
        if (message.type === "playback-log") {
            if (!isPluginPlaybackLogEvent(message) || estimateRpcBytes(message) > 16 * 1024) {
                logger.logError(
                    "LX plugin host playback log is invalid",
                    new Error("Invalid playback log payload"),
                );
                child.kill();
                return;
            }
            this.onPlaybackLog?.(message);
            return;
        }
        if (message.type === "lx-update-alert") {
            if (
                !/^[a-f0-9]{64}$/.test(message.hash)
                || (message.log !== undefined
                    && (typeof message.log !== "string" || message.log.length > 1024))
                || (message.updateUrl !== undefined
                    && (typeof message.updateUrl !== "string" || message.updateUrl.length > 8192))
                || estimateRpcBytes(message) > 16 * 1024
            ) {
                logger.logError(
                    "LX plugin host update alert is invalid",
                    new Error("Invalid update alert payload"),
                );
                return;
            }
            this.onUpdateAlert?.(message);
            return;
        }
        if (
            message.type !== "response"
            || typeof message.requestId !== "string"
        ) {
            return;
        }
        const pending = this.pending.get(message.requestId);
        if (!pending) {
            return;
        }
        this.pending.delete(message.requestId);
        clearTimeout(pending.timer);
        if (estimateRpcBytes(message) > MAX_RPC_BYTES) {
            pending.reject(new Error("LX plugin RPC response exceeds the limit"));
        } else if (message.error) {
            const error = new Error(String(message.error.message).slice(0, 4096));
            error.name = String(message.error.name).slice(0, 128);
            error.stack = typeof message.error.stack === "string"
                ? message.error.stack.slice(0, 65_536)
                : undefined;
            pending.reject(error);
        } else {
            pending.resolve(message.result);
        }
    }

    private requestRaw<T>(
        child: UtilityProcess,
        operation: LxPluginHostRequest["operation"],
        payload: unknown,
        timeoutMs: number,
    ) {
        if (this.pending.size >= MAX_PENDING_REQUESTS) {
            throw new Error("LX plugin RPC concurrency limit reached");
        }
        const requestId = `lx-plugin-${++this.requestCounter}`;
        const message: LxPluginHostRequest = {
            type: "request",
            requestId,
            operation,
            payload,
        };
        if (estimateRpcBytes(message) > MAX_RPC_BYTES) {
            throw new Error("LX plugin RPC request exceeds the limit");
        }
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`LX plugin RPC timed out: ${operation}`));
                if (this.child === child) {
                    child.kill();
                }
            }, timeoutMs);
            this.pending.set(requestId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timer,
            });
            child.postMessage(message);
        });
    }

    async loadPlugin(payload: LxPluginHostLoadPayload) {
        await this.ensureStarted();
        const child = this.child;
        if (!child) {
            throw new Error("LX plugin host did not start");
        }
        const descriptor = await this.requestRaw<LxPluginHostDescriptor>(
            child,
            "load",
            payload,
            LOAD_TIMEOUT_MS,
        );
        this.registrations.set(payload.hash, payload);
        return descriptor;
    }

    async invokePlugin(payload: LxPluginHostInvokePayload) {
        await this.ensureStarted();
        const child = this.child;
        if (!child) {
            throw new Error("LX plugin host did not start");
        }
        return this.requestRaw<string | null>(child, "invoke", payload, INVOKE_TIMEOUT_MS);
    }

    async unloadPlugin(hash: string) {
        this.registrations.delete(hash);
        if (this.child?.pid) {
            await this.requestRaw(this.child, "unload", { hash }, LOAD_TIMEOUT_MS);
        }
    }

    async clearPlugins() {
        this.registrations.clear();
        if (this.child?.pid) {
            await this.requestRaw(this.child, "clear", null, LOAD_TIMEOUT_MS);
        }
    }

    dispose() {
        this.shuttingDown = true;
        this.stopResourceMonitor();
        this.rejectAll(new Error("LX plugin host disposed"));
        this.child?.kill();
        this.child = null;
    }
}
