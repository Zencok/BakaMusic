const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const appPath = path.resolve(__dirname, "../out/BakaMusic-win32-x64/BakaMusic.exe");
const ac4FixturePath = path.resolve(
    __dirname,
    "fixtures/native-media-ac4-smoke.ac4",
);
const targetNames = ["main_window", "lrc_window", "minimode_window", "mv_window"];
const serviceNames = ["mflac-proxy", "luna-proxy"];
// Null output exercises decoding and timing without depending on host hardware.
// Set BAKAMUSIC_SMOKE_AUDIO_OUTPUT=system to additionally verify real audio output.
const smokeAudioOutput = process.env.BAKAMUSIC_SMOKE_AUDIO_OUTPUT ?? "null";

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

function createSilentDsf(durationSeconds = 0.25) {
    const channelCount = 2;
    const sampleRate = 2_822_400;
    const sampleCount = Math.round(sampleRate * durationSeconds);
    const blockSizePerChannel = 4096;
    const bytesPerChannel = Math.ceil(sampleCount / 8);
    const blockCount = Math.ceil(bytesPerChannel / blockSizePerChannel);
    const audioBytes = blockCount * blockSizePerChannel * channelCount;
    const fileSize = 28 + 52 + 12 + audioBytes;
    const dsf = Buffer.alloc(fileSize, 0x69);
    dsf.write("DSD ", 0, "ascii");
    dsf.writeBigUInt64LE(28n, 4);
    dsf.writeBigUInt64LE(BigInt(fileSize), 12);
    dsf.writeBigUInt64LE(0n, 20);
    dsf.write("fmt ", 28, "ascii");
    dsf.writeBigUInt64LE(52n, 32);
    dsf.writeUInt32LE(1, 40);
    dsf.writeUInt32LE(0, 44);
    dsf.writeUInt32LE(2, 48);
    dsf.writeUInt32LE(channelCount, 52);
    dsf.writeUInt32LE(sampleRate, 56);
    dsf.writeUInt32LE(1, 60);
    dsf.writeBigUInt64LE(BigInt(sampleCount), 64);
    dsf.writeUInt32LE(blockSizePerChannel, 72);
    dsf.writeUInt32LE(0, 76);
    dsf.write("data", 80, "ascii");
    dsf.writeBigUInt64LE(BigInt(12 + audioBytes), 84);
    return dsf;
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

    async waitForState(expression, expected, label) {
        return retry(async () => {
            const state = await this.evaluate(expression, label);
            assert.deepEqual(state, expected, `Unexpected UI state (${label})`);
            return state;
        });
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
                mainReady: !!document.querySelector(".app-container .music-bar-container")
                    && !document.querySelector(".startup-shell"),
                width: window.innerWidth,
                height: window.innerHeight,
                failedResources: performance.getEntriesByType("resource")
                    .filter((entry) => entry.responseStatus >= 400)
                    .map((entry) => ({ name: entry.name, status: entry.responseStatus })),
            };
        })()`);
        if (state.readyState !== "complete" || state.rootLength === 0) return null;
        if (name === "main_window" && !state.mainReady) return null;
        assert.ok(state.width > 0 && state.height > 0, `${name} has invalid dimensions`);
        assert.deepEqual(state.failedResources, [], `${name} has failed resources`);
        return state;
    });
}

async function run() {
    assert.ok(["null", "system"].includes(smokeAudioOutput), "Invalid smoke audio output");
    assert.ok(fs.existsSync(appPath), `Packaged app not found: ${appPath}`);
    const port = await getFreePort();
    let webdavDirectoryExists = false;
    let webdavBackupData = null;
    const resourceServer = http.createServer((request, response) => {
        if (request.url === "/native-audio.wav") {
            if (request.headers["x-bakamusic-smoke"] !== "libmpv") {
                response.writeHead(403);
                response.end("Missing native playback header");
                return;
            }
            const audio = createSilentWav();
            response.writeHead(200, {
                "Accept-Ranges": "bytes",
                "Content-Length": String(audio.length),
                "Content-Type": "audio/wav",
            });
            response.end(audio);
            return;
        }
        if (request.url === "/native-video.wav") {
            const audio = createSilentWav(120);
            response.writeHead(200, {
                "Accept-Ranges": "bytes",
                "Content-Length": String(audio.length),
                "Content-Type": "audio/wav",
            });
            response.end(audio);
            return;
        }
        if (request.url?.startsWith("/lx-audio/")) {
            const audioHeader = Buffer.from("fLaC", "ascii");
            response.writeHead(200, {
                "Accept-Ranges": "bytes",
                "Content-Length": String(audioHeader.length),
                "Content-Type": "audio/flac",
            });
            response.end(audioHeader);
            return;
        }
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
            request.url === "/health"
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
    await fs.promises.writeFile(
        path.join(userDataPath, "config.json"),
        JSON.stringify({ "$schema-version": 1, "normal.checkUpdate": false }),
        "utf8",
    );
    const pluginPath = path.join(userDataPath, "bakamusic-plugins-v2");
    await fs.promises.mkdir(pluginPath, { recursive: true });
    const providerId = "cc.baka.qq";
    const resolverId = "test.package.resolver";
    const writePlugin = async (id, code) => {
        const filename = path.join(pluginPath, `${id}.js`);
        await fs.promises.writeFile(filename, code, "utf8");
        await fs.promises.writeFile(`${filename}.integrity.json`, JSON.stringify({
            packageId: id, sha256: createHash("sha256").update(code, "utf8").digest("hex"),
            installedAt: new Date().toISOString(),
        }), "utf8");
    };
    await writePlugin(providerId, `// @baka-provider 2
