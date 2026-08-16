import { app, ipcMain } from "electron";
import http, { type IncomingMessage, type ServerResponse } from "http";
import { randomBytes } from "crypto";
import {
    assertIpcPayload,
    assertIpcSender,
    assertPlainObject,
    assertString,
    assertUrl,
} from "@shared/ipc-security/main";
import type { IWindowManager } from "@/types/window-manager";
import type { IVideoProxySource } from "./common";

const MAX_SESSIONS = 16;
const MAX_RESOURCES_PER_SESSION = 4096;
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_HEADER_COUNT = 64;
const MAX_HEADER_VALUE_LENGTH = 8192;
const forbiddenHeaders = new Set([
    "connection", "content-length", "host", "proxy-authorization", "te",
    "trailer", "transfer-encoding", "upgrade",
]);

interface VideoSession {
    id: string;
    ownerId: number;
    headers: Record<string, string>;
    resources: Map<string, string>;
    fallbacks: Map<string, string[]>;
    rootResourceId: string;
    rootMimeType?: string;
    lastUsedAt: number;
}

const sessions = new Map<string, VideoSession>();
let server: http.Server | null = null;
let serverUrl = "";
let cleanupTimer: NodeJS.Timeout | null = null;

function token() {
    return randomBytes(18).toString("base64url");
}

/**
 * Kugou signs MV URLs for the HTTP endpoint.  The same path is sometimes
 * returned with an `https:` scheme, but `fsmvpc.kugou.com` serves a
 * certificate for a different host.  Chromium consequently rejects the
 * request before it reaches the CDN.  Normalize both freshly returned and
 * cached plugin sources at the proxy boundary so an older cached plugin keeps
 * working after the host update.
 */
function normalizeVideoUpstreamUrl(value: string) {
    const parsed = new URL(value);
    if (
        parsed.protocol === "https:"
        && /(?:^|\.)fsmvpc(?:\.tx)?\.kugou\.com$/i.test(parsed.hostname)
    ) {
        parsed.protocol = "http:";
    }
    return parsed.toString();
}

function validateHeaders(value: unknown) {
    if (value === undefined) {
        return {};
    }
    assertPlainObject(value, "video proxy headers");
    const entries = Object.entries(value);
    if (entries.length > MAX_HEADER_COUNT) {
        throw new Error("Video proxy has too many headers");
    }
    return Object.fromEntries(entries.map(([name, rawValue]) => {
        assertString(name, "video proxy header name", 128);
        assertString(rawValue, "video proxy header value", MAX_HEADER_VALUE_LENGTH, true);
        const lower = name.toLocaleLowerCase("en-US");
        if (
            !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
            || forbiddenHeaders.has(lower)
            || lower.startsWith("proxy-")
            || lower.startsWith("sec-")
            || /[\r\n]/.test(rawValue)
        ) {
            throw new Error("Video proxy header is not accepted");
        }
        return [name, rawValue];
    })) as Record<string, string>;
}

function validateSource(value: unknown): IVideoProxySource {
    assertPlainObject(value, "video proxy source");
    assertIpcPayload(value, 256 * 1024);
    const url = normalizeVideoUpstreamUrl(
        assertUrl(value.url, ["http:", "https:"], 32_768, { allowCredentials: true }).toString(),
    );
    const headers = validateHeaders(value.headers);
    if (value.userAgent !== undefined) {
        assertString(value.userAgent, "video proxy user agent", 1024);
        headers["User-Agent"] = value.userAgent;
    }
    let mimeType: string | undefined;
    if (value.mimeType !== undefined) {
        assertString(value.mimeType, "video proxy mime type", 256);
        mimeType = value.mimeType;
    }
    const backupUrls = Array.isArray(value.backupUrls)
        ? value.backupUrls.flatMap((item) => {
            if (typeof item !== "string") return [];
            try {
                return [normalizeVideoUpstreamUrl(
                    assertUrl(item, ["http:", "https:"], 32_768, { allowCredentials: true }).toString(),
                )];
            } catch {
                return [];
            }
        }).slice(0, 4)
        : undefined;
    return { url, headers, mimeType, backupUrls };
}

