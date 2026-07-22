import {
    ICommonTagsResult,
    ILyricsTag,
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
import { createLocalArtworkDataUrl } from "./local-artwork";

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

const specialEncoding = ["GB2312"];

const MILLISECOND_TIMESTAMP_FORMAT = 2;
const LRC_TIMELINE_REG = /\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g;
const QRC_TIMELINE_REG = /\[\d+,\d+\]/g;

interface ILocalLyricCandidate {
    text: string;
    priority: number;
    averageLineLength: number;
    timelineCount: number;
}

function normalizeLyricNewlines(lyric: string) {
    return lyric
        .trim()
        .replace(/\r/g, "")
        .replace(/\\r\\n|\\n|\\r/g, "\n");
}

function countTimelineTags(lyric: string) {
    return (lyric.match(LRC_TIMELINE_REG)?.length ?? 0)
        + (lyric.match(QRC_TIMELINE_REG)?.length ?? 0);
}

function createLyricCandidate(text: string, priority: number) {
    const normalizedText = normalizeLyricNewlines(text);
    if (!normalizedText) {
        return null;
    }

    const lines = normalizedText.split("\n").filter(Boolean);
    return {
        text: normalizedText,
        priority,
        averageLineLength: normalizedText.length / Math.max(lines.length, 1),
        timelineCount: countTimelineTags(normalizedText),
    } satisfies ILocalLyricCandidate;
}

function formatLrcTimestamp(timestamp: number) {
    const totalMilliseconds = Math.max(0, Math.round(timestamp));
    const minutes = Math.floor(totalMilliseconds / 60_000);
    const seconds = Math.floor((totalMilliseconds % 60_000) / 1_000);
    const milliseconds = totalMilliseconds % 1_000;

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function createSynchronizedLyricCandidate(lyric: ILyricsTag) {
    const synchronizedLines = lyric.syncText
        ?.map((line) => {
            const text = line.text.trim();
            if (
                lyric.timeStampFormat === MILLISECOND_TIMESTAMP_FORMAT
                && typeof line.timestamp === "number"
                && Number.isFinite(line.timestamp)
            ) {
                return `[${formatLrcTimestamp(line.timestamp)}]${text}`;
            }
            return text;
        })
        .filter(Boolean);

    if (!synchronizedLines?.length) {
        return null;
    }

    const hasMillisecondTimeline =
        lyric.timeStampFormat === MILLISECOND_TIMESTAMP_FORMAT;
    const isLyricContent = lyric.contentType === 1;
    return createLyricCandidate(
        synchronizedLines.join("\n"),
        hasMillisecondTimeline ? (isLyricContent ? 300 : 200) : 100,
    );
}

export function normalizeLocalLyricText(
    lyrics?: Array<string | ILyricsTag> | null,
) {
    const candidates = lyrics
        ?.flatMap((lyric) => {
            if (typeof lyric === "string") {
                const candidate = createLyricCandidate(lyric, 100);
                if (candidate?.timelineCount) {
                    candidate.priority = 400;
                }
                return candidate ? [candidate] : [];
            }

            if (lyric.syncText?.length) {
                // music-metadata mirrors synchronized lyrics into `text` for
                // several containers. Using both duplicates every line, while
                // using `text` alone drops the outer line timestamp.
                const candidate = createSynchronizedLyricCandidate(lyric);
                return candidate ? [candidate] : [];
            }

            const candidate = createLyricCandidate(lyric.text ?? "", 100);
            if (candidate?.timelineCount) {
                // A complete USLT/Vorbis LRC is preferable to syllable-level
                // SYLT entries when a file contains both representations.
                candidate.priority = 400;
            }
            return candidate ? [candidate] : [];
        }) ?? [];

    return candidates.sort((left, right) =>
        right.priority - left.priority
        || right.averageLineLength - left.averageLineLength
        || right.timelineCount - left.timelineCount
        || right.text.length - left.text.length)[0]?.text;
}

export async function parseLocalMusicLyric(filePath: string) {
    try {
        const { common } = await parseFile(normalizeLocalFilePath(filePath), {
            duration: false,
            skipCovers: true,
        });
        return normalizeLocalLyricText(common.lyrics);
    } catch {
        return undefined;
    }
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
                ? await createLocalArtworkDataUrl(common.picture[0])
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
