import localMusicListStore from "./store";
import { getUserPreferenceIDB } from "@/renderer/utils/user-perference";
import * as Comlink from "comlink";
import musicSheetDB from "../db/music-sheet-db";
import { getGlobalContext } from "@/shared/global-context/renderer";
import { localPluginName } from "@/common/constant";
import optimizeArtworkDataUrl, {
    shouldOptimizeArtworkDataUrl,
} from "@/renderer/utils/optimize-artwork-data-url";

type ProxyMarkedFunction<T extends (...args: any) => void> = T &
    Comlink.ProxyMarked;

type IMusicItemWithLocalPath = IMusic.IMusicItem & { $$localPath: string };

function getLocalMusicPrimaryKey(musicItem: IMusicItemWithLocalPath) {
    return `${musicItem.platform}@${musicItem.id}`;
}

function mergeLocalMusicItems(
    prevMusicItems: IMusicItemWithLocalPath[],
    nextMusicItems: IMusicItemWithLocalPath[],
) {
    const nextMusicMap = new Map(
        nextMusicItems.map((item) => [getLocalMusicPrimaryKey(item), item]),
    );

    const mergedMusicItems = prevMusicItems.map((item) => {
        const key = getLocalMusicPrimaryKey(item);
        const nextItem = nextMusicMap.get(key);
        if (!nextItem) {
            return item;
        }

        nextMusicMap.delete(key);
        return nextItem;
    });

    if (nextMusicMap.size) {
        mergedMusicItems.push(...nextMusicMap.values());
    }

    return mergedMusicItems;
}

interface ILocalFileWatcherWorker {
    setupWatcher: (initPaths?: string[], knownPaths?: string[]) => Promise<void>;
    changeWatchPath: (addPaths?: string[], rmPaths?: string[]) => Promise<void>;
    scanDirectories: (
        initPaths?: string[],
        knownPaths?: string[],
    ) => Promise<{
        musicItems: IMusicItemWithLocalPath[];
        removedFilePaths: string[];
    }>;
    onAdd: (
        cb: ProxyMarkedFunction<
            (musicItems: Array<IMusicItemWithLocalPath>) => Promise<void>
        >
    ) => void;
    onRemove: (
        cb: ProxyMarkedFunction<(filePaths: string[]) => Promise<void>>
    ) => void;
}

let localFileWatcherWorker: ILocalFileWatcherWorker;
let localMusicSetupToken = 0;

async function optimizeLocalArtworkItems(
    musicItems: IMusicItemWithLocalPath[],
) {
    const changedMusicItems: IMusicItemWithLocalPath[] = [];

    const optimizedMusicItems = await Promise.all(
        musicItems.map(async (musicItem) => {
            if (
                musicItem.platform !== localPluginName ||
                !shouldOptimizeArtworkDataUrl(musicItem.artwork)
            ) {
                return musicItem;
            }

            const optimizedArtwork = await optimizeArtworkDataUrl(musicItem.artwork);

            if (!optimizedArtwork || optimizedArtwork === musicItem.artwork) {
                return musicItem;
            }

            const nextMusicItem = {
                ...musicItem,
                artwork: optimizedArtwork,
            };

            changedMusicItems.push(nextMusicItem);
            return nextMusicItem;
        }),
    );

    return {
        optimizedMusicItems,
        changedMusicItems,
    };
}

async function getLocalFileWatcherWorker() {
    if (localFileWatcherWorker) {
        return localFileWatcherWorker;
    }

    const localFileWatcherWorkerPath =
        getGlobalContext().workersPath.localFileWatcher;

    if (!localFileWatcherWorkerPath) {
        return null;
    }

    const worker = new Worker(localFileWatcherWorkerPath);
    localFileWatcherWorker = Comlink.wrap<ILocalFileWatcherWorker>(worker);
    return localFileWatcherWorker;
}

function isSameDir(parent: string, target: string) {
    return window.path.resolve(parent) === window.path.resolve(target);
}

function isInSelectedDirs(filePath: string, selectedDirs: string[]) {
    return selectedDirs.some((dirPath) =>
        isSameDir(dirPath, filePath) || isSubDir(dirPath, filePath),
    );
}

function isSubDir(parent: string, target: string) {
    const relative = window.path.relative(parent, target);
    return (
        relative && !relative.startsWith("..") && !window.path.isAbsolute(relative)
    );
}

async function setupLocalMusic() {
    const setupToken = ++localMusicSetupToken;

    try {
        const allMusic = await musicSheetDB.localMusicStore.toArray();
        const {
            optimizedMusicItems,
            changedMusicItems,
        } = await optimizeLocalArtworkItems(allMusic);

        if (setupToken !== localMusicSetupToken) {
            return;
        }

        if (changedMusicItems.length) {
            await musicSheetDB.localMusicStore.bulkPut(changedMusicItems);
        }

        localMusicListStore.setValue(optimizedMusicItems);
    } catch {
        return;
    }
}

function releaseLocalMusic() {
    localMusicSetupToken += 1;
    localMusicListStore.setValue([]);
}

async function changeWatchPath(_logs: Map<string, "add" | "delete">) {
    const selectedDirs =
        (await getUserPreferenceIDB("localWatchDirChecked")) ?? [];
    const cachedLocalMusic = localMusicListStore.getValue();

    const retainedLocalMusic = cachedLocalMusic.filter((item) =>
        isInSelectedDirs(item.$$localPath, selectedDirs),
    );
    const deletedByDirChange = cachedLocalMusic.filter(
        (item) => !isInSelectedDirs(item.$$localPath, selectedDirs),
    );

    const worker = await getLocalFileWatcherWorker();
    const scanResult = worker
        ? await worker.scanDirectories(
            selectedDirs,
            retainedLocalMusic.map((item) => item.$$localPath),
        )
        : {
            musicItems: [],
            removedFilePaths: retainedLocalMusic.map((item) => item.$$localPath),
        };
    const optimizedScanResult = await optimizeLocalArtworkItems(scanResult.musicItems);

    const removedFilePaths = new Set(scanResult.removedFilePaths);
    const deletedPrimaryKeys = [
        ...deletedByDirChange.map((item) => [item.platform, item.id]),
        ...retainedLocalMusic
            .filter((item) => removedFilePaths.has(item.$$localPath))
            .map((item) => [item.platform, item.id]),
    ];

    await musicSheetDB.transaction(
        "rw",
        musicSheetDB.localMusicStore,
        async () => {
            if (deletedPrimaryKeys.length) {
                await musicSheetDB.localMusicStore.bulkDelete(deletedPrimaryKeys);
            }

            if (optimizedScanResult.optimizedMusicItems.length) {
                await musicSheetDB.localMusicStore.bulkPut(
                    optimizedScanResult.optimizedMusicItems,
                );
            }
        },
    );

    const nextLocalMusic = mergeLocalMusicItems(
        retainedLocalMusic.filter(
            (item) => !removedFilePaths.has(item.$$localPath),
        ),
        optimizedScanResult.optimizedMusicItems,
    );

    localMusicListStore.setValue(nextLocalMusic);
}

// async function syncLocalMusic() {
//   ipcRendererSend("sync-local-music");
// }

export default {
    setupLocalMusic,
    releaseLocalMusic,
    // syncLocalMusic,
    changeWatchPath,
};
