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

/** Coerce null/undefined titles from legacy DBs; still reject non-strings. */
function normalizeOptionalTitle(value: unknown, name: string) {
    if (value == null) {
        return "";
    }
    assertBoundedString(value, name, 8_192, true);
    return value as string;
}

/**
 * Plugin payloads often store numeric ids. Coerce finite numbers / bigints to
 * strings; reject empty or oversized values.
 */
function coerceIdentityString(value: unknown, maxLength = 512): string | null {
    let text: string | null = null;
    if (typeof value === "string") {
        text = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
        text = String(value);
    } else if (typeof value === "bigint") {
        text = String(value);
    } else {
        return null;
    }
    if (!text.length || text.length > maxLength) {
        return null;
    }
    return text;
}

function requireIdentityString(
    value: unknown,
    name: string,
    maxLength = 512,
): string {
    const text = coerceIdentityString(value, maxLength);
    if (text === null) {
        throw new Error(`Invalid ${name}`);
    }
    return text;
}

function normalizeMusicItem(
    musicItem: unknown,
): IMusic.IMusicItem | null {
    if (!isRecord(musicItem)) {
        return null;
    }
    const id = coerceIdentityString(musicItem.id);
    const platform = coerceIdentityString(musicItem.platform);
    if (id === null || platform === null) {
        // Drop unusable tracks instead of failing the whole backup/restore.
        return null;
    }
    if (id === musicItem.id && platform === musicItem.platform) {
        return musicItem as IMusic.IMusicItem;
    }
    return {
        ...musicItem,
        id,
        platform,
    } as IMusic.IMusicItem;
}

function validateMusicSheetList(value: unknown) {
    if (!Array.isArray(value) || value.length > MAX_BACKUP_SHEETS) {
        throw new Error("Invalid backup music sheet list");
    }

    let totalTracks = 0;
    const normalizedSheets = value.map((sheet, sheetIndex) => {
        if (!isRecord(sheet)) {
            throw new Error(`Invalid music sheet at index ${sheetIndex}`);
        }
        const id = requireIdentityString(
            sheet.id,
            `musicSheets[${sheetIndex}].id`,
        );
        const platform = requireIdentityString(
            sheet.platform,
            `musicSheets[${sheetIndex}].platform`,
        );
        const title = normalizeOptionalTitle(
            sheet.title,
            `musicSheets[${sheetIndex}].title`,
        );

        const rawMusicList = sheet.musicList ?? [];
        if (!Array.isArray(rawMusicList)) {
            throw new Error(`Invalid music list at sheet ${sheetIndex}`);
        }
        const musicList = rawMusicList
            .map((musicItem) => normalizeMusicItem(musicItem))
            .filter((musicItem): musicItem is IMusic.IMusicItem => Boolean(musicItem));
        totalTracks += musicList.length;
        if (totalTracks > MAX_BACKUP_TRACKS) {
            throw new Error("Backup contains too many tracks");
        }

        const sheetUnchanged =
            id === sheet.id
            && platform === sheet.platform
            && title === sheet.title
            && musicList.length === rawMusicList.length
            && musicList.every((item, index) => item === rawMusicList[index]);
        if (sheetUnchanged) {
            return sheet as IMusic.IMusicSheetItem;
        }
        return {
            ...sheet,
            id,
            platform,
            title,
            musicList,
        } as IMusic.IMusicSheetItem;
    });

    return normalizedSheets;
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
    const normalizedSheets = validateMusicSheetList(musicSheets);
    const envelope: IBackupEnvelope = {
        schema: BACKUP_SCHEMA,
        version: BACKUP_VERSION,
        createdAt,
        data: { musicSheets: normalizedSheets },
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
