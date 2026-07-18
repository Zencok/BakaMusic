import {
    app,
    session,
    utilityProcess,
    UtilityProcess,
} from "electron";
import fs from "fs";
import path from "path";
import logger from "@shared/logger/main";
import { toError } from "@/common/error-util";
import {
    PluginExecutionEnvironment,
    PluginHostCallbackRequest,
    PluginHostCallbackResponse,
    PluginHostDescriptor,
    PluginHostRequest,
    PluginHostResponse,
    PluginMethodName,
} from "../rpc";

const LOAD_TIMEOUT_MS = 10_000;
const INVOKE_TIMEOUT_MS = 30_000;
const MAX_PENDING_REQUESTS = 128;
const MAX_RPC_BYTES = 16 * 1024 * 1024;
const MAX_WORKING_SET_KB = 384 * 1024;
const MAX_HOST_CALLBACK_BYTES = 1024 * 1024;
const hostCallbackOperations = new Set([
    "cookies.get",
    "cookies.set",
    "cookies.flush",
]);

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

interface PluginRegistration {
    code: string;
    environment: PluginExecutionEnvironment;
}

function estimateRpcBytes(value: unknown) {
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
        throw new Error("Plugin RPC payload is not serializable");
    }
}

function resolveStoragePath() {
    const nextPath = path.resolve(
        app.getPath("appData"),
        "bakamusic-plugin-storage/chunk.json",
    );
    const legacyPath = path.resolve(
        app.getPath("appData"),
        "musicfree-plugin-storage/chunk.json",
    );
    return fs.existsSync(nextPath) || !fs.existsSync(legacyPath) ? nextPath : legacyPath;
}

