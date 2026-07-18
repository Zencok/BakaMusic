import axios from "axios";
import bigInt from "big-integer";
import * as cheerio from "cheerio";
import CryptoJs from "crypto-js";
import dayjs from "dayjs";
import fs from "fs/promises";
import he from "he";
import path from "path";
import qs from "qs";
import * as webdav from "webdav";
import { HttpsProxyAgent } from "https-proxy-agent";
import pakoForPlugins from "./pako-compat";
import {
    PluginExecutionEnvironment,
    PluginHostCallbackRequest,
    PluginHostCallbackResponse,
    PluginHostDescriptor,
    PluginHostRequest,
    PluginHostResponse,
    PluginMethodName,
    pluginMethodNames,
} from "../rpc";

const MAX_PLUGIN_CODE_BYTES = 5 * 1024 * 1024;
const MAX_STORAGE_BYTES = 10 * 1024 * 1024;
const HOST_CALLBACK_TIMEOUT_MS = 10_000;
const supportedMethodSet = new Set<string>(pluginMethodNames);
const parentPort = process.parentPort;

axios.defaults.timeout = 15_000;
axios.defaults.maxContentLength = 16 * 1024 * 1024;
axios.defaults.maxBodyLength = 16 * 1024 * 1024;

interface HostedPlugin {
    instance: IPlugin.IPluginInstance;
    environment: PluginExecutionEnvironment;
}

interface HostCallbackPending {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

const hostedPlugins = new Map<string, HostedPlugin>();
const hostCallbacks = new Map<string, HostCallbackPending>();
let hostCallbackCounter = 0;
let storageLoaded = false;
let storage: Record<string, string> = {};
let storageWriteQueue = Promise.resolve();
let configuredProxyUrl: string | undefined;

function postMessage(message: PluginHostResponse | PluginHostCallbackRequest) {
    parentPort.postMessage(message);
}

function toErrorPayload(error: unknown) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return {
        name: normalized.name,
        message: normalized.message,
        stack: normalized.stack,
    };
}

function requestMain(
    operation: PluginHostCallbackRequest["operation"],
    payload: unknown,
) {
    const requestId = `host-${++hostCallbackCounter}`;
    return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
            hostCallbacks.delete(requestId);
            reject(new Error(`Plugin host callback timed out: ${operation}`));
        }, HOST_CALLBACK_TIMEOUT_MS);
        hostCallbacks.set(requestId, { resolve, reject, timer });
        postMessage({ type: "host-request", requestId, operation, payload });
    });
}

const cookies = {
    async set(url: string, cookie: Record<string, unknown>) {
        return await requestMain("cookies.set", { url, cookie }) as boolean;
    },
    async get(url: string) {
        return await requestMain("cookies.get", { url });
    },
    async flush() {
        await requestMain("cookies.flush", null);
    },
};

function getStoragePath() {
    const storagePath = process.env.BAKAMUSIC_PLUGIN_STORAGE_PATH;
    if (!storagePath) {
        throw new Error("Plugin storage path is not configured");
    }
    return path.resolve(storagePath);
}

async function loadStorage() {
    if (storageLoaded) {
        return;
    }
    try {
        const rawStorage = await fs.readFile(getStoragePath(), "utf8");
        const parsed = JSON.parse(rawStorage);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            storage = Object.fromEntries(
                Object.entries(parsed).flatMap(([key, value]) =>
                    typeof value === "string" ? [[key, value]] : [],
                ),
            );
        }
    } catch {
        storage = {};
    }
    storageLoaded = true;
}

