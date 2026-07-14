import * as Comlink from "comlink";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { encodeUrlHeaders } from "@/common/normalize-util";
import throttle from "lodash.throttle";
import { DownloadState as DownloadState } from "@/common/constant";
import {
    formatLyricsByTimestamp,
    IDownloadPostprocessPayload,
} from "@/common/download-postprocess";
import { toError } from "@/common/error-util";
import {
    File as TagLibFile,
    Id3v2Settings,
    Picture,
} from "node-taglib-sharp";
import { rimraf } from "rimraf";

async function cleanFile(filePath: string) {
    try {
        if ((await fsPromises.stat(filePath)).isFile()) {
            await rimraf(filePath);
        }
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
    ].includes(path.extname(filePath).toLowerCase());
}

function resolveCoverExt(imgUrl: string, contentType?: string) {
    const validExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
    let urlExt: string | undefined;

    try {
        const pathname = new URL(imgUrl).pathname;
        const index = pathname.lastIndexOf(".");
        if (index >= 0) {
            urlExt = pathname.slice(index).toLowerCase();
        }
    } catch {
        urlExt = undefined;
    }

    if (urlExt && validExts.has(urlExt)) {
        return urlExt === ".jpeg" ? ".jpg" : urlExt;
    }

    if (!contentType) {
        return ".jpg";
    }

    if (contentType.includes("image/png")) {
        return ".png";
    }
    if (contentType.includes("image/webp")) {
        return ".webp";
    }
    if (contentType.includes("image/bmp")) {
        return ".bmp";
    }
    if (contentType.includes("image/gif")) {
        return ".gif";
    }

    return ".jpg";
}

