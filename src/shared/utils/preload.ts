import { ipcRenderer, webUtils } from "electron";
import { fileURLToPath } from "url";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import {
    createLocalMediaUrl,
    LOCAL_MEDIA_PROTOCOL,
} from "@shared/local-media/common";


/****** fs utils ******/
async function writeFile(filePath: string, data: string, encoding: "utf8" | "utf-8" = "utf8") {
    await ipcRenderer.invoke("@shared/utils/fs-write-file", filePath, data, encoding);
}

async function readFile(filePath: string, encoding: "utf8" | "utf-8" = "utf8") {
    return await ipcRenderer.invoke("@shared/utils/fs-read-file", filePath, encoding) as string;
}

async function isFile(path: string) {
    return await ipcRenderer.invoke("@shared/utils/fs-is-file", path) as boolean;
}

async function isFolder(path: string) {
    return await ipcRenderer.invoke("@shared/utils/fs-is-folder", path) as boolean;
}

async function removeFile(path: string) {
    await ipcRenderer.invoke("@shared/utils/fs-remove-file", path);
    return true;
}

async function trashFile(path: string) {
    return await ipcRenderer.invoke(
        "@shared/utils/fs-trash-file",
        path,
    ) as boolean;
}

function getPathForFile(file: File) {
    const filePath = webUtils.getPathForFile(file);
    if (filePath) {
        ipcRenderer.send("@shared/utils/grant-dropped-path", filePath);
    }
    return filePath;
}

function addFileScheme(filePath: string) {
    if (filePath.startsWith(`${LOCAL_MEDIA_PROTOCOL}:`)) {
        return filePath;
    }
    const localPath = filePath.startsWith("file:")
        ? fileURLToPath(filePath)
        : filePath;
    return createLocalMediaUrl(localPath);
}

const fsUtil = {
    writeFile,
    readFile,
    isFile,
    isFolder,
    rimraf: removeFile,
    trashFile,
    addFileScheme,
    getPathForFile,
};

/****** app utils *****/
function exitApp() {
    ipcRenderer.send("@shared/utils/exit-app");
}

async function getPath(pathName: "home" | "appData" | "userData" | "sessionData" | "temp" | "exe" | "module" | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos" | "recent" | "logs" | "crashDumps") {
    return await ipcRenderer.invoke("@shared/utils/app-get-path", pathName);
}

async function checkUpdate() {
    return await ipcRenderer.invoke("@shared/utils/check-update");
}

async function downloadUpdate(): Promise<void> {
    await ipcRenderer.invoke("@shared/utils/download-update");
}

function onUpdateDownloadProgress(
    callback: (progress: { downloaded: number; total: number }) => void,
): () => void {
    const handler = (_: Electron.IpcRendererEvent, progress: { downloaded: number; total: number }) =>
        callback(progress);
    ipcRenderer.on("@shared/utils/update-download-progress", handler);
    return () => ipcRenderer.off("@shared/utils/update-download-progress", handler);
}

async function installUpdate(): Promise<void> {
    await ipcRenderer.invoke("@shared/utils/install-update");
}

function cancelUpdateDownload(): void {
    ipcRenderer.send("@shared/utils/cancel-update-download");
}

async function getCacheSize() {
    return await ipcRenderer.invoke("@shared/utils/get-cache-size");
}

async function clearCache() {
    ipcRenderer.send("@shared/utils/clear-cache");
}

const app = {
    exitApp,
    getPath,
    checkUpdate,
    downloadUpdate,
    onUpdateDownloadProgress,
    installUpdate,
    cancelUpdateDownload,
    getCacheSize,
    clearCache,
};


/****** window utils *****/
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

/****** shell utils *****/
function openExternal(url: string) {
    ipcRenderer.send("@shared/utils/open-url", url);
}

function openPath(path: string) {
    ipcRenderer.send("@shared/utils/open-path", path);
}

async function showItemInFolder(path: string): Promise<boolean> {
    return await ipcRenderer.invoke("@shared/utils/show-item-in-folder", path);
}

const shell = {
    openExternal,
    openPath,
    showItemInFolder,
};

/****** dialog utils *****/
function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
    return ipcRenderer.invoke("@shared/utils/show-open-dialog", options);
}

function showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
    return ipcRenderer.invoke("@shared/utils/show-save-dialog", options);
}

const dialog = {
    showOpenDialog,
    showSaveDialog,
};


const mod = {
    fs: fsUtil,
    app,
    appWindow,
    shell,
    dialog,
};

exposeInMainWorld("@shared/utils", mod);
