import { app, ipcMain } from "electron";
import { _IpcRendererEvt } from "./ipc-channel";
import path from "path";
import { isIpcSenderAllowed } from "@shared/ipc-security/main";

export function setupGlobalContext() {
    ipcMain.on(_IpcRendererEvt.GET_GLOBAL_DATA, (evt) => {
        if (!isIpcSenderAllowed(evt, ["main"])) {
            evt.returnValue = null;
            return;
        }
        evt.returnValue = {
            appVersion: app.getVersion(),
            appPath: {
                downloads: app.getPath("downloads"),
                temp: app.getPath("temp"),
                userData: app.getPath("userData"),
                res: app.isPackaged
                    ? path.resolve(process.resourcesPath, "res")
                    : path.resolve(__dirname, "../../res"),
            },
            platform: process.platform,
        };
    });
}