function evictExpiredSessions(now = Date.now()) {
    for (const [id, session] of sessions) {
        if (session.lastUsedAt + SESSION_TTL_MS <= now) {
            sessions.delete(id);
        }
    }
    while (sessions.size > MAX_SESSIONS) {
        const oldest = [...sessions.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
        if (!oldest) break;
        sessions.delete(oldest.id);
    }
}

function proxyResourceUrl(sessionId: string, resourceId: string) {
    return `${serverUrl}/video/${sessionId}/${resourceId}`;
}

function proxyDownloadUrl(sessionId: string, resourceId: string) {
    return `${serverUrl}/download/${sessionId}/${resourceId}`;
}

function registerResource(session: VideoSession, target: string) {
    for (const [id, value] of session.resources) {
        if (value === target) {
            return id;
        }
    }
    if (session.resources.size >= MAX_RESOURCES_PER_SESSION) {
        throw new Error("Video proxy resource limit reached");
    }
    const id = token();
    session.resources.set(id, target);
    return id;
}

function rewritePlaylist(body: string, session: VideoSession, baseUrl: string) {
    const rewrite = (raw: string) => {
        let target: URL;
        try {
            target = new URL(raw, baseUrl);
        } catch {
            return raw;
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
            return raw;
        }
        return proxyResourceUrl(session.id, registerResource(session, target.toString()));
    };

    return body.split(/\r?\n/).map((line) => {
        if (!line) {
            return line;
        }
        let rewritten = line;
        if (!line.startsWith("#")) {
            rewritten = rewrite(line.trim());
        }
        return rewritten.replace(/URI=("([^"]+)"|'([^']+)'|([^,\s]+))/g, (_match, wrapped, doubleQuoted, singleQuoted, bare) => {
            const raw = doubleQuoted ?? singleQuoted ?? bare;
            const next = rewrite(raw);
            const quote = wrapped[0] === "'" ? "'" : "\"";
            return `URI=${quote}${next}${quote}`;
        });
    }).join("\n");
}

function isPlaylist(target: string, contentType: string | null) {
    return /\.m3u8(?:$|[?#])/i.test(target)
        || /mpegurl|m3u8/i.test(contentType ?? "");
}

function copyResponseHeaders(upstream: Response, response: ServerResponse, playlist: boolean, length?: number) {
    const allowed = new Set([
        "accept-ranges", "cache-control", "content-range", "content-type",
        "etag", "last-modified", "expires",
    ]);
    upstream.headers.forEach((value, name) => {
        if (allowed.has(name.toLocaleLowerCase("en-US"))) {
            response.setHeader(name, value);
        }
    });
    if (playlist) {
        response.setHeader("content-type", "application/vnd.apple.mpegurl");
        response.setHeader("cache-control", "no-store");
    }
    if (length !== undefined) {
        response.setHeader("content-length", String(length));
    }
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "Range, Content-Type");
    response.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS");
    response.setHeader(
        "access-control-expose-headers",
        "Accept-Ranges, Content-Length, Content-Range, Content-Type",
    );
}

/**
 * Keep the upstream request in the Node networking stack. A Chromium
 * `net.fetch` request can bypass the proxy used by plugin hosts and invalidate
 * signed CDN URLs (Bilibili/Kugou in particular), even when the plugin itself
 * got a valid URL. Node's fetch accepts the platform headers (Origin/Referer)
 * that Chromium treats as forbidden request headers (and otherwise reports
 * `ERR_BLOCKED_BY_CLIENT`).
 */
function upstreamFetchInit(
    headers: Headers,
    init: Omit<RequestInit, "headers"> = {},
): RequestInit {
    return {
        ...init,
        headers,
    };
}

async function upstreamFetch(target: string, init: RequestInit): Promise<Response> {
    return fetch(target, init);
}

async function writeUpstream(
    request: IncomingMessage,
    response: ServerResponse,
    session: VideoSession,
    target: string,
) {
    session.lastUsedAt = Date.now();
    const headers = new Headers(session.headers);
    if (request.headers.range) headers.set("Range", request.headers.range);
    const ifRange = request.headers["if-range"];
    if (typeof ifRange === "string") headers.set("If-Range", ifRange);
    const controller = new AbortController();
    response.on("close", () => {
        if (!response.writableEnded) controller.abort();
    });
    let upstream: Response | null = null;
    const targets = [target, ...(session.fallbacks.get(target) ?? [])];
    for (const candidate of targets) {
        try {
            const result = await upstreamFetch(candidate, upstreamFetchInit(headers, {
                method: request.method,
                redirect: "follow",
                signal: controller.signal,
            }));
            upstream = result;
            if (result.ok || result.status === 206 || result.status === 304) break;
            await result.body?.cancel();
        } catch {
            // Try the next CDN URL, if the plugin supplied one.
        }
    }
    if (!upstream) {
        response.writeHead(502);
        response.end();
        return;
    }
    const playlist = isPlaylist(target, upstream.headers.get("content-type"));
    if (playlist) {
        let body: string;
        try {
            body = await upstream.text();
        } catch {
            response.writeHead(502);
            response.end();
            return;
        }
        if (Buffer.byteLength(body, "utf8") > MAX_PLAYLIST_BYTES) {
            response.writeHead(413);
            response.end();
            return;
        }
        const rewritten = rewritePlaylist(body, session, upstream.url || target);
        const bytes = Buffer.byteLength(rewritten, "utf8");
        response.statusCode = upstream.status;
        copyResponseHeaders(upstream, response, true, bytes);
        response.end(request.method === "HEAD" ? undefined : rewritten);
        return;
    }
    response.statusCode = upstream.status;
    const length = upstream.headers.get("content-length");
    copyResponseHeaders(upstream, response, false, length ? Number(length) : undefined);
    if (request.method === "HEAD" || !upstream.body) {
        response.end();
        return;
    }
    const reader = upstream.body.getReader();
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (!response.write(Buffer.from(chunk.value))) {
                await new Promise<void>((resolve) => response.once("drain", resolve));
            }
        }
    } catch {
        // The browser closing the media element aborts the stream normally.
    } finally {
        response.end();
    }
}