async function downloadCoverTempFile(
    filePath: string,
    coverUrl: string,
) {
    const response = await fetch(coverUrl);
    if (!response.ok) {
        throw new Error(`download cover failed: ${response.status}`);
    }

    const ext = resolveCoverExt(
        coverUrl,
        response.headers.get("content-type") ?? undefined,
    );
    const coverPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath, path.extname(filePath))}.cover-${Date.now()}${ext}`,
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    await fsPromises.writeFile(coverPath, bytes);
    return coverPath;
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

async function postprocessDownloadedFile(
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

const responseToReadable = (
    response: Response,
    options?: {
        onRead?: (size: number) => void;
        onDone?: () => void;
        onError?: (e: Error) => void;
    },
) => {
    if (!response.body) {
        throw new Error("Response body is empty");
    }
    const reader = response.body.getReader();
    const rs = new Readable();
    let size = 0;
    const tOnRead = options?.onRead
        ? throttle(options.onRead, 64, {
            leading: true,
            trailing: true,
        })
        : undefined;
    rs._read = async () => {
        try {
            const result = await reader.read();
            if (!result.done) {
                rs.push(Buffer.from(result.value));
                size += result.value.byteLength;
                tOnRead?.(size);
            } else {
                rs.push(null);
                options?.onDone?.();
            }
        } catch (error) {
            rs.destroy(toError(error));
        }
    };
    if (options?.onError) {
        rs.on("error", options.onError);
    }
    return rs;
};

type IOnStateChangeFunc = (data: {
    state: DownloadState;
    downloaded?: number;
    total?: number;
    msg?: string;
}) => void;

interface IActiveDownload {
    abortController: AbortController;
    filePath: string;
    readable?: Readable;
    writeStream?: fs.WriteStream;
    cancelled: boolean;
    failed: boolean;
}

const activeDownloads = new Map<string, IActiveDownload>();
const downloadPaths = new Map<string, string>();

async function abortDownload(taskId: string, removePartial = true) {
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
        const filePath = activeDownload?.filePath ?? downloadPaths.get(taskId);
        downloadPaths.delete(taskId);
        if (filePath) {
            await cleanFile(filePath);
        }
    }
}

async function downloadFile(
    taskId: string,
    mediaSource: IMusic.IMusicSource,
    filePath: string,
    onStateChange: IOnStateChangeFunc,
) {
    await abortDownload(taskId, false);
    const activeDownload: IActiveDownload = {
        abortController: new AbortController(),
        filePath,
        cancelled: false,
        failed: false,
    };
    activeDownloads.set(taskId, activeDownload);
    downloadPaths.set(taskId, filePath);
    let state = DownloadState.DOWNLOADING;
    let existingSize = 0;
    try {
        const stat = fs.statSync(filePath);
        // if (stat.isFile()) {
        //   state = DownloadState.ERROR;
        //   onStateChange?.({
        //     state,
        //     msg: "File Exist",
        //   });
        //   return;
        // }
        if (stat.isDirectory()) {
            state = DownloadState.ERROR;
            onStateChange?.({
                state,
                msg: "Filepath is a directory",
            });
            return;
        }
        existingSize = stat.size;
    } catch {
        state = DownloadState.DOWNLOADING;
    }
    const _headers: Record<string, string> = {
        ...(mediaSource.headers ?? {}),
    };
    if (mediaSource.userAgent) {
        _headers["user-agent"] = mediaSource.userAgent;
    }
    if (existingSize > 0) {
        _headers.Range = `bytes=${existingSize}-`;
    }

    try {
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
            res = await fetch(encodeUrlHeaders(mediaSource.url, _headers), {
                signal: activeDownload.abortController.signal,
            });
        }

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const isPartialResponse = res.status === 206 && existingSize > 0;
        const contentLength = +(res.headers.get("content-length") ?? 0);
        const rangeTotal = res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
        const startSize = isPartialResponse ? existingSize : 0;
        const totalSize = rangeTotal ? +rangeTotal : contentLength + startSize;
        onStateChange({
            state,
            downloaded: startSize,
            total: totalSize,
        });
        const readable = responseToReadable(res, {
            onRead(size) {
                if (state !== DownloadState.DOWNLOADING) {
                    return;
                }
                state = DownloadState.DOWNLOADING;
                onStateChange({
                    state,
                    downloaded: startSize + size,
                    total: totalSize,
                });
            },
            onError: (e) => {
                if (activeDownload.cancelled) {
                    return;
                }
                activeDownload.failed = true;
                state = DownloadState.ERROR;
                onStateChange({
                    state,
                    msg: e?.message,
                });
                activeDownload.writeStream?.destroy();
            },
        });
        const writeStream = fs.createWriteStream(filePath, {
            flags: isPartialResponse ? "a" : "w",
        });
        activeDownload.readable = readable;
        activeDownload.writeStream = writeStream;
        const stm = readable.pipe(writeStream);

        stm.on("close", () => {
            activeDownloads.delete(taskId);
            if (activeDownload.cancelled || activeDownload.failed) {
                return;
            }
            downloadPaths.delete(taskId);
            state = DownloadState.DONE;
            onStateChange({
                state,
            });
        });

        stm.on("error", (error) => {
            activeDownloads.delete(taskId);
            if (!activeDownload.cancelled && !activeDownload.failed) {
                activeDownload.failed = true;
                state = DownloadState.ERROR;
                onStateChange({
                    state,
                    msg: toError(error).message,
                });
            }
            // 清理文件
            void cleanFile(filePath);
        });
    } catch (e) {
        activeDownloads.delete(taskId);
        if (activeDownload.cancelled) {
            return;
        }
        state = DownloadState.ERROR;
        onStateChange({
            state,
            msg: toError(e).message,
        });
    }
}


interface IOptions {
    onProgress?: (progress: ICommon.IDownloadFileSize) => Promise<void>;
    onEnded?: () => Promise<void>;
    onError?: (reason: Error) => Promise<void>;
}
async function downloadFileNew(
    mediaSource: IMusic.IMusicSource,
    filePath: string,
    options?: IOptions,
) {
    let hasError = false;
    const { onProgress: onProgressCallback, onEnded: onEndedCallback, onError: onErrorCallback } = options ?? {};
    try {
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            hasError = true;
            onErrorCallback?.(new Error("Filepath is a directory"));
            return;
        }
    } catch {
        hasError = false;
    }

    const headers: Record<string, string> = {
        ...(mediaSource.headers ?? {}),
    };
    if (mediaSource.userAgent) {
        headers["user-agent"] = mediaSource.userAgent;
    }

    try {
        if (!mediaSource.url) {
            throw new Error("mediaSource.url is empty");
        }
        const urlObj = new URL(mediaSource.url);
        let res: Response;
        if (urlObj.username && urlObj.password) {
            headers["Authorization"] = `Basic ${btoa(
                `${decodeURIComponent(urlObj.username)}:${decodeURIComponent(
                    urlObj.password,
                )}`,
            )}`;
            urlObj.username = "";
            urlObj.password = "";
            res = await fetch(urlObj.toString(), {
                headers: headers,
            });
        } else {
            res = await fetch(encodeUrlHeaders(mediaSource.url, headers));
        }

        const totalSize = +(res.headers.get("content-length") ?? 0);
        onProgressCallback?.({
            currentSize: 0,
            totalSize: totalSize,
        });


        const stm = responseToReadable(res, {
            onRead(size) {
                if (hasError) {
                    // todo abort
                    return;
                }
                onProgressCallback?.({
                    currentSize: size,
                    totalSize: totalSize,
                });
            },
            onError: (e) => {
                if (!hasError) {
                    hasError = true;
                    onErrorCallback?.(toError(e));
                }
            },
        }).pipe(fs.createWriteStream(filePath));

        stm.on("close", () => {
            onEndedCallback?.();
        });

        stm.on("error", (e) => {
            if (!hasError) {
                hasError = true;
                onErrorCallback?.(toError(e));
            }
            // 清理文件
            cleanFile(filePath);
        });
    } catch (e) {
        if (!hasError) {
            hasError = true;
            onErrorCallback?.(toError(e));
        }
        cleanFile(filePath);
    }
}



Comlink.expose({
    downloadFile,
    abortDownload,
    downloadFileNew,
    postprocessDownloadedFile,
});
