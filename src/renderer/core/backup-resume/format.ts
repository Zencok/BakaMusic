export const BACKUP_SCHEMA = "bakamusic.music-sheet-backup";
export const BACKUP_VERSION = 2;
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
export const MAX_BACKUP_SHEETS = 2_000;
export const MAX_BACKUP_TRACKS = 200_000;

interface IBackupEnvelope {
    schema: typeof BACKUP_SCHEMA;
    version: typeof BACKUP_VERSION;
    createdAt: number;
    data: {
        musicSheets: IMusic.IMusicSheetItem[];
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getUtf8Size(value: string) {
    return new TextEncoder().encode(value).byteLength;
}

function assertBoundedString(
    value: unknown,
    name: string,
    maxLength = 8_192,
    allowEmpty = false,
) {
    if (
        typeof value !== "string"
        || (!allowEmpty && !value.length)
        || value.length > maxLength
    ) {
        throw new Error(`Invalid ${name}`);
    }
}

function validateMusicSheetList(value: unknown) {
    if (!Array.isArray(value) || value.length > MAX_BACKUP_SHEETS) {
        throw new Error("Invalid backup music sheet list");
    }

    let totalTracks = 0;
    value.forEach((sheet, sheetIndex) => {
        if (!isRecord(sheet)) {
            throw new Error(`Invalid music sheet at index ${sheetIndex}`);
        }
        assertBoundedString(sheet.id, `musicSheets[${sheetIndex}].id`, 512);
        assertBoundedString(sheet.platform, `musicSheets[${sheetIndex}].platform`, 512);
        assertBoundedString(
            sheet.title,
            `musicSheets[${sheetIndex}].title`,
            8_192,
            true,
        );

        const musicList = sheet.musicList ?? [];
        if (!Array.isArray(musicList)) {
            throw new Error(`Invalid music list at sheet ${sheetIndex}`);
        }
        totalTracks += musicList.length;
        if (totalTracks > MAX_BACKUP_TRACKS) {
            throw new Error("Backup contains too many tracks");
        }

        musicList.forEach((musicItem, musicIndex) => {
            if (!isRecord(musicItem)) {
                throw new Error(
                    `Invalid music item at ${sheetIndex}:${musicIndex}`,
                );
            }
            assertBoundedString(
                musicItem.id,
                `musicSheets[${sheetIndex}].musicList[${musicIndex}].id`,
                512,
            );
            assertBoundedString(
                musicItem.platform,
                `musicSheets[${sheetIndex}].musicList[${musicIndex}].platform`,
                512,
            );
        });
    });

    return value as IMusic.IMusicSheetItem[];
}

export function createBackupFileName(createdAt = Date.now()) {
    const timestamp = new Date(createdAt)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z")
        .replaceAll(":", "-");
    return `BakaMusicBackup-${timestamp}.json`;
}

export function createBackupPayload(
    musicSheets: IMusic.IMusicSheetItem[],
    createdAt = Date.now(),
) {
    validateMusicSheetList(musicSheets);
    const envelope: IBackupEnvelope = {
        schema: BACKUP_SCHEMA,
        version: BACKUP_VERSION,
        createdAt,
        data: { musicSheets },
    };
    const serialized = JSON.stringify(envelope);
    if (getUtf8Size(serialized) > MAX_BACKUP_BYTES) {
        throw new Error("Backup exceeds the size limit");
    }
    return serialized;
}

export function parseBackupPayload(data: string | Record<string, unknown>) {
    const serialized = typeof data === "string" ? data : JSON.stringify(data);
    if (getUtf8Size(serialized) > MAX_BACKUP_BYTES) {
        throw new Error("Backup exceeds the size limit");
    }

    const parsed: unknown = typeof data === "string" ? JSON.parse(data) : data;
    if (!isRecord(parsed)) {
        throw new Error("Invalid backup payload");
    }

    // Version 1 backups stored `musicSheets` directly at the root.
    if (Array.isArray(parsed.musicSheets) && parsed.schema === undefined) {
        return validateMusicSheetList(parsed.musicSheets);
    }

    if (
        parsed.schema !== BACKUP_SCHEMA
        || parsed.version !== BACKUP_VERSION
        || !isRecord(parsed.data)
    ) {
        throw new Error("Unsupported backup schema or version");
    }

    return validateMusicSheetList(parsed.data.musicSheets);
}
