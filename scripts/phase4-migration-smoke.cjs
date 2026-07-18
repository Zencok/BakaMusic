const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const appPath = path.resolve(__dirname, "../out/BakaMusic-win32-x64/BakaMusic.exe");

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

async function retry(callback, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const result = await callback();
            if (result) return result;
        } catch (error) {
            lastError = error;
        }
        await delay(100);
    }
    throw lastError || new Error("Timed out waiting for migration state");
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
                this.errors.push(message.params.exceptionDetails?.text || "Runtime exception");
            }
            if (
                message.method === "Log.entryAdded"
                && message.params.entry?.level === "error"
            ) {
                this.errors.push(message.params.entry.text);
            }
        });
        await new Promise((resolve, reject) => {
            this.socket.addEventListener("open", resolve, { once: true });
            this.socket.addEventListener("error", reject, { once: true });
        });
        await this.send("Runtime.enable");
        await this.send("Log.enable");
    }

    send(method, params = {}) {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const result = await this.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (result.exceptionDetails) {
            throw new Error(
                result.exceptionDetails.exception?.description
                || result.exceptionDetails.text,
            );
        }
        return result.result?.value;
    }

    close() {
        this.socket?.close();
    }
}

async function getMainTarget(port) {
    return retry(async () => {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await response.json();
        return targets.find((target) =>
            target.type === "page" && target.url.includes("/main_window/"));
    });
}

const seedLegacyDatabaseExpression = `(() => new Promise(async (resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase("musicSheetDB");
    await new Promise((deleted, failed) => {
        deleteRequest.onsuccess = deleted;
        deleteRequest.onerror = () => failed(deleteRequest.error);
        deleteRequest.onblocked = () => failed(new Error("delete blocked"));
    });

    const request = indexedDB.open("musicSheetDB", 11);
    request.onupgradeneeded = () => {
        const db = request.result;
        const sheets = db.createObjectStore("sheets", { keyPath: "id" });
        ["title", "artist", "createAt", "$$sortIndex"].forEach((name) =>
            sheets.createIndex(name, name));
        const music = db.createObjectStore("musicStore", {
            keyPath: ["platform", "id"],
        });
        ["title", "artist", "album"].forEach((name) => music.createIndex(name, name));
        const local = db.createObjectStore("localMusicStore", {
            keyPath: ["platform", "id"],
        });
        ["title", "artist", "album", "$$localPath"].forEach((name) =>
            local.createIndex(name, name));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["sheets", "musicStore"], "readwrite");
        transaction.objectStore("sheets").put({
            id: "favorite",
            platform: "本地",
            title: "Legacy favorite",
            musicList: [{
                platform: "fixture",
                id: "legacy-track",
                $$addedAt: 123,
                $$batchIndex: 7,
            }],
            $$sortIndex: -1,
        });
        transaction.objectStore("musicStore").put({
            platform: "fixture",
            id: "legacy-track",
            title: "Legacy track",
            artist: "Fixture artist",
            $$ref: 1,
        });
        transaction.oncomplete = () => {
            db.close();
            resolve(true);
        };
        transaction.onerror = () => reject(transaction.error);
    };
}))()`;

const inspectMigrationExpression = `(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("musicSheetDB");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["sheets", "musicStore", "sheetMusic"], "readonly");
        const sheetRequest = transaction.objectStore("sheets").get("favorite");
        const musicRequest = transaction.objectStore("musicStore").get(["fixture", "legacy-track"]);
        const relationRequest = transaction.objectStore("sheetMusic")
            .get(["favorite", "fixture", "legacy-track"]);
        transaction.oncomplete = () => {
            resolve({
                version: db.version,
                stores: [...db.objectStoreNames],
                sheet: sheetRequest.result,
                music: musicRequest.result,
                relation: relationRequest.result,
            });
            db.close();
        };
        transaction.onerror = () => reject(transaction.error);
    };
}))()`;

async function run() {
    assert.ok(fs.existsSync(appPath), `Packaged app not found: ${appPath}`);
    const port = await getFreePort();
    const userDataPath = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "bakamusic-phase4-migration-"),
    );
    const child = spawn(appPath, [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataPath}`,
    ], { windowsHide: true, stdio: "ignore" });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    let session;

    try {
        const target = await getMainTarget(port);
        session = new CdpSession(target.webSocketDebuggerUrl);
        await session.connect();
        await retry(() => session.evaluate(
            `document.readyState === "complete" && document.getElementById("root")?.innerHTML.length > 0`,
        ));
        await session.evaluate(seedLegacyDatabaseExpression);
        await session.evaluate("location.reload(); true");
        await retry(() => session.evaluate(
            `document.readyState === "complete" && document.getElementById("root")?.innerHTML.length > 0`,
        ));

        const migration = await retry(async () => {
            const result = await session.evaluate(inspectMigrationExpression);
            return result?.relation ? result : null;
        });
        assert.ok(migration.stores.includes("sheetMusic"));
        assert.equal(migration.sheet.musicList, undefined);
        assert.equal(migration.music.$$ref, 1);
        assert.deepEqual(migration.relation, {
            sheetId: "favorite",
            platform: "fixture",
            musicId: "legacy-track",
            position: 0,
            addedAt: 123,
            batchIndex: 7,
        });

        const statisticsStores = await session.evaluate(`(() => new Promise((resolve, reject) => {
            const request = indexedDB.open("listeningStatisticsDB");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                resolve([...request.result.objectStoreNames]);
                request.result.close();
            };
        }))()`);
        assert.deepEqual(statisticsStores.sort(), ["entries", "meta"]);
        assert.deepEqual(session.errors, []);
        console.log(JSON.stringify({ migration, statisticsStores }, null, 2));
        await session.evaluate(`window["@shared/utils"].app.exitApp()`);
        await Promise.race([exited, delay(10_000)]);
    } finally {
        session?.close();
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
