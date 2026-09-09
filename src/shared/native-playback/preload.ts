import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { INativeVideoFrame } from "./video-frame";
import type {
    INativeAudioOutputDevice,
    INativePlaybackCapabilities,
    INativePlaybackSnapshot,
    INativeVideoEvent,
    INativeVideoOpenRequest,
    INativeVideoSourceSelect,
    INativeVideoSourcesUpdate,
    INativeVideoSurfaceUpdate,
    NativePlaybackCommand,
    NativeVideoCommand,
} from "./common";

async function getCapabilities() {
    return ipcRenderer.invoke(
        "@shared/native-playback/capabilities",
    ) as Promise<INativePlaybackCapabilities>;
}

async function listAudioDevices() {
    return ipcRenderer.invoke(
        "@shared/native-playback/list-audio-devices",
    ) as Promise<INativeAudioOutputDevice[]>;
}

async function command(value: NativePlaybackCommand) {
    await ipcRenderer.invoke("@shared/native-playback/command", value);
}

function onSnapshot(callback: (snapshot: INativePlaybackSnapshot) => void) {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: INativePlaybackSnapshot) => {
        callback(snapshot);
    };
    ipcRenderer.on("@shared/native-playback/snapshot", listener);
    return () => ipcRenderer.removeListener("@shared/native-playback/snapshot", listener);
}

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

function onVideoFrame(callback: (frame: INativeVideoFrame) => void) {
    const listener = (_event: Electron.IpcRendererEvent, frame: INativeVideoFrame) => callback(frame);
    ipcRenderer.on("@shared/native-playback/video-frame", listener);
    return () => ipcRenderer.removeListener("@shared/native-playback/video-frame", listener);
}

function acknowledgeVideoFrame(sourceId: string, frameId: number) {
    void ipcRenderer.invoke("@shared/native-playback/video-frame-ack", sourceId, frameId)
        .catch(() => undefined);
}

export const mod = {
    getCapabilities,
    listAudioDevices,
    command,
    onSnapshot,
    prepareVideoOverlay,
    openVideo,
    updateVideoSources,
    selectVideoSource,
    videoCommand,
    updateVideoSurface,
    closeVideo,
    onVideoEvent,
    onVideoFrame,
    acknowledgeVideoFrame,
};

exposeInMainWorld("@shared/native-playback", mod);
