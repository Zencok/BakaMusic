import axios from "axios";
import {
    constants,
    createCipheriv,
    createHash,
    createPublicKey,
    publicEncrypt,
    randomBytes,
} from "crypto";
import { HttpsProxyAgent } from "https-proxy-agent";
import vm from "vm";
import { deflate, inflate } from "zlib";
import { promisify } from "util";
import type {
    LxPluginHostDescriptor,
    LxPluginHostInvokePayload,
    LxPluginHostLoadPayload,
    LxPluginHostMessage,
    LxPluginHostRequest,
    LxPluginHostUpdateAlert,
} from "../lx-rpc";
import {
    lxSources,
    type LxSource,
    type LxSourceDescriptor,
} from "../lx-types";
import type { PluginExecutionEnvironment } from "../rpc";
import {
    createPlaybackCallId,
    createPlaybackConsole,
    emitPlaybackLifecycle,
    getPlaybackErrorMessage,
    runWithPlaybackLog,
} from "./playback-console";

const MAX_PLUGIN_CODE_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_URL_LENGTH = 8192;
const INIT_TIMEOUT_MS = 10_000;
const SCRIPT_SYNC_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const MEDIA_PROBE_TIMEOUT_MS = 8_000;
const EVENT_NAMES = Object.freeze({
    request: "request",
    inited: "inited",
    updateAlert: "updateAlert",
});
const supportedQualities = new Set<IMusic.IQualityKey>([
    "mgg",
    "128k",
    "192k",
    "320k",
    "flac",
    "flac24bit",
    "hires",
    "vinyl",
    "dolby",
    "atmos",
    "atmos_plus",
    "master",
]);
const parentPort = process.parentPort;
const inflateAsync = promisify(inflate);
const deflateAsync = promisify(deflate);

type LxRequestHandler = (request: {
    source: LxSource;
    action: "musicUrl";
    info: {
        type: IMusic.IQualityKey;
        musicInfo: Record<string, unknown>;
    };
}) => unknown;

type LxUpdateAlertHandler = (event: LxPluginHostUpdateAlert) => void;

interface HostedLxPlugin {
    context: vm.Context;
    descriptor: LxPluginHostDescriptor;
    environment: PluginExecutionEnvironment;
    getRequestHandler: () => LxRequestHandler | null;
}

const hostedPlugins = new Map<string, HostedLxPlugin>();

function toErrorPayload(error: unknown) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return {
        name: normalized.name,
        message: normalized.message,
        stack: normalized.stack,
    };
}

function postMessage(message: LxPluginHostMessage) {
    parentPort.postMessage(message);
}

const pluginConsole = createPlaybackConsole((event) => postMessage(event));

function parseResponseBody(body: unknown) {
    if (typeof body !== "string") {
        return body;
    }
    try {
        return JSON.parse(body) as unknown;
    } catch {
        return body;
    }
}

function getRequestAgent(environment: PluginExecutionEnvironment, url: URL) {
    if (!environment.proxyUrl) {
        return undefined;
    }
    const proxyUrl = new URL(environment.proxyUrl);
    if (
        !["http:", "https:"].includes(proxyUrl.protocol)
        || !proxyUrl.hostname
        || !["http:", "https:"].includes(url.protocol)
    ) {
        throw new Error("LX plugin proxy URL is invalid");
    }
    return new HttpsProxyAgent(proxyUrl);
}

async function probeLxMediaUrl(
    url: URL,
    environment: PluginExecutionEnvironment,
) {
    const agent = getRequestAgent(environment, url);
    const response = await axios.request({
        url: url.toString(),
        method: "get",
        headers: {
            Range: "bytes=0-1",
            "User-Agent": "Mozilla/5.0 BakaMusic LX Compatibility/2.0",
        },
        timeout: MEDIA_PROBE_TIMEOUT_MS,
        responseType: "stream",
        maxRedirects: 5,
        beforeRedirect(options) {
            if (!options.protocol || !["http:", "https:"].includes(options.protocol)) {
                throw new Error("LX media redirect protocol is not accepted");
            }
        },
        httpAgent: agent,
        httpsAgent: agent,
        validateStatus: () => true,
    });
    const body = response.data as { destroy?: () => void };
    body.destroy?.();
    if (response.status !== 200 && response.status !== 206) {
        throw new Error(`LX media URL probe failed with HTTP ${response.status}`);
    }
}

function normalizeRequestHeaders(value: unknown) {
    if (value == null) {
        return {};
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error("LX request headers are invalid");
    }
    const entries = Object.entries(value);
    if (entries.length > 128) {
        throw new Error("LX request contains too many headers");
    }
    return Object.fromEntries(entries.map(([key, headerValue]) => {
        if (
            !key
            || key.length > 256
            || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
            || !["string", "number", "boolean"].includes(typeof headerValue)
        ) {
            throw new Error("LX request header is invalid");
        }
        const text = String(headerValue);
        if (text.length > 32_768 || /[\r\n]/.test(text)) {
            throw new Error("LX request header value is invalid");
        }
        return [key, text];
    }));
}

