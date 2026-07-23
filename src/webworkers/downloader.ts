import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import throttle from "lodash.throttle";
import { DownloadState as DownloadState } from "@/common/constant";
import {
    formatLyricsByTimestamp,
    IDownloadPostprocessPayload,
} from "@/common/download-postprocess";
import { toError } from "@/common/error-util";
import {
    createDownloadPartPath,
    createDownloadResponsePlan,
    DownloadIntegrityError,
    validateCompletedDownload,
    validateMediaFileSignature,
} from "./download-integrity";

async function cleanFile(filePath: string) {
    try {
        await fsPromises.rm(filePath, { force: true });
        return true;
    } catch {
        return false;
    }
}

class Semaphore {
    private active = 0;
    private readonly waiters: Array<() => void> = [];

    constructor(private readonly limit: number) {}

    async run<T>(callback: () => Promise<T>): Promise<T> {
        if (this.active >= this.limit) {
            await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
        this.active++;
        try {
            return await callback();
        } finally {
            this.active--;
            this.waiters.shift()?.();
        }
    }
}

const coverDownloadSemaphore = new Semaphore(3);
const coverDownloadTimeoutMs = 15_000;

function isAudioFile(filePath: string) {
    return [
        ".mp3",
        ".flac",
        ".wav",
        ".aac",
        ".m4a",
        ".ogg",
        ".wma",
        ".opus",
        ".mp4",
    ].includes(path.extname(filePath).toLowerCase());
}

async function downloadCoverTempFile(
    filePath: string,
    coverUrl: string,
) {
    return coverDownloadSemaphore.run(async () => {
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), coverDownloadTimeoutMs);
        const tempBasePath = path.join(
            path.dirname(filePath),
            `.${path.basename(filePath, path.extname(filePath))}.cover-${randomUUID()}`,
        );
        const partPath = `${tempBasePath}.part`;

        try {
            const response = await fetch(coverUrl, {
                signal: abortController.signal,
            });
            if (!response.ok || !response.body) {
                throw new Error(`download cover failed: ${response.status}`);
            }

            const contentType = response.headers.get("content-type");
            if (contentType && !contentType.toLowerCase().startsWith("image/")) {
                throw new Error(`unexpected cover type: ${contentType}`);
            }

            await pipeline(
                Readable.fromWeb(response.body as any),
                fs.createWriteStream(partPath, { flags: "wx" }),
            );
            const signature = Buffer.alloc(16);
            const handle = await fsPromises.open(partPath, "r");
            let bytesRead = 0;
            try {
                ({ bytesRead } = await handle.read(signature, 0, signature.length, 0));
            } finally {
                await handle.close();
            }
            const actualExt = detectCoverExt(signature.subarray(0, bytesRead));
            if (!actualExt) {
                throw new Error("invalid cover file signature");
            }
            const coverPath = `${tempBasePath}${actualExt}`;
            await fsPromises.rename(partPath, coverPath);
            return coverPath;
        } finally {
            clearTimeout(timeout);
            await cleanFile(partPath);
        }
    });
}

function detectCoverExt(bytes: Uint8Array) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return ".jpg";
    }
    if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))) {
        return ".png";
    }
    if (
        Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
        && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
    ) {
        return ".webp";
    }
    const prefix = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    if (prefix === "GIF87a" || prefix === "GIF89a") {
        return ".gif";
    }
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
        return ".bmp";
    }
    return null;
}

function buildLyricContent(payload: IDownloadPostprocessPayload) {
    if (!payload.lyricSource?.rawLrc) {
        return "";
    }

    return formatLyricsByTimestamp(
        payload.lyricSource.rawLrc,
        payload.lyricSource.translation,
        payload.lyricSource.romanization,
        payload.options.lyricOrder,
        {
            enableWordByWord: payload.options.enableWordByWordLyric,
        },
    );
}

