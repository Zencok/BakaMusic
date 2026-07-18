const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");
const { Transform } = require("stream");

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_PROXY_RESPONSE_BYTES = 1024 * 1024 * 1024;

const REQUEST_HEADER_ALLOWLIST = new Set([
    "accept",
    "accept-encoding",
    "authorization",
    "cache-control",
    "cookie",
    "if-range",
    "if-none-match",
    "origin",
    "range",
    "referer",
    "user-agent",
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
    "accept-ranges",
    "cache-control",
    "content-encoding",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
]);

function parseTargetUrl(value) {
    if (typeof value !== "string" || value.length > 8192) {
        throw new Error("Invalid target URL");
    }
    const target = new URL(value);
    if (!["http:", "https:"].includes(target.protocol) || !target.hostname) {
        throw new Error("Only HTTP(S) targets are supported");
    }
    return target;
}

function isPrivateAddress(address) {
    const normalized = String(address).toLowerCase();
    if (net.isIPv4(normalized)) {
        const octets = normalized.split(".").map(Number);
        const [a, b] = octets;
        return a === 0
            || a === 10
            || a === 127
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && (b === 0 || b === 168))
            || (a === 198 && (octets[2] === 18 || octets[2] === 19))
            || (a === 192 && b === 0 && octets[2] === 2)
            || (a === 198 && b === 51 && octets[2] === 100)
            || (a === 203 && b === 0 && octets[2] === 113)
            || a >= 224;
    }
    if (!net.isIPv6(normalized)) {
        return true;
    }
    if (normalized === "::1" || normalized === "::") {
        return true;
    }
    if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8")
        || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")
        || normalized.startsWith("ff")) {
        return true;
    }
    if (normalized.startsWith("::ffff:")) {
        return isPrivateAddress(normalized.slice(7));
    }
    return false;
}

function isPrivateHostname(hostname) {
    const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return normalized === "localhost"
        || normalized.endsWith(".localhost")
        || normalized.endsWith(".local")
        || normalized.endsWith(".internal")
        || normalized === "metadata.google.internal"
        || isPrivateAddress(normalized);
}

function assertSafeTargetUrlSync(targetUrl) {
    const target = parseTargetUrl(targetUrl);
    if (isPrivateHostname(target.hostname)) {
        throw new Error("Private target is not allowed");
    }
    return target;
}

function lookupPublic(hostname, options, callback) {
    if (net.isIP(hostname)) {
        if (isPrivateAddress(hostname)) {
            callback(new Error("Private target is not allowed"));
            return;
        }
        callback(null, hostname, net.isIP(hostname));
        return;
    }
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
        if (error) {
            callback(error);
            return;
        }
        const publicAddress = addresses.find(({ address }) => !isPrivateAddress(address));
        if (!publicAddress || addresses.some(({ address }) => isPrivateAddress(address))) {
            callback(new Error("Target resolves to a private address"));
            return;
        }
        callback(null, publicAddress.address, publicAddress.family);
    });
}

async function assertSafeTargetUrl(targetUrl) {
    const target = assertSafeTargetUrlSync(targetUrl);
    const hostname = target.hostname.replace(/^\[|\]$/g, "");
    if (!net.isIP(hostname)) {
        await new Promise((resolve, reject) => {
            lookupPublic(hostname, {}, (error) => error ? reject(error) : resolve());
        });
    }
    return target;
}

function sanitizeHeaders(input, target, extraHeaders = {}) {
    const result = {};
    const source = input && typeof input === "object" ? input : {};
    for (const [rawName, rawValue] of Object.entries(source)) {
        const name = rawName.toLowerCase();
        if (!REQUEST_HEADER_ALLOWLIST.has(name)) {
            continue;
        }
        const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
        if (typeof value !== "string" || value.length > 8192 || /[\r\n]/.test(value)) {
            continue;
        }
        result[name] = value;
    }
    for (const [rawName, rawValue] of Object.entries(extraHeaders)) {
        const name = rawName.toLowerCase();
        if (REQUEST_HEADER_ALLOWLIST.has(name) && typeof rawValue === "string") {
            result[name] = rawValue;
        }
    }
    if (target.username || target.password) {
        if (!result.authorization) {
            result.authorization = `Basic ${Buffer.from(
                `${decodeURIComponent(target.username)}:${decodeURIComponent(target.password)}`,
            ).toString("base64")}`;
        }
    }
    result.host = target.host;
    return result;
}

function pickResponseHeaders(headers) {
    const result = {};
    for (const [rawName, rawValue] of Object.entries(headers || {})) {
        const name = rawName.toLowerCase();
        if (RESPONSE_HEADER_ALLOWLIST.has(name) && rawValue !== undefined) {
            result[name] = rawValue;
        }
    }
    return result;
}

