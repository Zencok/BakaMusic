import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { IDownloadPostprocessPayload } from "@/common/download-postprocess";
import { DownloadState } from "@/common/constant";

type DownloadStateCallback = (state: {
    state: DownloadState;
    downloaded?: number;
    total?: number;
    msg?: string;
    filePath?: string;
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
    let lastState: {
        state: DownloadState;
        downloaded?: number;
        total?: number;
        msg?: string;
        filePath?: string;
    } | undefined;
    const wrapped: DownloadStateCallback = (state) => {
        lastState = state;
        onStateChange(state);
    };
    downloadCallbacks.set(taskId, wrapped);
    try {
        const result = await ipcRenderer.invoke(
            "@shared/node-runtime/download-file",
            taskId,
            mediaSource,
            filePath,
        ) as {
            state?: DownloadState;
            msg?: string;
            filePath?: string;
        } | null | undefined;

        // Progress events and invoke completion race. If DONE/ERROR never
        // reached the callback before it was cleared, re-deliver from the
        // RPC result so postprocess / UI state can finish.
        if (
            result
            && (result.state === DownloadState.DONE || result.state === DownloadState.ERROR)
            && lastState?.state !== result.state
        ) {
            onStateChange({
                state: result.state,
                msg: typeof result.msg === "string" ? result.msg : undefined,
                filePath: typeof result.filePath === "string" ? result.filePath : undefined,
            });
        } else if (
            result
            && result.state === DownloadState.DONE
            && typeof result.filePath === "string"
            && lastState?.state === DownloadState.DONE
            && lastState.filePath !== result.filePath
        ) {
            // DONE event arrived without the corrected path — patch it.
            onStateChange({
                state: DownloadState.DONE,
                filePath: result.filePath,
            });
        }
    } finally {
        if (downloadCallbacks.get(taskId) === wrapped) {
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

/** Main-process Chromium net.fetch for cover bytes (not utility undici). */
async function fetchCoverImage(coverUrl: string) {
    return await ipcRenderer.invoke(
        "@shared/node-runtime/fetch-cover-image",
        coverUrl,
    ) as { dataBase64: string; mimeType: string };
}

async function overwriteEmbeddedLyric(filePath: string, lyricContent: string) {
    await ipcRenderer.invoke(
        "@shared/node-runtime/overwrite-embedded-lyric",
        filePath,
        lyricContent,
    );
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

async function warmUp() {
    await ipcRenderer.invoke("@shared/node-runtime/warm-up");
}

export const mod = {
    downloadFile,
    abortDownload,
    postprocessDownloadedFile,
    fetchCoverImage,
    overwriteEmbeddedLyric,
    warmUp,
    setupWatcher,
    closeWatcher,
    changeWatchPath,
    scanDirectories,
    onWatcherAdd,
    onWatcherRemove,
};

exposeInMainWorld("@shared/node-runtime", mod);
