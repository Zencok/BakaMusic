import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { PluginInvocationResult } from "./rpc";

let pluginUpdateCallback: ((plugins: IPlugin.IPluginDelegate[]) => void) | undefined;
async function invoke(
    delegate: { id?: string | number; platform?: string; hash?: string },
    capability: "media.video",
    request: IPlugin.Requests["media.video"],
): Promise<PluginInvocationResult<IPlugin.Results["media.video"]>> {
    if (capability !== "media.video") throw new Error("MV overlay may only resolve video sources");
    const response = await ipcRenderer.invoke("@shared/plugin-manager/invoke", {
        providerId: delegate.platform ?? delegate.hash ?? delegate.id, capability, request,
    });
    return response;
}
exposeInMainWorld("@shared/plugin-manager", {
    onPluginUpdated: (callback: typeof pluginUpdateCallback) => {
        pluginUpdateCallback = callback;
    },
    onRegistryUpdated: () => undefined,
    onPlaybackLogAppended: () => () => undefined,
    invoke,
    reloadPlugins: async () => {
        pluginUpdateCallback?.(await ipcRenderer.invoke("@shared/plugin-manager/load-all-plugins"));
    },
});