async function persistStorage(nextStorage: Record<string, string>) {
    const rawStorage = JSON.stringify(nextStorage);
    if (Buffer.byteLength(rawStorage, "utf8") > MAX_STORAGE_BYTES) {
        throw new Error("Plugin storage size exceeds the limit");
    }
    const storagePath = getStoragePath();
    const temporaryPath = `${storagePath}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.writeFile(temporaryPath, rawStorage, "utf8");
    await fs.rename(temporaryPath, storagePath);
    storage = nextStorage;
}

function queueStorageWrite(action: () => Promise<void>) {
    storageWriteQueue = storageWriteQueue.then(action, action);
    return storageWriteQueue;
}

const pluginStorage = {
    async setItem(key: string, value: unknown) {
        if (typeof key !== "string" || !key || key.length > 1024) {
            throw new Error("Plugin storage key is not valid");
        }
        await loadStorage();
        await queueStorageWrite(() => persistStorage({
            ...storage,
            [key]: typeof value === "string" ? value : String(value),
        }));
    },
    async getItem(key: string) {
        if (typeof key !== "string" || key.length > 1024) {
            return null;
        }
        await loadStorage();
        return storage[key] ?? null;
    },
    async removeItem(key: string) {
        if (typeof key !== "string" || key.length > 1024) {
            return;
        }
        await loadStorage();
        const nextStorage = { ...storage };
        delete nextStorage[key];
        await queueStorageWrite(() => persistStorage(nextStorage));
    },
};

const packages: Record<string, unknown> = {
    cheerio,
    "crypto-js": CryptoJs,
    axios,
    dayjs,
    "big-integer": bigInt,
    qs,
    he,
    pako: pakoForPlugins,
    buffer: { Buffer },
    "@react-native-cookies/cookies": cookies,
    webdav,
    "musicfree/storage": pluginStorage,
};

function pluginRequire(packageName: string) {
    if (typeof packageName !== "string" || !(packageName in packages)) {
        return null;
    }
    const packageValue = packages[packageName];
    if (
        packageValue
        && (typeof packageValue === "object" || typeof packageValue === "function")
        && !("default" in (packageValue as Record<string, unknown>))
    ) {
        try {
            Object.defineProperty(packageValue, "default", {
                configurable: true,
                enumerable: false,
                value: packageValue,
            });
        } catch {
            // Frozen module namespace objects are returned unchanged.
        }
    }
    return packageValue;
}

function createEnvironment(initial: PluginExecutionEnvironment) {
    const state = { ...initial, userVariables: { ...initial.userVariables } };
    const environment = {
        getUserVariables: () => state.userVariables,
        get userVariables() {
            return state.userVariables;
        },
        os: state.os,
        appVersion: state.appVersion,
        lang: state.lang,
    };
    return { state, environment };
}

function applyNetworkEnvironment(environment: PluginExecutionEnvironment) {
    if (environment.proxyUrl === configuredProxyUrl) {
        return;
    }
    configuredProxyUrl = environment.proxyUrl;
    if (!configuredProxyUrl) {
        axios.defaults.httpAgent = undefined;
        axios.defaults.httpsAgent = undefined;
        return;
    }
    if (configuredProxyUrl.length > 8192) {
        throw new Error("Plugin proxy URL exceeds the limit");
    }
    const proxyUrl = new URL(configuredProxyUrl);
    if (!["https:", "http:"].includes(proxyUrl.protocol) || !proxyUrl.hostname) {
        throw new Error("Plugin proxy URL is invalid");
    }
    const agent = new HttpsProxyAgent(proxyUrl);
    axios.defaults.httpAgent = agent;
    axios.defaults.httpsAgent = agent;
}

function cloneMetadata(instance: IPlugin.IPluginInstance) {
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(instance)) {
        if (typeof value !== "function") {
            metadata[key] = value;
        }
    }
    const serialized = JSON.stringify(metadata);
    if (Buffer.byteLength(serialized, "utf8") > 1024 * 1024) {
        throw new Error("Plugin metadata exceeds the limit");
    }
    return JSON.parse(serialized) as Record<string, unknown>;
}

function executePlugin(
    code: string,
    environmentInput: PluginExecutionEnvironment,
) {
    if (Buffer.byteLength(code, "utf8") > MAX_PLUGIN_CODE_BYTES) {
        throw new Error("Plugin code exceeds the limit");
    }
    applyNetworkEnvironment(environmentInput);
    const moduleValue: { exports: Record<string, unknown>; loaded: boolean } = {
        exports: {},
        loaded: false,
    };
    let initialized: (() => void) | undefined;
    const ensurePluginInitialized = new Promise<void>((resolve) => {
        initialized = resolve;
    });
    const { state, environment } = createEnvironment(environmentInput);
    const pluginProcess = {
        platform: environmentInput.os,
        version: environmentInput.appVersion,
        env: environment,
        ensurePluginInitialized,
    };
    let instance = Function(`
        "use strict";
        return function(require, __musicfree_require, module, exports, console, env, URL, process) {
            ${code}
        }
    `)()(
        pluginRequire,
        pluginRequire,
        moduleValue,
        moduleValue.exports,
        console,
        environment,
        URL,
        pluginProcess,
    ) as IPlugin.IPluginInstance;
    const exportedDefault = moduleValue.exports.default;
    if (exportedDefault && typeof exportedDefault === "object") {
        instance = exportedDefault as IPlugin.IPluginInstance;
    } else if (moduleValue.exports && Object.keys(moduleValue.exports).length) {
        instance = moduleValue.exports as unknown as IPlugin.IPluginInstance;
    }
    initialized?.();
    moduleValue.loaded = true;
    if (!instance || typeof instance !== "object") {
        throw new Error("Plugin did not export an object");
    }
    if (typeof instance.platform !== "string" || !instance.platform.trim() || instance.platform.length > 128) {
        throw new Error("Plugin platform is not valid");
    }
    if (Array.isArray(instance.userVariables)) {
        instance.userVariables = instance.userVariables.filter((item) =>
            item?.key && typeof item.key === "string" && item.key.length <= 256,
        ).slice(0, 128);
    }
    return { instance, environment: state };
}

function loadPlugin(payload: unknown): PluginHostDescriptor {
    const request = payload as {
        code?: unknown;
        hash?: unknown;
        environment?: PluginExecutionEnvironment;
    };
    if (
        typeof request?.code !== "string"
        || typeof request.hash !== "string"
        || !/^[a-f0-9]{64}$/.test(request.hash)
        || !request.environment
    ) {
        throw new Error("Plugin load request is not valid");
    }
    const hosted = executePlugin(request.code, request.environment);
    hostedPlugins.set(request.hash, hosted);
    const supportedMethods = pluginMethodNames.filter((method) =>
        typeof hosted.instance[method] === "function",
    );
    return {
        hash: request.hash,
        metadata: cloneMetadata(hosted.instance),
        supportedMethods,
    };
}

async function invokePlugin(payload: unknown) {
    const request = payload as {
        hash?: unknown;
        method?: unknown;
        args?: unknown;
        environment?: PluginExecutionEnvironment;
    };
    if (
        typeof request?.hash !== "string"
        || typeof request.method !== "string"
        || !supportedMethodSet.has(request.method)
        || !Array.isArray(request.args)
        || !request.environment
    ) {
        throw new Error("Plugin invocation request is not valid");
    }
    const hosted = hostedPlugins.get(request.hash);
    if (!hosted) {
        throw new Error("Plugin is not loaded");
    }
    hosted.environment.userVariables = { ...request.environment.userVariables };
    hosted.environment.lang = request.environment.lang;
    applyNetworkEnvironment(request.environment);
    const method = hosted.instance[request.method as PluginMethodName];
    if (typeof method !== "function") {
        return null;
    }
    return await (method as (...args: unknown[]) => unknown).apply(hosted.instance, request.args);
}

async function handleRequest(request: PluginHostRequest) {
    switch (request.operation) {
        case "load":
            return loadPlugin(request.payload);
        case "invoke":
            return invokePlugin(request.payload);
        case "unload": {
            const hash = (request.payload as { hash?: unknown })?.hash;
            if (typeof hash === "string") {
                hostedPlugins.delete(hash);
            }
            return null;
        }
        case "clear":
            hostedPlugins.clear();
            return null;
    }
}

parentPort.on("message", (event) => {
    const message = event.data as PluginHostRequest | PluginHostCallbackResponse;
    if (message?.type === "host-response") {
        const pending = hostCallbacks.get(message.requestId);
        if (!pending) {
            return;
        }
        hostCallbacks.delete(message.requestId);
        clearTimeout(pending.timer);
        if (message.error) {
            pending.reject(new Error(message.error));
        } else {
            pending.resolve(message.result);
        }
        return;
    }
    if (message?.type !== "request" || typeof message.requestId !== "string") {
        return;
    }
    void Promise.resolve(handleRequest(message)).then(
        (result) => postMessage({
            type: "response",
            requestId: message.requestId,
            result,
        }),
        (error) => postMessage({
            type: "response",
            requestId: message.requestId,
            error: toErrorPayload(error),
        }),
    );
});
