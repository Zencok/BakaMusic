import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { PluginInvocationResult } from "./rpc";
import { isPluginPlaybackLogEntry, type PluginPlaybackLogEntry } from "./playback-log";

let pluginUpdateCallback: ((plugins: IPlugin.IPluginDelegate[]) => void) | undefined;
let registryUpdateCallback: ((state: IPlugin.RegistryState) => void) | undefined;
const playbackLogCallbacks = new Set<(entry: PluginPlaybackLogEntry) => void>();
ipcRenderer.on("@/shared/plugin-manager/sync-plugins", (_event, plugins) => pluginUpdateCallback?.(plugins));
ipcRenderer.on("@shared/plugin-manager/state-updated", (_event, state) => registryUpdateCallback?.(state));
ipcRenderer.on("@shared/plugin-manager/playback-log-appended", (_event, entry: unknown) => {
    if (isPluginPlaybackLogEntry(entry)) for (const callback of playbackLogCallbacks) callback(entry);
});

async function invoke<T extends IPlugin.Capability>(
    delegate: { id?: string | number; platform?: string; hash?: string },
    capability: T,
    request: IPlugin.Requests[T],
): Promise<PluginInvocationResult<IPlugin.Results[T]>> {
    const response = await ipcRenderer.invoke("@shared/plugin-manager/invoke", {
        providerId: delegate.platform ?? delegate.hash ?? delegate.id, capability, request,
    });
    return response;
}
async function reloadPlugins() {
    const [plugins, state] = await Promise.all([
        ipcRenderer.invoke("@shared/plugin-manager/load-all-plugins"),
        ipcRenderer.invoke("@shared/plugin-manager/load-plugin-state"),
    ]);
    pluginUpdateCallback?.(plugins);
    registryUpdateCallback?.(state);
}
exposeInMainWorld("@shared/plugin-manager", {
    onPluginUpdated: (callback: typeof pluginUpdateCallback) => {
        pluginUpdateCallback = callback;
    },
    onRegistryUpdated: (callback: typeof registryUpdateCallback) => {
        registryUpdateCallback = callback;
    },
    onPlaybackLogAppended: (callback: (entry: PluginPlaybackLogEntry) => void) => {
        playbackLogCallbacks.add(callback);
        return () => playbackLogCallbacks.delete(callback);
    },
    invoke,
    reloadPlugins,
    uninstallPlugin: (id: string) => ipcRenderer.invoke("@shared/plugin-manager/uninstall-plugin", id),
    uninstallAllPlugins: () => ipcRenderer.invoke("@shared/plugin-manager/uninstall-all-plugins"),
    updateAllPlugins: () => ipcRenderer.invoke("@shared/plugin-manager/update-all-plugins"),
    installPluginFromRemote: (url: string, options?: IPlugin.ImportOptions) => ipcRenderer.invoke("@shared/plugin-manager/install-plugin-remote", url, options),
    installPluginFromLocal: (filePath: string, options?: IPlugin.ImportOptions) => ipcRenderer.invoke("@shared/plugin-manager/install-plugin-local", filePath, options),
    setResolverBinding: (providerId: string, resolverId: string | null) => ipcRenderer.invoke("@shared/plugin-manager/set-resolver-binding", providerId, resolverId),
    loadPlaybackLogs: () => ipcRenderer.invoke("@shared/plugin-manager/load-playback-logs"),
    clearPlaybackLogs: () => ipcRenderer.invoke("@shared/plugin-manager/clear-playback-logs"),
});
