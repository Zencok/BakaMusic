const http = require("http");
const serviceIpc = require("./service-ipc.cjs");
const crypto = require("crypto");
const path = require("path");
const {
    MAX_PROXY_RESPONSE_BYTES,
    REQUEST_TIMEOUT_MS,
    assertSafeTargetUrl,
    createSessionStore,
    requestUpstream,
    writeProxyError,
} = require("./proxy-common.cjs");

const nativeQmc2 = require(path.join(__dirname, "native", "qmc2.node"));
console.log("[mflac-proxy] Native QMC2 module loaded");

const defaultPort = Number(process.env.MFLAC_PROXY_PORT || 0);
let currentPort = null;

function normalizeEkey(input) {
    const value = input.trim();
    return value.length > 704 ? value.slice(value.length - 704) : value;
}

function getMimeType(url) {
    const lower = url.split("?", 1)[0].toLowerCase();
    if (lower.endsWith(".mgg")) return "audio/ogg";
    if (lower.endsWith(".mmp4")) return "audio/mp4";
    return "audio/flac";
}

function destroySession(session) {
    if (!session.nativeHandle) return;
    try { nativeQmc2.destroyDecoder(session.nativeHandle); } catch { /* already released */ }
    session.nativeHandle = null;
}

const sessions = createSessionStore({
    maxEntries: 256,
    ttlMs: 30 * 60 * 1000,
    dispose: destroySession,
});

function generateToken() {
    return crypto.randomBytes(16).toString("hex");
}

function validHeaders(headers) {
    return headers === undefined || (
        headers
        && typeof headers === "object"
        && !Array.isArray(headers)
        && Object.keys(headers).length <= 64
    );
}

serviceIpc.onMessage(async (message) => {
    if (!message || message.type !== "register") return;
    const { requestId, src, ekey, headers } = message;
    const reply = (payload) => serviceIpc.send({ ...payload, requestId });
    if (
        typeof requestId !== "string"
        || requestId.length > 128
        || typeof src !== "string"
        || typeof ekey !== "string"
        || !validHeaders(headers)
    ) {
        reply({ type: "error", error: "Invalid registration payload" });
        return;
    }
    if (!currentPort) {
        reply({ type: "error", error: "mflac-proxy is not listening" });
        return;
    }

    try {
        await assertSafeTargetUrl(src);
        const keyBuffer = nativeQmc2.decryptEKey(normalizeEkey(ekey));
        if (!keyBuffer?.length) {
            throw new Error("Failed to decrypt ekey");
        }
        const token = generateToken();
        sessions.set(token, {
            src,
            headers: headers || {},
            nativeHandle: nativeQmc2.createDecoder(keyBuffer),
            mimeType: getMimeType(src),
            contentLength: null,
        });
        reply({
            type: "registered",
            token,
            localUrl: `http://127.0.0.1:${currentPort}/m/${token}`,
        });
    } catch (error) {
        reply({ type: "error", error: String(error?.message || error) });
    }
});

function parseRangeStart(rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader || "");
    if (!match) return { start: 0, end: null };
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : null;
    if (!Number.isSafeInteger(start) || start < 0 || (end !== null && end < start)) {
        return { start: 0, end: null };
    }
    return { start, end };
}

function streamDecrypted(upstream, req, res, session, options) {
    return new Promise((resolve, reject) => {
        let currentOffset = options.dataOffset;
        let skipBytes = options.skipBytes;
        let remaining = options.remaining;
        let upstreamBytes = 0;
        let settled = false;

        const finish = (error) => {
            if (settled) return;
            settled = true;
            res.removeListener("close", cancel);
            req.removeListener("aborted", cancel);
            error ? reject(error) : resolve();
        };
        const cancel = () => {
            upstream.destroy();
            finish();
        };
        req.once("aborted", cancel);
        res.once("close", cancel);

        upstream.on("data", (chunk) => {
            upstreamBytes += chunk.length;
            if (upstreamBytes > MAX_PROXY_RESPONSE_BYTES) {
                upstream.destroy(new Error("Upstream response exceeds proxy limit"));
                return;
            }

            let buffer = Buffer.from(chunk);
            if (skipBytes > 0) {
                const skipped = Math.min(skipBytes, buffer.length);
                skipBytes -= skipped;
                currentOffset += skipped;
                buffer = buffer.subarray(skipped);
            }
            if (!buffer.length || remaining === 0) return;
            if (remaining !== null && buffer.length > remaining) {
                buffer = buffer.subarray(0, remaining);
            }

            nativeQmc2.decrypt(session.nativeHandle, currentOffset, buffer);
            currentOffset += buffer.length;
            if (remaining !== null) remaining -= buffer.length;
            if (!res.write(buffer)) {
                upstream.pause();
                res.once("drain", () => upstream.resume());
            }
            if (remaining === 0) {
                upstream.destroy();
                if (!res.writableEnded) res.end();
                finish();
            }
        });
        upstream.once("end", () => {
            if (!res.writableEnded) res.end();
            finish();
        });
        upstream.once("error", (error) => {
            if (!settled) finish(error);
        });
    });
}

