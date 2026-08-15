import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { LxPluginDescriptor } from "./lx-types";
import {
    isPluginPlaybackLogEntry,
    type PluginPlaybackLogEntry,
} from "./playback-log";

ipcRenderer.on("@/shared/plugin-manager/sync-plugins", (_evt, newPlugins) => {
    pluginUpdateCallback?.(newPlugins);
});

ipcRenderer.on("@/shared/plugin-manager/sync-lx-plugins", (_evt, newPlugins) => {
    lxPluginUpdateCallback?.(newPlugins);
});

const playbackLogCallbacks = new Set<
    (entry: PluginPlaybackLogEntry) => void
>();

ipcRenderer.on(
    "@shared/plugin-manager/playback-log-appended",
    (_event, entry: unknown) => {
        if (!isPluginPlaybackLogEntry(entry)) {
            return;
        }
        for (const callback of playbackLogCallbacks) {
            callback(entry);
        }
    },
);

let pluginUpdateCallback: (plugins: IPlugin.IPluginDelegate[]) => void;
let lxPluginUpdateCallback: (plugins: LxPluginDescriptor[]) => void;

function onPluginUpdated(callback: (plugins: IPlugin.IPluginDelegate[]) => void) {
    pluginUpdateCallback = callback;
}

function onLxPluginUpdated(callback: (plugins: LxPluginDescriptor[]) => void) {
    lxPluginUpdateCallback = callback;
}

function onPlaybackLogAppended(
    callback: (entry: PluginPlaybackLogEntry) => void,
) {
    playbackLogCallbacks.add(callback);
    return () => playbackLogCallbacks.delete(callback);
}


interface IPluginDelegateLike {
    platform?: string;
    hash?: string;
}

async function callPluginMethod<
    T extends keyof IPlugin.IPluginInstanceMethods,
>(
    pluginDelegate: IPluginDelegateLike,
    method: T,
    ...args: Parameters<IPlugin.IPluginInstanceMethods[T]>
) {
    return (await ipcRenderer.invoke("@shared/plugin-manager/call-plugin-method", {
        hash: pluginDelegate.hash,
        platform: pluginDelegate.platform,
        method,
        args,
    })) as ReturnType<IPlugin.IPluginInstanceMethods[T]>;
}

async function reloadPlugins() {
    const result = await ipcRenderer.invoke("@shared/plugin-manager/load-all-plugins");
    pluginUpdateCallback?.(result);
}

async function uninstallPlugin(hash: string) {
    await ipcRenderer.invoke("@shared/plugin-manager/uninstall-plugin", hash);
}

async function uninstallAllPlugins() {
    await ipcRenderer.invoke("@shared/plugin-manager/uninstall-all-plugins");
}

async function updateAllPlugins() {
    await ipcRenderer.invoke("@shared/plugin-manager/update-all-plugins");
}

async function reloadLxPlugins() {
    const result = await ipcRenderer.invoke("@shared/plugin-manager/load-lx-plugins");
    lxPluginUpdateCallback?.(result);
}

async function installPluginFromRemote(url: string) {
    return await ipcRenderer.invoke("@shared/plugin-manager/install-plugin-remote", url);
}

async function installPluginFromLocal(url: string) {
    return await ipcRenderer.invoke("@shared/plugin-manager/install-plugin-local", url);
}

async function installLxPluginFromLocal(filePath: string) {
    return await ipcRenderer.invoke("@shared/plugin-manager/install-lx-plugin-local", filePath);
}

async function installLxPluginFromRemote(url: string) {
    return await ipcRenderer.invoke("@shared/plugin-manager/install-lx-plugin-remote", url);
}

async function setActiveLxPlugin(hash: string | null) {
    return await ipcRenderer.invoke("@shared/plugin-manager/set-active-lx-plugin", hash);
}

async function uninstallLxPlugin(hash: string) {
    return await ipcRenderer.invoke("@shared/plugin-manager/uninstall-lx-plugin", hash);
}

async function loadPlaybackLogs() {
    return await ipcRenderer.invoke(
        "@shared/plugin-manager/load-playback-logs",
    ) as PluginPlaybackLogEntry[];
}

async function clearPlaybackLogs() {
    await ipcRenderer.invoke("@shared/plugin-manager/clear-playback-logs");
}

const mod = {
    onPluginUpdated,
    onLxPluginUpdated,
    onPlaybackLogAppended,
    callPluginMethod,
    reloadPlugins,
    reloadLxPlugins,
    uninstallPlugin,
    uninstallAllPlugins,
    updateAllPlugins,
    installPluginFromLocal,
    installPluginFromRemote,
    installLxPluginFromLocal,
    installLxPluginFromRemote,
    setActiveLxPlugin,
    uninstallLxPlugin,
    loadPlaybackLogs,
    clearPlaybackLogs,
};

exposeInMainWorld("@shared/plugin-manager", mod);
