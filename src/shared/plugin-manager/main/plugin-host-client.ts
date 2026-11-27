import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import { randomUUID } from "crypto";
import getResourcePath from "@/common/get-resource-path";
import logger from "@shared/logger/main";
import { toError } from "@/common/error-util";
import type {
    NativeRequest, NativeResponse, PluginCapability, PluginExecutionEnvironment, PluginHostDescriptor,
} from "../rpc";
import type { PluginPlaybackLogEvent } from "../playback-log";

const LOAD_TIMEOUT_MS = 10_000;
const IMPORT_TIMEOUT_MS = 20_000;
const INVOKE_TIMEOUT_MS = 30_000;
const CANCEL_GRACE_MS = 250;
const MAX_PENDING_REQUESTS = 128;
const MAX_RPC_BYTES = 16 * 1024 * 1024;
const RUNTIME_NAME = "rust-quickjs-v2";

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    killTimer?: NodeJS.Timeout;
}
interface PluginRegistration {
    pluginId: string;
    code: string;
    settings: Record<string, string>;
    storageRoot: string;
    proxyUrl?: string;
}
export interface PluginImportRequest {
    source: string;
    kind?: "auto" | "v2" | "lx";
    id?: string;
    name?: string;
    locator?: string;
    variables?: Record<string, string>;
    enabled?: boolean;
    proxyUrl?: string;
}
export interface PreparedPluginImport {
    source: string;
    id?: string;
    originalId?: string;
    manifest?: IPlugin.Manifest;
}
export class PluginRuntimeError extends Error {
    constructor(message: string, public readonly code?: string, public readonly rpcCode?: number) {
        super(message);
        this.name = "PluginRuntimeError";
    }
}
export function assertV2Descriptor(value: unknown): asserts value is PluginHostDescriptor {
    const descriptor = value as Partial<PluginHostDescriptor> | null;
    const manifest = descriptor?.manifest;
    if (!descriptor || descriptor.protocolVersion !== 2 || descriptor.runtime !== RUNTIME_NAME
        || !manifest || manifest.apiVersion !== 2 || descriptor.id !== manifest.id
        || typeof manifest.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(manifest.id)
        || !["provider", "resolver"].includes(manifest.kind)
        || typeof manifest.name !== "string" || !manifest.name.trim()
        || !Array.isArray(manifest.capabilities)) {
        throw new PluginRuntimeError("The package is not a valid V2 plugin", "invalid_v2");
    }
}
function nativeEnvironment() {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TZ",
        "NODE_EXTRA_CA_CERTS", "SSL_CERT_DIR", "SSL_CERT_FILE"]) {
        const value = process.env[key];
        if (value !== undefined && value.length <= 32_768) environment[key] = value;
    }
    return environment;
}

/** Transport only: JS execution, storage and network permissions belong to Rust. */
export default class PluginHostClient {
    private child: ChildProcessWithoutNullStreams | null = null;
    private spawnPromise: Promise<void> | null = null;
    private pending = new Map<string, PendingRequest>();
    private registrations = new Map<string, PluginRegistration>();
    private shuttingDown = false;
    private sequence = 0;

    constructor(private readonly onPlaybackLog?: (event: PluginPlaybackLogEvent) => void) {}

