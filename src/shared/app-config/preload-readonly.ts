import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { IAppConfigUpdate } from "@shared/app-config/config-utils";

async function syncConfig() {
    return await ipcRenderer.invoke("@shared/app-config/sync-app-config");
}

function onConfigUpdate(callback: (update: IAppConfigUpdate) => void) {
    const listener = (_event: Electron.IpcRendererEvent, update: IAppConfigUpdate) => {
        callback(update);
    };
    ipcRenderer.on("@shared/app-config/update-app-config", listener);
}

exposeInMainWorld("@shared/app-config", { syncConfig, onConfigUpdate });