module.exports={manifest:{apiVersion:2,id:"${providerId}",kind:"provider",name:"Package provider",author:"BakaMusic",version:"1.0.0",sourceId:"qq.v1",capabilities:["search","entities.get","media.prepare","media.resolve","media.video"],supportedVideoQualities:["720p"]},handlers:{
search:async(r,sdk)=>{
    const response=await sdk.http.request({url:${JSON.stringify(`${resourceOrigin}/health`)},method:"GET",responseType:"json"});
    if(response.body.ok!==true)throw new Error("network roundtrip failed");
    await sdk.storage.set("package-smoke","ok");
    if(await sdk.storage.get("package-smoke")!=="ok")throw new Error("storage roundtrip failed");
    if([typeof require,typeof process,typeof Buffer].some(v=>v!=="undefined"))throw new Error("ambient Node global");
    return {items:[],nextCursor:null};
},entities:{get:r=>r.entity},media:{prepare:r=>({entity:r.entity,context:{prepared:true,protocol:"lx",source:"tx",musicInfo:{songmid:r.entity.id}}}),resolve:r=>({url:${JSON.stringify(`${resourceOrigin}/native-audio.wav`)},quality:r.quality}),video:r=>({url:${JSON.stringify(`${resourceOrigin}/native-video.wav`)},videoQuality:r.quality||"720p",width:1280,height:720})}}};`);
    await writePlugin(resolverId, `// @baka-provider 2
module.exports={manifest:{apiVersion:2,id:"${resolverId}",kind:"resolver",name:"Package resolver",author:"BakaMusic",version:"1.0.0",sources:["qq.v1"],capabilities:["media.resolve"]},handlers:{media:{resolve:r=>{
if(!r.context.prepared||r.providerId!=="${providerId}")throw new Error("missing prepare context");
if(r.quality==="320k"){const e=new Error("quality missing");e.code="quality_unavailable";throw e;}
return {url:${JSON.stringify(`${resourceOrigin}/native-audio.wav`)},quality:r.quality};
}}}};`);
    // Retired scripts remain on disk and must never be evaluated by the V2 registry.
    for (const directory of ["bakamusic-plugins"]) {
        const retiredPath = path.join(userDataPath, directory);
        await fs.promises.mkdir(retiredPath, { recursive: true });
        await fs.promises.writeFile(path.join(retiredPath, "retired.js"), 'throw new Error("legacy code executed")', "utf8");
    }
    const legacyLxSource = `/** @name Package original LX\n * @version 1.0.0\n */
