import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { IMvOverlaySession } from "./common";

function getSession() {
    return ipcRenderer.invoke(
        "@shared/mv-overlay/get-session",
    ) as Promise<IMvOverlaySession>;
}

async function suspendAudio() {
    await ipcRenderer.invoke("@shared/mv-overlay/audio", "suspend");
}

async function restoreAudio() {
    await ipcRenderer.invoke("@shared/mv-overlay/audio", "restore");
}

function close() {
    ipcRenderer.send("@shared/mv-overlay/close");
}

export const mod = { getSession, suspendAudio, restoreAudio, close };

exposeInMainWorld("@shared/mv-overlay", mod);