async function writeLyricFile(
    filePath: string,
    lyricContent: string,
    format: "lrc" | "txt",
) {
    if (!lyricContent.trim()) {
        return;
    }

    const lyricFilePath = `${filePath.replace(/\.[^.]+$/, "")}.${format}`;
    await fsPromises.writeFile(lyricFilePath, lyricContent, "utf8");
}

async function writeMetadata(
    filePath: string,
    payload: IDownloadPostprocessPayload,
    lyricContent: string,
) {
    const {
        File: TagLibFile,
        Id3v2Settings,
        Picture,
    } = await import("node-taglib-sharp");
    const ext = path.extname(filePath).toLowerCase();
    let coverTempFilePath: string | undefined;
    const artists = payload.musicItem.artist
        ? [payload.musicItem.artist]
        : [];

    if (ext === ".mp3") {
        try {
            Id3v2Settings.forceDefaultVersion = true;
            Id3v2Settings.defaultVersion = 3;
        } catch {
            // pass
        }
    } else {
        Id3v2Settings.forceDefaultVersion = false;
    }

    const songFile = TagLibFile.createFromPath(filePath);

    try {
        songFile.tag.title = payload.musicItem.title || path.basename(filePath, ext);
        songFile.tag.album = payload.musicItem.album || "";
        songFile.tag.performers = artists;
        songFile.tag.albumArtists = artists;

        if (payload.options.writeMetadataLyric && lyricContent.trim()) {
            songFile.tag.lyrics = lyricContent;
        }

        if (payload.options.writeMetadataCover && payload.coverUrl) {
            try {
                coverTempFilePath = await downloadCoverTempFile(filePath, payload.coverUrl);
                songFile.tag.pictures = [Picture.fromPath(coverTempFilePath)];
            } catch {
                coverTempFilePath = undefined;
            }
        }

        if (ext !== ".wav") {
            songFile.save();
        }
    } finally {
        songFile.dispose();

        if (coverTempFilePath) {
            await fsPromises.unlink(coverTempFilePath).catch(() => {
                // pass
            });
        }
    }
}

export async function postprocessDownloadedFile(
    filePath: string,
    payload?: IDownloadPostprocessPayload | null,
) {
    if (!payload) {
        return;
    }

    const lyricContent = buildLyricContent(payload);

    if (payload.options.downloadLyricFile) {
        await writeLyricFile(
            filePath,
            lyricContent,
            payload.options.lyricFileFormat,
        );
    }

    if (!payload.options.writeMetadata || !isAudioFile(filePath)) {
        return;
    }

    await writeMetadata(filePath, payload, lyricContent);
}

type IOnStateChangeFunc = (data: {
    state: DownloadState;
    downloaded?: number;
    total?: number;
    msg?: string;
}) => void;

interface IActiveDownload {
    abortController: AbortController;
    partPath: string;
    readable?: Readable;
    writeStream?: fs.WriteStream;
    cancelled: boolean;
    failed: boolean;
}

const activeDownloads = new Map<string, IActiveDownload>();
const downloadPaths = new Map<string, string>();

export async function abortDownload(taskId: string, removePartial = true) {
    const activeDownload = activeDownloads.get(taskId);
    if (activeDownload) {
        activeDownload.cancelled = true;
        activeDownload.abortController.abort();
        activeDownload.readable?.destroy();
        const waitForClose = activeDownload.writeStream
            && !activeDownload.writeStream.closed
            ? new Promise<void>((resolve) => {
                activeDownload.writeStream?.once("close", resolve);
            })
            : Promise.resolve();
        activeDownload.writeStream?.destroy();
        await waitForClose;
        activeDownloads.delete(taskId);
    }

    if (removePartial) {
        const filePath = activeDownload?.partPath ?? downloadPaths.get(taskId);
        downloadPaths.delete(taskId);
        if (filePath) {
            await cleanFile(filePath);
        }
    }
}

