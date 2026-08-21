import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";

function setMainWindowFullScreen(enabled: boolean) {
    ipcRenderer.send("@shared/utils/set-main-window-fullscreen", enabled);
}

async function isMainWindowFullScreen() {
    return await ipcRenderer.invoke(
        "@shared/utils/is-main-window-fullscreen",
    ) as boolean;
}

function onMainWindowFullScreenChanged(
    callback: (isFullScreen: boolean) => void,
) {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => {
        callback(Boolean(enabled));
    };
    ipcRenderer.on("@shared/utils/main-window-fullscreen-changed", listener);
    return () => ipcRenderer.removeListener(
        "@shared/utils/main-window-fullscreen-changed",
        listener,
    );
}

async function showItemInFolder(filePath: string) {
    return await ipcRenderer.invoke(
        "@shared/utils/show-item-in-folder",
        filePath,
    ) as boolean;
}

const mod = {
    appWindow: {
        setMainWindowFullScreen,
        isMainWindowFullScreen,
        onMainWindowFullScreenChanged,
    },
    shell: {
        showItemInFolder,
    },
};

exposeInMainWorld("@shared/utils", mod);
