const http = require("http");
const serviceIpc = require("./service-ipc.cjs");
const crypto = require("crypto");
const path = require("path");
const { once } = require("events");
const {
    MAX_PROXY_RESPONSE_BYTES,
    REQUEST_TIMEOUT_MS,
    assertSafeTargetUrl,
    createSessionStore,
    requestUpstream,
    writeProxyError,
} = require("./proxy-common.cjs");

const native = require(path.join(__dirname, "native", "ence.node"));
console.log("[luna-proxy] Native CENC module loaded");

const defaultPort = Number(process.env.LUNA_PROXY_PORT || 0);
const PROBE_SIZE = 256 * 1024;
const MAX_LAYOUT_FETCH_BYTES = 32 * 1024 * 1024;
let currentPort = null;

function destroySession(session) {
    if (!session.handle) return;
    try { native.destroyDecoder(session.handle); } catch { /* already released */ }
    session.handle = null;
}

const sessions = createSessionStore({
    maxEntries: 128,
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

function parseTotalSize(headers, status) {
    const contentRange = headers["content-range"];
    if (typeof contentRange === "string") {
        const match = /\/(\d+)\s*$/.exec(contentRange);
        if (match) return Number(match[1]);
    }
    const contentLength = Number(headers["content-length"]);
    return status === 200 && Number.isSafeInteger(contentLength) ? contentLength : null;
}

async function httpGetRange(url, headers, start, end) {
    const requestedSize = end - start + 1;
    if (
        !Number.isSafeInteger(start)
        || !Number.isSafeInteger(end)
        || start < 0
        || requestedSize <= 0
        || requestedSize > MAX_LAYOUT_FETCH_BYTES
    ) {
        throw new Error("Invalid or oversized layout range");
    }

    const upstream = await requestUpstream(url, {
        method: "GET",
        headers,
        extraHeaders: {
            "accept-encoding": "identity",
            range: `bytes=${start}-${end}`,
        },
    });
    if (![200, 206].includes(upstream.statusCode)) {
        upstream.resume();
        throw new Error(`Unexpected layout response: ${upstream.statusCode}`);
    }
    const responseStart = typeof upstream.headers["content-range"] === "string"
        ? Number(/^bytes\s+(\d+)-/i.exec(upstream.headers["content-range"])?.[1])
        : 0;
    if (upstream.statusCode === 206 && responseStart !== start) {
        upstream.destroy();
        throw new Error("Layout Content-Range does not match request");
    }

    const chunks = [];
    let skip = upstream.statusCode === 200 ? start : 0;
    let remaining = requestedSize;
    let collected = 0;
    let upstreamBytes = 0;
    for await (const chunk of upstream) {
        upstreamBytes += chunk.length;
        if (upstreamBytes > MAX_LAYOUT_FETCH_BYTES) {
            upstream.destroy();
            throw new Error("Layout response exceeds limit");
        }
        let buffer = Buffer.from(chunk);
        if (skip > 0) {
            const skipped = Math.min(skip, buffer.length);
            skip -= skipped;
            buffer = buffer.subarray(skipped);
        }
        if (!buffer.length) continue;
        if (buffer.length > remaining) buffer = buffer.subarray(0, remaining);
        chunks.push(buffer);
        collected += buffer.length;
        remaining -= buffer.length;
        if (remaining === 0) {
            upstream.destroy();
            break;
        }
    }
    return {
        status: upstream.statusCode,
        headers: upstream.headers,
        body: Buffer.concat(chunks, collected),
    };
}

async function readBoxHeaderAt(src, headers, offset, cache) {
    let header;
    if (cache && offset >= cache.start && offset + 16 <= cache.start + cache.buffer.length) {
        header = cache.buffer.subarray(offset - cache.start, offset - cache.start + 16);
    } else {
        header = (await httpGetRange(src, headers, offset, offset + 15)).body;
    }
    if (header.length < 8) return null;
    let size = header.readUInt32BE(0);
    const type = header.toString("latin1", 4, 8);
    let headerSize = 8;
    if (size === 1) {
        if (header.length < 16) return null;
        size = Number(header.readBigUInt64BE(8));
        headerSize = 16;
    }
    if (!Number.isSafeInteger(size) || size < headerSize) return null;
    return { type, size, headerSize };
}

async function fetchRangeBuffer(src, headers, offset, size, cache) {
    if (size > MAX_LAYOUT_FETCH_BYTES) throw new Error("ISO box exceeds layout limit");
    if (cache && offset >= cache.start && offset + size <= cache.start + cache.buffer.length) {
        return cache.buffer.subarray(offset - cache.start, offset - cache.start + size);
    }
    return (await httpGetRange(src, headers, offset, offset + size - 1)).body;
}

async function discoverLayout(src, headers) {
    const first = await httpGetRange(src, headers, 0, PROBE_SIZE - 1);
    const total = parseTotalSize(first.headers, first.status);
    if (!Number.isSafeInteger(total) || total <= 0) {
        throw new Error("Upstream media length is unavailable");
    }
    const cache = { start: 0, buffer: first.body };
    let ftyp = null;
    let moov = null;
    let mdatPayloadOffset = null;
    let mdatPayloadSize = null;
    let offset = 0;

    for (let guard = 0; offset + 8 <= total && guard < 4096; guard++) {
        const box = await readBoxHeaderAt(src, headers, offset, cache);
        if (!box || offset + box.size > total) break;
        if (box.type === "ftyp") {
            ftyp = await fetchRangeBuffer(src, headers, offset, box.size, cache);
        } else if (box.type === "moov") {
            moov = await fetchRangeBuffer(src, headers, offset, box.size, cache);
        } else if (box.type === "mdat") {
            mdatPayloadOffset = offset + box.headerSize;
            mdatPayloadSize = box.size - box.headerSize;
        }
        if (ftyp && moov && mdatPayloadOffset !== null) break;
        offset += box.size;
    }
    return { ftyp, moov, mdatPayloadOffset, mdatPayloadSize };
}

serviceIpc.onMessage(async (message) => {
    if (!message || message.type !== "register") return;
    const { requestId, src, cek, headers } = message;
    const reply = (payload) => serviceIpc.send({ ...payload, requestId });
    if (
        typeof requestId !== "string"
        || requestId.length > 128
        || typeof src !== "string"
        || !validHeaders(headers)
    ) {
        reply({ type: "error", error: "Invalid registration payload" });
        return;
    }
    if (!currentPort) {
        reply({ type: "error", error: "luna-proxy is not listening" });
        return;
    }

    let handle = null;
    try {
        await assertSafeTargetUrl(src);
        const cekText = String(cek || "").trim();
        if (!/^[a-f0-9]{32}$/i.test(cekText)) {
            throw new Error("Invalid CENC key");
        }
        const layout = await discoverLayout(src, headers || {});
        if (!layout.moov || layout.mdatPayloadOffset === null) {
            throw new Error("Failed to locate moov/mdat");
        }
        handle = native.createDecoder(
            layout.ftyp || Buffer.alloc(0),
            layout.moov,
            Buffer.from(cekText, "hex"),
            layout.mdatPayloadOffset,
            layout.mdatPayloadSize,
        );
        const info = native.getInfo(handle);
        if (!info.ok || !Number.isSafeInteger(info.outputTotalSize) || info.outputTotalSize <= 0) {
            throw new Error(info.error || "Decoder initialization failed");
        }
        const token = generateToken();
        sessions.set(token, {
            handle,
            headerBuffer: native.getHeader(handle),
            layout: info,
            src,
            headers: headers || {},
        });
        handle = null;
        reply({
            type: "registered",
            token,
            localUrl: `http://127.0.0.1:${currentPort}/l/${token}`,
        });
    } catch (error) {
        if (handle) {
            try { native.destroyDecoder(handle); } catch { /* cleanup failure */ }
        }
        reply({ type: "error", error: String(error?.message || error) });
    }
});

function parseRange(rangeHeader, total) {
    if (!rangeHeader) return null;
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) return false;
    let start = match[1] ? Number(match[1]) : null;
    let end = match[2] ? Number(match[2]) : null;
    if (start === null) {
        const suffixLength = end;
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
        start = Math.max(0, total - suffixLength);
        end = total - 1;
    } else {
        if (!Number.isSafeInteger(start) || start < 0) return false;
        end = end === null ? total - 1 : Math.min(end, total - 1);
    }
    if (!Number.isSafeInteger(end) || start >= total || start > end) return false;
    return { start, end };
}

async function writeWithBackpressure(res, buffer) {
    if (!buffer.length || res.writableEnded) return;
    if (!res.write(buffer)) {
        await Promise.race([
            once(res, "drain"),
            once(res, "close").then(() => {
                throw new Error("Client disconnected");
            }),
        ]);
    }
}

async function streamDecryptMdat(req, res, session, startRelative, endRelative, signal) {
    const cdnStart = session.layout.mdatFileOffset + startRelative;
    const cdnEnd = session.layout.mdatFileOffset + endRelative;
    const upstream = await requestUpstream(session.src, {
        method: "GET",
        headers: session.headers,
        extraHeaders: {
            "accept-encoding": "identity",
            range: `bytes=${cdnStart}-${cdnEnd}`,
        },
        signal,
    });

    return new Promise((resolve, reject) => {
        if (![200, 206].includes(upstream.statusCode)) {
            upstream.resume();
            reject(new Error(`Unexpected media response: ${upstream.statusCode}`));
            return;
        }
        const responseStart = typeof upstream.headers["content-range"] === "string"
            ? Number(/^bytes\s+(\d+)-/i.exec(upstream.headers["content-range"])?.[1])
            : 0;
        if (upstream.statusCode === 206 && responseStart !== cdnStart) {
            upstream.destroy();
            reject(new Error("Media Content-Range does not match request"));
            return;
        }

        let skip = upstream.statusCode === 200 ? cdnStart : 0;
        let currentRelative = startRelative;
        let remaining = endRelative - startRelative + 1;
        let upstreamBytes = 0;
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            req.removeListener("aborted", cancel);
            res.removeListener("close", cancel);
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
            if (skip > 0) {
                const skipped = Math.min(skip, buffer.length);
                skip -= skipped;
                buffer = buffer.subarray(skipped);
            }
            if (!buffer.length || remaining === 0) return;
            if (buffer.length > remaining) buffer = buffer.subarray(0, remaining);
            native.decrypt(session.handle, currentRelative, buffer);
            currentRelative += buffer.length;
            remaining -= buffer.length;
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
            if (remaining !== 0) {
                finish(new Error("Upstream media response is truncated"));
                return;
            }
            if (!res.writableEnded) res.end();
            finish();
        });
        upstream.once("error", (error) => {
            if (!settled) finish(error);
        });
    });
}

