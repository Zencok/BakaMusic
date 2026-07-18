import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";

function minMainWindow(skipTaskBar: boolean) {
    ipcRenderer.send("@shared/utils/min-main-window", { skipTaskBar });
}

function showMainWindow() {
    ipcRenderer.send("@shared/utils/show-main-window");
}

function setLyricWindow(enabled: boolean) {
    ipcRenderer.send("@shared/utils/set-lyric-window", enabled);
}

function setMinimodeWindow(enabled: boolean) {
    ipcRenderer.send("@shared/utils/set-minimode-window", enabled);
}

async function getCurrentWindowBounds() {
    return await ipcRenderer.invoke("@shared/utils/get-current-window-bounds");
}

async function getAllWorkAreas() {
    return await ipcRenderer.invoke("@shared/utils/get-all-work-areas");
}

function ignoreMouseEvent(ignore: boolean) {
    ipcRenderer.send("@shared/utils/ignore-mouse-event", ignore);
}

function setCurrentWindowBounds(bounds: Electron.Rectangle) {
    ipcRenderer.send("@shared/utils/set-current-window-bounds", bounds);
}

function toggleMainWindowVisible() {
    ipcRenderer.send("@shared/utils/toggle-main-window-visible");
}

function toggleMainWindowMaximize() {
    ipcRenderer.send("@shared/utils/toggle-maximize-main-window");
}

function setMainWindowFullScreen(enabled: boolean) {
    ipcRenderer.send("@shared/utils/set-main-window-fullscreen", enabled);
}

async function toggleMainWindowFullScreen() {
    return (await ipcRenderer.invoke("@shared/utils/toggle-main-window-fullscreen")) as boolean;
}

async function isMainWindowFullScreen() {
    return (await ipcRenderer.invoke("@shared/utils/is-main-window-fullscreen")) as boolean;
}

function onMainWindowFullScreenChanged(
    callback: (isFullScreen: boolean) => void,
): () => void {
    const handler = (_: Electron.IpcRendererEvent, isFullScreen: boolean) => {
        callback(Boolean(isFullScreen));
    };
    ipcRenderer.on("@shared/utils/main-window-fullscreen-changed", handler);
    return () => {
        ipcRenderer.off("@shared/utils/main-window-fullscreen-changed", handler);
    };
}

function onMainWindowF11(callback: () => void): () => void {
    const handler = () => {
        callback();
    };
    ipcRenderer.on("@shared/utils/main-window-f11", handler);
    return () => {
        ipcRenderer.off("@shared/utils/main-window-f11", handler);
    };
}

const appWindow = {
    minMainWindow,
    showMainWindow,
    setLyricWindow,
    setMinimodeWindow,
    getCurrentWindowBounds,
    getAllWorkAreas,
    ignoreMouseEvent,
    setCurrentWindowBounds,
    toggleMainWindowVisible,
    toggleMainWindowMaximize,
    setMainWindowFullScreen,
    toggleMainWindowFullScreen,
    isMainWindowFullScreen,
    onMainWindowFullScreenChanged,
    onMainWindowF11,
};

exposeInMainWorld("@shared/utils", { appWindow });
