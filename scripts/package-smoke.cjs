const assert = require("node:assert/strict");
const fs = require("node:fs");
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
        `const storage = require("musicfree/storage");
        module.exports = {
            platform: "Phase5Smoke",
            version: "1.0.0",
            async search() {
                await storage.setItem("phase5-smoke", "ok");
                if (await storage.getItem("phase5-smoke") !== "ok") {
                    throw new Error("plugin storage roundtrip failed");
                }
                return { isEnd: true, data: [] };
            }
        };`,
        "utf8",
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
            LOCALAPPDATA: localAppDataPath,
            XDG_CONFIG_HOME: appDataPath,
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
            return {
                processType: typeof window.process,
                requireType: typeof window.require,
                dirnameType: typeof window.__dirname,
                legacyPathBridgeType: typeof window.path,
                nodeRuntimeBridge: typeof nodeRuntime.closeWatcher,
                pluginBridge: typeof pluginBridge.callPluginMethod,
            };
        })()`, "renderer boundary");
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
        await mainSession.evaluate(
            `window["@shared/node-runtime"].closeWatcher()`,
            "node runtime watcher shutdown",
        );
        const { pluginBridge: _pluginBridge, ...rendererState } = rendererBoundary;
        assert.equal(_pluginBridge, "function");
        const boundaryState = {
            ...rendererState,
            pluginResult,
            themeState,
        };
        assert.deepEqual(boundaryState, {
            processType: "undefined",
            requireType: "undefined",
            dirnameType: "undefined",
            legacyPathBridgeType: "undefined",
            nodeRuntimeBridge: "function",
            pluginResult: { isEnd: true, data: [] },
            themeState: {
                count: 1,
                pathProtocol: "bakamusic-theme:",
                cssValidated: true,
                assetLoaded: true,
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
