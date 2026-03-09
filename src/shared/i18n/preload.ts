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

const mod = {
    setupLang,
    changeLang,
};

exposeInMainWorld("@shared/i18n", mod);