interface HlsSegment {
    url: string;
    range?: string;
}

function requestHeaders(session: VideoSession, range?: string) {
    const headers = new Headers(session.headers);
    if (range) headers.set("Range", range);
    return headers;
}

async function readHlsPlaylist(session: VideoSession, target: string, depth = 0): Promise<{
    body: string;
    url: string;
}> {
    if (depth > 3) throw new Error("HLS playlist nesting is too deep");
    const upstream = await upstreamFetch(target, upstreamFetchInit(
        requestHeaders(session),
        { redirect: "follow" },
    ));
    if (!upstream.ok) throw new Error(`HLS playlist HTTP ${upstream.status}`);
    const body = await upstream.text();
    if (Buffer.byteLength(body, "utf8") > MAX_PLAYLIST_BYTES) {
        throw new Error("HLS playlist is too large");
    }
    const baseUrl = upstream.url || target;
    const lines = body.split(/\r?\n/);
    const variants: Array<{ bandwidth: number; url: string }> = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index].trim();
        if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
        const bandwidth = Number(line.match(/(?:^|,)BANDWIDTH=(\d+)/i)?.[1] ?? 0);
        const uri = lines.slice(index + 1).map((value) => value.trim())
            .find((value) => value && !value.startsWith("#"));
        if (uri) variants.push({ bandwidth, url: new URL(uri, baseUrl).toString() });
    }
    if (variants.length) {
        variants.sort((a, b) => b.bandwidth - a.bandwidth);
        return readHlsPlaylist(session, variants[0].url, depth + 1);
    }
    return { body, url: baseUrl };
}

function parseByteRange(value: string, previousEnd: number) {
    const match = /^(\d+)(?:@(\d+))?$/.exec(value.trim());
    if (!match) return null;
    const length = Number(match[1]);
    const start = match[2] === undefined ? previousEnd : Number(match[2]);
    if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(start) || start < 0) {
        return null;
    }
    return { range: `bytes=${start}-${start + length - 1}`, end: start + length };
}

function parseHlsSegments(body: string, baseUrl: string) {
    const segments: HlsSegment[] = [];
    let pendingRange: string | undefined;
    let previousRangeEnd = 0;
    let hasMap = false;
    for (const rawLine of body.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (/^#EXT-X-KEY:/i.test(line) && !/METHOD=NONE/i.test(line)) {
            throw new Error("Encrypted HLS downloads are not supported by this source");
        }
        if (/^#EXT-X-BYTERANGE:/i.test(line)) {
            const parsed = parseByteRange(line.slice(line.indexOf(":") + 1), previousRangeEnd);
            pendingRange = parsed?.range;
            if (parsed) previousRangeEnd = parsed.end;
            continue;
        }
        if (/^#EXT-X-MAP:/i.test(line)) {
            const uri = line.match(/URI=(?:"([^"]+)"|'([^']+)'|([^,\s]+))/i);
            const rawUri = uri?.[1] ?? uri?.[2] ?? uri?.[3];
            if (rawUri) {
                const rangeValue = line.match(/BYTERANGE=(?:"([^"]+)"|'([^']+)'|([^,\s]+))/i);
                const rawRange = rangeValue?.[1] ?? rangeValue?.[2] ?? rangeValue?.[3];
                const parsed = rawRange ? parseByteRange(rawRange, 0) : null;
                segments.push({
                    url: new URL(rawUri, baseUrl).toString(),
                    range: parsed?.range,
                });
                hasMap = true;
            }
            continue;
        }
        if (line.startsWith("#")) continue;
        segments.push({
            url: new URL(line, baseUrl).toString(),
            range: pendingRange,
        });
        pendingRange = undefined;
    }
    if (!segments.length || segments.length > 10_000) {
        throw new Error("HLS segment list is invalid");
    }
    return { segments, hasMap };
}

