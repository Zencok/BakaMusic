import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { IChangeLangData, ISetupData } from "./type";

async function setupLang() {
    return await ipcRenderer.invoke("shared/i18n/setup") as ISetupData;
}

function onLanguageChanged(callback: (data: IChangeLangData) => void) {
    const listener = (_event: Electron.IpcRendererEvent, data: IChangeLangData) => {
        callback(data);
    };
    ipcRenderer.on("shared/i18n/languageChanged", listener);
    return () => ipcRenderer.removeListener("shared/i18n/languageChanged", listener);
}

exposeInMainWorld("@shared/i18n", { setupLang, onLanguageChanged });
