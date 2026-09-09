import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { INativeVideoFrame } from "./video-frame";
import type {
    INativeVideoEvent,
    INativeVideoOpenRequest,
    INativeVideoSourceSelect,
    INativeVideoSourcesUpdate,
    INativeVideoSurfaceUpdate,
    NativeVideoCommand,
} from "./common";

async function openVideo(value: INativeVideoOpenRequest) {
    await ipcRenderer.invoke("@shared/native-playback/open-video", value);
}

async function prepareVideoOverlay(sourceId: string) {
    await ipcRenderer.invoke("@shared/native-playback/prepare-video-overlay", sourceId);
}

async function updateVideoSources(value: INativeVideoSourcesUpdate) {
    await ipcRenderer.invoke("@shared/native-playback/update-video-sources", value);
}

async function selectVideoSource(value: INativeVideoSourceSelect) {
    await ipcRenderer.invoke("@shared/native-playback/select-video-source", value);
}

async function videoCommand(value: NativeVideoCommand) {
    await ipcRenderer.invoke("@shared/native-playback/video-command", value);
}

async function updateVideoSurface(value: INativeVideoSurfaceUpdate) {
    await ipcRenderer.invoke("@shared/native-playback/update-video-surface", value);
}

async function closeVideo(sourceId: string) {
    await ipcRenderer.invoke("@shared/native-playback/close-video", sourceId);
}

function onVideoEvent(callback: (event: INativeVideoEvent) => void) {
    const listener = (_event: Electron.IpcRendererEvent, value: INativeVideoEvent) => {
        callback(value);
    };
    ipcRenderer.on("@shared/native-playback/video-event", listener);
    return () => ipcRenderer.removeListener("@shared/native-playback/video-event", listener);
}

export const mod = {
    onVideoFrame(callback: (frame: INativeVideoFrame) => void) {
        const listener = (_event: Electron.IpcRendererEvent, frame: INativeVideoFrame) => callback(frame);
        ipcRenderer.on("@shared/native-playback/video-frame", listener);
        return () => ipcRenderer.removeListener("@shared/native-playback/video-frame", listener);
    },
    acknowledgeVideoFrame(sourceId: string, frameId: number) {
        void ipcRenderer.invoke("@shared/native-playback/video-frame-ack", sourceId, frameId)
            .catch(() => undefined);
    },
    prepareVideoOverlay,
    openVideo,
    updateVideoSources,
    selectVideoSource,
    videoCommand,
    updateVideoSurface,
    closeVideo,
    onVideoEvent,
};

exposeInMainWorld("@shared/native-playback", mod);
