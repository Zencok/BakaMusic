import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { IDownloadPostprocessPayload } from "@/common/download-postprocess";
import { DownloadState } from "@/common/constant";

type DownloadStateCallback = (state: {
    state: DownloadState;
    downloaded?: number;
    total?: number;
    msg?: string;
}) => void;

const downloadCallbacks = new Map<string, DownloadStateCallback>();
let watcherAddCallback: ((musicItems: unknown[]) => void) | undefined;
let watcherRemoveCallback: ((filePaths: string[]) => void) | undefined;

ipcRenderer.on("@shared/node-runtime/download-state", (_event, payload) => {
    if (payload && typeof payload.taskId === "string") {
        downloadCallbacks.get(payload.taskId)?.(payload.state);
    }
});
ipcRenderer.on("@shared/node-runtime/watcher-add", (_event, musicItems) => {
    if (Array.isArray(musicItems)) {
        watcherAddCallback?.(musicItems);
    }
});
ipcRenderer.on("@shared/node-runtime/watcher-remove", (_event, filePaths) => {
    if (Array.isArray(filePaths)) {
        watcherRemoveCallback?.(filePaths);
    }
});

async function downloadFile(
    taskId: string,
    mediaSource: IMusic.IMusicSource,
    filePath: string,
    onStateChange: DownloadStateCallback,
) {
    downloadCallbacks.set(taskId, onStateChange);
    try {
        await ipcRenderer.invoke(
            "@shared/node-runtime/download-file",
            taskId,
            mediaSource,
            filePath,
        );
    } finally {
        if (downloadCallbacks.get(taskId) === onStateChange) {
            downloadCallbacks.delete(taskId);
        }
    }
}

async function abortDownload(taskId: string, removePartial = true) {
    await ipcRenderer.invoke("@shared/node-runtime/abort-download", taskId, removePartial);
}

async function postprocessDownloadedFile(
    filePath: string,
    payload?: IDownloadPostprocessPayload | null,
) {
    await ipcRenderer.invoke("@shared/node-runtime/postprocess-download", filePath, payload);
}

async function setupWatcher(initPaths: string[] = [], knownPaths: string[] = []) {
    await ipcRenderer.invoke("@shared/node-runtime/watcher-setup", initPaths, knownPaths);
}

async function closeWatcher() {
    await ipcRenderer.invoke("@shared/node-runtime/watcher-close");
}

async function changeWatchPath(addPaths: string[] = [], removePaths: string[] = []) {
    await ipcRenderer.invoke("@shared/node-runtime/watcher-change", addPaths, removePaths);
}

async function scanDirectories(initPaths: string[] = [], knownPaths: string[] = []) {
    return await ipcRenderer.invoke(
        "@shared/node-runtime/watcher-scan",
        initPaths,
        knownPaths,
    );
}

function onWatcherAdd(callback: (musicItems: unknown[]) => void) {
    watcherAddCallback = callback;
}

function onWatcherRemove(callback: (filePaths: string[]) => void) {
    watcherRemoveCallback = callback;
}

export const mod = {
    downloadFile,
    abortDownload,
    postprocessDownloadedFile,
    setupWatcher,
    closeWatcher,
    changeWatchPath,
    scanDirectories,
    onWatcherAdd,
    onWatcherRemove,
};

exposeInMainWorld("@shared/node-runtime", mod);
