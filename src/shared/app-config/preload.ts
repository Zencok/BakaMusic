import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { IAppConfig } from "@/types/app-config";
import type { IAppConfigUpdate } from "@shared/app-config/config-utils";


async function syncConfig() {
    return await ipcRenderer.invoke("@shared/app-config/sync-app-config");
}

function setConfig(config: IAppConfig) {
    return ipcRenderer.send("@shared/app-config/set-app-config", config);
}

function reset() {
    return ipcRenderer.send("@shared/app-config/reset");
}

function onConfigUpdate(callback: (update: IAppConfigUpdate) => void) {
    ipcRenderer.on("@shared/app-config/update-app-config", (_event, update) => {
        callback(update);
    });
}


const mod = {
    syncConfig,
    setConfig,
    onConfigUpdate,
    reset,
};

exposeInMainWorld("@shared/app-config", mod);