lx.on(lx.EVENT_NAMES.request,({source,info})=>{if(source!=="tx"||info.musicInfo.songmid!==7)throw Error("LX context changed");return ${JSON.stringify(`${resourceOrigin}/native-audio.wav`)};});
lx.send(lx.EVENT_NAMES.inited,{sources:{tx:{actions:["musicUrl"],qualitys:["flac","128k"]}}});`;
    const legacyLxHash = createHash("sha256").update(legacyLxSource).digest("hex");
    const legacyLxPath = path.join(userDataPath, "bakamusic-lx-plugins", `${legacyLxHash}.js`);
    await fs.promises.mkdir(path.dirname(legacyLxPath), {recursive:true});
    await fs.promises.writeFile(legacyLxPath, legacyLxSource);
    await fs.promises.writeFile(`${legacyLxPath}.integrity.json`, JSON.stringify({sha256:legacyLxHash}));
    await fs.promises.writeFile(path.join(path.dirname(legacyLxPath), "state.json"), JSON.stringify({activeHash:legacyLxHash}));
    const importedLxPath = path.join(userDataPath, "packed-lx.js");
    const packedBody = `const api=Function('return lx')();api.on('request',()=>${JSON.stringify(`${resourceOrigin}/native-audio.wav`)});api.send('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['flac']}}});`;
    const importedLxSource = `eval(String.fromCharCode(${[...packedBody].map(value => value.charCodeAt(0)).join(",")}));`;
    await fs.promises.writeFile(importedLxPath, importedLxSource);
    const localMediaPath = path.join(userDataPath, "local-media-smoke.wav");
    await fs.promises.writeFile(localMediaPath, createSilentWav());
    const alacMediaPath = path.join(userDataPath, "local-media-alac-smoke.m4a");
    await fs.promises.writeFile(alacMediaPath, createAlacM4a());
    const dsfMediaPath = path.join(userDataPath, "local-media-dsf-smoke.dsf");
    await fs.promises.writeFile(dsfMediaPath, createSilentDsf());
    assert.ok(fs.existsSync(ac4FixturePath), "AC-4 playback fixture is missing");
    const ac4MediaPath = path.join(userDataPath, "native-media-ac4-smoke.ac4");
    await fs.promises.copyFile(ac4FixturePath, ac4MediaPath);
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
            BAKAMUSIC_SMOKE_AUDIO_OUTPUT: smokeAudioOutput,
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
        assert.equal(await mainSession.evaluate(
            '(async () => (await window["@shared/app-config"].syncConfig())["normal.checkUpdate"])()',
            "smoke startup config",
        ), false, "Smoke config must disable automatic update requests");
        const rendererBoundary = await mainSession.evaluate(`(() => {
            const pluginBridge = window["@shared/plugin-manager"];
            const nodeRuntime = window["@shared/node-runtime"];
            const backupBridge = window["@shared/backup"];
            const nativePlayback = window["@shared/native-playback"];
            const fsBridge = window["@shared/utils"].fs;
            return {
                processType: typeof window.process,
                requireType: typeof window.require,
                dirnameType: typeof window.__dirname,
                legacyPathBridgeType: typeof window.path,
                nodeRuntimeBridge: typeof nodeRuntime.closeWatcher,
                nativeProbeBridge: typeof nativePlayback.probe,
                nativeCommandBridge: typeof nativePlayback.command,
                dlnaDiscoverBridge: typeof window["@shared/dlna"].discover,
                dlnaCommandBridge: typeof window["@shared/dlna"].command,
                backupWriteBridge: typeof backupBridge.backupToWebdav,
                backupReadBridge: typeof backupBridge.restoreFromWebdav,
                trashFileBridge: typeof fsBridge.trashFile,
                pluginBridge: typeof pluginBridge.invoke,
            };
        })()`, "renderer boundary");
        const dlnaState = await mainSession.evaluate(
            '(async () => { const bridge = window["@shared/dlna"]; const invalid = await bridge.command({ operation: "seek", sourceId: "smoke-invalid", value: -1 }).then(() => false, () => true); const stale = await bridge.command({ operation: "status", sourceId: "smoke-stale" }); return { invalidRejected: invalid, staleSnapshot: stale }; })()',
            "DLNA IPC validation",
        );
        assert.deepEqual(dlnaState, { invalidRejected: true, staleSnapshot: null });
        const originalDetailConfig = await mainSession.evaluate(
            '(async () => { const config = await window["@shared/app-config"].syncConfig(); return config["normal.classicAmllPlaybackDetail"] ?? false; })()',
            "original playback detail preference",
        );
        await mainSession.evaluate(
            'window["@shared/app-config"].setConfig({ "normal.classicAmllPlaybackDetail": false })',
            "default detail without casting entry",
        );
        await mainSession.evaluate(
            'window["@shared/message-bus/main"].sendCommand("OpenMusicDetailPage")',
            "open default detail",
        );
        await retry(() => mainSession.evaluate(
            '!!document.querySelector(".music-detail--container[data-playback-detail=default][data-page-motion=visible]:not([inert])") && !document.querySelector(".classic-amll-output-button") && ![...document.querySelectorAll(".music-extra-tools button")].some((button) => button.textContent.trim() === "DLNA" || button.getAttribute("aria-label") === "Play To")',
            "DLNA entry absent outside AMLL detail",
        ));
        await mainSession.evaluate(
            'window["@shared/app-config"].setConfig({ "normal.classicAmllPlaybackDetail": true })',
            "AMLL playback detail preference",
        );
        await mainSession.evaluate(
            'window["@shared/message-bus/main"].sendCommand("OpenMusicDetailPage")',
            "open AMLL detail",
        );
        await retry(() => mainSession.evaluate(
            '!!document.querySelector(".music-detail--container[data-playback-detail=classic-amll]:not([inert]) .classic-amll-output-button")',
            "DLNA AMLL detail ready",
        ));
        await mainSession.evaluate(
            '(() => { const trigger = document.querySelector(".classic-amll-output-button"); trigger.focus(); trigger.click(); })()',
            "open DLNA dialog",
        );
        // Poll the observable state from Node: animation frames may pause when
        // Windows occludes the app, and two frames do not guarantee React/IPC
        // completion. Keep actions outside the retry so each is sent only once.
        const dlnaDialog = await mainSession.waitForState(`(() => {
            const trigger = document.querySelector(".classic-amll-output-button");
            const dialog = document.querySelector(".modal--dlna");
            const container = dialog?.closest("[role=dialog]");
            const favorite = document.querySelector(".classic-amll-favorite-button");
            return {
                open: !!dialog,
                semantic: container?.getAttribute("aria-modal"),
                focusContained: !!container?.contains(document.activeElement),
                localFocused: document.activeElement === dialog?.querySelector(".dlna-output"),
                scanButton: !!dialog?.querySelector(".dlna-refresh"),
                hasHint: !!dialog?.querySelector(".dlna-hint"),
                favoriteBeforeMore: favorite?.nextElementSibling?.classList.contains("classic-amll-menu-button"),
                outputFirst: trigger === document.querySelector(".classic-amll-bottom-controls")?.firstElementChild,
            };
        })()`, {
            open: true,
            semantic: "true",
            focusContained: true,
            localFocused: true,
            scanButton: true,
            hasHint: true,
            favoriteBeforeMore: true,
            outputFirst: true,
        }, "DLNA dialog and AMLL layout");
        if (process.env.BAKAMUSIC_SMOKE_SCREENSHOT_DIR) {
            await delay(400);
            const screenshot = await mainSession.send("Page.captureScreenshot", { format: "png" });
            await fs.promises.mkdir(process.env.BAKAMUSIC_SMOKE_SCREENSHOT_DIR, { recursive: true });
            await fs.promises.writeFile(
                path.join(process.env.BAKAMUSIC_SMOKE_SCREENSHOT_DIR, "dlna-picker.png"),
                Buffer.from(screenshot.data, "base64"),
            );
        }
        await mainSession.evaluate(
            'document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }))',
            "close DLNA dialog with Escape",
        );
        const dlnaClosed = await mainSession.waitForState(`(() => ({
            closed: !document.querySelector(".modal--dlna"),
            focusRestored: document.activeElement?.classList.contains("classic-amll-output-button"),
            detailStillOpen: !!document.querySelector(".music-detail--container:not([inert])"),
        }))()`, { closed: true, focusRestored: true, detailStillOpen: true }, "DLNA dialog Escape and focus restore");
        await mainSession.evaluate(
            'window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }))',
            "close AMLL detail",
        );
        await mainSession.evaluate(
            'window["@shared/app-config"].setConfig({ "normal.classicAmllPlaybackDetail": ' + JSON.stringify(originalDetailConfig) + ' })',
            "restore playback detail preference",
        );
        const localScanState = await mainSession.evaluate(`(async () => {
            const result = await window["@shared/node-runtime"].scanDirectories(
                [${JSON.stringify(localScanPath)}],
                [],
            );
            const item = result.musicItems[0];
            const freshLyricResponse = await window["@shared/plugin-manager"].invoke(
                { platform: "本地" },
                "lyrics.get",
                { entity: { ...item, rawLrc: "stale lyric without timestamps" } },
            );
            return {
                count: result.musicItems.length,
                removedCount: result.removedFilePaths.length,
                title: item?.title,
                artworkType: item?.artwork?.slice(0, 23),
                artworkBounded: (item?.artwork?.length ?? Infinity) < 96 * 1024,
                scannedLyric: item?.rawLrc,
                refreshedLyric: freshLyricResponse.value?.rawLrc,
            };
        })()`, "local music metadata scan");
        const pluginResult = await mainSession.evaluate(`(async () => {
            const pluginBridge = window["@shared/plugin-manager"];
            await pluginBridge.reloadPlugins();
            return (await pluginBridge.invoke(
                { platform: "cc.baka.qq" }, "search",
                { query: "smoke", cursor: null, limit: 20, kind: "music" },
            )).value;
        })()`, "native V2 network/storage roundtrip");
        const v2PluginState = await mainSession.evaluate(`(async () => {
            const bridge = window["@shared/plugin-manager"];
            let registry;
            bridge.onRegistryUpdated(state => { registry = state; });
            await bridge.reloadPlugins();
            const retiredCount = registry.retiredPlugins.length;
            const entity = {id: 7, platform: "cc.baka.qq", title: "V2 smoke", qualities: {flac: {}, "320k": {}}};
            const invoke = async (delegate, capability, request) => {
                const response = await bridge.invoke(delegate, capability, request);
                if (!response.ok) { const error = new Error(response.error.message); error.code = response.error.code; throw error; }
                return response.value;
            };
            const resolve = quality => invoke({platform: entity.platform}, "media.resolve", {entity, quality});
            const migratedResolverId = registry.resolverBindings.find(binding => binding.providerId === entity.platform)?.resolverId;
            if (!migratedResolverId) throw Error("Original active LX selection was lost");
            const originalLxSource = await resolve("flac");
            await bridge.setResolverBinding(entity.platform, "test.package.resolver");
            const source = await resolve("flac");
            let failureCode;
            try { await resolve("320k"); } catch(error) { failureCode = error.code; }
            await bridge.setResolverBinding(entity.platform, null);
            const providerSource = await resolve("flac");
            let rejectedLegacy = false;
            try { await invoke({platform: "retired"}, "search", {query:"a",kind:"music",cursor:null,limit:1}); } catch { rejectedLegacy = true; }
            await bridge.installPluginFromLocal(${JSON.stringify(importedLxPath)}, {kind:"lx"});
            let installed;
            bridge.onPluginUpdated(plugins => {installed = plugins;});
            await bridge.reloadPlugins();
            const imported = installed.find(plugin => plugin.kind === "resolver" && plugin.id !== migratedResolverId && plugin.id !== "test.package.resolver");
            if (!imported) throw Error("Explicit LX import was not installed");
            await bridge.setResolverBinding(entity.platform, imported.id);
            const packedLxSource = await resolve("flac");
            await bridge.setResolverBinding(entity.platform, null);
            return {retiredCount, source, failureCode, providerSource, rejectedLegacy, originalLxSource, packedLxSource};
        })()`, "V2 explicit resolver and coded failure boundary");
        assert.equal(await fs.promises.readFile(legacyLxPath,"utf8"), legacyLxSource);
        assert.equal(await fs.promises.readFile(importedLxPath,"utf8"), importedLxSource);
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
        const nativePlaybackState = await mainSession.evaluate(`(async () => {
            const bridge = window["@shared/native-playback"];
            window["@shared/message-bus/main"].syncAppState({
                musicItem: {
                    id: "package-smoke-smtc",
                    platform: "package-smoke",
                    title: "BakaMusic SMTC Smoke",
                    artist: "BakaMusic",
                    album: "Package Verification",
                    artwork: ${JSON.stringify(`${resourceOrigin}/pixel.png`)},
                },
            });
            const initialCapabilities = await bridge.getCapabilities();
            const sources = [
                ["wav", ${JSON.stringify(localMediaPath)}, false],
                ["alac", ${JSON.stringify(alacMediaPath)}, false],
                ["dsf", ${JSON.stringify(dsfMediaPath)}, false],
                ["ac4", ${JSON.stringify(ac4MediaPath)}, false],
                ["remote", ${JSON.stringify(`${resourceOrigin}/native-audio.wav`)}, true],
            ];
            const results = {};
            for (const [name, source, isRemote] of sources) {
                const sourceId = "package-smoke-" + name;
                const mediaUrl = isRemote
                    ? source
                    : window["@shared/utils"].fs.addFileScheme(source);
                let lastSnapshot;
                const reachedPlaying = new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        cleanup();
                        resolve({ error: "Timed out waiting for playback progress", sourceId, lastSnapshot });
                    }, 15_000);
                    const cleanup = bridge.onSnapshot((snapshot) => {
                        if (snapshot.sourceId !== sourceId) return;
                        lastSnapshot = snapshot;
                        if ((snapshot.state === "playing" && snapshot.currentTime > 0)
                            || (snapshot.ended && snapshot.duration > 0)) {
                            clearTimeout(timer);
                            cleanup();
                            resolve(true);
                        } else if (snapshot.state === "error") {
                            clearTimeout(timer);
                            cleanup();
                            resolve(snapshot);
                        }
                    });
                });
                await bridge.command({
                    operation: "load",
                    sourceId,
                    url: mediaUrl,
                    ...(isRemote ? {
                        headers: { "x-bakamusic-smoke": "libmpv" },
                    } : {}),
                });
                await bridge.command({ operation: "volume", sourceId, volume: 0 });
                if (name === "wav") {
                    await bridge.command({ operation: "pitch", sourceId, semitones: 1 });
                }
                await bridge.command({ operation: "play", sourceId });
                results[name] = await reachedPlaying;
                await bridge.command({ operation: "stop", sourceId });
                if (results[name] !== true) {
                    throw new Error("Native playback failed: " + JSON.stringify(results[name]));
                }
            }
            return {
                available: initialCapabilities.available,
                systemMediaControls: initialCapabilities.systemMediaControls,
                clientApiVersion: initialCapabilities.clientApiVersion,
                mediaBackend: initialCapabilities.mediaBackend,
                engine: initialCapabilities.engine,
                playing: results,
            };
        })()`, "libmpv + LibreMPEG AC-4 playback boundary");
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
            nativePlaybackState,
            pluginResult,
            v2PluginState,
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
            nativeProbeBridge: "undefined",
            nativeCommandBridge: "function",
            dlnaDiscoverBridge: "function",
            dlnaCommandBridge: "function",
            backupWriteBridge: "function",
            backupReadBridge: "function",
            trashFileBridge: "function",
            nativePlaybackState: {
                available: true,
                systemMediaControls: process.platform === "win32",
                clientApiVersion: "2.5",
                mediaBackend: "librempeg",
                engine: "libmpv",
                playing: {
                    wav: true,
                    alac: true,
                    dsf: true,
                    ac4: true,
                    remote: true,
                },
            },
            pluginResult: { items: [], nextCursor: null },
            v2PluginState: {
                retiredCount: 1,
                source: { url: `${resourceOrigin}/native-audio.wav`, quality: "flac" },
                failureCode: "quality_unavailable",
                providerSource: { url: `${resourceOrigin}/native-audio.wav`, quality: "flac" },
                rejectedLegacy: true,
                originalLxSource: {url: `${resourceOrigin}/native-audio.wav`},
                packedLxSource: {url: `${resourceOrigin}/native-audio.wav`},
            },
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
        const audioControlsBeforeMv = await mainSession.evaluate(
            `window["@shared/native-playback"].getCapabilities()` ,
            "audio media controls before MV",
        );
        const mvOpened = await mainSession.evaluate(`window["@shared/mv-overlay"].open({
            musicItem: {
                id: 4242,
                platform: "cc.baka.qq",
                title: "BakaMusic MV Package Smoke",
                artist: "BakaMusic",
                album: "Package Verification",
                artwork: ${JSON.stringify(`${resourceOrigin}/pixel.png`)},
                videoQuality: "720p",
            },
            audio: {
                volume: 0,
                muted: true,
            },
        })`, "open MV overlay window");
        assert.equal(mvOpened, true);
        const mvSessions = await connectWindowTargets(port, ["mv_window"]);
        const mvSession = mvSessions.get("mv_window");
        sessions.set("mv_window", mvSession);
        const mvPlaybackState = await retry(async () => {
            const state = await mvSession.evaluate(`(() => {
                const nativePlayback = window["@shared/native-playback"];
                const pluginManager = window["@shared/plugin-manager"];
                const player = document.querySelector(".modal--mv-player");
                return {
                    playerRendered: Boolean(player),
                    nativeSurfaceVisible:
                        player?.getAttribute("data-native-surface-visible") === "true",
                    title: document.querySelector(".mv-player-heading strong")?.textContent || "",
                    videoCommandBridge: typeof nativePlayback?.videoCommand,
                    videoFrameBridge: typeof nativePlayback?.onVideoFrame,
                    videoFrameAckBridge: typeof nativePlayback?.acknowledgeVideoFrame,
                    audioCommandBridge: typeof nativePlayback?.command,
                    capabilitiesBridge: typeof nativePlayback?.getCapabilities,
                    pluginCallBridge: typeof pluginManager?.invoke,
                    pluginInstallBridge: typeof pluginManager?.installPluginFromLocal,
                };
            })()`);
            return state.playerRendered && state.nativeSurfaceVisible ? state : null;
        }, 30_000);
        assert.deepEqual(mvPlaybackState, {
            playerRendered: true,
            nativeSurfaceVisible: true,
            title: "BakaMusic MV Package Smoke",
            videoCommandBridge: "function",
            videoFrameBridge: "function",
            videoFrameAckBridge: "function",
            audioCommandBridge: "undefined",
            capabilitiesBridge: "undefined",
            pluginCallBridge: "function",
            pluginInstallBridge: "undefined",
        });
        const videoControls = await mainSession.evaluate(
            `window["@shared/native-playback"].getCapabilities()`,
            "video media controls during MV",
        );
        assert.equal(
            videoControls.systemMediaControlsActive,
            process.platform === "win32",
        );
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
            if (name !== "main_window") {
                assert.equal(await sessions.get(name).evaluate('typeof window["@shared/dlna"]'), "undefined");
            }
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

        await mvSession.evaluate(`(() => {
            setTimeout(() => window["@shared/mv-overlay"].close(), 0);
            return true;
        })()`, "close MV overlay window");
        await retry(async () => {
            const targets = await getTargets(port);
            return targets.some((target) => classifyTarget(target) === "mv_window")
                ? null
                : true;
        });
        const audioControlsAfterMv = await retry(async () => {
            const capabilities = await mainSession.evaluate(
                `window["@shared/native-playback"].getCapabilities()`,
            );
            return capabilities.systemMediaControlsActive
                === audioControlsBeforeMv.systemMediaControlsActive
                ? capabilities
                : null;
        });
        assert.equal(
            audioControlsAfterMv.systemMediaControlsActive,
            audioControlsBeforeMv.systemMediaControlsActive,
        );

        await delay(1_000);
        const runtimeErrors = Object.fromEntries(
            [...sessions].map(([name, session]) => [name, session.errors]),
        );
        assert.ok(
            Object.values(runtimeErrors).every((errors) => errors.length === 0),
            `Runtime errors: ${JSON.stringify(runtimeErrors)}`,
        );
        console.log(JSON.stringify({
            smokeAudioOutput,
            windowStates,
            boundaryState,
            dlnaState,
            dlnaDialog,
            dlnaClosed,
            mvPlaybackState,
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
