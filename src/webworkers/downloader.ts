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
    const reader = response.body.getReader();
    const rs = new Readable();
    let size = 0;
    const tOnRead = throttle(options?.onRead, 64, {
        leading: true,
        trailing: true,
    });
    rs._read = async () => {
        const result = await reader.read();
        if (!result.done) {
            rs.push(Buffer.from(result.value));
            size += result.value.byteLength;
            tOnRead?.(size);
        } else {
            rs.push(null);
            options?.onDone?.();
            return;
        }
    };
    rs.on("error", options?.onError);
    return rs;
};

type IOnStateChangeFunc = (data: {
    state: DownloadState;
    downloaded?: number;
    total?: number;
    msg?: string;
}) => void;

async function downloadFile(
    mediaSource: IMusic.IMusicSource,
    filePath: string,
    onStateChange: IOnStateChangeFunc,
) {
    let state = DownloadState.DOWNLOADING;
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
    } catch {
        state = DownloadState.DOWNLOADING;
    }
    const _headers: Record<string, string> = {
        ...(mediaSource.headers ?? {}),
        "user-agent": mediaSource.userAgent,
    };

    try {
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
            });
        } else {
            res = await fetch(encodeUrlHeaders(mediaSource.url, _headers));
        }

        const totalSize = +res.headers.get("content-length");
        onStateChange({
            state,
            downloaded: 0,
            total: totalSize,
        });
        const stm = responseToReadable(res, {
            onRead(size) {
                if (state !== DownloadState.DOWNLOADING) {
                    return;
                }
                state = DownloadState.DOWNLOADING;
                onStateChange({
                    state,
                    downloaded: size,
                    total: totalSize,
                });
            },
            onError: (e) => {
                state = DownloadState.ERROR;
                onStateChange({
                    state,
                    msg: e?.message,
                });
            },
        }).pipe(fs.createWriteStream(filePath));

        stm.on("close", () => {
            state = DownloadState.DONE;
            onStateChange({
                state,
            });
        });

        stm.on("error", () => {
            // 清理文件
            cleanFile(filePath);
        });
    } catch (e) {
        state = DownloadState.ERROR;
        onStateChange({
            state,
            msg: e?.message,
        });
        cleanFile(filePath);
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
        "user-agent": mediaSource.userAgent,
    };

    try {
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

        const totalSize = +res.headers.get("content-length");
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
                    onErrorCallback?.(e);
                }
            },
        }).pipe(fs.createWriteStream(filePath));

        stm.on("close", () => {
            onEndedCallback?.();
        });

        stm.on("error", (e) => {
            if (!hasError) {
                hasError = true;
                onErrorCallback?.(e);
            }
            // 清理文件
            cleanFile(filePath);
        });
    } catch (e) {
        if (!hasError) {
            hasError = true;
            onErrorCallback?.(e);
        }
        cleanFile(filePath);
    }
}



Comlink.expose({
    downloadFile,
    downloadFileNew,
    postprocessDownloadedFile,
});
