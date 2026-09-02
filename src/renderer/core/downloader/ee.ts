import EventEmitter from "eventemitter3";

export const ee = new EventEmitter();

export enum DownloadEvts {
    DownloadStatusUpdated = "DownloadStatusUpdated",
    Downloaded = "Downloaded",
    RemoveDownload = "RemoveDownload",
}

export function getDownloadStatusEvent(taskId: string) {
    return `${DownloadEvts.DownloadStatusUpdated}:${taskId}`;
}