export async function downloadFile(
    taskId: string,
    mediaSource: IMusic.IMusicSource,
    filePath: string,
    onStateChange: IOnStateChangeFunc,
) {
    await abortDownload(taskId, false);
    const partPath = createDownloadPartPath(filePath, taskId);
    const activeDownload: IActiveDownload = {
        abortController: new AbortController(),
        partPath,
        cancelled: false,
        failed: false,
    };
    activeDownloads.set(taskId, activeDownload);
    downloadPaths.set(taskId, partPath);
    let state = DownloadState.DOWNLOADING;
    let existingSize = 0;
    try {
        await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
        let partialStat: fs.Stats | undefined;
        try {
            partialStat = await fsPromises.stat(partPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }
        if (partialStat?.isDirectory()) {
            throw new DownloadIntegrityError("Partial filepath is a directory");
        }
        existingSize = partialStat?.size ?? 0;
        const _headers: Record<string, string> = {
            ...(mediaSource.headers ?? {}),
            "accept-encoding": "identity",
        };
        if (mediaSource.userAgent) {
            _headers["user-agent"] = mediaSource.userAgent;
        }
        if (existingSize > 0) {
            _headers.Range = `bytes=${existingSize}-`;
        }

        if (!mediaSource.url) {
            throw new Error("mediaSource.url is empty");
        }
        const urlObj = new URL(mediaSource.url);
        let res: Response;
        if (urlObj.username && urlObj.password) {
            _headers["Authorization"] = `Basic ${btoa(
                `${decodeURIComponent(urlObj.username)}:${decodeURIComponent(
                    urlObj.password,
                )}`,
            )}`;
            urlObj.username = "";
            urlObj.password = "";
            res = await fetch(urlObj.toString(), {
                headers: _headers,
                signal: activeDownload.abortController.signal,
            });
        } else {
            res = await fetch(mediaSource.url, {
                headers: _headers,
                signal: activeDownload.abortController.signal,
            });
        }

        if (!res.body) {
            throw new DownloadIntegrityError("Response body is empty");
        }
        const responsePlan = createDownloadResponsePlan(res.status, res.headers, existingSize);
        const { startSize, totalSize } = responsePlan;
        onStateChange({
            state,
            downloaded: startSize,
            total: totalSize,
        });
        let receivedBytes = 0;
        const notifyProgress = throttle(() => {
            onStateChange({
                state: DownloadState.DOWNLOADING,
                downloaded: startSize + receivedBytes,
                total: totalSize,
            });
        }, 64, {
            leading: true,
            trailing: true,
        });
        const readable = Readable.fromWeb(res.body as any);
        const progressTransform = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                receivedBytes += chunk.length;
                notifyProgress();
                callback(null, chunk);
            },
        });
        const writeStream = fs.createWriteStream(partPath, {
            flags: responsePlan.append ? "a" : "w",
        });
        activeDownload.readable = readable;
        activeDownload.writeStream = writeStream;
        try {
            await pipeline(readable, progressTransform, writeStream);
        } finally {
            notifyProgress.flush();
            notifyProgress.cancel();
        }
        if (activeDownload.cancelled) {
            return;
        }

        const completedStat = await fsPromises.stat(partPath);
        validateCompletedDownload(responsePlan, receivedBytes, completedStat.size);
        const signature = Buffer.alloc(Math.min(128 * 1024, completedStat.size));
        const handle = await fsPromises.open(partPath, "r");
        let bytesRead = 0;
        try {
            ({ bytesRead } = await handle.read(signature, 0, signature.length, 0));
        } finally {
            await handle.close();
        }
        validateMediaFileSignature(signature.subarray(0, bytesRead), filePath);
        await fsPromises.rename(partPath, filePath);
        downloadPaths.delete(taskId);
        state = DownloadState.DONE;
        onStateChange({ state });
    } catch (e) {
        if (activeDownload.cancelled) {
            return;
        }
        activeDownload.failed = true;
        if (e instanceof DownloadIntegrityError) {
            await cleanFile(partPath);
            downloadPaths.delete(taskId);
        }
        state = DownloadState.ERROR;
        onStateChange({
            state,
            msg: toError(e).message,
        });
    } finally {
        if (activeDownloads.get(taskId) === activeDownload) {
            activeDownloads.delete(taskId);
        }
    }
}
