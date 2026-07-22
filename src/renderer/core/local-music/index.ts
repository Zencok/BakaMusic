import { mapWithConcurrency } from "@/common/concurrency-util";
import { localPluginName } from "@/common/constant";
import { getUserPreferenceIDB } from "@/renderer/utils/user-perference";
import musicSheetDB from "../music-sheet/database";
import optimizeArtworkDataUrl, {
    shouldOptimizeArtworkDataUrl,
} from "@/renderer/utils/optimize-artwork-data-url";
import localMusicListStore from "./store";
import {
    isAbsoluteFilePath,
    normalizeFilePath,
    relativeFilePath,
    resolveFilePath,
} from "@/common/path-util";
import nodeRuntime from "@shared/node-runtime/renderer";
import AppConfig from "@shared/app-config/renderer";

type LocalMusicItem = IMusic.IMusicItem & { $$localPath: string };

interface ILocalFileWatcherWorker {
    setupWatcher: (initPaths?: string[], knownPaths?: string[]) => Promise<void>;
    closeWatcher: () => Promise<void>;
    changeWatchPath: (addPaths?: string[], removePaths?: string[]) => Promise<void>;
    scanDirectories: (
        initPaths?: string[],
        knownPaths?: string[],
    ) => Promise<{
        musicItems: LocalMusicItem[];
        removedFilePaths: string[];
    }>;
    onWatcherAdd: (cb: (musicItems: LocalMusicItem[]) => void) => void;
    onWatcherRemove: (cb: (filePaths: string[]) => void) => void;
}

let localFileWatcherWorker: ILocalFileWatcherWorker | undefined;
let watcherCallbacksRegistered = false;
let localMusicSetupToken = 0;
let localMusicActive = false;

function normalizeRendererPath(filePath: string) {
    const normalizedPath = normalizeFilePath(resolveFilePath(filePath));
    return normalizedPath.replace(/^([a-z]):/, (_match, drive: string) =>
        `${drive.toUpperCase()}:`);
}

function getRendererPathKey(filePath: string) {
    const normalizedPath = normalizeRendererPath(filePath);
    return /^[A-Z]:[\\/]/i.test(normalizedPath)
        ? normalizedPath.toLocaleLowerCase("en-US")
        : normalizedPath;
}

function normalizeLocalMusicPath(musicItem: LocalMusicItem) {
    const normalizedPath = normalizeRendererPath(
        musicItem.$$localPath || musicItem.localPath,
    );
    if (
        normalizedPath === musicItem.$$localPath
        && normalizedPath === musicItem.localPath
    ) {
        return musicItem;
    }
    return {
        ...musicItem,
        $$localPath: normalizedPath,
        localPath: normalizedPath,
    };
}

function getLocalMusicPrimaryKey(musicItem: LocalMusicItem) {
    return `${musicItem.platform}@${musicItem.id}`;
}

function mergeLocalMusicItems(
    previousItems: LocalMusicItem[],
    nextItems: LocalMusicItem[],
) {
    const nextByPath = new Map(
        nextItems.map((item) => [getRendererPathKey(item.$$localPath), item]),
    );
    const nextById = new Map(
        nextItems.map((item) => [getLocalMusicPrimaryKey(item), item]),
    );
    const mergedItems = previousItems.map((item) => {
        const pathKey = getRendererPathKey(item.$$localPath);
        const replacement = nextByPath.get(pathKey)
            ?? nextById.get(getLocalMusicPrimaryKey(item));
        if (!replacement) {
            return item;
        }
        nextByPath.delete(pathKey);
        nextById.delete(getLocalMusicPrimaryKey(replacement));
        return replacement;
    });
    nextItems.forEach((item) => {
        if (nextById.has(getLocalMusicPrimaryKey(item))) {
            mergedItems.push(item);
            nextById.delete(getLocalMusicPrimaryKey(item));
        }
    });
    return mergedItems;
}

async function optimizeLocalArtworkItems(musicItems: LocalMusicItem[]) {
    const normalizedItems = musicItems.map(normalizeLocalMusicPath);
    const optimizedMusicItems = await mapWithConcurrency(
        normalizedItems,
        4,
        async (musicItem) => {
            if (
                musicItem.platform !== localPluginName
                || !shouldOptimizeArtworkDataUrl(musicItem.artwork)
            ) {
                return musicItem;
            }
            const optimizedArtwork = await optimizeArtworkDataUrl(musicItem.artwork);
            if (!optimizedArtwork || optimizedArtwork === musicItem.artwork) {
                return musicItem;
            }
            return { ...musicItem, artwork: optimizedArtwork };
        },
    );
    const changedMusicItems = optimizedMusicItems.filter(
        (item, index) => item !== musicItems[index],
    );
    return { optimizedMusicItems, changedMusicItems };
}

