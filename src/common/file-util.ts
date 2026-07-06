import { ICommonTagsResult, IPicture, parseFile } from "music-metadata";
import path from "path";
import { localPluginName, supportLocalMediaType } from "./constant";
import CryptoJS from "crypto-js";
import fs from "fs/promises";
import url from "url";
import type { BigIntStats, PathLike, StatOptions, Stats } from "original-fs";
import { setInternalData } from "./media-util";

function getB64Picture(picture: IPicture) {
    return `data:${picture.format};base64,${picture.data.toString("base64")}`;
}

const specialEncoding = ["GB2312"];

function normalizeLocalLyricText(lyrics?: string[] | null) {
    const normalizedLyrics = lyrics
        ?.map((lyric) => lyric?.trim?.() ?? "")
        .filter(Boolean);

    if (!normalizedLyrics?.length) {
        return undefined;
    }

    return normalizedLyrics
        .join("\n")
        .replace(/\r/g, "")
        .replace(/\\r\\n|\\n|\\r/g, "\n");
}

function getLocalAudioQuality(format?: {
    bitrate?: number;
    bitsPerSample?: number;
    sampleRate?: number;
    lossless?: boolean;
    codec?: string;
    container?: string;
}): IMusic.IQualityKey {
    const bitrateKbps = typeof format?.bitrate === "number"
        ? format.bitrate / 1000
        : 0;
    const bitsPerSample = format?.bitsPerSample ?? 0;
    const sampleRate = format?.sampleRate ?? 0;
    const codecText = `${format?.codec ?? ""} ${format?.container ?? ""}`.toLowerCase();
    const isLossless =
        format?.lossless === true ||
        /\b(flac|alac|ape|wav|wave|pcm|dsd|dsf|aiff?)\b/.test(codecText);

    if (isLossless) {
        if (bitsPerSample > 16 || sampleRate > 48000) {
            return "hires";
        }
        return "flac";
    }

    if (bitrateKbps >= 256) {
        return "320k";
    }
    if (bitrateKbps >= 160) {
        return "192k";
    }
    return "128k";
}

async function getLocalFileSize(filePath: string) {
    const stat = await safeStat(filePath);
    return stat?.isFile() ? Number(stat.size) : undefined;
}

function applyLocalQualityInfo(
    musicItem: IMusic.IMusicItem,
    filePath: string,
    quality: IMusic.IQualityKey,
    size?: number,
) {
    musicItem.qualities = {
        ...(musicItem.qualities ?? {}),
        [quality]: {
            url: addFileScheme(filePath),
            ...(size !== undefined ? { size } : {}),
        },
    };
    setInternalData<IMusic.IMusicItemInternalData>(
        musicItem,
        "downloadData",
        {
            path: filePath,
            quality,
        },
    );
    return musicItem;
}

export async function parseLocalMusicItem(
    filePath: string,
): Promise<IMusic.IMusicItem> {
    const hash = CryptoJS.MD5(filePath).toString();
    const size = await getLocalFileSize(filePath);
    try {
        const {
            common = {} as ICommonTagsResult,
            format,
        } = await parseFile(filePath);
        const duration =
            typeof format?.duration === "number" && isFinite(format.duration)
                ? format.duration
                : undefined;

        const jschardet = await import("jschardet");

        // 检测编码
        let encoding: string | null = null;
        let conf = 0;
        const testItems = [common.title, common.artist, common.album];

        for (const testItem of testItems) {
            if (!testItem) {
                continue;
            }
            const testResult = jschardet.detect(testItem, {
                minimumThreshold: 0.4,
            });
            if (testResult.confidence > conf) {
                conf = testResult.confidence;
                encoding = testResult.encoding;
            }

            if (conf > 0.9) {
                break;
            }
        }

        if (encoding && specialEncoding.includes(encoding)) {
            const iconv = await import("iconv-lite");

            if (common.title) {
                common.title = iconv.decode(
                    common.title as unknown as Buffer,
                    encoding,
                );
            }
            if (common.artist) {
                common.artist = iconv.decode(
                    common.artist as unknown as Buffer,
                    encoding,
                );
            }
            if (common.album) {
                common.album = iconv.decode(
                    common.album as unknown as Buffer,
                    encoding,
                );
            }
            if (common.lyrics) {
                common.lyrics = common.lyrics.map((it) =>
                    it ? iconv.decode(it as unknown as Buffer, encoding) : "",
                );
            }
        }

        const quality = getLocalAudioQuality(format);
        return applyLocalQualityInfo({
            title: common.title ?? path.parse(filePath).name,
            duration,
            artist: common.artist ?? "未知作者",
            artwork: common.picture?.[0]
                ? getB64Picture(common.picture[0])
                : undefined,
            album: common.album ?? "未知专辑",
            url: addFileScheme(filePath),
            localPath: filePath,
            platform: localPluginName,
            id: hash,
            rawLrc: normalizeLocalLyricText(common.lyrics),
        }, filePath, quality, size);
    } catch {
        return applyLocalQualityInfo({
            title: path.parse(filePath).name || filePath,
            id: hash,
            platform: localPluginName,
            localPath: filePath,
            url: addFileScheme(filePath),
            artist: "未知作者",
            album: "未知专辑",
        }, filePath, "320k", size);
    }
}

export async function parseLocalMusicItemFolder(
    folderPath: string,
): Promise<IMusic.IMusicItem[]> {
    /**
   * 1. 筛选出符合条件的
   */

    try {
        const folderStat = await fs.stat(folderPath);
        if (folderStat.isDirectory()) {
            const files = await fs.readdir(folderPath);
            const validFiles = files.filter((fp) =>
                supportLocalMediaType.some((postfix) => fp.endsWith(postfix)),
            );
            // TODO: 分片
            return Promise.all(
                validFiles.map((fp) =>
                    parseLocalMusicItem(path.resolve(folderPath, fp)),
                ),
            );
        }
        throw new Error("Folder Not Found");
    } catch {
        return [];
    }
}

export function addFileScheme(filePath: string) {
    return filePath.startsWith("file:")
        ? filePath
        : url.pathToFileURL(filePath).toString();
}

export function addTailSlash(filePath: string) {
    return filePath.endsWith("/") || filePath.endsWith("\\")
        ? filePath
        : filePath + "/";
}

export async function safeStat(
    path: PathLike,
    opts?: StatOptions,
): Promise<Stats | BigIntStats | null> {
    try {
        return await fs.stat(path, opts);
    } catch {
        return null;
    }
}
