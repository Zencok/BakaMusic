import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import { DownloadState } from "@/common/constant";

type DownloadStateCallback = (state: {
    state: DownloadState;
    downloaded?: number;
    total?: number;
    msg?: string;
    filePath?: string;
}) => void;

const downloadCallbacks = new Map<string, DownloadStateCallback>();

ipcRenderer.on("@shared/node-runtime/download-state", (_event, payload) => {
    if (payload && typeof payload.taskId === "string") {
        downloadCallbacks.get(payload.taskId)?.(payload.state);
    }
});

async function downloadFile(
    taskId: string,
    mediaSource: IMusic.IMusicSource,
    filePath: string,
    onStateChange: DownloadStateCallback,
) {
    let lastState: Parameters<DownloadStateCallback>[0] | undefined;
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
        ) as Parameters<DownloadStateCallback>[0] | null | undefined;
        if (
            result
            && (result.state === DownloadState.DONE || result.state === DownloadState.ERROR)
            && lastState?.state !== result.state
        ) {
            onStateChange(result);
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

async function probeMediaSize(mediaSource: IMusic.IMusicSource) {
    return await ipcRenderer.invoke(
        "@shared/node-runtime/probe-media-size",
        mediaSource,
    ) as number | null;
}

const mod = { downloadFile, abortDownload, probeMediaSize };

exposeInMainWorld("@shared/node-runtime", mod);