async function applyAddedLocalMusic(musicItems: LocalMusicItem[]) {
    if (!localMusicActive || !musicItems.length) {
        return;
    }
    const setupToken = localMusicSetupToken;
    const optimized = await optimizeLocalArtworkItems(musicItems);
    if (setupToken !== localMusicSetupToken || !localMusicActive) {
        return;
    }

    const previousItems = localMusicListStore.getValue();
    const previousByPath = new Map(
        previousItems.map((item) => [getRendererPathKey(item.$$localPath), item]),
    );
    const replacedPrimaryKeys = optimized.optimizedMusicItems.flatMap((item) => {
        const previousItem = previousByPath.get(getRendererPathKey(item.$$localPath));
        return previousItem && previousItem.id !== item.id
            ? [[previousItem.platform, previousItem.id] as [string, string]]
            : [];
    });

    await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.localMusicStore,
        async () => {
            if (replacedPrimaryKeys.length) {
                await musicSheetDB.localMusicStore.bulkDelete(replacedPrimaryKeys);
            }
            await musicSheetDB.localMusicStore.bulkPut(optimized.optimizedMusicItems);
        },
    );
    if (setupToken === localMusicSetupToken && localMusicActive) {
        localMusicListStore.setValue((previous) =>
            mergeLocalMusicItems(previous, optimized.optimizedMusicItems));
    }
}

async function applyRemovedLocalMusic(filePaths: string[]) {
    if (!localMusicActive || !filePaths.length) {
        return;
    }
    const removedPathKeys = new Set(filePaths.map(getRendererPathKey));
    const currentItems = localMusicListStore.getValue();
    const removedItems = currentItems.filter((item) =>
        removedPathKeys.has(getRendererPathKey(item.$$localPath)));
    if (!removedItems.length) {
        return;
    }
    await musicSheetDB.localMusicStore.bulkDelete(
        removedItems.map((item) => [item.platform, item.id]),
    );
    if (localMusicActive) {
        localMusicListStore.setValue((previous) => previous.filter((item) =>
            !removedPathKeys.has(getRendererPathKey(item.$$localPath))));
    }
}

async function getLocalFileWatcherWorker() {
    if (localFileWatcherWorker) {
        return localFileWatcherWorker;
    }
    localFileWatcherWorker = nodeRuntime as unknown as ILocalFileWatcherWorker;
    return localFileWatcherWorker;
}

async function ensureWatcherCallbacks(worker: ILocalFileWatcherWorker) {
    if (watcherCallbacksRegistered) {
        return;
    }
    worker.onWatcherAdd((musicItems: LocalMusicItem[]) => {
        void applyAddedLocalMusic(musicItems);
    });
    worker.onWatcherRemove((filePaths: string[]) => {
        void applyRemovedLocalMusic(filePaths);
    });
    watcherCallbacksRegistered = true;
}

function isSameDir(parent: string, target: string) {
    return getRendererPathKey(parent) === getRendererPathKey(target);
}

function isSubDir(parent: string, target: string) {
    const relative = relativeFilePath(
        normalizeRendererPath(parent),
        normalizeRendererPath(target),
    );
    return Boolean(
        relative
        && !relative.startsWith("..")
        && !isAbsoluteFilePath(relative),
    );
}

function isInSelectedDirs(filePath: string, selectedDirs: string[]) {
    return selectedDirs.some((dirPath) =>
        isSameDir(dirPath, filePath) || isSubDir(dirPath, filePath));
}

async function getSelectedDirectories() {
    const configuredDirectories = (AppConfig.getConfig("localMusic.watchDir") ?? [])
        .map(normalizeRendererPath);
    if (configuredDirectories.length) {
        return configuredDirectories;
    }
    const legacyDirectories = ((await getUserPreferenceIDB("localWatchDirChecked")) ?? [])
        .map(normalizeRendererPath);
    if (!legacyDirectories.length) {
        return [];
    }
    return await AppConfig.migrateLocalWatchDirectories(legacyDirectories);
}

async function setupLocalMusic() {
    const setupToken = ++localMusicSetupToken;
    localMusicActive = true;
    try {
        const allMusic = await musicSheetDB.localMusicStore.toArray();
        const optimized = await optimizeLocalArtworkItems(allMusic);
        if (setupToken !== localMusicSetupToken || !localMusicActive) {
            return;
        }
        if (optimized.changedMusicItems.length) {
            await musicSheetDB.localMusicStore.bulkPut(
                optimized.changedMusicItems,
            );
        }
        localMusicListStore.setValue(optimized.optimizedMusicItems);

        const worker = await getLocalFileWatcherWorker();
        if (!worker || setupToken !== localMusicSetupToken) {
            return;
        }
        await ensureWatcherCallbacks(worker);
        const selectedDirectories = await getSelectedDirectories();
        if (setupToken !== localMusicSetupToken || !localMusicActive) {
            return;
        }
        const knownPaths = optimized.optimizedMusicItems
            .filter((item) => isInSelectedDirs(item.$$localPath, selectedDirectories))
            .map((item) => item.$$localPath);
        await worker.setupWatcher(
            selectedDirectories,
            knownPaths,
        );
    } catch {
        return;
    }
}

