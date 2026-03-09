/**
 * mflac-proxy.js — Local Decryption Proxy Service
 *
 * Self-contained Node.js child process that decrypts QMC2 encrypted audio
 * (mflac/mgg/mmp4) on-the-fly and serves it via HTTP.
 *
 * Uses native C++ N-API module for high-performance decryption.
 *
 * IPC API:
 *   Parent sends: { type: "register", src, ekey, headers }
 *   Child replies: { type: "registered", token, localUrl }
 *
 * HTTP endpoints:
 *   HEAD /m/<token> — Content info
 *   GET  /m/<token> — Streamed decrypted audio (Range supported)
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const path = require("path");

// --- Native QMC2 module (C++ N-API) ---
const nativeQmc2 = require(path.join(__dirname, "native", "qmc2.node"));
console.log("[mflac-proxy] Native QMC2 module loaded");

const defaultPort = 17863;
const maxRetries = 20;
let retryCount = 0;
let currentPort = defaultPort;

// =========================================================================
// EKey normalization (kept in JS — trivial string op)
// =========================================================================

function normalizeEkey(input) {
    const s = input.trim();
    return s.length > 704 ? s.slice(s.length - 704) : s;
}

// =========================================================================
// Session Management
// =========================================================================

const sessions = new Map(); // token -> { src, headers, nativeHandle, contentLength, mimeType }

function getMimeType(url) {
    const lower = url.split("?")[0].toLowerCase();
    if (lower.endsWith(".mgg")) return "audio/ogg";
    if (lower.endsWith(".mmp4")) return "audio/mp4";
    return "audio/flac";
}

function generateToken() {
    return crypto.randomBytes(16).toString("hex");
}

// =========================================================================
// IPC: Register stream from parent process
// =========================================================================

process.on("message", (msg) => {
    if (msg && msg.type === "register") {
        const { src, ekey, headers } = msg;
        const normalizedEkey = normalizeEkey(ekey);

        let keyBuf = null;
        try {
            keyBuf = nativeQmc2.decryptEKey(normalizedEkey);
        } catch (e) {
            console.error("[mflac-proxy] decryptEKey threw:", e.message);
        }

        if (!keyBuf || keyBuf.length === 0) {
            console.log("[mflac-proxy] Failed to decrypt ekey");
            process.send({ type: "error", error: "Failed to decrypt ekey" });
            return;
        }

        console.log("[mflac-proxy] Decoded key length:", keyBuf.length,
            "mode:", keyBuf.length <= 300 ? "MapL" : "RC4");

        const nativeHandle = nativeQmc2.createDecoder(keyBuf);
        const token = generateToken();
        const mimeType = getMimeType(src);

        sessions.set(token, {
            src,
            headers: headers || {},
            nativeHandle,
            mimeType,
            contentLength: null,
        });

        const localUrl = `http://127.0.0.1:${currentPort}/m/${token}`;
        process.send({ type: "registered", token, localUrl });
    }
});

// =========================================================================
// HTTP Proxy Server
// =========================================================================

function fetchUpstream(url, headers, rangeHeader) {
    return new Promise((resolve, reject) => {
        let host = headers?.host;
        if (!host || host.includes("localhost") || host.includes("127.0.0.1")) {
            host = new URL(url).host;
        }

        const reqHeaders = { ...(headers || {}), host };
        if (rangeHeader) {
            reqHeaders["range"] = rangeHeader;
        }

        const protocol = url.startsWith("https") ? https : http;
        const req = protocol.request(url, { method: "GET", headers: reqHeaders }, (res) => {
            resolve(res);
        });
        req.on("error", reject);
        req.end();
    });
}

function handleHead(req, res, session) {
    const url = session.src;
    let host = session.headers?.host;
    if (!host || host.includes("localhost") || host.includes("127.0.0.1")) {
        try { host = new URL(url).host; } catch { host = undefined; }
    }
    const reqHeaders = { ...(session.headers || {}), host };

    const protocol = url.startsWith("https") ? https : http;
    const headReq = protocol.request(url, { method: "HEAD", headers: reqHeaders }, (upstream) => {
        const contentLength = upstream.headers["content-length"];
        if (contentLength) {
            session.contentLength = parseInt(contentLength, 10);
        }
        res.writeHead(200, {
            "Content-Type": session.mimeType,
            "Content-Length": contentLength || "",
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
        });
        res.end();
    });
    headReq.on("error", (err) => {
        console.error("[mflac-proxy] HEAD upstream error:", err.message);
        res.writeHead(502);
        res.end("Bad Gateway");
    });
    headReq.end();
}

function handleGet(req, res, session) {
    const rangeHeader = req.headers["range"] || null;
    let rangeStart = 0;

    if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
            rangeStart = parseInt(match[1], 10);
        }
    }

    fetchUpstream(session.src, session.headers, rangeHeader)
        .then((upstream) => {
            const statusCode = upstream.statusCode;
            const contentLength = upstream.headers["content-length"];
            const contentRange = upstream.headers["content-range"];

            // Determine the actual byte offset of the data we're receiving
            let dataOffset = 0;
            if (contentRange) {
                const crMatch = contentRange.match(/bytes (\d+)-/);
                if (crMatch) {
                    dataOffset = parseInt(crMatch[1], 10);
                }
            } else if (rangeHeader && (statusCode === 200)) {
                // Upstream ignored Range, we need to skip bytes
                dataOffset = 0;
            } else {
                dataOffset = rangeStart;
            }

            // Build response headers
            const resHeaders = {
                "Content-Type": session.mimeType,
                "Access-Control-Allow-Origin": "*",
                "Accept-Ranges": "bytes",
            };

            if (contentLength) {
                resHeaders["Content-Length"] = contentLength;
            }
            if (contentRange) {
                resHeaders["Content-Range"] = contentRange;
            }

            const resStatus = (statusCode === 206) ? 206 : 200;
            res.writeHead(resStatus, resHeaders);

            // Stream and decrypt
            let currentOffset = dataOffset;
            let skipBytes = 0;

            // If upstream returned 200 but we requested a range, skip bytes
            if (rangeHeader && statusCode === 200 && rangeStart > 0) {
                skipBytes = rangeStart;
            }

            upstream.on("data", (chunk) => {
                let buf = Buffer.from(chunk);

                if (skipBytes > 0) {
                    if (skipBytes >= buf.length) {
                        skipBytes -= buf.length;
                        currentOffset += buf.length;
                        return;
                    }
                    buf = buf.subarray(skipBytes);
                    currentOffset += skipBytes;
                    skipBytes = 0;
                }

                // Decrypt in-place (native C++)
                nativeQmc2.decrypt(session.nativeHandle, currentOffset, buf);
                currentOffset += buf.length;

                if (!res.writableEnded) {
                    res.write(buf);
                }
            });

            upstream.on("end", () => {
                if (!res.writableEnded) {
                    res.end();
                }
            });

            upstream.on("error", (err) => {
                console.error("[mflac-proxy] Upstream stream error:", err.message);
                if (!res.writableEnded) {
                    res.end();
                }
            });
        })
        .catch((err) => {
            console.error("[mflac-proxy] Fetch upstream error:", err.message);
            res.writeHead(502);
            res.end("Bad Gateway");
        });
}

function startServer(port) {
    const server = http.createServer((req, res) => {
        // CORS preflight
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

        // Parse /m/<token>
        const match = req.url.match(/^\/m\/([a-f0-9]+)/);
        if (!match) {
            res.writeHead(404);
            return res.end("Not Found");
        }

        const token = match[1];
        const session = sessions.get(token);
        if (!session) {
            res.writeHead(404);
            return res.end("Session Not Found");
        }

        if (req.method === "HEAD") {
            handleHead(req, res, session);
        } else if (req.method === "GET") {
            handleGet(req, res, session);
        } else {
            res.writeHead(405);
            res.end("Method Not Allowed");
        }
    });

    server.listen(port, "127.0.0.1", () => {
        currentPort = port;
        process.send?.({ type: "port", port });
        console.log(`mflac-proxy is running on http://localhost:${port}`);
    });

    server.on("error", (err) => {
        console.error("Server error:", err);
        if (retryCount < maxRetries) {
            retryCount++;
            const newPort = port + 1;
            console.log(`Retrying on port: ${newPort} (attempt ${retryCount})`);
            startServer(newPort);
        } else {
            process.send?.({ type: "error", error: "Max retries reached" });
        }
    });
}

// Clean up stale sessions periodically (every 30 minutes)
setInterval(() => {
    if (sessions.size > 1000) {
        const keys = [...sessions.keys()];
        const toRemove = keys.slice(0, keys.length - 500);
        toRemove.forEach((k) => sessions.delete(k));
    }
}, 30 * 60 * 1000);

startServer(defaultPort);