function requestOnce(target, options, signal) {
    if (signal?.aborted) {
        return Promise.reject(signal.reason || new Error("Upstream request cancelled"));
    }
    return new Promise((resolve, reject) => {
        const protocol = target.protocol === "https:" ? https : http;
        const req = protocol.request(target, {
            method: options.method,
            headers: sanitizeHeaders(options.headers, target, options.extraHeaders),
            lookup: lookupPublic,
            timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
        }, (response) => {
            response.__upstreamRequest = req;
            const responseUrl = new URL(target);
            responseUrl.username = "";
            responseUrl.password = "";
            response.__targetUrl = responseUrl.toString();
            response.setTimeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS, () => {
                response.destroy(new Error("Upstream response timeout"));
            });
            resolve(response);
        });
        let settled = false;
        const abort = () => {
            req.destroy(new Error("Upstream request cancelled"));
        };
        const cleanup = () => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", abort);
        };
        signal?.addEventListener("abort", abort, { once: true });
        req.once("close", cleanup);
        req.once("timeout", () => req.destroy(new Error("Upstream request timeout")));
        req.once("error", (error) => {
            cleanup();
            reject(error);
        });
        req.end();
    });
}

async function requestUpstream(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    if (!new Set(["GET", "HEAD"]).has(method)) {
        throw new Error("Unsupported upstream method");
    }
    let currentUrl = url;
    let currentHeaders = options.headers;
    for (let redirect = 0; redirect <= (options.maxRedirects ?? MAX_REDIRECTS); redirect++) {
        const target = await assertSafeTargetUrl(currentUrl);
        const response = await requestOnce(target, {
            method,
            headers: currentHeaders,
            extraHeaders: options.extraHeaders,
            timeoutMs: options.timeoutMs,
        }, options.signal);
        if (![301, 302, 303, 307, 308].includes(response.statusCode) || !response.headers.location) {
            return response;
        }
        response.resume();
        const nextTarget = new URL(response.headers.location, target);
        if (nextTarget.origin !== target.origin && currentHeaders) {
            currentHeaders = Object.fromEntries(
                Object.entries(currentHeaders).filter(([name]) =>
                    !new Set(["authorization", "cookie", "origin"]).has(name.toLowerCase()),
                ),
            );
        }
        currentUrl = nextTarget.toString();
    }
    throw new Error("Too many upstream redirects");
}

function createByteLimitTransform(maxBytes = MAX_PROXY_RESPONSE_BYTES, onBytes) {
    let total = 0;
    return new Transform({
        transform(chunk, _encoding, callback) {
            total += chunk.length;
            if (total > maxBytes) {
                callback(new Error("Upstream response exceeds proxy limit"));
                return;
            }
            onBytes?.(total);
            callback(null, chunk);
        },
    });
}

function createSessionStore({ maxEntries = 256, ttlMs = 30 * 60 * 1000, dispose = () => undefined } = {}) {
    const entries = new Map();
    const remove = (key) => {
        const value = entries.get(key);
        if (!value) return false;
        entries.delete(key);
        try { dispose(value); } catch { /* native cleanup must not stop eviction */ }
        return true;
    };
    const touch = (key, value) => {
        value.lastAccess = Date.now();
        entries.delete(key);
        entries.set(key, value);
    };
    const sweep = () => {
        const now = Date.now();
        for (const [key, value] of entries) {
            if (!value.activeRequests && now - (value.lastAccess || 0) > ttlMs) {
                remove(key);
            }
        }
        while (entries.size > maxEntries) {
            const oldest = [...entries.entries()].find(([, value]) => !value.activeRequests);
            if (!oldest) break;
            remove(oldest[0]);
        }
    };
    return {
        get(key) {
            const value = entries.get(key);
            if (!value) return undefined;
            if (!value.activeRequests && Date.now() - (value.lastAccess || 0) > ttlMs) {
                remove(key);
                return undefined;
            }
            touch(key, value);
            return value;
        },
        set(key, value) {
            value.lastAccess = Date.now();
            value.activeRequests = value.activeRequests || 0;
            entries.delete(key);
            entries.set(key, value);
            sweep();
        },
        delete: remove,
        acquire(key) {
            const value = this.get(key);
            if (value) value.activeRequests = (value.activeRequests || 0) + 1;
            return value;
        },
        release(key) {
            const value = entries.get(key);
            if (value) value.activeRequests = Math.max(0, (value.activeRequests || 0) - 1);
            sweep();
        },
        sweep,
        close() {
            for (const key of [...entries.keys()]) remove(key);
        },
        get size() { return entries.size; },
    };
}

function writeProxyError(res, statusCode, message) {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(message);
}

module.exports = {
    MAX_PROXY_RESPONSE_BYTES,
    REQUEST_TIMEOUT_MS,
    assertSafeTargetUrl,
    assertSafeTargetUrlSync,
    createByteLimitTransform,
    createSessionStore,
    parseTargetUrl,
    pickResponseHeaders,
    requestUpstream,
    sanitizeHeaders,
    writeProxyError,
};