function releaseLocalMusic() {
    localMusicActive = false;
    localMusicSetupToken++;
    localMusicListStore.setValue([]);
    void localFileWatcherWorker?.closeWatcher();
}

async function reconcileSelectedDirectories() {
    const setupToken = localMusicSetupToken;
    const selectedDirs = await getSelectedDirectories();
    const cachedItems = localMusicListStore.getValue();
    const retainedItems = cachedItems.filter((item) =>
        isInSelectedDirs(item.$$localPath, selectedDirs));
    const removedBySelection = cachedItems.filter((item) =>
        !isInSelectedDirs(item.$$localPath, selectedDirs));
    const worker = await getLocalFileWatcherWorker();
    const scanResult = worker
        ? await worker.scanDirectories(
            selectedDirs,
            retainedItems.map((item) => item.$$localPath),
        )
        : { musicItems: [], removedFilePaths: retainedItems.map((item) => item.$$localPath) };
    const optimized = await optimizeLocalArtworkItems(scanResult.musicItems);
    if (setupToken !== localMusicSetupToken || !localMusicActive) {
        return;
    }

    const removedPathKeys = new Set(
        scanResult.removedFilePaths.map(getRendererPathKey),
    );
    const removedItems = [
        ...removedBySelection,
        ...retainedItems.filter((item) =>
            removedPathKeys.has(getRendererPathKey(item.$$localPath))),
    ];
    await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.localMusicStore,
        async () => {
            if (removedItems.length) {
                await musicSheetDB.localMusicStore.bulkDelete(
                    removedItems.map((item) => [item.platform, item.id]),
                );
            }
            if (optimized.optimizedMusicItems.length) {
                await musicSheetDB.localMusicStore.bulkPut(
                    optimized.optimizedMusicItems,
                );
            }
        },
    );
    if (setupToken === localMusicSetupToken && localMusicActive) {
        localMusicListStore.setValue(mergeLocalMusicItems(
            retainedItems.filter((item) =>
                !removedPathKeys.has(getRendererPathKey(item.$$localPath))),
            optimized.optimizedMusicItems,
        ));
    }
}

async function changeWatchPath(changeLog: Map<string, "add" | "delete">) {
    if (!changeLog.size) {
        await reconcileSelectedDirectories();
        return;
    }
    const worker = await getLocalFileWatcherWorker();
    if (!worker) {
        return;
    }
    await ensureWatcherCallbacks(worker);
    const addPaths: string[] = [];
    const removePaths: string[] = [];
    changeLog.forEach((operation, filePath) => {
        (operation === "add" ? addPaths : removePaths).push(
            normalizeRendererPath(filePath),
        );
    });
    await worker.changeWatchPath(addPaths, removePaths);

    const selectedDirs = await getSelectedDirectories();
    const removedItems = localMusicListStore.getValue().filter((item) =>
        !isInSelectedDirs(item.$$localPath, selectedDirs));
    if (removedItems.length) {
        await musicSheetDB.localMusicStore.bulkDelete(
            removedItems.map((item) => [item.platform, item.id]),
        );
        localMusicListStore.setValue((previous) => previous.filter((item) =>
            isInSelectedDirs(item.$$localPath, selectedDirs)));
    }
}

async function scanLocalMusicChanges() {
    await reconcileSelectedDirectories();
}

async function clearAndRescanLocalMusic() {
    const setupToken = localMusicSetupToken;
    const selectedDirs = await getSelectedDirectories();
    if (setupToken !== localMusicSetupToken || !localMusicActive) {
        return;
    }
    if (!selectedDirs.length) {
        await musicSheetDB.localMusicStore.clear();
        if (setupToken === localMusicSetupToken && localMusicActive) {
            localMusicListStore.setValue([]);
        }
        return;
    }
    const worker = await getLocalFileWatcherWorker();
    if (!worker) {
        return;
    }
    const scanResult = await worker.scanDirectories(selectedDirs, []);
    const optimized = await optimizeLocalArtworkItems(scanResult.musicItems);
    if (setupToken !== localMusicSetupToken || !localMusicActive) {
        return;
    }
    await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.localMusicStore,
        async () => {
            await musicSheetDB.localMusicStore.clear();
            if (optimized.optimizedMusicItems.length) {
                await musicSheetDB.localMusicStore.bulkPut(
                    optimized.optimizedMusicItems,
                );
            }
        },
    );
    if (setupToken !== localMusicSetupToken || !localMusicActive) {
        return;
    }
    localMusicListStore.setValue(optimized.optimizedMusicItems);
    await worker.setupWatcher(
        selectedDirs,
        optimized.optimizedMusicItems.map((item) => item.$$localPath),
    );
}

export default {
    setupLocalMusic,
    releaseLocalMusic,
    changeWatchPath,
    scanLocalMusicChanges,
    clearAndRescanLocalMusic,
};