async function pipeHlsSegment(
    segment: HlsSegment,
    session: VideoSession,
    response: ServerResponse,
    signal: AbortSignal,
) {
    const upstream = await upstreamFetch(segment.url, upstreamFetchInit(
        requestHeaders(session, segment.range),
        { redirect: "follow", signal },
    ));
    if (!upstream.ok || !upstream.body) {
        throw new Error(`HLS segment HTTP ${upstream.status}`);
    }
    const reader = upstream.body.getReader();
    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!response.write(Buffer.from(chunk.value))) {
            await new Promise<void>((resolve) => response.once("drain", resolve));
        }
    }
}

async function writeHlsDownload(
    request: IncomingMessage,
    response: ServerResponse,
    session: VideoSession,
    target: string,
) {
    session.lastUsedAt = Date.now();
    const playlist = await readHlsPlaylist(session, target);
    const parsed = parseHlsSegments(playlist.body, playlist.url);
    response.statusCode = 200;
    response.setHeader("content-type", parsed.hasMap ? "video/mp4" : "video/mp2t");
    response.setHeader("cache-control", "no-store");
    response.setHeader("access-control-allow-origin", "*");
    if (request.method === "HEAD") {
        response.end();
        return;
    }
    const controller = new AbortController();
    response.on("close", () => {
        if (!response.writableEnded) controller.abort();
    });
    try {
        for (const segment of parsed.segments) {
            await pipeHlsSegment(segment, session, response, controller.signal);
        }
    } finally {
        response.end();
    }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.setHeader("access-control-allow-origin", "*");
        response.setHeader("access-control-allow-headers", "Range, Content-Type");
        response.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS");
        response.end();
        return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD, OPTIONS" });
        response.end();
        return;
    }
    const remote = request.socket.remoteAddress;
    if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
        response.writeHead(403);
        response.end();
        return;
    }
    const parts = new URL(request.url ?? "/", "http://127.0.0.1").pathname.split("/");
    const session = sessions.get(parts[2] ?? "");
    const target = session?.resources.get(parts[3] ?? "");
    if (!session || !target) {
        response.writeHead(404);
        response.end();
        return;
    }
    const hlsDownload = parts[1] === "download"
        && (/mpegurl|m3u8/i.test(session.rootMimeType ?? "") || /\.m3u8(?:$|[?#])/i.test(target));
    if (hlsDownload) {
        await writeHlsDownload(request, response, session, target);
    } else {
        await writeUpstream(request, response, session, target);
    }
}

async function ensureServer() {
    if (server && serverUrl) return;
    server = http.createServer((request, response) => {
        void handleRequest(request, response).catch(() => {
            if (!response.headersSent) response.writeHead(500);
            response.end();
        });
    });
    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
            server?.off("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            server?.off("error", onError);
            resolve();
        };
        server?.once("error", onError);
        server?.once("listening", onListening);
        server?.listen(0, "127.0.0.1");
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Video proxy failed to bind");
    serverUrl = `http://127.0.0.1:${address.port}`;
}

class VideoProxyManager {
    setup(windowManager: IWindowManager) {
        ipcMain.handle("@shared/video-proxy/register", async (event, value) => {
            assertIpcSender(event, ["main"]);
            const source = validateSource(value);
            await ensureServer();
            evictExpiredSessions();
            const id = token();
            const session: VideoSession = {
                id,
                ownerId: event.sender.id,
                headers: source.headers ?? {},
                resources: new Map(),
                fallbacks: new Map(),
                rootResourceId: "",
                rootMimeType: source.mimeType,
                lastUsedAt: Date.now(),
            };
            const resourceId = registerResource(session, source.url);
            session.rootResourceId = resourceId;
            if (source.backupUrls?.length) {
                session.fallbacks.set(source.url, source.backupUrls.filter((item) => item !== source.url));
            }
            sessions.set(id, session);
            evictExpiredSessions();
            return {
                id,
                url: proxyResourceUrl(id, resourceId),
                downloadUrl: proxyDownloadUrl(id, resourceId),
            };
        });
        ipcMain.handle("@shared/video-proxy/release", (event, value) => {
            assertIpcSender(event, ["main"]);
            assertIpcPayload(value, 1024);
            assertString(value, "video proxy session id", 128);
            const session = sessions.get(value);
            if (session?.ownerId === event.sender.id) sessions.delete(value);
        });
        cleanupTimer = setInterval(() => evictExpiredSessions(), 60_000);
        cleanupTimer.unref();
        windowManager.on("WindowCreated", (data) => {
            if (data.windowName !== "main") return;
            const ownerId = data.browserWindow.webContents.id;
            data.browserWindow.webContents.once("destroyed", () => {
                for (const [id, session] of sessions) {
                    if (session.ownerId === ownerId) sessions.delete(id);
                }
            });
        });
        app.on("will-quit", () => {
            if (cleanupTimer) clearInterval(cleanupTimer);
            cleanupTimer = null;
            sessions.clear();
            server?.close();
            server = null;
            serverUrl = "";
        });
    }
}

export default new VideoProxyManager();
