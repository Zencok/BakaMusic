import {
    app,
    BrowserWindow,
    session,
} from "electron";

const productionCsp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: file: bakamusic-theme: https: http:",
    "media-src 'self' data: blob: file: bakamusic-media: bakamusic-theme: https: http:",
    "font-src 'self' data: file: bakamusic-theme:",
    "connect-src 'self' https: http: ws: wss:",
    "worker-src 'self' blob:",
    "frame-src 'self' data: blob: bakamusic-theme:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
].join("; ");

const developmentCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: file: bakamusic-theme: https: http:",
    "media-src 'self' data: blob: file: bakamusic-media: bakamusic-theme: https: http:",
    "font-src 'self' data: file: bakamusic-theme:",
    "connect-src 'self' https: http: ws: wss:",
    "worker-src 'self' blob:",
    "frame-src 'self' data: blob: bakamusic-theme:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
].join("; ");

let sessionSecurityConfigured = false;

function setResponseHeader(
    headers: Record<string, string[]>,
    name: string,
    values: string[],
) {
    for (const key of Object.keys(headers)) {
        if (key.toLocaleLowerCase() === name.toLocaleLowerCase()) {
            delete headers[key];
        }
    }
    headers[name] = values;
}

function allowRendererReadableMediaCors(
    details: Electron.OnHeadersReceivedListenerDetails,
    responseHeaders: Record<string, string[]>,
) {
    if (
        details.resourceType !== "image"
        && details.resourceType !== "media"
    ) {
        return;
    }
    try {
        const target = new URL(details.url);
        if (target.protocol !== "https:" && target.protocol !== "http:") {
            return;
        }
        // Artwork and decoded audio are intentionally readable by the renderer
        // for palette extraction and the local Web Audio pitch-shift graph.
        setResponseHeader(responseHeaders, "Access-Control-Allow-Origin", ["*"]);
    } catch {
        // Ignore malformed response URLs.
    }
}

function isSameApplicationDocument(targetUrl: string, entryUrl: string) {
    try {
        const target = new URL(targetUrl);
        const entry = new URL(entryUrl);
        if (target.protocol !== entry.protocol) {
            return false;
        }
        if (entry.protocol === "file:") {
            return target.hostname === entry.hostname
                && target.pathname === entry.pathname
                && target.search === entry.search;
        }
        return target.origin === entry.origin
            && target.pathname === entry.pathname
            && target.search === entry.search;
    } catch {
        return false;
    }
}

export function setupSessionSecurity() {
    if (sessionSecurityConfigured) {
        return;
    }
    sessionSecurityConfigured = true;

    const appSession = session.defaultSession;
    appSession.setPermissionCheckHandler(() => false);
    appSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
    });
    appSession.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = { ...details.responseHeaders };
        allowRendererReadableMediaCors(details, responseHeaders);
        if (details.resourceType === "mainFrame" || details.resourceType === "subFrame") {
            setResponseHeader(responseHeaders, "Content-Security-Policy", [
                app.isPackaged ? productionCsp : developmentCsp,
            ]);
        }
        callback({ responseHeaders });
    });
}

export function hardenWindow(window: BrowserWindow, entryUrl: string) {
    window.webContents.setWindowOpenHandler(() => {
        return { action: "deny" };
    });

    window.webContents.on("will-navigate", (event, url) => {
        if (!isSameApplicationDocument(url, entryUrl)) {
            event.preventDefault();
        }
    });
    window.webContents.on("will-attach-webview", (event) => {
        event.preventDefault();
    });
}