    private get hostPath() {
        return getResourcePath(path.join(".service", "plugin-v2", `${process.platform}-${process.arch}`,
            process.platform === "win32" ? "baka-plugin-runtime.exe" : "baka-plugin-runtime"));
    }
    private getChild() {
        if (!this.child || this.child.killed || this.shuttingDown) throw new Error("Plugin runtime is unavailable");
        return this.child;
    }
    private ensureStarted() {
        if (this.shuttingDown) return Promise.reject(new Error("Plugin runtime is shutting down"));
        if (this.spawnPromise) return this.spawnPromise;
        if (this.child && this.child.exitCode === null && !this.child.killed) return Promise.resolve();
        this.spawnPromise = this.spawnAndRestore().finally(() => {
            this.spawnPromise = null;
        });
        return this.spawnPromise;
    }
    private async spawnAndRestore() {
        const child = spawn(this.hostPath, [], {
            shell: false, windowsHide: true, env: nativeEnvironment(), stdio: ["pipe", "pipe", "pipe"],
        });
        this.child = child;
        child.stdin.on("error", (error) => this.failChild(child, error));
        let buffered = Buffer.alloc(0);
        child.stdout.on("data", (chunk: Buffer) => {
            if (this.child !== child) return;
            buffered = Buffer.concat([buffered, chunk]);
            let lineEnd: number;
            while ((lineEnd = buffered.indexOf(10)) >= 0) {
                const line = buffered.subarray(0, lineEnd);
                buffered = buffered.subarray(lineEnd + 1);
                if (line.length > MAX_RPC_BYTES) {
                    this.failChild(child, new Error("Plugin RPC frame exceeds the limit"));
                    return;
                }
                if (!line.length) continue;
                try {
                    this.handleResponse(child, JSON.parse(line.toString("utf8")) as NativeResponse);
                } catch (error) {
                    this.failChild(child, toError(error)); return;
                }
            }
            if (buffered.length > MAX_RPC_BYTES) this.failChild(child, new Error("Plugin RPC frame exceeds the limit"));
        });
        child.stderr.on("data", (chunk: Buffer) => {
            logger.logInfo(`[plugin-v2] ${chunk.toString("utf8").slice(0, 8192).trim()}`);
        });
        child.on("error", (error) => this.failChild(child, error));
        child.on("exit", (code, signal) => {
            if (this.child === child) {
                this.child = null;
                this.rejectAll(new Error(`Plugin runtime exited (${code ?? signal})`));
            }
        });
        try {
            const health = await this.requestRaw<{ protocolVersion: number; runtime: string }>(child, "health", {}, LOAD_TIMEOUT_MS);
            if (health?.protocolVersion !== 2 || health.runtime !== RUNTIME_NAME) throw new Error("Plugin runtime protocol is not V2");
            for (const registration of this.registrations.values()) {
                const descriptor = await this.requestRaw(child, "load", registration, LOAD_TIMEOUT_MS);
                assertV2Descriptor(descriptor);
                if (descriptor.id !== registration.pluginId) throw new Error("Restored plugin identity changed");
            }
        } catch (error) {
            this.failChild(child, toError(error)); throw error;
        }
    }
    private failChild(child: ChildProcessWithoutNullStreams, error: Error) {
        if (this.child !== child) return;
        this.child = null;
        this.rejectAll(error);
        child.kill();
    }
    private rejectAll(error: Error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            if (pending.killTimer) clearTimeout(pending.killTimer);
            pending.reject(error);
        }
        this.pending.clear();
    }
    private handleResponse(child: ChildProcessWithoutNullStreams, message: NativeResponse) {
        if (this.child !== child) return;
        if (!message || message.jsonrpc !== "2.0" || typeof message.id !== "string" || message.id.length > 128) {
            throw new Error("Plugin runtime sent an invalid response");
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (pending.killTimer) clearTimeout(pending.killTimer);
        if (message.error) {
            pending.reject(new PluginRuntimeError(String(message.error.message).slice(0, 4096),
                message.error.data?.failureCode ?? message.error.data?.code, message.error.code));
        } else pending.resolve(message.result);
    }
    private requestRaw<T>(child: ChildProcessWithoutNullStreams, method: NativeRequest["method"],
        params: object, timeoutMs: number): Promise<T> {
        if (this.pending.size >= MAX_PENDING_REQUESTS) return Promise.reject(new Error("Plugin RPC concurrency limit reached"));
        const id = `plugin-${++this.sequence}`;
        const message: NativeRequest = { jsonrpc: "2.0", id, method, params: params as Record<string, unknown> };
        const frame = `${JSON.stringify(message)}\n`;
        if (Buffer.byteLength(frame) > MAX_RPC_BYTES) return Promise.reject(new Error("Plugin RPC request exceeds the limit"));
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                const pending = this.pending.get(id);
                if (!pending) return;
                pending.reject(new PluginRuntimeError(`Plugin RPC timed out: ${method}`, "temporary_unavailable"));
                // Cooperative cancellation first; a tight JS loop still has a terminal process boundary.
                child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: `cancel-${++this.sequence}`, method: "cancel", params: { requestId: id } })}\n`);
                pending.killTimer = setTimeout(() => {
                    if (this.pending.has(id)) this.failChild(child, new Error("Plugin runtime did not cancel the timed-out call"));
                }, CANCEL_GRACE_MS);
            }, timeoutMs);
            this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
            child.stdin.write(frame, (error) => {
                if (error) this.failChild(child, error);
            });
        });
    }
    async inspectPlugin(code: string, settings: Record<string, string> = {}) {
        await this.ensureStarted();
        const descriptor = await this.requestRaw(this.getChild(), "inspect", { code, settings }, LOAD_TIMEOUT_MS);
        assertV2Descriptor(descriptor);
        return descriptor;
    }
    async prepareImport(request: PluginImportRequest) {
        await this.ensureStarted();
        const prepared = await this.requestRaw<PreparedPluginImport>(this.getChild(), "prepareImport", request, IMPORT_TIMEOUT_MS);
        if (!prepared || typeof prepared.source !== "string" || Buffer.byteLength(prepared.source) > 5 * 1024 * 1024
            || prepared.originalId !== undefined && (typeof prepared.originalId !== "string" || prepared.originalId.length > 16_384)) {
            throw new PluginRuntimeError("Plugin import returned invalid source metadata", "invalid_v2");
        }
        return prepared;
    }
    async loadPlugin(pluginId: string, code: string, environment: PluginExecutionEnvironment, storageRoot: string) {
        await this.ensureStarted();
        const registration: PluginRegistration = {
            pluginId, code, settings: { ...environment.userVariables }, storageRoot, proxyUrl: environment.proxyUrl,
        };
        const descriptor = await this.requestRaw(this.getChild(), "load", registration, LOAD_TIMEOUT_MS);
        assertV2Descriptor(descriptor);
        if (descriptor.id !== pluginId) throw new Error("Plugin package identity changed during loading");
        this.registrations.set(pluginId, registration);
        return descriptor;
    }
    async invokePlugin(pluginId: string, capability: PluginCapability, request: unknown, pluginName = pluginId) {
        await this.ensureStarted();
        if (!this.registrations.has(pluginId)) throw new PluginRuntimeError("Plugin is not enabled", "permission_denied");
        const callId = randomUUID();
        const quality = request && typeof request === "object" ? (request as { quality?: unknown }).quality : undefined;
        const context = { callId, kind: "plugin" as const, pluginHash: pluginId, pluginName, platform: pluginId,
            quality: typeof quality === "string" ? quality : undefined };
        const started = performance.now();
        this.onPlaybackLog?.({ type: "playback-log", ...context, timestamp: Date.now(), level: "info", phase: "request" });
        try {
            const result = await this.requestRaw(this.getChild(), "invoke", { pluginId, capability, request }, INVOKE_TIMEOUT_MS);
            this.onPlaybackLog?.({ type: "playback-log", ...context, timestamp: Date.now(), level: "info", phase: "success", durationMs: performance.now() - started });
            return result;
        } catch (error) {
            this.onPlaybackLog?.({ type: "playback-log", ...context, timestamp: Date.now(), level: "error", phase: "error",
                durationMs: performance.now() - started, message: toError(error).message.slice(0, 8192) });
            throw error;
        }
    }
    async unloadPlugin(pluginId: string) {
        this.registrations.delete(pluginId);
        if (this.spawnPromise) await this.spawnPromise.catch(() => undefined);
        if (this.child) await this.requestRaw(this.child, "unload", { pluginId }, LOAD_TIMEOUT_MS);
    }
    async clearPlugins() {
        this.registrations.clear();
        if (this.spawnPromise) await this.spawnPromise.catch(() => undefined);
        if (this.child) await this.requestRaw(this.child, "clear", {}, LOAD_TIMEOUT_MS);
    }
    dispose() {
        this.shuttingDown = true;
        this.registrations.clear();
        if (this.child) this.failChild(this.child, new Error("Plugin runtime disposed"));
        else this.rejectAll(new Error("Plugin runtime disposed"));
    }
}