function createLxRequest(environment: PluginExecutionEnvironment) {
    return (
        urlLike: unknown,
        rawOptions: unknown,
        callback: unknown,
    ) => {
        if (typeof urlLike !== "string" || urlLike.length > MAX_URL_LENGTH) {
            throw new Error("LX request URL is invalid");
        }
        if (typeof callback !== "function") {
            throw new Error("LX request callback is required");
        }
        const url = new URL(urlLike);
        if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
            throw new Error("LX request URL protocol is invalid");
        }
        const options = rawOptions && typeof rawOptions === "object"
            ? rawOptions as Record<string, unknown>
            : {};
        const method = typeof options.method === "string"
            ? options.method.toLocaleLowerCase()
            : "get";
        if (!/^[a-z]{3,12}$/.test(method)) {
            throw new Error("LX request method is invalid");
        }
        const timeout = typeof options.timeout === "number" && options.timeout > 0
            ? Math.min(options.timeout, MAX_REQUEST_TIMEOUT_MS)
            : DEFAULT_REQUEST_TIMEOUT_MS;
        const controller = new AbortController();
        const agent = getRequestAgent(environment, url);
        let data = options.body;
        if (options.form && typeof options.form === "object") {
            data = new URLSearchParams(
                Object.entries(options.form as Record<string, unknown>)
                    .map(([key, value]) => [key, String(value)]),
            );
        } else if (options.formData && typeof options.formData === "object") {
            const formData = new FormData();
            for (const [key, value] of Object.entries(
                options.formData as Record<string, unknown>,
            )) {
                formData.append(key, String(value));
            }
            data = formData;
        }
        const binary = options.binary === true;

        void axios.request({
            url: url.toString(),
            method,
            data,
            headers: {
                "User-Agent": "Mozilla/5.0 BakaMusic LX Compatibility/2.0",
                ...normalizeRequestHeaders(options.headers),
            },
            timeout,
            signal: controller.signal,
            responseType: binary ? "arraybuffer" : "text",
            transformResponse: [(value) => value],
            maxRedirects: 5,
            maxContentLength: MAX_RESPONSE_BYTES,
            maxBodyLength: MAX_RESPONSE_BYTES,
            httpAgent: agent,
            httpsAgent: agent,
            validateStatus: () => true,
        }).then((response) => {
            const rawBody = binary
                ? Buffer.from(response.data as ArrayBuffer)
                : response.data;
            const body = binary ? rawBody : parseResponseBody(rawBody);
            callback(null, {
                statusCode: response.status,
                statusMessage: response.statusText,
                headers: response.headers,
                bytes: binary ? (rawBody as Buffer).length : Buffer.byteLength(String(rawBody)),
                raw: binary ? rawBody : Buffer.from(String(rawBody), "utf8"),
                body,
            }, body);
        }).catch((error) => {
            callback(new Error(toErrorPayload(error).message), null, null);
        });

        return () => controller.abort();
    };
}

function parseSources(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("LX plugin did not declare sources");
    }
    const rawSources = (value as { sources?: unknown }).sources;
    if (!rawSources || typeof rawSources !== "object" || Array.isArray(rawSources)) {
        throw new Error("LX plugin sources are invalid");
    }
    const sources: Partial<Record<LxSource, LxSourceDescriptor>> = {};
    for (const source of lxSources) {
        const rawSource = (rawSources as Record<string, unknown>)[source];
        if (!rawSource || typeof rawSource !== "object" || Array.isArray(rawSource)) {
            continue;
        }
        const { type, actions, qualitys, qualities } = rawSource as Record<string, unknown>;
        if (
            type !== "music"
            || !Array.isArray(actions)
            || !actions.includes("musicUrl")
        ) {
            continue;
        }
        const rawQualities = Array.isArray(qualitys) ? qualitys : qualities;
        const normalizedQualities = Array.isArray(rawQualities)
            ? [...new Set(rawQualities.filter((quality): quality is IMusic.IQualityKey =>
                typeof quality === "string"
                && supportedQualities.has(quality as IMusic.IQualityKey),
            ))]
            : [];
        if (!normalizedQualities.length) {
            continue;
        }
        sources[source] = {
            actions: ["musicUrl"],
            qualities: normalizedQualities,
        };
    }
    if (!Object.keys(sources).length) {
        throw new Error("LX plugin does not provide a supported musicUrl source");
    }
    return sources;
}

