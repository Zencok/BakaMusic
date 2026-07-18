import {
    ICommonTagsResult,
    ILyricsTag,
    IPicture,
    parseFile,
} from "music-metadata";
import path from "path";
import { localPluginName, supportLocalMediaType } from "./constant";
import CryptoJS from "crypto-js";
import fs from "fs/promises";
import url from "url";
import type { BigIntStats, PathLike, StatOptions, Stats } from "original-fs";
import { setInternalData } from "./media-util";
import { mapWithConcurrency } from "./concurrency-util";
import {
    createLocalMediaUrl,
    LOCAL_MEDIA_PROTOCOL,
} from "../shared/local-media/common";

const LOCAL_METADATA_CONCURRENCY = 4;

export function normalizeLocalFilePath(filePath: string) {
    const normalizedPath = path.normalize(path.resolve(filePath));
    if (process.platform !== "win32") {
        return normalizedPath;
    }
    return normalizedPath.replace(/^([a-z]):/, (_match, drive: string) =>
        `${drive.toUpperCase()}:`);
}

export function getLocalPathComparisonKey(filePath: string) {
    const normalizedPath = normalizeLocalFilePath(filePath);
    return process.platform === "win32"
        ? normalizedPath.toLocaleLowerCase("en-US")
        : normalizedPath;
}

function getB64Picture(picture: IPicture) {
    return `data:${picture.format};base64,${Buffer.from(picture.data).toString("base64")}`;
}

const specialEncoding = ["GB2312"];

function normalizeLocalLyricText(lyrics?: Array<string | ILyricsTag> | null) {
    const normalizedLyrics = lyrics
        ?.flatMap((lyric) => {
            if (typeof lyric === "string") {
                return [lyric];
            }

            return [
                lyric.text ?? "",
                ...(lyric.syncText?.map((line) => line.text) ?? []),
            ];
        })
        .map((lyric) => lyric.trim())
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
    const normalizedFilePath = normalizeLocalFilePath(filePath);
    const hash = CryptoJS.MD5(getLocalPathComparisonKey(normalizedFilePath)).toString();
    const size = await getLocalFileSize(normalizedFilePath);
    try {
        const {
            common = {} as ICommonTagsResult,
            format,
        } = await parseFile(normalizedFilePath);
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

            const decodeLegacyText = (value: string) =>
                iconv.decode(Buffer.from(value, "binary"), encoding);

            if (common.title) {
                common.title = iconv.decode(
                    Buffer.from(common.title, "binary"),
                    encoding,
                );
            }
            if (common.artist) {
                common.artist = decodeLegacyText(common.artist);
            }
            if (common.album) {
                common.album = decodeLegacyText(common.album);
            }
            if (common.lyrics) {
                common.lyrics = common.lyrics.map((lyric) => ({
                    ...lyric,
                    ...(lyric.text
                        ? { text: decodeLegacyText(lyric.text) }
                        : {}),
                    syncText: lyric.syncText?.map((line) => ({
                        ...line,
                        text: decodeLegacyText(line.text),
                    })) ?? [],
                }));
            }
        }

        const quality = getLocalAudioQuality(format);
        return applyLocalQualityInfo({
            title: common.title ?? path.parse(normalizedFilePath).name,
            duration,
            artist: common.artist ?? "未知作者",
            artwork: common.picture?.[0]
                ? getB64Picture(common.picture[0])
                : undefined,
            album: common.album ?? "未知专辑",
            url: addFileScheme(normalizedFilePath),
            localPath: normalizedFilePath,
            platform: localPluginName,
            id: hash,
            rawLrc: normalizeLocalLyricText(common.lyrics),
        }, normalizedFilePath, quality, size);
    } catch {
        return applyLocalQualityInfo({
            title: path.parse(normalizedFilePath).name || normalizedFilePath,
            id: hash,
            platform: localPluginName,
            localPath: normalizedFilePath,
            url: addFileScheme(normalizedFilePath),
            artist: "未知作者",
            album: "未知专辑",
        }, normalizedFilePath, "320k", size);
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
                supportLocalMediaType.some((postfix) =>
                    fp.toLocaleLowerCase().endsWith(postfix)),
            );
            return mapWithConcurrency(
                validFiles,
                LOCAL_METADATA_CONCURRENCY,
                (fileName) => parseLocalMusicItem(path.resolve(folderPath, fileName)),
            );
        }
        throw new Error("Folder Not Found");
    } catch {
        return [];
    }
}

export function addFileScheme(filePath: string) {
    if (filePath.startsWith(`${LOCAL_MEDIA_PROTOCOL}:`)) {
        return filePath;
    }
    const localPath = filePath.startsWith("file:")
        ? url.fileURLToPath(filePath)
        : filePath;
    return createLocalMediaUrl(localPath);
}

export async function safeStat(
    path: PathLike,
    opts?: StatOptions,
): Promise<Stats | BigIntStats | null> {
    try {
        const stat = opts === undefined
            ? await fs.stat(path)
            : await fs.stat(path, opts);
        return stat ?? null;
    } catch {
        return null;
    }
}
