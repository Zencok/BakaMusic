import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
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
    resolveDownloadedFilePath,
    validateCompletedDownload,
} from "./download-integrity";

async function cleanFile(filePath: string) {
    try {
        await fsPromises.rm(filePath, { force: true });
        return true;
    } catch {
        return false;
    }
}

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
        ".m4b",
        ".m4r",
        ".aiff",
        ".aif",
        ".ape",
        ".wv",
        ".dsf",
    ].includes(path.extname(filePath).toLowerCase());
}

function resolveLyricContent(payload: IDownloadPostprocessPayload) {
    if (typeof payload.lyricContent === "string") {
        return payload.lyricContent;
    }
    // Legacy fallback only.
    if (!payload.lyricSource?.rawLrc) {
        return "";
    }
    return formatLyricsByTimestamp(
        payload.lyricSource.rawLrc,
        payload.lyricSource.translation,
        payload.lyricSource.romanization,
        payload.options.lyricOrder,
        {
            enableWordByWord: payload.options.enableWordByWordLyric === true,
            format: payload.lyricSource.format,
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

/** Utility only embeds prepared cover/lyrics — no network. */
async function writeMetadata(
    filePath: string,
    payload: IDownloadPostprocessPayload,
    lyricContent: string,
) {
    const { writeTags } = await import("@/common/taglib-native");
    const ext = path.extname(filePath).toLowerCase();
    const artist = payload.musicItem.artist || "";

    let coverPicture: { data: Buffer; mimeType: string } | undefined;
    if (payload.options.writeMetadataCover && payload.coverImage?.dataBase64) {
        const data = Buffer.from(payload.coverImage.dataBase64, "base64");
        if (data.length > 0) {
            coverPicture = {
                data,
                mimeType: payload.coverImage.mimeType || "image/jpeg",
            };
        }
    }

    writeTags(filePath, {
        title: payload.musicItem.title || path.basename(filePath, ext),
        album: payload.musicItem.album || "",
        artist,
        albumArtist: artist,
        ...(payload.options.writeMetadataLyric && lyricContent.trim()
            ? { lyrics: lyricContent }
            : {}),
        ...(coverPicture
            ? {
                pictures: [{
                    data: coverPicture.data,
                    mimeType: coverPicture.mimeType,
                }],
            }
            : {}),
    });
}

export async function postprocessDownloadedFile(
    filePath: string,
    payload?: IDownloadPostprocessPayload | null,
) {
    if (!payload) {
        return;
    }

    const lyricContent = resolveLyricContent(payload);

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
    /** Final on-disk path when DONE (may differ from requested path after signature fix). */
    filePath?: string;
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

export type IDownloadFileResult = {
    state: DownloadState.DONE | DownloadState.ERROR | DownloadState.DOWNLOADING;
    msg?: string;
    /** Final path after optional extension correction from magic bytes. */
    filePath?: string;
};

async function ensureUniqueFilePath(filePath: string) {
    try {
        await fsPromises.access(filePath);
    } catch {
        return filePath;
    }
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    for (let index = 1; index < 10_000; index++) {
        const candidate = path.join(dir, `${base} (${index})${ext}`);
        try {
            await fsPromises.access(candidate);
        } catch {
            return candidate;
        }
    }
    throw new DownloadIntegrityError("Unable to allocate a unique download path");
}

export async function downloadFile(
    taskId: string,
    mediaSource: IMusic.IMusicSource,
    filePath: string,
    onStateChange: IOnStateChangeFunc,
): Promise<IDownloadFileResult> {
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
    let state: IDownloadFileResult["state"] = DownloadState.DOWNLOADING;
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
            return { state: DownloadState.DOWNLOADING };
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
        // Safety net: if path ext still disagrees with magic bytes (wrong
        // platform guess), rename to the detected container before finalize.
        const resolved = resolveDownloadedFilePath(
            filePath,
            signature.subarray(0, bytesRead),
        );
        const finalPath = resolved.filePath === filePath
            ? filePath
            : await ensureUniqueFilePath(resolved.filePath);
        await fsPromises.rename(partPath, finalPath);
        downloadPaths.delete(taskId);
        state = DownloadState.DONE;
        // Terminal state is also returned via RPC so the renderer still
        // finalizes even if the progress event races past callback teardown.
        onStateChange({ state, filePath: finalPath });
        return { state, filePath: finalPath };
    } catch (e) {
        if (activeDownload.cancelled) {
            return { state: DownloadState.DOWNLOADING };
        }
        activeDownload.failed = true;
        if (e instanceof DownloadIntegrityError) {
            await cleanFile(partPath);
            downloadPaths.delete(taskId);
        }
        state = DownloadState.ERROR;
        const msg = toError(e).message;
        onStateChange({
            state,
            msg,
        });
        return { state, msg };
    } finally {
        if (activeDownloads.get(taskId) === activeDownload) {
            activeDownloads.delete(taskId);
        }
    }
}
