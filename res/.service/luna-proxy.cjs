/**
 * luna-proxy.cjs - Local CENC streaming-decryption proxy.
 *
 * Self-contained Node.js child process that decrypts CENC (cenc-aes-ctr)
 * protected m4a audio on the fly and serves plaintext over local HTTP with
 * full Range/seek support. Uses the native `ence.node` decryptor.
 *
 * IPC:
 *   Parent: { type: "register", requestId, src, cek, headers }
 *   Child:  { type: "registered", requestId, token, localUrl } | { type: "error", requestId, error }
 *
 * HTTP:
 *   HEAD /l/<token>  - content info (plaintext output length)
 *   GET  /l/<token>  - streamed decrypted m4a (Range supported)
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const path = require("path");

const native = require(path.join(__dirname, "native", "ence.node"));
console.log("[luna-proxy] Native CENC module loaded");

const defaultPort = Number(process.env.LUNA_PROXY_PORT || 0);
let currentPort = null;

// token -> { handle, headerBuf, layout, src, headers }
const sessions = new Map();

function generateToken() {
    return crypto.randomBytes(16).toString("hex");
}

// =========================================================================
// Upstream helpers
// =========================================================================

function getUrlHost(url) {
    try {
        return new URL(url).host;
    } catch {
        return undefined;
    }
}

function buildUpstreamHeaders(url, headers, extraHeaders) {
    const reqHeaders = { ...(headers || {}) };
    delete reqHeaders.host;
    delete reqHeaders.Host;
    delete reqHeaders.range;
    delete reqHeaders.Range;

    const host = getUrlHost(url);
    if (host) reqHeaders.host = host;
    return { ...reqHeaders, ...(extraHeaders || {}) };
}

// GET a byte range; resolves with { status, headers, body }. Follows redirects.
function httpGetRange(url, headers, start, end, redirects = 5) {
    return new Promise((resolve, reject) => {
        const rangeHeaders = {};
        if (start != null) {
            rangeHeaders.range = `bytes=${start}-${end != null ? end : ""}`;
        }
        const reqHeaders = buildUpstreamHeaders(url, headers, rangeHeaders);
        const protocol = url.startsWith("https") ? https : http;
        const req = protocol.request(url, { method: "GET", headers: reqHeaders }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
                res.resume();
                resolve(httpGetRange(new URL(res.headers.location, url).href, headers, start, end, redirects - 1));
                return;
            }
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject);
        req.end();
    });
}

function parseTotalSize(headers, status) {
    const cr = headers["content-range"];
    if (cr) {
        const m = cr.match(/\/(\d+)\s*$/);
        if (m) return parseInt(m[1], 10);
    }
    if (status === 200 && headers["content-length"]) {
        return parseInt(headers["content-length"], 10);
    }
    return null;
}

// =========================================================================
// moov / mdat discovery (handles moov at head or tail)
// =========================================================================

const PROBE_SIZE = 256 * 1024;

async function readBoxHeaderAt(src, headers, offset, cache) {
    let hdr;
    if (cache && offset >= cache.start && offset + 16 <= cache.start + cache.buf.length) {
        hdr = cache.buf.subarray(offset - cache.start, offset - cache.start + 16);
    } else {
        const r = await httpGetRange(src, headers, offset, offset + 15);
        hdr = r.body;
    }
    if (hdr.length < 8) return null;
    let size = hdr.readUInt32BE(0);
    const type = hdr.toString("latin1", 4, 8);
    let headerSize = 8;
    if (size === 1) {
        if (hdr.length < 16) return null;
        size = Number(hdr.readBigUInt64BE(8));
        headerSize = 16;
    }
    return { type, size, headerSize };
}

async function fetchRangeBuf(src, headers, offset, size, cache) {
    if (cache && offset >= cache.start && offset + size <= cache.start + cache.buf.length) {
        return cache.buf.subarray(offset - cache.start, offset - cache.start + size);
    }
    const r = await httpGetRange(src, headers, offset, offset + size - 1);
    return r.body;
}

async function discoverLayout(src, headers) {
    const first = await httpGetRange(src, headers, 0, PROBE_SIZE - 1);
    const total = parseTotalSize(first.headers, first.status);
    const cache = { start: 0, buf: first.body };

    let ftyp = null;
    let moov = null;
    let mdatPayloadOffset = null;
    let mdatPayloadSize = null;

    const fileEnd = total != null ? total : first.body.length;
    let offset = 0;
    let guard = 0;
    while (offset + 8 <= fileEnd && guard++ < 4096) {
        const bh = await readBoxHeaderAt(src, headers, offset, cache);
        if (!bh || bh.size <= 0) break;
        if (bh.type === "ftyp") {
            ftyp = await fetchRangeBuf(src, headers, offset, bh.size, cache);
        } else if (bh.type === "moov") {
            moov = await fetchRangeBuf(src, headers, offset, bh.size, cache);
        } else if (bh.type === "mdat") {
            mdatPayloadOffset = offset + bh.headerSize;
            mdatPayloadSize = bh.size - bh.headerSize;
        }
        if (ftyp && moov && mdatPayloadOffset != null) break;
        offset += bh.size;
    }

    return { ftyp, moov, mdatPayloadOffset, mdatPayloadSize };
}

// =========================================================================
// IPC: register a stream
// =========================================================================

process.on("message", async (msg) => {
    if (!msg || msg.type !== "register") return;
    const { requestId, src, cek, headers } = msg;
    const reply = (payload) => process.send?.({ ...payload, requestId });

    if (!currentPort) {
        reply({ type: "error", error: "luna-proxy is not listening" });
        return;
    }

    try {
        const cekText = String(cek || "").trim();
        if (!/^[a-f0-9]{32}$/i.test(cekText)) {
            reply({ type: "error", error: "invalid cek (need 32 hex chars)" });
            return;
        }
        const cekBuf = Buffer.from(cekText, "hex");

        const layout = await discoverLayout(src, headers);
        if (!layout.moov || layout.mdatPayloadOffset == null) {
            reply({ type: "error", error: "failed to locate moov/mdat" });
            return;
        }

        const ftypBuf = layout.ftyp || Buffer.alloc(0);
        const handle = native.createDecoder(
            ftypBuf,
            layout.moov,
            cekBuf,
            layout.mdatPayloadOffset,
            layout.mdatPayloadSize,
        );

        const info = native.getInfo(handle);
        if (!info.ok) {
            native.destroyDecoder(handle);
            reply({ type: "error", error: info.error || "decoder init failed" });
            return;
        }

        const headerBuf = native.getHeader(handle);
        const token = generateToken();
        sessions.set(token, { handle, headerBuf, layout: info, src, headers: headers || {} });

        const localUrl = `http://127.0.0.1:${currentPort}/l/${token}`;
        reply({ type: "registered", token, localUrl });
    } catch (e) {
        reply({ type: "error", error: String((e && e.message) || e) });
    }
});

// =========================================================================
// HTTP serving (plaintext = [header][decrypted mdat payload])
// =========================================================================

function parseRange(rangeHeader, total) {
    if (!rangeHeader) return null;
    const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!m) return null;
    let start = m[1] === "" ? null : parseInt(m[1], 10);
    let end = m[2] === "" ? null : parseInt(m[2], 10);
    if (start == null && end == null) return null;
    if (start == null) {
        start = Math.max(0, total - end);
        end = total - 1;
    } else if (end == null) {
        end = total - 1;
    }
    if (end >= total) end = total - 1;
    if (start < 0) start = 0;
    if (start > end) return null;
    return { start, end };
}

// Stream-decrypt the mdat byte range [mdatStartRel, mdatEndRel] (inclusive,
// relative to the mdat payload) into res.
function streamDecryptMdat(res, session, mdatStartRel, mdatEndRel) {
    return new Promise((resolve, reject) => {
        const { handle, src, headers, layout } = session;
        const cdnStart = layout.mdatFileOffset + mdatStartRel;
        const cdnEnd = layout.mdatFileOffset + mdatEndRel;

        const doRequest = (url, redirects) => {
            const reqHeaders = buildUpstreamHeaders(url, headers, {
                range: `bytes=${cdnStart}-${cdnEnd}`,
            });

            const protocol = url.startsWith("https") ? https : http;
            const upReq = protocol.request(url, { method: "GET", headers: reqHeaders }, (up) => {
                if ([301, 302, 303, 307, 308].includes(up.statusCode) && up.headers.location && redirects > 0) {
                    up.resume();
                    return doRequest(new URL(up.headers.location, url).href, redirects - 1);
                }

                let skip = up.statusCode === 200 && cdnStart > 0 ? cdnStart : 0;
                let curRel = mdatStartRel;
                let remaining = mdatEndRel - mdatStartRel + 1;

                up.on("data", (chunk) => {
                    if (remaining <= 0) return;
                    let buf = Buffer.from(chunk);
                    if (skip > 0) {
                        if (skip >= buf.length) {
                            skip -= buf.length;
                            return;
                        }
                        buf = buf.subarray(skip);
                        skip = 0;
                    }
                    if (buf.length > remaining) {
                        buf = buf.subarray(0, remaining);
                    }
                    native.decrypt(handle, curRel, buf);
                    curRel += buf.length;
                    remaining -= buf.length;
                    if (!res.writableEnded) res.write(buf);
                    if (remaining <= 0) {
                        up.destroy();
                        if (!res.writableEnded) res.end();
                        resolve();
                    }
                });
                up.on("end", () => {
                    if (!res.writableEnded) res.end();
                    resolve();
                });
                up.on("error", (err) => {
                    if (!res.writableEnded) res.end();
                    reject(err);
                });
            });
            upReq.on("error", reject);
            upReq.end();
        };

        doRequest(src, 5);
    });
}

async function serveRange(res, session, start, end) {
    const headerSize = session.layout.headerSize;

    // 1. header portion [start, min(end+1, headerSize))
    if (start < headerSize) {
        const hEnd = Math.min(end + 1, headerSize);
        if (!res.writableEnded) res.write(session.headerBuf.subarray(start, hEnd));
        if (end < headerSize) {
            if (!res.writableEnded) res.end();
            return;
        }
    }

    // 2. mdat portion
    const mdatStartRel = Math.max(start, headerSize) - headerSize;
    const mdatEndRel = end - headerSize;
    await streamDecryptMdat(res, session, mdatStartRel, mdatEndRel);
}

function handleRequest(req, res, session) {
    const total = session.layout.outputTotalSize;
    const range = parseRange(req.headers["range"], total);
    const start = range ? range.start : 0;
    const end = range ? range.end : total - 1;

    const respHeaders = {
        "Content-Type": "audio/mp4",
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Access-Control-Allow-Origin": "*",
    };
    if (range) {
        respHeaders["Content-Range"] = `bytes ${start}-${end}/${total}`;
    }
    res.writeHead(range ? 206 : 200, respHeaders);

    if (req.method === "HEAD") {
        res.end();
        return;
    }

    serveRange(res, session, start, end).catch((err) => {
        console.error("[luna-proxy] serve error:", err && err.message);
        if (!res.writableEnded) res.end();
    });
}

function startServer(port) {
    const server = http.createServer((req, res) => {
        if (req.method === "OPTIONS") {
            res.writeHead(200, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers": "Range",
            });
            return res.end();
        }
        if (req.url === "/heartbeat") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            return res.end("OK");
        }

        const match = req.url.match(/^\/l\/([a-f0-9]+)/);
        if (!match) {
            res.writeHead(404);
            return res.end("Not Found");
        }
        const session = sessions.get(match[1]);
        if (!session) {
            res.writeHead(404);
            return res.end("Session Not Found");
        }
        if (req.method === "GET" || req.method === "HEAD") {
            handleRequest(req, res, session);
        } else {
            res.writeHead(405);
            res.end("Method Not Allowed");
        }
    });

    server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        currentPort = typeof address === "object" && address ? address.port : port;
        process.send?.({ type: "port", port: currentPort });
        console.log(`luna-proxy is running on http://127.0.0.1:${currentPort}`);
    });

    server.on("error", (err) => {
        console.error("Server error:", err);
        process.send?.({ type: "error", error: err.message });
    });
}

// Periodically drop stale sessions (and free native decoders).
setInterval(() => {
    if (sessions.size > 500) {
        const keys = [...sessions.keys()];
        const toRemove = keys.slice(0, keys.length - 250);
        toRemove.forEach((k) => {
            const s = sessions.get(k);
            if (s && s.handle) {
                try { native.destroyDecoder(s.handle); } catch { /* ignore */ }
            }
            sessions.delete(k);
        });
    }
}, 30 * 60 * 1000);

startServer(defaultPort);
