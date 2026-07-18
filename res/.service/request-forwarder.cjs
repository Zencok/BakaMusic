const http = require("http");
const serviceIpc = require("./service-ipc.cjs");
const { pipeline } = require("stream/promises");
const {
    MAX_PROXY_RESPONSE_BYTES,
    REQUEST_TIMEOUT_MS,
    createByteLimitTransform,
    pickResponseHeaders,
    requestUpstream,
    writeProxyError,
} = require("./proxy-common.cjs");

const defaultPort = Number(process.env.REQUEST_FORWARDER_PORT || 0);

function parseHeaders(value) {
    if (!value || value.length > 32 * 1024) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

async function handleForwardRequest(req, res, targetUrl, method, configuredHeaders) {
    const abortController = new AbortController();
    const cancel = () => abortController.abort();
    req.once("aborted", cancel);
    res.once("close", () => {
        if (!res.writableFinished) cancel();
    });

    try {
        const upstream = await requestUpstream(targetUrl, {
            method,
            headers: {
                ...req.headers,
                ...configuredHeaders,
            },
            signal: abortController.signal,
        });
        if (abortController.signal.aborted) {
            upstream.destroy();
            return;
        }

        const declaredLength = Number(upstream.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_PROXY_RESPONSE_BYTES) {
            upstream.destroy();
            writeProxyError(res, 413, "Upstream response is too large");
            return;
        }

        const responseHeaders = {
            ...pickResponseHeaders(upstream.headers),
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range, X-BakaMusic-Final-URL",
            "x-bakamusic-final-url": upstream.__targetUrl,
        };
        res.writeHead(upstream.statusCode || 502, responseHeaders);
        if (method === "HEAD") {
            upstream.resume();
            res.end();
            return;
        }

        await pipeline(
            upstream,
            createByteLimitTransform(),
            res,
        );
    } catch (error) {
        if (abortController.signal.aborted) return;
        console.error("[request-forwarder] request failed:", error?.message || error);
        if (!res.headersSent) {
            writeProxyError(res, 502, "Bad Gateway");
        } else if (!res.destroyed) {
            res.destroy(error instanceof Error ? error : undefined);
        }
    } finally {
        req.removeListener("aborted", cancel);
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
        if (!req.url || req.url.length > 64 * 1024) {
            writeProxyError(res, 414, "URI Too Long");
            return;
        }
        if (!new Set(["GET", "HEAD"]).has(req.method || "")) {
            writeProxyError(res, 405, "Method Not Allowed");
            return;
        }

        const query = new URL(req.url, "http://127.0.0.1").searchParams;
        const targetUrl = query.get("url");
        const requestedMethod = (query.get("method") || req.method || "GET").toUpperCase();
        if (!targetUrl || !new Set(["GET", "HEAD"]).has(requestedMethod)) {
            writeProxyError(res, 400, "Invalid proxy request");
            return;
        }

        void handleForwardRequest(
            req,
            res,
            targetUrl,
            requestedMethod,
            parseHeaders(query.get("headers")),
        );
    });

    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = REQUEST_TIMEOUT_MS;
    server.keepAliveTimeout = 5_000;
    server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const servicePort = typeof address === "object" && address ? address.port : port;
        serviceIpc.send({ type: "port", port: servicePort });
        console.log(`request-forwarder is running on http://127.0.0.1:${servicePort}`);
    });
    server.on("error", (error) => {
        console.error("[request-forwarder] server error:", error);
        serviceIpc.send({ type: "error", error: error.message });
    });
}

startServer(defaultPort);
