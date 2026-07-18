export const LOCAL_MEDIA_PROTOCOL = "bakamusic-media";
export const LOCAL_MEDIA_HOST = "local";

export interface ILocalMediaByteRange {
    start: number;
    end: number;
}

export function createLocalMediaUrl(filePath: string) {
    const mediaUrl = new URL(`${LOCAL_MEDIA_PROTOCOL}://${LOCAL_MEDIA_HOST}/`);
    mediaUrl.searchParams.set("path", filePath);
    return mediaUrl.toString();
}

export function parseLocalMediaUrl(value: string) {
    const mediaUrl = new URL(value);
    const pathValues = mediaUrl.searchParams.getAll("path");
    const parameterNames = [...mediaUrl.searchParams.keys()];
    if (
        mediaUrl.protocol !== `${LOCAL_MEDIA_PROTOCOL}:`
        || mediaUrl.hostname !== LOCAL_MEDIA_HOST
        || mediaUrl.port
        || mediaUrl.username
        || mediaUrl.password
        || mediaUrl.pathname !== "/"
        || parameterNames.some((name) => name !== "path")
        || pathValues.length !== 1
        || !pathValues[0]
        || pathValues[0].length > 32_768
    ) {
        throw new Error("Local media URL is invalid");
    }
    return pathValues[0];
}

export function resolveLocalMediaByteRange(
    rangeHeader: string | null,
    fileSize: number,
): ILocalMediaByteRange | null {
    if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
        throw new RangeError("Local media file size is invalid");
    }
    if (rangeHeader === null) {
        return null;
    }
    if (rangeHeader.length > 128) {
        throw new RangeError("Local media byte range is invalid");
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || (!match[1] && !match[2]) || fileSize === 0) {
        throw new RangeError("Local media byte range is invalid");
    }

    const startValue = match[1];
    const endValue = match[2];
    if (!startValue) {
        const suffixLength = Number(endValue);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            throw new RangeError("Local media byte range is invalid");
        }
        return {
            start: Math.max(0, fileSize - suffixLength),
            end: fileSize - 1,
        };
    }

    const start = Number(startValue);
    const requestedEnd = endValue ? Number(endValue) : fileSize - 1;
    if (
        !Number.isSafeInteger(start)
        || !Number.isSafeInteger(requestedEnd)
        || start < 0
        || requestedEnd < start
        || start >= fileSize
    ) {
        throw new RangeError("Local media byte range is invalid");
    }
    return {
        start,
        end: Math.min(requestedEnd, fileSize - 1),
    };
}
