import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { DlnaBridge } from "./common";

const bridge: DlnaBridge = {
    discover: () => ipcRenderer.invoke("@shared/dlna/discover"),
    command: (command) => ipcRenderer.invoke("@shared/dlna/command", command),
};

exposeInMainWorld("@shared/dlna", bridge);
