import * as Comlink from "comlink";
import * as chokidar from "chokidar";
import path from "path";
import { supportLocalMediaType } from "@/common/constant";
import debounce from "lodash.debounce";
import { parseLocalMusicItem } from "@/common/file-util";
import { setInternalData } from "@/common/media-util";

let watcher: chokidar.FSWatcher;

const addedMusicItems: IMusic.IMusicItem[] = [];
const removedFilePaths: string[] = [];
const knownLocalFilePaths = new Set<string>();

let initialScanCompleted = false;

let _onAdd: (musicItems: IMusic.IMusicItem[]) => void;
let _onRemove: (filePaths: string[]) => void;

function isSupportedLocalMusicFile(filePath: string) {
    return supportLocalMediaType.some((postfix) => filePath.endsWith(postfix));
}

function getCurrentWatchedLocalMusicFiles() {
    const watchedFiles = new Set<string>();
    const watched = watcher?.getWatched?.() ?? {};

    Object.entries(watched).forEach(([dirPath, entries]) => {
        entries.forEach((entryName) => {
            const filePath = path.join(dirPath, entryName);
            if (isSupportedLocalMusicFile(filePath)) {
                watchedFiles.add(filePath);
            }
        });
    });

    return watchedFiles;
}

function createParsedLocalMusicItem(filePath: string) {
    return parseLocalMusicItem(filePath).then((musicItem) => {
        musicItem.$$localPath = filePath;
        setInternalData<IMusic.IMusicItemInternalData>(
            musicItem,
            "downloadData",
            {
                path: filePath,
                quality: "320k",
            },
        );
        return musicItem;
    });
}

async function setupWatcher(initPaths?: string[], knownPaths: string[] = []) {
    initialScanCompleted = false;
    knownLocalFilePaths.clear();
    knownPaths.forEach((filePath) => {
        if (filePath) {
            knownLocalFilePaths.add(filePath);
        }
    });

    watcher = chokidar.watch(initPaths ?? [], {
        depth: 10,
        persistent: true,
        ignorePermissionErrors: true,
    });

    watcher.on("add", async (fp, stats) => {
        if (!(stats?.isFile?.() ?? true) || !isSupportedLocalMusicFile(fp)) {
            return;
        }
        if (!initialScanCompleted && knownLocalFilePaths.delete(fp)) {
            return;
        }

        const musicItem = await createParsedLocalMusicItem(fp);
        addedMusicItems.push(musicItem);
        syncAddedMusic();
    });

    watcher.on("unlink", (fp) => {
        knownLocalFilePaths.delete(fp);
        if (isSupportedLocalMusicFile(fp)) {
            removedFilePaths.push(fp);
            syncRemovedFilePaths();
        }
    });

    watcher.on("ready", () => {
        const watchedLocalMusicFiles = getCurrentWatchedLocalMusicFiles();
        const staleFilePaths = [...knownLocalFilePaths].filter(
            (filePath) => !watchedLocalMusicFiles.has(filePath),
        );

        initialScanCompleted = true;
        knownLocalFilePaths.clear();

        if (staleFilePaths.length) {
            removedFilePaths.push(...staleFilePaths);
            syncRemovedFilePaths();
        }
    });
}

const syncAddedMusic = debounce(
    () => {
        const copyOfAddedMusicItems = [...addedMusicItems];
        addedMusicItems.length = 0;
        _onAdd?.(copyOfAddedMusicItems);
    },
    500,
    {
        leading: false,
        trailing: true,
    },
);

const syncRemovedFilePaths = debounce(
    () => {
        const copyOfRemovedFilePaths = [...removedFilePaths];
        removedFilePaths.length = 0;
        _onRemove?.(copyOfRemovedFilePaths);
    },
    500,
    {
        leading: false,
        trailing: true,
    },
);

async function changeWatchPath(addPaths?: string[], rmPaths?: string[]) {
    try {
        if (addPaths?.length) {
            watcher.add(addPaths);
        }
        if (rmPaths?.length) {
            watcher.unwatch(rmPaths);
            /**
       * chokidar的bug: https://github.com/paulmillr/chokidar/issues/1027
       * unwatch之后重新watch不会触发文件更新
       */
            rmPaths.forEach((it) => {
                // @ts-ignore
                const watchedDirEntry = watcher._watched.get(it);
                if (watchedDirEntry) {
                    // 移除所有子节点的监听
                    watchedDirEntry._removeWatcher(
                        path.dirname(it),
                        path.basename(it),
                        true,
                    );
                }
                // watcher._watched.delete(it);
            });
        }
    // console.log("WATCH PATH CHANGED", addPaths, rmPaths, watcher);
    } catch {
        return;
    }
}

async function onAdd(fn: (musicItems: IMusic.IMusicItem[]) => void) {
    _onAdd = fn;
}

async function onRemove(fn: (filePaths: string[]) => void) {
    _onRemove = fn;
}

async function scanDirectories(initPaths: string[] = [], knownPaths: string[] = []) {
    const scannedKnownPaths = new Set(knownPaths);
    const watchedFiles = new Set<string>();
    const nextMusicItems: IMusic.IMusicItem[] = [];
    const pendingTasks = new Set<Promise<void>>();

    const scanWatcher = chokidar.watch(initPaths, {
        depth: 10,
        persistent: true,
        ignorePermissionErrors: true,
    });

    return await new Promise<{
        musicItems: IMusic.IMusicItem[];
        removedFilePaths: string[];
    }>((resolve) => {
        const finalize = async () => {
            await Promise.all([...pendingTasks]);
            const removedFilePaths = [...scannedKnownPaths].filter(
                (filePath) => !watchedFiles.has(filePath),
            );
            await scanWatcher.close();
            resolve({
                musicItems: nextMusicItems,
                removedFilePaths,
            });
        };

        scanWatcher.on("add", (fp, stats) => {
            if (!(stats?.isFile?.() ?? true) || !isSupportedLocalMusicFile(fp)) {
                return;
            }

            watchedFiles.add(fp);
            if (scannedKnownPaths.delete(fp)) {
                return;
            }

            const task = createParsedLocalMusicItem(fp)
                .then((musicItem) => {
                    nextMusicItems.push(musicItem);
                })
                .finally(() => {
                    pendingTasks.delete(task);
                });

            pendingTasks.add(task);
        });

        scanWatcher.on("ready", () => {
            void finalize();
        });
    });
}

Comlink.expose({
    setupWatcher,
    changeWatchPath,
    onAdd,
    onRemove,
    scanDirectories,
});
