import * as chokidar from "chokidar";
import path from "path";
import { supportLocalMediaType } from "@/common/constant";
import { mapWithConcurrency } from "@/common/concurrency-util";
import {
    getLocalPathComparisonKey,
    normalizeLocalFilePath,
    parseLocalMusicItem,
} from "@/common/file-util";
import debounce from "lodash.debounce";

const LOCAL_METADATA_CONCURRENCY = 4;

type LocalMusicItem = IMusic.IMusicItem & { $$localPath: string };
type AddCallback = (musicItems: LocalMusicItem[]) => void | Promise<void>;
type RemoveCallback = (filePaths: string[]) => void | Promise<void>;

let watcher: chokidar.FSWatcher | null = null;
let watcherGeneration = 0;
let initialScanCompleted = false;
let onAddCallback: AddCallback | undefined;
let onRemoveCallback: RemoveCallback | undefined;
let incrementalTaskQueue: Promise<void> = Promise.resolve();

const knownLocalFilePaths = new Map<string, string>();
const liveLocalFileKeys = new Set<string>();
const pendingAddedPaths = new Map<string, string>();
const pendingRemovedPaths = new Map<string, string>();

function isSupportedLocalMusicFile(filePath: string) {
    const lowerFilePath = filePath.toLocaleLowerCase();
    return supportLocalMediaType.some((postfix) =>
        lowerFilePath.endsWith(postfix));
}

function normalizePaths(paths: string[] = []) {
    return Array.from(new Set(paths.filter(Boolean).map(normalizeLocalFilePath)));
}

function getCurrentWatchedLocalMusicFiles(currentWatcher: chokidar.FSWatcher) {
    const watchedFiles = new Map<string, string>();
    const watched = currentWatcher.getWatched();

    Object.entries(watched).forEach(([dirPath, entries]) => {
        entries.forEach((entryName) => {
            const filePath = normalizeLocalFilePath(path.join(dirPath, entryName));
            if (isSupportedLocalMusicFile(filePath)) {
                watchedFiles.set(getLocalPathComparisonKey(filePath), filePath);
            }
        });
    });
    return watchedFiles;
}

async function createParsedLocalMusicItem(filePath: string) {
    const normalizedPath = normalizeLocalFilePath(filePath);
    const musicItem = await parseLocalMusicItem(normalizedPath) as LocalMusicItem;
    musicItem.$$localPath = normalizedPath;
    return musicItem;
}

const flushAddedMusic = debounce(() => {
    const paths = [...pendingAddedPaths.values()];
    pendingAddedPaths.clear();
    const generation = watcherGeneration;

    incrementalTaskQueue = incrementalTaskQueue.then(async () => {
        const musicItems = await mapWithConcurrency(
            paths,
            LOCAL_METADATA_CONCURRENCY,
            createParsedLocalMusicItem,
        );
        if (generation !== watcherGeneration) {
            return;
        }
        const currentItems = musicItems.filter((musicItem) =>
            liveLocalFileKeys.has(
                getLocalPathComparisonKey(musicItem.$$localPath),
            ));
        if (currentItems.length) {
            await onAddCallback?.(currentItems);
        }
    }).catch(() => undefined);
}, 350, { leading: false, trailing: true });

const flushRemovedMusic = debounce(() => {
    const paths = [...pendingRemovedPaths.values()];
    pendingRemovedPaths.clear();
    if (paths.length) {
        void onRemoveCallback?.(paths);
    }
}, 350, { leading: false, trailing: true });

function queueAddedFile(filePath: string) {
    const normalizedPath = normalizeLocalFilePath(filePath);
    const key = getLocalPathComparisonKey(normalizedPath);
    liveLocalFileKeys.add(key);
    pendingRemovedPaths.delete(key);
    pendingAddedPaths.set(key, normalizedPath);
    flushAddedMusic();
}

function queueRemovedFile(filePath: string) {
    const normalizedPath = normalizeLocalFilePath(filePath);
    const key = getLocalPathComparisonKey(normalizedPath);
    liveLocalFileKeys.delete(key);
    knownLocalFilePaths.delete(key);
    pendingAddedPaths.delete(key);
    pendingRemovedPaths.set(key, normalizedPath);
    flushRemovedMusic();
}

export async function closeWatcher() {
    watcherGeneration++;
    initialScanCompleted = false;
    flushAddedMusic.cancel();
    flushRemovedMusic.cancel();
    pendingAddedPaths.clear();
    pendingRemovedPaths.clear();
    knownLocalFilePaths.clear();
    liveLocalFileKeys.clear();
    const currentWatcher = watcher;
    watcher = null;
    if (currentWatcher) {
        await currentWatcher.close();
    }
}

