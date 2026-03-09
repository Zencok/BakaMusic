import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";


function registerGlobalShortCut(key: string, shortCut: string[]) {
    ipcRenderer.send("@shared/short-cut/register-global-short-cut", key, shortCut);
}

function unregisterGlobalShortCut(key: string) {
    ipcRenderer.send("@shared/short-cut/unregister-global-short-cut", key);
}

const mod = {
    registerGlobalShortCut,
    unregisterGlobalShortCut,
};

exposeInMainWorld("@shared/short-cut", mod);
