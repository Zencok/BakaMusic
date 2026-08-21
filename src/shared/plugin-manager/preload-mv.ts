import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";

let pluginUpdateCallback: ((plugins: IPlugin.IPluginDelegate[]) => void) | undefined;

function onPluginUpdated(callback: (plugins: IPlugin.IPluginDelegate[]) => void) {
    pluginUpdateCallback = callback;
}

function onLxPluginUpdated(callback: (plugins: never[]) => void) {
    callback([]);
}

function onPlaybackLogAppended() {
    return () => undefined;
}

async function callPluginMethod<
    T extends keyof IPlugin.IPluginInstanceMethods,
>(
    pluginDelegate: { platform?: string; hash?: string },
    method: T,
    ...args: Parameters<IPlugin.IPluginInstanceMethods[T]>
) {
    return await ipcRenderer.invoke("@shared/plugin-manager/call-plugin-method", {
        hash: pluginDelegate.hash,
        platform: pluginDelegate.platform,
        method,
        args,
    }) as ReturnType<IPlugin.IPluginInstanceMethods[T]>;
}

async function reloadPlugins() {
    const plugins = await ipcRenderer.invoke(
        "@shared/plugin-manager/load-all-plugins",
    ) as IPlugin.IPluginDelegate[];
    pluginUpdateCallback?.(plugins);
}

async function reloadLxPlugins() {
    // MV source resolution uses the owning plugin directly; LX playback
    // adapters and their management surface remain main-renderer only.
}

const mod = {
    onPluginUpdated,
    onLxPluginUpdated,
    onPlaybackLogAppended,
    callPluginMethod,
    reloadPlugins,
    reloadLxPlugins,
};

exposeInMainWorld("@shared/plugin-manager", mod);