async function serveRange(req, res, session, start, end, signal) {
    const headerSize = session.layout.headerSize;
    if (start < headerSize) {
        const headerEnd = Math.min(end + 1, headerSize);
        await writeWithBackpressure(res, session.headerBuffer.subarray(start, headerEnd));
        if (end < headerSize) {
            res.end();
            return;
        }
    }
    const mdatStart = Math.max(start, headerSize) - headerSize;
    const mdatEnd = end - headerSize;
    await streamDecryptMdat(req, res, session, mdatStart, mdatEnd, signal);
}

async function handleRequest(req, res, session) {
    const total = session.layout.outputTotalSize;
    const range = parseRange(req.headers.range, total);
    if (range === false) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        res.end();
        return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? total - 1;
    const responseSize = end - start + 1;
    if (responseSize > MAX_PROXY_RESPONSE_BYTES) {
        writeProxyError(res, 413, "Requested range is too large");
        return;
    }

    res.writeHead(range ? 206 : 200, {
        "Content-Type": "audio/mp4",
        "Accept-Ranges": "bytes",
        "Content-Length": String(responseSize),
        "Access-Control-Allow-Origin": "*",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}),
    });
    if (req.method === "HEAD") {
        res.end();
        return;
    }

    const abortController = new AbortController();
    const cancel = () => abortController.abort();
    req.once("aborted", cancel);
    res.once("close", () => {
        if (!res.writableFinished) cancel();
    });
    try {
        await serveRange(req, res, session, start, end, abortController.signal);
    } catch (error) {
        if (!abortController.signal.aborted && !res.destroyed) {
            res.destroy(error instanceof Error ? error : undefined);
        }
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
        const match = /^\/l\/([a-f0-9]{32})(?:\.[a-z0-9]+)?(?:\?.*)?$/i.exec(req.url || "");
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
        const operation = ["GET", "HEAD"].includes(req.method)
            ? handleRequest(req, res, session)
            : Promise.resolve(writeProxyError(res, 405, "Method Not Allowed"));
        void operation.finally(() => sessions.release(token));
    });
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = REQUEST_TIMEOUT_MS;
    server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        currentPort = typeof address === "object" && address ? address.port : port;
        serviceIpc.send({ type: "port", port: currentPort });
        console.log(`luna-proxy is running on http://127.0.0.1:${currentPort}`);
    });
    server.on("error", (error) => serviceIpc.send({ type: "error", error: error.message }));
}

const sweepTimer = setInterval(() => sessions.sweep(), 60_000);
sweepTimer.unref();
const closeSessions = () => sessions.close();
process.once("disconnect", closeSessions);
process.once("exit", closeSessions);

startServer(defaultPort);
