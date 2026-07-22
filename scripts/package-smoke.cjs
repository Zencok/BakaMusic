const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const appPath = path.resolve(__dirname, "../out/BakaMusic-win32-x64/BakaMusic.exe");
const targetNames = ["main_window", "lrc_window", "minimode_window"];
const serviceNames = ["request-forwarder", "mflac-proxy", "luna-proxy"];

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createSilentWav(durationSeconds = 1) {
    const channelCount = 1;
    const sampleRate = 8_000;
    const bitsPerSample = 16;
    const sampleCount = Math.round(sampleRate * durationSeconds);
    const blockAlign = channelCount * bitsPerSample / 8;
    const dataSize = sampleCount * blockAlign;
    const wav = Buffer.alloc(44 + dataSize);
    wav.write("RIFF", 0, "ascii");
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write("WAVE", 8, "ascii");
    wav.write("fmt ", 12, "ascii");
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(channelCount, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * blockAlign, 28);
    wav.writeUInt16LE(blockAlign, 32);
    wav.writeUInt16LE(bitsPerSample, 34);
    wav.write("data", 36, "ascii");
    wav.writeUInt32LE(dataSize, 40);
    return wav;
}

function createAlacM4a() {
    return Buffer.from(
        "AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAr9tb292AAAAbG12aGQAAAAAAAAA"
        + "AAAAAAAAAAPoAAAA+gABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAA"
        + "AAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAB6XRyYWsAAABcdGto"
        + "ZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAA+gAAAAAAAAAAAAAAAQEAAAAAAQAAAAAAAAAAAAAA"
        + "AAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAA"
        + "AQAAAPoAAAAAAAEAAAAAAWFtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAKxEAAArEVXEAAAA"
        + "AAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAAEMbWluZgAA"
        + "ABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAADQ"
        + "c3RibAAAAFhzdHNkAAAAAAAAAAEAAABIYWxhYwAAAAAAAAABAAAAAAAAAAAAAQAQAAAAAKxE"
        + "AAAAAAAkYWxhYwAAAAAAABAAABAoCg4BAAAAACAEAArEQAAArEQAAAAgc3R0cwAAAAAAAAAC"
        + "AAAAAgAAEAAAAAABAAALEQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAwAAAAEAAAAgc3RzegAA"
        + "AAAAAAAAAAAAAwAAABMAAAATAAAAFwAAABRzdGNvAAAAAAAAAAEAAALrAAAAYnVkdGEAAABa"
        + "bWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWp"
        + "dG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDIAAAAIZnJlZQAAAEVtZGF0AAAAAAAP"
        + "CAEAAAAAAAAA/4f/8AAAAAAADwgBAAAAAAAAAP+H//AAABAAABYiAAAPCAEAAAAAAAAA/4WI"
        + "cA==",
        "base64",
    );
}

function encodeSyncSafeInteger(value) {
    return Buffer.from([
        (value >>> 21) & 0x7f,
        (value >>> 14) & 0x7f,
        (value >>> 7) & 0x7f,
        value & 0x7f,
    ]);
}

function createId3Frame(id, payload) {
    const header = Buffer.alloc(10);
    header.write(id, 0, 4, "ascii");
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
}

async function createLocalArtworkMp3() {
    const sharp = require("sharp");
    const width = 320;
    const height = 320;
    const pixels = Buffer.alloc(width * height * 3);
    let seed = 0x12345678;
    for (let index = 0; index < pixels.length; index++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        pixels[index] = seed & 0xff;
    }
    const artwork = await sharp(pixels, {
        raw: { width, height, channels: 3 },
    }).png().toBuffer();
    const titleFrame = createId3Frame(
        "TIT2",
        Buffer.concat([Buffer.from([3]), Buffer.from("Local Scan Smoke")]),
    );
    const artworkFrame = createId3Frame(
        "APIC",
        Buffer.concat([
            Buffer.from([0]),
            Buffer.from("image/png\0", "latin1"),
            Buffer.from([3, 0]),
            artwork,
        ]),
    );
    const lyricFrame = createId3Frame(
        "USLT",
        Buffer.concat([
            Buffer.from([3]),
            Buffer.from("eng", "ascii"),
            Buffer.from([0]),
            Buffer.from(
                "[00:01.230]First local lyric\n[00:04.560]Second local lyric",
                "utf8",
            ),
            Buffer.from([0]),
        ]),
    );
    const tagBody = Buffer.concat([titleFrame, artworkFrame, lyricFrame]);
    const tagHeader = Buffer.concat([
        Buffer.from("ID3\x03\x00\x00", "latin1"),
        encodeSyncSafeInteger(tagBody.length),
    ]);
    return Buffer.concat([tagHeader, tagBody, Buffer.alloc(2048)]);
}