async function handleHead(req, res, session) {
    const abortController = new AbortController();
    const cancel = () => abortController.abort();
    req.once("aborted", cancel);
    res.once("close", cancel);
    try {
        const upstream = await requestUpstream(session.src, {
            method: "HEAD",
            headers: session.headers,
            extraHeaders: { "accept-encoding": "identity" },
            signal: abortController.signal,
        });
        const contentLength = upstream.headers["content-length"];
        if (contentLength) session.contentLength = Number(contentLength);
        upstream.resume();
        res.writeHead(upstream.statusCode || 200, {
            "Content-Type": session.mimeType,
            ...(contentLength ? { "Content-Length": contentLength } : {}),
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
        });
        res.end();
    } catch (error) {
        if (!abortController.signal.aborted) writeProxyError(res, 502, "Bad Gateway");
    }
}

async function handleGet(req, res, session) {
    const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : null;
    const requestedRange = parseRangeStart(rangeHeader);
    const abortController = new AbortController();
    const cancel = () => abortController.abort();
    req.once("aborted", cancel);
    res.once("close", () => {
        if (!res.writableFinished) cancel();
    });

    try {
        const upstream = await requestUpstream(session.src, {
            method: "GET",
            headers: session.headers,
            extraHeaders: {
                "accept-encoding": "identity",
                ...(rangeHeader ? { range: rangeHeader } : {}),
            },
            signal: abortController.signal,
        });
        if ((upstream.statusCode || 500) >= 400) {
            upstream.resume();
            writeProxyError(res, upstream.statusCode || 502, "Upstream request failed");
            return;
        }

        const contentRange = upstream.headers["content-range"];
        const rangeMatch = typeof contentRange === "string"
            ? /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(contentRange)
            : null;
        if (
            upstream.statusCode === 206
            && (!rangeMatch || (rangeHeader && Number(rangeMatch[1]) !== requestedRange.start))
        ) {
            upstream.destroy();
            writeProxyError(res, 502, "Invalid upstream Content-Range");
            return;
        }
        const declaredLength = Number(upstream.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_PROXY_RESPONSE_BYTES) {
            upstream.destroy();
            writeProxyError(res, 413, "Upstream response is too large");
            return;
        }

        let responseStatus = upstream.statusCode === 206 ? 206 : 200;
        let responseLength = Number.isFinite(declaredLength) ? declaredLength : null;
        let responseRange = rangeMatch ? contentRange : null;
        let dataOffset = rangeMatch ? Number(rangeMatch[1]) : 0;
        let skipBytes = 0;
        let remaining = responseLength;

        if (rangeHeader && upstream.statusCode === 200 && !Number.isFinite(declaredLength)) {
            upstream.destroy();
            writeProxyError(res, 502, "Upstream ignored Range without a known length");
            return;
        }
        if (rangeHeader && upstream.statusCode === 200 && Number.isFinite(declaredLength)) {
            const end = Math.min(
                requestedRange.end ?? declaredLength - 1,
                declaredLength - 1,
            );
            if (requestedRange.start > end) {
                upstream.destroy();
                res.writeHead(416, { "Content-Range": `bytes */${declaredLength}` });
                res.end();
                return;
            }
            responseStatus = 206;
            responseLength = end - requestedRange.start + 1;
            responseRange = `bytes ${requestedRange.start}-${end}/${declaredLength}`;
            skipBytes = requestedRange.start;
            remaining = responseLength;
        }

        res.writeHead(responseStatus, {
            "Content-Type": session.mimeType,
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
            ...(responseLength !== null ? { "Content-Length": String(responseLength) } : {}),
            ...(responseRange ? { "Content-Range": responseRange } : {}),
        });
        await streamDecrypted(upstream, req, res, session, {
            dataOffset,
            skipBytes,
            remaining,
        });
    } catch (error) {
        if (abortController.signal.aborted) return;
        console.error("[mflac-proxy] stream failed:", error?.message || error);
        if (!res.headersSent) writeProxyError(res, 502, "Bad Gateway");
        else if (!res.destroyed) res.destroy(error instanceof Error ? error : undefined);
    }
}

function startServer(port) {
    const server = http.createServer((req, res) => {
        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers": "Range",
            });
            res.end();
            return;
        }
        if (req.url === "/heartbeat") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("OK");
            return;
        }
        const match = /^\/m\/([a-f0-9]{32})(?:\.[a-z0-9]+)?(?:\?.*)?$/i.exec(req.url || "");
        if (!match) {
            writeProxyError(res, 404, "Not Found");
            return;
        }
        const token = match[1];
        const session = sessions.acquire(token);
        if (!session) {
            writeProxyError(res, 404, "Session Not Found");
            return;
        }
        const release = () => sessions.release(token);
        const operation = req.method === "HEAD"
            ? handleHead(req, res, session)
            : req.method === "GET"
                ? handleGet(req, res, session)
                : Promise.resolve(writeProxyError(res, 405, "Method Not Allowed"));
        void operation.finally(release);
    });
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = REQUEST_TIMEOUT_MS;
    server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        currentPort = typeof address === "object" && address ? address.port : port;
        serviceIpc.send({ type: "port", port: currentPort });
        console.log(`mflac-proxy is running on http://127.0.0.1:${currentPort}`);
    });
    server.on("error", (error) => serviceIpc.send({ type: "error", error: error.message }));
}

const sweepTimer = setInterval(() => sessions.sweep(), 60_000);
sweepTimer.unref();
const closeSessions = () => sessions.close();
process.once("disconnect", closeSessions);
process.once("exit", closeSessions);

startServer(defaultPort);