function createPluginHostEnvironment(storagePath: string) {
    const environment: NodeJS.ProcessEnv = {
        BAKAMUSIC_PLUGIN_STORAGE_PATH: storagePath,
    };
    for (const key of [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
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
        // utilityProcess on Windows needs these locations to initialize
        // Winsock, including connections made through a local proxy.
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

function assertRpcRequestId(value: unknown) {
    if (
        typeof value !== "string"
        || value.length > 128
        || !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
        throw new Error("Plugin host request ID is invalid");
    }
}

export default class PluginHostClient {
    private child: UtilityProcess | null = null;
    private spawnPromise: Promise<void> | null = null;
    private pending = new Map<string, PendingRequest>();
    private registrations = new Map<string, PluginRegistration>();
    private requestCounter = 0;
    private resourceTimer: NodeJS.Timeout | null = null;
    private shuttingDown = false;

    private get hostPath() {
        return path.resolve(__dirname, "plugin_host.js");
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
            throw new Error("Plugin host is shutting down");
        }
        const storagePath = resolveStoragePath();
        fs.mkdirSync(path.dirname(storagePath), { recursive: true });
        const child = utilityProcess.fork(this.hostPath, [], {
            serviceName: "BakaMusic Plugin Host",
            execArgv: ["--max-old-space-size=256"],
            cwd: path.dirname(storagePath),
            env: createPluginHostEnvironment(storagePath),
            session: session.defaultSession,
            stdio: "pipe",
            allowLoadingUnsignedLibraries: false,
            disclaim: process.platform === "darwin",
        });
        this.child = child;
        child.on("message", (message) => {
            void this.handleMessage(
                child,
                message as PluginHostResponse | PluginHostCallbackRequest,
            ).catch((error) => {
                logger.logError("Plugin host sent an invalid RPC message", toError(error));
                if (this.child === child) {
                    child.kill();
                }
            });
        });
        child.on("exit", (code) => {
            if (this.child !== child) {
                return;
            }
            this.child = null;
            this.stopResourceMonitor();
            this.rejectAll(new Error(`Plugin host exited with code ${code}`));
        });
        child.on("error", (_type, location) => {
            logger.logError("Plugin host fatal error", new Error(location));
        });
        child.stdout?.on("data", (chunk: Buffer) => {
            logger.logInfo(`[plugin-host] ${chunk.toString("utf8").trim()}`);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            logger.logError("Plugin host stderr", new Error(chunk.toString("utf8").trim()));
        });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Plugin host spawn timed out")), LOAD_TIMEOUT_MS);
            child.once("spawn", () => {
                clearTimeout(timer);
                resolve();
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                reject(new Error(`Plugin host exited during startup (${code})`));
            });
        });
        this.startResourceMonitor(child);

        for (const [hash, registration] of this.registrations) {
            await this.requestRaw<PluginHostDescriptor>(child, "load", {
                hash,
                code: registration.code,
                environment: registration.environment,
            }, LOAD_TIMEOUT_MS);
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
                    "Plugin host memory limit exceeded",
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

    private async handleMessage(
        child: UtilityProcess,
        message: PluginHostResponse | PluginHostCallbackRequest,
    ) {
        if (this.child !== child || !message || typeof message !== "object") {
            return;
        }
        if (message.type === "host-request") {
            assertRpcRequestId(message.requestId);
            if (
                !hostCallbackOperations.has(message.operation)
                || estimateRpcBytes(message) > MAX_HOST_CALLBACK_BYTES
            ) {
                throw new Error("Plugin host callback is invalid");
            }
            const response: PluginHostCallbackResponse = {
                type: "host-response",
                requestId: message.requestId,
            };
            try {
                response.result = await this.handleHostCallback(message);
            } catch (error) {
                response.error = toError(error).message;
            }
            child.postMessage(response);
            return;
        }
        if (message.type !== "response" || typeof message.requestId !== "string") {
            return;
        }
        assertRpcRequestId(message.requestId);
        const pending = this.pending.get(message.requestId);
        if (!pending) {
            return;
        }
        this.pending.delete(message.requestId);
        clearTimeout(pending.timer);
        if (estimateRpcBytes(message) > MAX_RPC_BYTES) {
            pending.reject(new Error("Plugin RPC response exceeds the limit"));
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

    private async handleHostCallback(request: PluginHostCallbackRequest) {
        const payload = request.payload as {
            url?: unknown;
            cookie?: Record<string, unknown>;
        } | null;
        if (request.operation === "cookies.flush") {
            await session.defaultSession.cookies.flushStore();
            return null;
        }
        if (typeof payload?.url !== "string" || payload.url.length > 8192) {
            throw new Error("Plugin cookie URL is invalid");
        }
        const parsedUrl = new URL(payload.url);
        if (!["https:", "http:"].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
            throw new Error("Plugin cookie URL protocol is invalid");
        }
        if (request.operation === "cookies.get") {
            const cookies = await session.defaultSession.cookies.get({ url: parsedUrl.toString() });
            return Object.fromEntries(cookies.map((cookie) => [cookie.name, cookie]));
        }
        const cookie = payload.cookie;
        if (
            !cookie
            || typeof cookie.name !== "string"
            || !cookie.name
            || cookie.name.length > 256
            || typeof cookie.value !== "string"
            || cookie.value.length > 8192
        ) {
            throw new Error("Plugin cookie is invalid");
        }
        const expirationDate = typeof cookie.expires === "string"
            ? Date.parse(cookie.expires) / 1000
            : typeof cookie.expirationDate === "number"
                ? cookie.expirationDate
                : undefined;
        await session.defaultSession.cookies.set({
            url: parsedUrl.toString(),
            name: cookie.name,
            value: cookie.value,
            path: typeof cookie.path === "string" ? cookie.path.slice(0, 2048) : undefined,
            domain: typeof cookie.domain === "string" ? cookie.domain.slice(0, 512) : undefined,
            secure: cookie.secure === true,
            httpOnly: cookie.httpOnly === true,
            expirationDate: Number.isFinite(expirationDate) ? expirationDate : undefined,
            sameSite: ["unspecified", "no_restriction", "lax", "strict"].includes(String(cookie.sameSite))
                ? cookie.sameSite as Electron.CookiesSetDetails["sameSite"]
                : undefined,
        });
        return true;
    }

    private requestRaw<T>(
        child: UtilityProcess,
        operation: PluginHostRequest["operation"],
        payload: unknown,
        timeoutMs: number,
    ) {
        if (this.pending.size >= MAX_PENDING_REQUESTS) {
            throw new Error("Plugin RPC concurrency limit reached");
        }
        const requestId = `plugin-${++this.requestCounter}`;
        const message: PluginHostRequest = {
            type: "request",
            requestId,
            operation,
            payload,
        };
        if (estimateRpcBytes(message) > MAX_RPC_BYTES) {
            throw new Error("Plugin RPC request exceeds the limit");
        }
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`Plugin RPC timed out: ${operation}`));
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

    async loadPlugin(
        hash: string,
        code: string,
        environment: PluginExecutionEnvironment,
    ) {
        await this.ensureStarted();
        const child = this.child;
        if (!child) {
            throw new Error("Plugin host did not start");
        }
        const descriptor = await this.requestRaw<PluginHostDescriptor>(child, "load", {
            hash,
            code,
            environment,
        }, LOAD_TIMEOUT_MS);
        this.registrations.set(hash, { code, environment });
        return descriptor;
    }

    async invokePlugin(
        hash: string,
        method: PluginMethodName,
        args: unknown[],
        environment: PluginExecutionEnvironment,
    ) {
        await this.ensureStarted();
        const child = this.child;
        if (!child) {
            throw new Error("Plugin host did not start");
        }
        return this.requestRaw<unknown>(child, "invoke", {
            hash,
            method,
            args,
            environment,
        }, INVOKE_TIMEOUT_MS);
    }

    async unloadPlugin(hash: string) {
        this.registrations.delete(hash);
        if (!this.child?.pid) {
            return;
        }
        await this.requestRaw(this.child, "unload", { hash }, LOAD_TIMEOUT_MS);
    }

    async clearPlugins() {
        this.registrations.clear();
        if (!this.child?.pid) {
            return;
        }
        await this.requestRaw(this.child, "clear", null, LOAD_TIMEOUT_MS);
    }

    dispose() {
        this.shuttingDown = true;
        this.stopResourceMonitor();
        this.rejectAll(new Error("Plugin host disposed"));
        this.child?.kill();
        this.child = null;
    }
}
