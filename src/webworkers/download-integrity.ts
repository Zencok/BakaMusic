import { createHash } from "crypto";
import path from "path";

export class DownloadIntegrityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DownloadIntegrityError";
    }
}

export interface IDownloadResponsePlan {
    append: boolean;
    startSize: number;
    expectedBodySize?: number;
    totalSize?: number;
}

interface IContentRange {
    start: number;
    end: number;
    total: number;
}

function parseContentLength(value: string | null) {
    if (value === null) {
        return undefined;
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new DownloadIntegrityError("Invalid Content-Length header");
    }
    return parsed;
}

export function parseContentRange(value: string | null): IContentRange | null {
    if (!value) {
        return null;
    }

    const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(value.trim());
    if (!match) {
        return null;
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    if (
        !Number.isSafeInteger(start)
        || !Number.isSafeInteger(end)
        || !Number.isSafeInteger(total)
        || start < 0
        || end < start
        || total <= end
    ) {
        return null;
    }

    return { start, end, total };
}

export function validateMediaContentType(contentType: string | null) {
    if (!contentType) {
        return;
    }

    const normalized = contentType.split(";", 1)[0].trim().toLowerCase();
    const allowedApplicationTypes = new Set([
        "application/download",
        "application/force-download",
        "application/mp4",
        "application/octet-stream",
        "application/ogg",
        "application/vnd.ms-asf",
        "application/x-binary",
        "application/x-flac",
    ]);
    if (
        normalized.startsWith("audio/")
        || normalized === "video/mp4"
        || normalized === "video/ogg"
        || allowedApplicationTypes.has(normalized)
    ) {
        return;
    }

    throw new DownloadIntegrityError(`Unexpected media type: ${normalized || "empty"}`);
}

export function createDownloadPartPath(filePath: string, taskId: string) {
    const taskHash = createHash("sha256").update(taskId).digest("hex").slice(0, 16);
    return path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${taskHash}.part`,
    );
}

export function createDownloadResponsePlan(
    status: number,
    headers: Pick<Headers, "get">,
    existingSize: number,
): IDownloadResponsePlan {
    if (!Number.isSafeInteger(existingSize) || existingSize < 0) {
        throw new DownloadIntegrityError("Invalid partial file length");
    }

    validateMediaContentType(headers.get("content-type"));
    const contentLength = parseContentLength(headers.get("content-length"));

    if (status === 200) {
        return {
            append: false,
            startSize: 0,
            expectedBodySize: contentLength,
            totalSize: contentLength,
        };
    }

    if (status !== 206) {
        throw new DownloadIntegrityError(`Unexpected download response status: ${status}`);
    }

    const contentRange = parseContentRange(headers.get("content-range"));
    if (!contentRange) {
        throw new DownloadIntegrityError("Missing or invalid Content-Range header");
    }
    if (contentRange.start !== existingSize) {
        throw new DownloadIntegrityError(
            `Content-Range starts at ${contentRange.start}, expected ${existingSize}`,
        );
    }

    const rangeSize = contentRange.end - contentRange.start + 1;
    if (contentLength !== undefined && contentLength !== rangeSize) {
        throw new DownloadIntegrityError(
            `Content-Length ${contentLength} does not match Content-Range ${rangeSize}`,
        );
    }

    return {
        append: existingSize > 0,
        startSize: existingSize,
        expectedBodySize: rangeSize,
        totalSize: contentRange.total,
    };
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0) {
    return signature.every((value, index) => bytes[offset + index] === value);
}

function isMpegAudioFrame(bytes: Uint8Array) {
    return bytes.length >= 2
        && bytes[0] === 0xff
        && (bytes[1] & 0xe0) === 0xe0
        && (bytes[1] & 0x18) !== 0x08
        && (bytes[1] & 0x06) !== 0;
}

function isAdtsFrame(bytes: Uint8Array) {
    return bytes.length >= 2
        && bytes[0] === 0xff
        && (bytes[1] & 0xf6) === 0xf0;
}

function hasIsoBox(bytes: Uint8Array, type: string) {
    const signature = Array.from(type, (character) => character.charCodeAt(0));
    return startsWith(bytes, signature, 4);
}

function hasFlacSignature(bytes: Uint8Array) {
    const flac = [0x66, 0x4c, 0x61, 0x43] as const;
    if (startsWith(bytes, flac)) {
        return true;
    }

    if (!startsWith(bytes, [0x49, 0x44, 0x33]) || bytes.length < 10) {
        return false;
    }
    const tagSize = ((bytes[6] & 0x7f) << 21)
        | ((bytes[7] & 0x7f) << 14)
        | ((bytes[8] & 0x7f) << 7)
        | (bytes[9] & 0x7f);
    return startsWith(bytes, flac, tagSize + 10);
}

/**
 * Detect container extension from magic bytes.
 * Order matters: ID3 can prefix FLAC, so FLAC is checked before MP3.
 */
export function detectMediaExtension(bytes: Uint8Array): string | null {
    if (bytes.length < 4) {
        return null;
    }

    const hasId3 = startsWith(bytes, [0x49, 0x44, 0x33]);
    if (hasFlacSignature(bytes)) {
        return ".flac";
    }
    if (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
        && startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8)
    ) {
        return ".wav";
    }
    if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) {
        return ".ogg";
    }
    if (
        hasIsoBox(bytes, "ftyp")
        || hasIsoBox(bytes, "styp")
        || hasIsoBox(bytes, "moof")
    ) {
        return ".m4a";
    }
    if (startsWith(bytes, [
        0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11,
        0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c,
    ])) {
        return ".wma";
    }
    if (hasId3 || isMpegAudioFrame(bytes)) {
        return ".mp3";
    }
    if (startsWith(bytes, [0x41, 0x44, 0x49, 0x46]) || isAdtsFrame(bytes)) {
        return ".aac";
    }
    return null;
}

/** Whether two extensions refer to the same media family (e.g. .m4a ≈ .mp4). */
export function mediaExtensionsCompatible(a: string, b: string) {
    const normalize = (ext: string) => {
        const value = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
        if (value === ".mflac") {
            return ".flac";
        }
        if (value === ".mgg") {
            return ".ogg";
        }
        if (value === ".mmp4" || value === ".m4s" || value === ".mp4" || value === ".m4b" || value === ".m4r") {
            return ".m4a";
        }
        if (value === ".opus") {
            return ".ogg";
        }
        return value;
    };
    return normalize(a) === normalize(b);
}

/**
 * Ensure bytes are a known media container. When `filePath` is provided and
 * its extension disagrees with the payload, throws unless the caller prefers
 * {@link detectMediaExtension} + rename (download path).
 */
export function validateMediaFileSignature(bytes: Uint8Array, filePath: string) {
    if (bytes.length < 4) {
        throw new DownloadIntegrityError("Downloaded media file is empty or truncated");
    }

    const detected = detectMediaExtension(bytes);
    if (!detected) {
        throw new DownloadIntegrityError(
            `Media signature does not match ${path.extname(filePath).toLowerCase() || "the target file"}`,
        );
    }

    const extension = path.extname(filePath).toLowerCase();
    if (extension && !mediaExtensionsCompatible(extension, detected)) {
        throw new DownloadIntegrityError(
            `Media signature does not match ${extension || "the target file"}`,
        );
    }
}

/**
 * Resolve the final on-disk extension for a downloaded body.
 * Prefers magic-byte detection so CDN URLs without (or with wrong) extensions
 * still land as .flac / .m4a instead of the historical .mp3 default.
 */
export function resolveDownloadedFilePath(
    requestedPath: string,
    signatureBytes: Uint8Array,
): { filePath: string; detectedExt: string } {
    const detectedExt = detectMediaExtension(signatureBytes);
    if (!detectedExt) {
        throw new DownloadIntegrityError(
            `Media signature does not match ${path.extname(requestedPath).toLowerCase() || "the target file"}`,
        );
    }

    const requestedExt = path.extname(requestedPath).toLowerCase();
    if (!requestedExt || mediaExtensionsCompatible(requestedExt, detectedExt)) {
        return {
            filePath: requestedPath,
            detectedExt: requestedExt || detectedExt,
        };
    }

    const correctedPath = path.join(
        path.dirname(requestedPath),
        `${path.basename(requestedPath, requestedExt)}${detectedExt}`,
    );
    return {
        filePath: correctedPath,
        detectedExt,
    };
}

export function validateCompletedDownload(
    plan: IDownloadResponsePlan,
    receivedBytes: number,
    fileSize: number,
) {
    if (!Number.isSafeInteger(receivedBytes) || receivedBytes < 0) {
        throw new DownloadIntegrityError("Invalid received byte count");
    }
    if (plan.expectedBodySize !== undefined && receivedBytes !== plan.expectedBodySize) {
        throw new DownloadIntegrityError(
            `Received ${receivedBytes} bytes, expected ${plan.expectedBodySize}`,
        );
    }

    const countedSize = plan.startSize + receivedBytes;
    if (fileSize !== countedSize) {
        throw new DownloadIntegrityError(
            `Partial file length ${fileSize} does not match received length ${countedSize}`,
        );
    }
    if (plan.totalSize !== undefined && fileSize !== plan.totalSize) {
        throw new DownloadIntegrityError(
            `Final file length ${fileSize} does not match expected length ${plan.totalSize}`,
        );
    }
}
