import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";

async function initCurrentTheme(selection: string | null) {
    return await ipcRenderer.invoke("@shared/themepack/init-current", selection) as ICommon.IThemePack;
}

async function loadThemePacks() {
    return await ipcRenderer.invoke("@shared/themepack/load-all") as ICommon.IThemePack[];
}

async function readThemeContents(themeUrl: string) {
    return await ipcRenderer.invoke("@shared/themepack/read-contents", themeUrl) as {
        rawCss: string;
        iframeHtml: string | null;
    };
}

async function installThemePack(themePackPath: string) {
    return await ipcRenderer.invoke(
        "@shared/themepack/install-local",
        themePackPath,
    ) as ICommon.IThemePack;
}

async function uninstallThemePack(themePack: ICommon.IThemePack) {
    await ipcRenderer.invoke("@shared/themepack/uninstall", themePack);
}

async function installRemoteThemePack(remoteUrl: string) {
    return await ipcRenderer.invoke(
        "@shared/themepack/install-remote",
        remoteUrl,
    ) as ICommon.IThemePack;
}

async function setWindowMaterial(
    enabled: boolean,
    scheme?: "light" | "dark",
) {
    return await ipcRenderer.invoke(
        "@shared/themepack/set-window-material",
        enabled,
        scheme ?? null,
    ) as boolean;
}

export const mod = {
    initCurrentTheme,
    loadThemePacks,
    readThemeContents,
    installThemePack,
    uninstallThemePack,
    installRemoteThemePack,
    setWindowMaterial,
};

exposeInMainWorld("@shared/themepack", mod);