async function getFreePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise((resolve) => server.close(resolve));
    return port;
}

async function retry(callback, timeoutMs = 30_000, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const value = await callback();
            if (value) return value;
        } catch (error) {
            lastError = error;
        }
        await delay(intervalMs);
    }
    throw lastError || new Error("Timed out waiting for runtime state");
}

async function getTargets(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
    return response.json();
}

function classifyTarget(target) {
    return targetNames.find((name) => target.url.includes(`/${name}/`)) || null;
}

class CdpSession {
    constructor(webSocketUrl) {
        this.webSocketUrl = webSocketUrl;
        this.nextId = 0;
        this.pending = new Map();
        this.errors = [];
    }

    async connect() {
        this.socket = new WebSocket(this.webSocketUrl);
        this.socket.addEventListener("message", (event) => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(message.error.message));
                else pending.resolve(message.result);
                return;
            }
            if (message.method === "Runtime.exceptionThrown") {
                const details = message.params.exceptionDetails;
                this.errors.push(
                    details?.exception?.description
                    || details?.exception?.value
                    || details?.text
                    || "Runtime exception",
                );
            }
            if (
                message.method === "Log.entryAdded"
                && ["error", "warning"].includes(message.params.entry?.level)
            ) {
                this.errors.push(message.params.entry.text);
            }
        });
        await new Promise((resolve, reject) => {
            this.socket.addEventListener("open", resolve, { once: true });
            this.socket.addEventListener("error", reject, { once: true });
        });
        await Promise.all([
            this.send("Runtime.enable"),
            this.send("Log.enable"),
            this.send("Page.enable"),
        ]);
    }

    send(method, params = {}) {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP command timed out: ${method}`));
            }, 30_000);
            this.pending.set(id, {
                resolve: (value) => {
                    clearTimeout(timeout);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression, label = "anonymous") {
        let result;
        try {
            result = await this.send("Runtime.evaluate", {
                expression,
                awaitPromise: true,
                returnByValue: true,
            });
        } catch (error) {
            error.message = `CDP evaluation failed (${label}): ${error.message}`;
            throw error;
        }
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description
                || result.exceptionDetails.text);
        }
        return result.result?.value;
    }

    close() {
        this.socket?.close();
    }
}

async function connectWindowTargets(port, expectedNames) {
    const targets = await retry(async () => {
        const pages = (await getTargets(port)).filter((target) => target.type === "page");
        const namedTargets = new Map(
            pages.map((target) => [classifyTarget(target), target]).filter(([name]) => name),
        );
        return expectedNames.every((name) => namedTargets.has(name)) ? namedTargets : null;
    });
    const sessions = new Map();
    for (const name of expectedNames) {
        const session = new CdpSession(targets.get(name).webSocketDebuggerUrl);
        await session.connect();
        sessions.set(name, session);
    }
    return sessions;
}

async function inspectWindow(session, name) {
    return retry(async () => {
        const state = await session.evaluate(`(() => {
            const root = document.getElementById("root");
            return {
                readyState: document.readyState,
                rootLength: root?.innerHTML.length || 0,
                width: window.innerWidth,
                height: window.innerHeight,
                failedResources: performance.getEntriesByType("resource")
                    .filter((entry) => entry.responseStatus >= 400)
                    .map((entry) => ({ name: entry.name, status: entry.responseStatus })),
            };
        })()`);
        if (state.readyState !== "complete" || state.rootLength === 0) return null;
        assert.ok(state.width > 0 && state.height > 0, `${name} has invalid dimensions`);
        assert.deepEqual(state.failedResources, [], `${name} has failed resources`);
        return state;
    });
}

async function run() {
    assert.ok(fs.existsSync(appPath), `Packaged app not found: ${appPath}`);
    const port = await getFreePort();
    let webdavDirectoryExists = false;
    let webdavBackupData = null;
    const resourceServer = http.createServer((request, response) => {
        if (request.url === "/pixel.png" || request.url?.endsWith("/pixel.png")) {
            response.writeHead(200, {
                "Cache-Control": "no-store",
                "Content-Type": "image/png",
            });
            response.end(Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+AvzZAAAAAElFTkSuQmCC",
                "base64",
            ));
            return;
        }
        if (
            request.url === "http://plugin-smoke.invalid/health"
            || (
                request.headers.host === "plugin-smoke.invalid"
                && request.url === "/health"
            )
        ) {
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ ok: true }));
            return;
        }
        if (request.url?.startsWith("/webdav")) {
            const expectedAuthorization = `Basic ${Buffer.from(
                "smoke-user:smoke-pass",
            ).toString("base64")}`;
            if (request.headers.authorization !== expectedAuthorization) {
                response.writeHead(401, { "WWW-Authenticate": "Basic" });
                response.end("Unauthorized");
                return;
            }
            const requestPath = request.url.replace(/\/$/, "");
            const backupPath = "/webdav/BakaMusic/BakaMusicBackup.json";
            if (request.method === "PROPFIND") {
                const isDirectory = requestPath === "/webdav/BakaMusic"
                    && webdavDirectoryExists;
                const isBackup = requestPath === backupPath
                    && webdavBackupData !== null;
                if (!isDirectory && !isBackup) {
                    response.writeHead(404);
                    response.end("Not found");
                    return;
                }
                const resourceType = isDirectory
                    ? "<d:resourcetype><d:collection/></d:resourcetype>"
                    : "<d:resourcetype/>";
                response.writeHead(207, { "Content-Type": "application/xml" });
                response.end(`<?xml version="1.0" encoding="utf-8"?>
                    <d:multistatus xmlns:d="DAV:"><d:response>
                    <d:href>${requestPath}</d:href><d:propstat><d:prop>
                    ${resourceType}<d:getcontentlength>${Buffer.byteLength(
                        webdavBackupData || "",
                    )}</d:getcontentlength></d:prop>
                    <d:status>HTTP/1.1 200 OK</d:status>
                    </d:propstat></d:response></d:multistatus>`);
                return;
            }
            if (request.method === "MKCOL" && requestPath === "/webdav/BakaMusic") {
                webdavDirectoryExists = true;
                response.writeHead(201);
                response.end();
                return;
            }
            if (request.method === "PUT" && requestPath === backupPath) {
                const chunks = [];
                request.on("data", (chunk) => chunks.push(chunk));
                request.on("end", () => {
                    webdavBackupData = Buffer.concat(chunks).toString("utf8");
                    response.writeHead(201);
                    response.end();
                });
                return;
            }
            if (
                request.method === "GET"
                && requestPath === backupPath
                && webdavBackupData !== null
            ) {
                response.writeHead(200, { "Content-Type": "application/json" });
                response.end(webdavBackupData);
                return;
            }
        }
        response.writeHead(404);
        response.end("Not found");
    });
    await new Promise((resolve, reject) => {
        resourceServer.once("error", reject);
        resourceServer.listen(0, "127.0.0.1", resolve);
    });
    const resourceAddress = resourceServer.address();
    const resourcePort = typeof resourceAddress === "object" && resourceAddress
        ? resourceAddress.port
        : 0;
    const resourceOrigin = `http://127.0.0.1:${resourcePort}`;
    const userDataPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bakamusic-smoke-"));
    const appDataPath = path.join(userDataPath, "app-data");
    const localAppDataPath = path.join(userDataPath, "local-app-data");
    await Promise.all([
        fs.promises.mkdir(appDataPath, { recursive: true }),
        fs.promises.mkdir(localAppDataPath, { recursive: true }),
    ]);
    const pluginPath = path.join(userDataPath, "bakamusic-plugins");
    await fs.promises.mkdir(pluginPath, { recursive: true });
    await fs.promises.writeFile(
        path.join(pluginPath, "phase5-smoke.js"),
        `const axios = require("axios");
        const storage = require("musicfree/storage");
        module.exports = {
            platform: "Phase5Smoke",
            version: "1.0.0",
            async search() {
                const response = await axios.get("http://plugin-smoke.invalid/health");
                if (response.data?.ok !== true) {
                    throw new Error("plugin network roundtrip failed");
                }
                await storage.setItem("phase5-smoke", "ok");
                if (await storage.getItem("phase5-smoke") !== "ok") {
                    throw new Error("plugin storage roundtrip failed");
                }
                return { isEnd: true, data: [] };
            }
        };`,
        "utf8",
    );
    const localMediaPath = path.join(userDataPath, "local-media-smoke.wav");
    await fs.promises.writeFile(localMediaPath, createSilentWav());
    const alacMediaPath = path.join(userDataPath, "local-media-alac-smoke.m4a");
    await fs.promises.writeFile(alacMediaPath, createAlacM4a());
    const localScanPath = path.join(userDataPath, "local-scan-smoke");
    await fs.promises.mkdir(localScanPath, { recursive: true });
    await fs.promises.writeFile(
        path.join(localScanPath, "artwork-smoke.mp3"),
        await createLocalArtworkMp3(),
    );
    const themePath = path.join(userDataPath, "bakamusic-themepacks", "phase5-smoke");
    await fs.promises.mkdir(themePath, { recursive: true });
    await Promise.all([
        fs.promises.writeFile(
            path.join(themePath, "config.json"),
            JSON.stringify({
                spec: "bakamusic-theme@2",
                name: "Phase5Smoke",
                author: "BakaMusic",
                version: "1.0.0",
                preview: "@/preview.png",
                description: "Packaged theme boundary smoke",
                tags: ["测试"],
                scheme: "dark",
            }),
            "utf8",
        ),
        fs.promises.writeFile(
            path.join(themePath, "index.css"),
            ":root { --theme-primary: #ffffff; --theme-bg: #000000; --theme-text: #ffffff; --theme-scheme: dark; }",
            "utf8",
        ),
        fs.promises.writeFile(
            path.join(themePath, "preview.png"),
            Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+AvzZAAAAAElFTkSuQmCC",
                "base64",
            ),
        ),
    ]);
    const output = [];
    const child = spawn(appPath, [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataPath}`,
    ], {
        env: {
            ...process.env,
            APPDATA: appDataPath,
            HTTP_PROXY: resourceOrigin,
            HTTPS_PROXY: resourceOrigin,
            LOCALAPPDATA: localAppDataPath,
            NO_PROXY: "127.0.0.1,localhost",
            XDG_CONFIG_HOME: appDataPath,
            http_proxy: resourceOrigin,
            https_proxy: resourceOrigin,
            no_proxy: "127.0.0.1,localhost",
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk) => output.push(chunk.toString()));
    const exited = new Promise((resolve) => child.once("exit", resolve));
    const sessions = new Map();

    try {
        const mainSessions = await connectWindowTargets(port, ["main_window"]);
        const mainSession = mainSessions.get("main_window");
        sessions.set("main_window", mainSession);
        await inspectWindow(mainSession, "main_window");
        const rendererBoundary = await mainSession.evaluate(`(() => {
            const pluginBridge = window["@shared/plugin-manager"];
            const nodeRuntime = window["@shared/node-runtime"];
            const backupBridge = window["@shared/backup"];
            const fsBridge = window["@shared/utils"].fs;
            return {
                processType: typeof window.process,
                requireType: typeof window.require,
                dirnameType: typeof window.__dirname,
                legacyPathBridgeType: typeof window.path,
                nodeRuntimeBridge: typeof nodeRuntime.closeWatcher,
                backupWriteBridge: typeof backupBridge.backupToWebdav,
                backupReadBridge: typeof backupBridge.restoreFromWebdav,
                trashFileBridge: typeof fsBridge.trashFile,
                pluginBridge: typeof pluginBridge.callPluginMethod,
            };
        })()`, "renderer boundary");
        const localScanState = await mainSession.evaluate(`(async () => {
            const result = await window["@shared/node-runtime"].scanDirectories(
                [${JSON.stringify(localScanPath)}],
                [],
            );
            const item = result.musicItems[0];
            const freshLyric = await window["@shared/plugin-manager"].callPluginMethod(
                { platform: "本地" },
                "getLyric",
                { ...item, rawLrc: "stale lyric without timestamps" },
            );
            return {
                count: result.musicItems.length,
                removedCount: result.removedFilePaths.length,
                title: item?.title,
                artworkType: item?.artwork?.slice(0, 23),
                artworkBounded: (item?.artwork?.length ?? Infinity) < 96 * 1024,
                scannedLyric: item?.rawLrc,
                refreshedLyric: freshLyric?.rawLrc,
            };
        })()`, "local music metadata scan");
        const pluginResult = await mainSession.evaluate(`(async () => {
            const pluginBridge = window["@shared/plugin-manager"];
            await pluginBridge.reloadPlugins();
            return pluginBridge.callPluginMethod(
                { platform: "Phase5Smoke" },
                "search",
                "smoke",
                1,
                "music",
            );
        })()`, "plugin utility roundtrip");
        const webdavState = await mainSession.evaluate(`(async () => {
            const backupBridge = window["@shared/backup"];
            const connection = {
                url: ${JSON.stringify(`${resourceOrigin}/webdav`)},
                username: "smoke-user",
                password: "smoke-pass",
            };
            const fixture = JSON.stringify({ schema: "package-smoke" });
            await backupBridge.backupToWebdav(connection, fixture);
            return {
                restored: await backupBridge.restoreFromWebdav(connection),
                fixture,
            };
        })()`, "WebDAV backup roundtrip");
        const themeState = await mainSession.evaluate(`(async () => {
            const themeBridge = window["@shared/themepack"];
            const themes = await themeBridge.loadThemePacks();
            const smokeTheme = themes.find((theme) => theme.name === "Phase5Smoke");
            if (!smokeTheme) {
                const context = window["@shared/global-context"].getGlobalContext();
                throw new Error("packaged theme was not discovered: " + JSON.stringify({
                    names: themes.map((theme) => theme.name),
                    userData: context.appPath.userData,
                }));
            }
            const themeContents = await themeBridge.readThemeContents(smokeTheme.path);
            const themeAssetLoaded = await new Promise((resolve) => {
                const preview = new Image();
                preview.onload = () => resolve(true);
                preview.onerror = () => resolve(false);
                preview.src = smokeTheme.preview;
            });
            return {
                count: themes.length,
                pathProtocol: new URL(smokeTheme.path).protocol,
                cssValidated: themeContents.rawCss.includes("--theme-primary"),
                assetLoaded: themeAssetLoaded,
            };
        })()`, "theme boundary");
        const localMediaState = await mainSession.evaluate(`(async () => {
            const mediaUrl = window["@shared/utils"].fs.addFileScheme(
                ${JSON.stringify(localMediaPath)}
            );
            const audio = new Audio();
            audio.preload = "auto";
            const loaded = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(null), 10_000);
                audio.oncanplay = () => {
                    clearTimeout(timer);
                    resolve(
                        Number.isFinite(audio.duration)
                        && audio.duration > 0
                        && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
                    );
                };
                audio.onerror = () => {
                    clearTimeout(timer);
                    resolve(null);
                };
                audio.src = mediaUrl;
                audio.load();
            });
            audio.removeAttribute("src");
            audio.load();
            return {
                loaded,
                protocol: new URL(mediaUrl).protocol,
            };
        })()`, "local media boundary");
        const alacMediaState = await mainSession.evaluate(`(async () => {
            const mediaUrl = window["@shared/utils"].fs.addFileScheme(
                ${JSON.stringify(alacMediaPath)}
            );
            const audio = new Audio();
            audio.preload = "auto";
            const loaded = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(false), 30_000);
                audio.oncanplay = () => {
                    clearTimeout(timer);
                    resolve(
                        Number.isFinite(audio.duration)
                        && audio.duration > 0
                        && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
                    );
                };
                audio.onerror = () => {
                    clearTimeout(timer);
                    resolve(false);
                };
                audio.src = mediaUrl;
                audio.load();
            });
            const state = {
                loaded,
                protocol: new URL(mediaUrl).protocol,
                nativeAlacSupport: audio.canPlayType('audio/mp4; codecs="alac"'),
            };
            audio.removeAttribute("src");
            audio.load();
            return state;
        })()`, "ALAC local media boundary");
        const remoteArtworkCors = await mainSession.evaluate(`(async () => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            const loaded = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(false), 10_000);
                image.onload = () => {
                    clearTimeout(timer);
                    try {
                        const canvas = document.createElement("canvas");
                        canvas.width = 1;
                        canvas.height = 1;
                        const context = canvas.getContext("2d");
                        context.drawImage(image, 0, 0);
                        context.getImageData(0, 0, 1, 1);
                        resolve(true);
                    } catch {
                        resolve(false);
                    }
                };
                image.onerror = () => {
                    clearTimeout(timer);
                    resolve(false);
                };
                image.src = ${JSON.stringify(`${resourceOrigin}/pixel.png`)};
            });
            image.src = "";
            return loaded;
        })()`, "remote artwork CORS boundary");
        const pitchShiftState = await mainSession.evaluate(`(async () => {
            const button = document.querySelector(".pitch-btn");
            if (!button) {
                throw new Error("pitch shift control was not rendered");
            }
            button.dispatchEvent(new WheelEvent("wheel", {
                bubbles: true,
                cancelable: true,
                deltaY: -100,
            }));
            const deadline = Date.now() + 10_000;
            while (Date.now() < deadline) {
                if (button.classList.contains("highlight")) {
                    return { active: true };
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return { active: false };
        })()`, "pitch shift worklet");
        await mainSession.evaluate(
            `window["@shared/node-runtime"].closeWatcher()`,
            "node runtime watcher shutdown",
        );
        const { pluginBridge: _pluginBridge, ...rendererState } = rendererBoundary;
        assert.equal(_pluginBridge, "function");
        const boundaryState = {
            ...rendererState,
            localMediaState,
            alacMediaState,
            pluginResult,
            localScanState,
            pitchShiftState,
            remoteArtworkCors,
            themeState,
            webdavState,
        };
        assert.deepEqual(boundaryState, {
            processType: "undefined",
            requireType: "undefined",
            dirnameType: "undefined",
            legacyPathBridgeType: "undefined",
            nodeRuntimeBridge: "function",
            backupWriteBridge: "function",
            backupReadBridge: "function",
            trashFileBridge: "function",
            localMediaState: {
                loaded: true,
                protocol: "bakamusic-media:",
            },
            alacMediaState: {
                loaded: true,
                protocol: "bakamusic-media:",
                nativeAlacSupport: "",
            },
            pluginResult: { isEnd: true, data: [] },
            localScanState: {
                count: 1,
                removedCount: 0,
                title: "Local Scan Smoke",
                artworkType: "data:image/webp;base64,",
                artworkBounded: true,
                scannedLyric: "[00:01.230]First local lyric\n[00:04.560]Second local lyric",
                refreshedLyric: "[00:01.230]First local lyric\n[00:04.560]Second local lyric",
            },
            pitchShiftState: {
                active: true,
            },
            remoteArtworkCors: true,
            themeState: {
                count: 1,
                pathProtocol: "bakamusic-theme:",
                cssValidated: true,
                assetLoaded: true,
            },
            webdavState: {
                restored: JSON.stringify({ schema: "package-smoke" }),
                fixture: JSON.stringify({ schema: "package-smoke" }),
            },
        });
        await mainSession.evaluate(`(() => {
            const appWindow = window["@shared/utils"].appWindow;
            appWindow.setLyricWindow(true);
            appWindow.setMinimodeWindow(true);
            return true;
        })()`);

        const extensionSessions = await connectWindowTargets(port, [
            "lrc_window",
            "minimode_window",
        ]);
        extensionSessions.forEach((session, name) => sessions.set(name, session));

        const windowStates = {};
        for (const name of targetNames) {
            windowStates[name] = await inspectWindow(sessions.get(name), name);
        }

        const serviceHosts = await retry(async () => {
            const hosts = await mainSession.evaluate(`(() => {
                const serviceManager = window["@shared/service-manager"];
                return ${JSON.stringify(serviceNames)}.reduce((result, name) => {
                    result[name] = serviceManager.getServiceHost(name) || null;
                    return result;
                }, {});
            })()`);
            return Object.values(hosts).every(Boolean) ? hosts : null;
        });
        const serviceStates = {};
        for (const [name, host] of Object.entries(serviceHosts)) {
            const response = await fetch(`${host}/heartbeat`);
            serviceStates[name] = {
                status: response.status,
                body: await response.text(),
            };
            assert.deepEqual(serviceStates[name], { status: 200, body: "OK" });
        }

        await delay(1_000);
        const runtimeErrors = Object.fromEntries(
            [...sessions].map(([name, session]) => [name, session.errors]),
        );
        assert.ok(
            Object.values(runtimeErrors).every((errors) => errors.length === 0),
            `Runtime errors: ${JSON.stringify(runtimeErrors)}`,
        );
        console.log(JSON.stringify({
            windowStates,
            boundaryState,
            serviceStates,
            runtimeErrors,
        }, null, 2));
        await mainSession.evaluate(`window["@shared/utils"].app.exitApp()`);
        await Promise.race([exited, delay(10_000)]);
    } catch (error) {
        const runtimeOutput = output.join("").trim();
        const capturedErrors = Object.fromEntries(
            [...sessions].map(([name, session]) => [name, session.errors]),
        );
        if (Object.values(capturedErrors).some((errors) => errors.length)) {
            error.message += `\nRenderer errors:\n${JSON.stringify(capturedErrors, null, 2)}`;
        }
        if (runtimeOutput) {
            error.message += `\nPackaged runtime output:\n${runtimeOutput}`;
        }
        throw error;
    } finally {
        sessions.forEach((session) => session.close());
        if (child.exitCode === null) {
            spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore",
            });
        }
        resourceServer.closeAllConnections();
        await new Promise((resolve) => resourceServer.close(resolve));
        await fs.promises.rm(userDataPath, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 200,
        });
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
