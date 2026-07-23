import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type {
    INativeAudioOutputDevice,
    INativePlaybackCapabilities,
    INativePlaybackSnapshot,
    NativePlaybackCommand,
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

export const mod = {
    getCapabilities,
    listAudioDevices,
    command,
    onSnapshot,
};

exposeInMainWorld("@shared/native-playback", mod);