function createCryptoUtils() {
    return Object.freeze({
        aesEncrypt(buffer: Uint8Array | string, mode: string, key: Uint8Array | string, iv: Uint8Array | string) {
            const cipher = createCipheriv(mode, Buffer.from(key), Buffer.from(iv));
            return Buffer.concat([cipher.update(Buffer.from(buffer)), cipher.final()]);
        },
        rsaEncrypt(buffer: Uint8Array | string, key: string) {
            const input = Buffer.from(buffer);
            const keyObject = createPublicKey(key);
            const modulusBytes = Math.ceil(
                (keyObject.asymmetricKeyDetails?.modulusLength ?? 1024) / 8,
            );
            if (input.length > modulusBytes) {
                throw new Error("LX RSA input is too large");
            }
            return publicEncrypt({
                key: keyObject,
                padding: constants.RSA_NO_PADDING,
            }, Buffer.concat([Buffer.alloc(modulusBytes - input.length), input]));
        },
        randomBytes(size: number) {
            if (!Number.isInteger(size) || size < 0 || size > 1024 * 1024) {
                throw new Error("LX random byte size is invalid");
            }
            return randomBytes(size);
        },
        md5(value: string) {
            if (typeof value !== "string" || value.length > 1024 * 1024) {
                throw new Error("LX MD5 input is invalid");
            }
            return createHash("md5").update(value).digest("hex");
        },
    });
}

function createLxApi(
    hash: string,
    scriptInfo: LxPluginHostLoadPayload["scriptInfo"],
    code: string,
    environment: PluginExecutionEnvironment,
    onInited: (sources: LxPluginHostDescriptor["sources"]) => void,
    onUpdateAlert: LxUpdateAlertHandler,
) {
    let requestHandler: LxRequestHandler | null = null;
    let inited = false;
    let updateAlertSent = false;
    const lx = {
        EVENT_NAMES,
        request: createLxRequest(environment),
        async send(eventName: unknown, data: unknown) {
            if (eventName === EVENT_NAMES.inited) {
                if (inited) {
                    throw new Error("LX plugin is already initialized");
                }
                inited = true;
                onInited(parseSources(data));
                return;
            }
            if (eventName === EVENT_NAMES.updateAlert) {
                if (updateAlertSent) {
                    return;
                }
                updateAlertSent = true;
                if (!data || typeof data !== "object" || Array.isArray(data)) {
                    return;
                }
                const update = data as Record<string, unknown>;
                const log = typeof update.log === "string"
                    ? update.log.slice(0, 1024)
                    : undefined;
                const updateUrl = typeof update.updateUrl === "string"
                    ? update.updateUrl.trim().slice(0, MAX_URL_LENGTH)
                    : undefined;
                if (!log && !updateUrl) {
                    return;
                }
                onUpdateAlert({
                    type: "lx-update-alert",
                    hash,
                    log,
                    updateUrl,
                });
                return;
            }
            throw new Error(`The LX event is not supported: ${String(eventName)}`);
        },
        async on(eventName: unknown, handler: unknown) {
            if (eventName !== EVENT_NAMES.request || typeof handler !== "function") {
                throw new Error(`The LX event is not supported: ${String(eventName)}`);
            }
            requestHandler = handler as LxRequestHandler;
        },
        utils: Object.freeze({
            crypto: createCryptoUtils(),
            buffer: Object.freeze({
                from(input: string | ArrayLike<number>, encoding?: BufferEncoding) {
                    return Buffer.from(input as string, encoding);
                },
                bufToString(buffer: Uint8Array, encoding: BufferEncoding = "utf8") {
                    return Buffer.from(buffer).toString(encoding);
                },
            }),
            zlib: Object.freeze({
                inflate: (buffer: Uint8Array) => inflateAsync(Buffer.from(buffer)),
                deflate: (buffer: Uint8Array | string) => deflateAsync(Buffer.from(buffer)),
            }),
        }),
        currentScriptInfo: Object.freeze({
            ...scriptInfo,
            rawScript: code,
        }),
        version: "2.0.0",
        env: "desktop",
    };
    Object.freeze(lx);
    return {
        lx,
        getRequestHandler: () => requestHandler,
    };
}

