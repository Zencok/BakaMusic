export const BACKUP_TO_WEBDAV_CHANNEL = "@shared/backup/webdav-write";
export const RESTORE_FROM_WEBDAV_CHANNEL = "@shared/backup/webdav-read";
export const MAX_BACKUP_TRANSFER_BYTES = 128 * 1024 * 1024;

export interface IWebdavConnection {
    url: string;
    username: string;
    password: string;
}
