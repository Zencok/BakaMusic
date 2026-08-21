import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type {
    IMvOverlayAudioCommand,
    IMvOverlayAudioResponse,
    IMvOverlaySession,
    MvOverlayAudioOperation,
} from "./common";

function open(session: IMvOverlaySession) {
    return ipcRenderer.invoke("@shared/mv-overlay/open", session) as Promise<boolean>;
}

function onAudioRequest(
    callback: (operation: MvOverlayAudioOperation) => void | Promise<void>,
) {
    const listener = (_event: Electron.IpcRendererEvent, command: IMvOverlayAudioCommand) => {
        void Promise.resolve(callback(command.operation)).then(() => {
            const response: IMvOverlayAudioResponse = {
                requestId: command.requestId,
                success: true,
            };
            ipcRenderer.send("@shared/mv-overlay/audio-response", response);
        }).catch((error: unknown) => {
            const response: IMvOverlayAudioResponse = {
                requestId: command.requestId,
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
            ipcRenderer.send("@shared/mv-overlay/audio-response", response);
        });
    };
    ipcRenderer.on("@shared/mv-overlay/audio-command", listener);
    return () => ipcRenderer.removeListener("@shared/mv-overlay/audio-command", listener);
}

export const mod = { open, onAudioRequest };

exposeInMainWorld("@shared/mv-overlay", mod);
