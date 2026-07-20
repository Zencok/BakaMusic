import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import {
    BACKUP_TO_WEBDAV_CHANNEL,
    RESTORE_FROM_WEBDAV_CHANNEL,
    type IWebdavConnection,
} from "./common";

async function backupToWebdav(connection: IWebdavConnection, data: string) {
    await ipcRenderer.invoke(BACKUP_TO_WEBDAV_CHANNEL, connection, data);
}

async function restoreFromWebdav(connection: IWebdavConnection) {
    return await ipcRenderer.invoke(
        RESTORE_FROM_WEBDAV_CHANNEL,
        connection,
    ) as string | null;
}

export const mod = {
    backupToWebdav,
    restoreFromWebdav,
};

exposeInMainWorld("@shared/backup", mod);