async function loadPlugin(payload: unknown) {
    const request = payload as Partial<LxPluginHostLoadPayload>;
    if (
        typeof request.hash !== "string"
        || !/^[a-f0-9]{64}$/.test(request.hash)
        || typeof request.code !== "string"
        || Buffer.byteLength(request.code, "utf8") > MAX_PLUGIN_CODE_BYTES
        || !request.scriptInfo
        || !request.environment
    ) {
        throw new Error("LX plugin load request is invalid");
    }

    let resolveInited!: (sources: LxPluginHostDescriptor["sources"]) => void;
    let rejectInited!: (error: Error) => void;
    const initedPromise = new Promise<LxPluginHostDescriptor["sources"]>((resolve, reject) => {
        resolveInited = resolve;
        rejectInited = reject;
    });
    const timer = setTimeout(() => {
        rejectInited(new Error("LX plugin initialization timed out"));
    }, INIT_TIMEOUT_MS);
    const runtime = createLxApi(
        request.hash,
        request.scriptInfo,
        request.code,
        request.environment,
        resolveInited,
        (event) => postMessage(event),
    );
    const sandbox: Record<string, unknown> = {
        lx: runtime.lx,
        console: pluginConsole,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        AbortController,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        atob,
        btoa,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.global = sandbox;
    const context = vm.createContext(sandbox, {
        name: `BakaMusic LX plugin ${request.hash}`,
    });

    try {
        new vm.Script(request.code, {
            filename: `${request.hash}.lx.js`,
        }).runInContext(context, { timeout: SCRIPT_SYNC_TIMEOUT_MS });
        const sources = await initedPromise;
        if (!runtime.getRequestHandler()) {
            throw new Error("LX plugin did not register a request handler");
        }
        const descriptor: LxPluginHostDescriptor = {
            hash: request.hash,
            ...request.scriptInfo,
            sources,
        };
        hostedPlugins.set(request.hash, {
            context,
            descriptor,
            environment: request.environment,
            getRequestHandler: runtime.getRequestHandler,
        });
        return descriptor;
    } finally {
        clearTimeout(timer);
    }
}

async function invokePlugin(payload: unknown) {
    const request = payload as Partial<LxPluginHostInvokePayload>;
    if (
        typeof request.hash !== "string"
        || !lxSources.includes(request.source as LxSource)
        || typeof request.quality !== "string"
        || !supportedQualities.has(request.quality as IMusic.IQualityKey)
        || !request.musicInfo
        || typeof request.musicInfo !== "object"
        || !request.environment
        || typeof request.pluginName !== "string"
        || request.pluginName.length > 256
        || typeof request.platform !== "string"
        || request.platform.length > 128
        || typeof request.attempt !== "number"
        || !Number.isInteger(request.attempt)
        || request.attempt < 1
        || request.attempt > 32
    ) {
        throw new Error("LX plugin invocation request is invalid");
    }
    const hosted = hostedPlugins.get(request.hash);
    const source = request.source as LxSource;
    const quality = request.quality as IMusic.IQualityKey;
    const musicInfo = request.musicInfo;
    if (!hosted?.descriptor.sources[source]?.qualities.includes(quality)) {
        return null;
    }
    hosted.environment.proxyUrl = request.environment.proxyUrl;
    const handler = hosted.getRequestHandler();
    if (!handler) {
        return null;
    }
    const context = {
        callId: createPlaybackCallId("lx"),
        kind: "lx" as const,
        pluginHash: request.hash,
        pluginName: request.pluginName,
        platform: request.platform,
        quality,
        attempt: request.attempt,
    };
    return await runWithPlaybackLog(context, async () => {
        const startedAt = performance.now();
        emitPlaybackLifecycle((event) => postMessage(event), context, "request");
        try {
            const result = await Promise.resolve(handler.call(hosted.context.lx, {
                source,
                action: "musicUrl",
                info: {
                    type: quality,
                    musicInfo,
                },
            }));
            if (typeof result !== "string" || result.length > MAX_URL_LENGTH) {
                throw new Error("LX plugin returned an invalid media URL");
            }
            const url = new URL(result);
            if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
                throw new Error("LX plugin media URL protocol is invalid");
            }
            await probeLxMediaUrl(url, hosted.environment);
            emitPlaybackLifecycle((event) => postMessage(event), context, "success", {
                durationMs: performance.now() - startedAt,
            });
            return url.toString();
        } catch (error) {
            emitPlaybackLifecycle((event) => postMessage(event), context, "error", {
                durationMs: performance.now() - startedAt,
                message: getPlaybackErrorMessage(error),
            });
            throw error;
        }
    });
}

async function handleRequest(request: LxPluginHostRequest) {
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

process.on("unhandledRejection", (reason) => {
    process.stderr.write(`[lx-plugin-host] unhandled rejection: ${toErrorPayload(reason).stack ?? ""}\n`);
});
process.on("uncaughtException", (error) => {
    process.stderr.write(`[lx-plugin-host] uncaught exception: ${toErrorPayload(error).stack ?? ""}\n`);
});

parentPort.on("message", (event) => {
    const message = event.data as LxPluginHostRequest;
    if (message?.type !== "request" || typeof message.requestId !== "string") {
        return;
    }
    void Promise.resolve(handleRequest(message)).then(
        (result) => postMessage({ type: "response", requestId: message.requestId, result }),
        (error) => postMessage({
            type: "response",
            requestId: message.requestId,
            error: toErrorPayload(error),
        }),
    );
});
