import { app } from "electron";
import path from "path";
import fsSync from "fs";
import fs from "fs/promises";
import { rimraf } from "rimraf";

const MAX_STORAGE_SIZE = 1024 * 1024 * 10;
let storage: Record<string, string> = {};
let loaded = false;

function resolveStoragePath() {
    const nextStoragePath = path.resolve(
        app.getPath("appData"),
        "./bakamusic-plugin-storage/chunk.json",
    );
    const legacyStoragePath = path.resolve(
        app.getPath("appData"),
        "./musicfree-plugin-storage/chunk.json",
    );

    if (fsSync.existsSync(nextStoragePath) || !fsSync.existsSync(legacyStoragePath)) {
        return nextStoragePath;
    }

    return legacyStoragePath;
}

async function loadStorage() {
    if (loaded) {
        return storage;
    }
    try {
        const storagePath = resolveStoragePath();
        const storageString = await fs.readFile(storagePath, "utf-8");
        storage = JSON.parse(storageString);
    } catch {
        // pass
    }
    loaded = true;
}

async function saveStorage(newStorage: Record<string, string>) {
    const storageString = JSON.stringify(newStorage, undefined, 0);
    if (Buffer.byteLength(storageString, "utf-8") > MAX_STORAGE_SIZE) {
        throw new Error("Storage size exceeds limit");
    }

    const storagePath = resolveStoragePath();

    let fileExist = true;
    try {
        const stat = await fs.stat(storagePath);
        if (!stat.isFile()) {
            fileExist = false;
            await rimraf(storagePath);
        }
    } catch {
        fileExist = false;
    }

    if (!fileExist) {
        await fs.mkdir(path.resolve(storagePath, ".."), {
            recursive: true,
        });
    }
    storage = newStorage;
    await fs.writeFile(storagePath, storageString, "utf-8");
}

async function setItem(key: string, value: unknown) {
    if (!loaded) {
        await loadStorage();
    }
    const newStorage = {
        ...storage,
        [key]: typeof value === "string" ? value : value?.toString?.(),
    };
    await saveStorage(newStorage);
}

async function getItem(key: string) {
    if (!loaded) {
        await loadStorage();
    }
    return storage[key] ?? null;
}

async function removeItem(key: string) {
    if (!loaded) {
        await loadStorage();
    }
    const newStorage = {
        ...storage,
    };
    delete newStorage[key];
    await saveStorage(newStorage);
}

export default {
    setItem,
    getItem,
    removeItem,
};