export async function setupWatcher(initPaths: string[] = [], knownPaths: string[] = []) {
    await closeWatcher();
    const generation = watcherGeneration;
    normalizePaths(knownPaths).forEach((filePath) => {
        knownLocalFilePaths.set(getLocalPathComparisonKey(filePath), filePath);
    });

    const nextWatcher = chokidar.watch(normalizePaths(initPaths), {
        depth: 10,
        persistent: true,
        ignorePermissionErrors: true,
    });
    watcher = nextWatcher;

    nextWatcher.on("add", (filePath, stats) => {
        if (
            generation !== watcherGeneration
            || !(stats?.isFile?.() ?? true)
            || !isSupportedLocalMusicFile(filePath)
        ) {
            return;
        }
        const normalizedPath = normalizeLocalFilePath(filePath);
        const key = getLocalPathComparisonKey(normalizedPath);
        liveLocalFileKeys.add(key);
        if (!initialScanCompleted && knownLocalFilePaths.delete(key)) {
            return;
        }
        queueAddedFile(normalizedPath);
    });

    nextWatcher.on("change", (filePath) => {
        if (
            generation === watcherGeneration
            && isSupportedLocalMusicFile(filePath)
        ) {
            queueAddedFile(filePath);
        }
    });

    nextWatcher.on("unlink", (filePath) => {
        if (
            generation === watcherGeneration
            && isSupportedLocalMusicFile(filePath)
        ) {
            queueRemovedFile(filePath);
        }
    });

    nextWatcher.on("ready", () => {
        if (generation !== watcherGeneration) {
            return;
        }
        const watchedFiles = getCurrentWatchedLocalMusicFiles(nextWatcher);
        const staleFilePaths = [...knownLocalFilePaths.entries()]
            .filter(([key]) => !watchedFiles.has(key))
            .map(([, filePath]) => filePath);
        watchedFiles.forEach((_filePath, key) => liveLocalFileKeys.add(key));
        initialScanCompleted = true;
        knownLocalFilePaths.clear();
        staleFilePaths.forEach(queueRemovedFile);
    });
}

export async function changeWatchPath(addPaths: string[] = [], removePaths: string[] = []) {
    if (!watcher) {
        await setupWatcher(addPaths);
        return;
    }
    const normalizedAddPaths = normalizePaths(addPaths);
    const normalizedRemovePaths = normalizePaths(removePaths);
    if (normalizedAddPaths.length) {
        watcher.add(normalizedAddPaths);
    }
    if (normalizedRemovePaths.length) {
        await watcher.unwatch(normalizedRemovePaths);
    }
}

export async function onAdd(callback: AddCallback) {
    onAddCallback = callback;
}

export async function onRemove(callback: RemoveCallback) {
    onRemoveCallback = callback;
}

export async function scanDirectories(initPaths: string[] = [], knownPaths: string[] = []) {
    const normalizedKnownPaths = normalizePaths(knownPaths);
    const knownPathMap = new Map(
        normalizedKnownPaths.map((filePath) => [
            getLocalPathComparisonKey(filePath),
            filePath,
        ]),
    );
    const watchedFiles = new Map<string, string>();
    const scanWatcher = chokidar.watch(normalizePaths(initPaths), {
        depth: 10,
        persistent: true,
        ignorePermissionErrors: true,
    });

    return new Promise<{
        musicItems: LocalMusicItem[];
        removedFilePaths: string[];
    }>((resolve) => {
        let finalized = false;
        const finalize = async () => {
            if (finalized) {
                return;
            }
            finalized = true;
            await scanWatcher.close();
            const newFilePaths = [...watchedFiles.entries()]
                .filter(([key]) => !knownPathMap.has(key))
                .map(([, filePath]) => filePath);
            const musicItems = await mapWithConcurrency(
                newFilePaths,
                LOCAL_METADATA_CONCURRENCY,
                createParsedLocalMusicItem,
            );
            const removedFilePaths = [...knownPathMap.entries()]
                .filter(([key]) => !watchedFiles.has(key))
                .map(([, filePath]) => filePath);
            resolve({ musicItems, removedFilePaths });
        };

        scanWatcher.on("add", (filePath, stats) => {
            if (!(stats?.isFile?.() ?? true) || !isSupportedLocalMusicFile(filePath)) {
                return;
            }
            const normalizedPath = normalizeLocalFilePath(filePath);
            watchedFiles.set(getLocalPathComparisonKey(normalizedPath), normalizedPath);
        });
        scanWatcher.on("ready", () => {
            void finalize();
        });
        scanWatcher.on("error", () => {
            void finalize();
        });
    });
}
