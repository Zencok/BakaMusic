import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { IChangeLangData, ISetupData } from "./type";

async function setupLang() {
    const data: ISetupData = await ipcRenderer.invoke("shared/i18n/setup");
    return data;
}

async function changeLang(lang: string) {
    const data: IChangeLangData = await ipcRenderer.invoke("shared/i18n/changeLang", lang);
    return data;
}

function onLanguageChanged(callback: (data: IChangeLangData) => void) {
    const listener = (_event: Electron.IpcRendererEvent, data: IChangeLangData) => {
        callback(data);
    };
    ipcRenderer.on("shared/i18n/languageChanged", listener);
    return () => {
        ipcRenderer.removeListener("shared/i18n/languageChanged", listener);
    };
}

const mod = {
    setupLang,
    changeLang,
    onLanguageChanged,
};

exposeInMainWorld("@shared/i18n", mod);

