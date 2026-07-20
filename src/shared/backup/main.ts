import { ipcMain } from "electron";
import axios from "axios";
import {
    BACKUP_TO_WEBDAV_CHANNEL,
    MAX_BACKUP_TRANSFER_BYTES,
    RESTORE_FROM_WEBDAV_CHANNEL,
    type IWebdavConnection,
} from "./common";
import {
    assertIpcPayload,
    assertIpcSender,
    assertPlainObject,
    assertString,
    assertUrl,
} from "@shared/ipc-security/main";

const WEBDAV_BACKUP_DIR = "/BakaMusic";
const WEBDAV_BACKUP_FILE = `${WEBDAV_BACKUP_DIR}/BakaMusicBackup.json`;
const LEGACY_WEBDAV_BACKUP_FILE = "/MusicFree/MusicFreeBackup.json";
const WEBDAV_REQUEST_TIMEOUT_MS = 60_000;

function validateConnection(value: unknown): IWebdavConnection {
    assertIpcPayload(value, 32 * 1024);
    assertPlainObject(value, "WebDAV connection");
    const url = assertUrl(value.url, ["https:", "http:"], 8_192).toString();
    assertString(value.username, "WebDAV username", 1_024);
    assertString(value.password, "WebDAV password", 8_192);
    return {
        url,
        username: value.username,
        password: value.password,
    };
}

function validateBackupData(value: unknown) {
    assertString(value, "backup data", MAX_BACKUP_TRANSFER_BYTES, true);
    if (Buffer.byteLength(value, "utf8") > MAX_BACKUP_TRANSFER_BYTES) {
        throw new Error("Backup exceeds the size limit");
    }
    return value;
}

function decodeBackupData(value: unknown) {
    let data: string;
    if (typeof value === "string") {
        data = value;
    } else if (Buffer.isBuffer(value)) {
        data = value.toString("utf8");
    } else if (value instanceof ArrayBuffer) {
        data = Buffer.from(value).toString("utf8");
    } else {
        throw new Error("WebDAV backup response is not valid text");
    }
    return validateBackupData(data);
}

async function withWebdavTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBDAV_REQUEST_TIMEOUT_MS);
    try {
        return await operation(controller.signal);
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error("WebDAV request timed out");
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function createWebdavClient(connection: IWebdavConnection) {
    const { AuthType, createClient } = await import("webdav");
    return createClient(connection.url, {
        authType: AuthType.Password,
        username: connection.username,
        password: connection.password,
        maxBodyLength: MAX_BACKUP_TRANSFER_BYTES,
        maxContentLength: MAX_BACKUP_TRANSFER_BYTES,
        httpAgent: axios.defaults.httpAgent,
        httpsAgent: axios.defaults.httpsAgent,
    });
}

export function setupBackupMain() {
    ipcMain.handle(
        BACKUP_TO_WEBDAV_CHANNEL,
        async (event, connectionValue, dataValue) => {
            assertIpcSender(event, ["main"]);
            const connection = validateConnection(connectionValue);
            const data = validateBackupData(dataValue);
            const client = await createWebdavClient(connection);

            await withWebdavTimeout(async (signal) => {
                if (!(await client.exists(WEBDAV_BACKUP_DIR, { signal }))) {
                    await client.createDirectory(WEBDAV_BACKUP_DIR, {
                        signal,
                    });
                }
                await client.putFileContents(WEBDAV_BACKUP_FILE, data, {
                    overwrite: true,
                    signal,
                });
            });
        },
    );

    ipcMain.handle(
        RESTORE_FROM_WEBDAV_CHANNEL,
        async (event, connectionValue) => {
            assertIpcSender(event, ["main"]);
            const connection = validateConnection(connectionValue);
            const client = await createWebdavClient(connection);

            return await withWebdavTimeout(async (signal) => {
                const restoreSource = await client.exists(
                    WEBDAV_BACKUP_FILE,
                    { signal },
                )
                    ? WEBDAV_BACKUP_FILE
                    : (await client.exists(LEGACY_WEBDAV_BACKUP_FILE, { signal })
                        ? LEGACY_WEBDAV_BACKUP_FILE
                        : null);
                if (!restoreSource) {
                    return null;
                }
                const data = await client.getFileContents(restoreSource, {
                    format: "text",
                    signal,
                });
                return decodeBackupData(data);
            });
        },
    );
}
