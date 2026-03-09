import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";

function dragWindow(position: ICommon.IPoint) {
    ipcRenderer.send("set-window-draggable", position);
}

const mod = {
    dragWindow,
};

exposeInMainWorld("@shared/window-drag", mod);

