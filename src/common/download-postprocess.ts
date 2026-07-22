import LyricParser from "@/renderer/utils/lyric-parser";

export type DownloadLyricOrderItem = "original" | "translation" | "romanization";

export interface IDownloadTagWriteOptions {
    writeMetadata: boolean;
    writeMetadataCover: boolean;
    writeMetadataLyric: boolean;
    downloadLyricFile: boolean;
    lyricFileFormat: "lrc" | "txt";
    lyricOrder: DownloadLyricOrderItem[];
    enableWordByWordLyric: boolean;
}

export interface IDownloadPostprocessMusicItem {
    id: string;
    platform: string;
    title: string;
    artist: string;
    album?: string;
}

export interface IDownloadPostprocessPayload {
    musicItem: IDownloadPostprocessMusicItem;
    coverUrl?: string;
    lyricSource?: ILyric.ILyricSource | null;
    options: IDownloadTagWriteOptions;
}

const defaultLyricOrder: DownloadLyricOrderItem[] = [
    "romanization",
    "original",
    "translation",
];

export function getDefaultDownloadTagWriteOptions(): IDownloadTagWriteOptions {
    return {
        writeMetadata: true,
        writeMetadataCover: true,
        writeMetadataLyric: true,
        downloadLyricFile: false,
        lyricFileFormat: "lrc",
        lyricOrder: [...defaultLyricOrder],
        enableWordByWordLyric: false,
    };
}

export function normalizeDownloadLyricOrder(
    lyricOrder?: DownloadLyricOrderItem[] | null,
) {
    if (!Array.isArray(lyricOrder)) {
        return [...defaultLyricOrder];
    }

    const normalized: DownloadLyricOrderItem[] = [];
    for (const item of lyricOrder) {
        if (
            (item === "original" || item === "translation" || item === "romanization")
            && !normalized.includes(item)
        ) {
            normalized.push(item);
        }
    }
    return normalized;
}

export function hasDownloadPostprocessEnabled(options: IDownloadTagWriteOptions) {
    return options.writeMetadata || options.downloadLyricFile;
}

export function needsLyricForDownloadPostprocess(options: IDownloadTagWriteOptions) {
    return (options.writeMetadata && options.writeMetadataLyric)
        || options.downloadLyricFile;
}

function toLrcTimestamp(seconds: number) {
    const safeSeconds = Math.max(0, seconds || 0);
    const minute = Math.floor(safeSeconds / 60);
    const second = safeSeconds - minute * 60;
    const secondInt = Math.floor(second);
    const millisecond = Math.round((second - secondInt) * 1000);

    return `[${minute.toString().padStart(2, "0")}:${secondInt
        .toString()
        .padStart(2, "0")}.${millisecond.toString().padStart(3, "0")}]`;
}

function toWordTimestamp(seconds: number) {
    return toLrcTimestamp(seconds).slice(1, -1);
}

function formatWordByWordLine(
    lineTime: number,
    words: ILyric.IWordData[],
    fallbackEndTime?: number,
) {
    if (!Array.isArray(words) || words.length === 0) {
        return "";
    }

    let result = toLrcTimestamp(lineTime);
    let lastEndTime = fallbackEndTime ?? lineTime;

    for (const word of words) {
        const text = word?.text ?? "";
        result += `<${toWordTimestamp(word.startTime)}>${text}`;
        lastEndTime = Math.max(lastEndTime, word.endTime ?? word.startTime);
    }

    result += `<${toWordTimestamp(lastEndTime)}>`;
    return result;
}

function stringifyMetaValue(key: string, value: unknown) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    if (key === "offset" && typeof value === "number" && isFinite(value)) {
        return Math.round(value * 1000).toString();
    }

    return String(value);
}

export interface IFormatLyricItemsOptions {
    /** Include enhanced word-by-word timestamps when available */
    enableWordByWord?: boolean;
    /** Keep LRC timestamps (default true). When false, emit plain text lines only. */
    withTimestamp?: boolean;
    meta?: Record<string, unknown> | null;
}

/** Lyric line shape needed for export (compatible with LyricParser items). */
export interface IExportableLyricItem {
    time: number;
    lrc?: string;
    translation?: string | null;
    romanization?: string | null;
    words?: ILyric.IWordData[];
    hasWordTimeline?: boolean;
    endTime?: number;
    romanizationWords?: ILyric.IWordData[];
    hasRomanizationWordTimeline?: boolean;
    romanizationDuration?: number;
}

/**
 * Build export order from lyric display toggles.
 * Original is always included; translation / romanization follow show flags.
 * Relative order prefers download.lyricOrder when provided.
 */
export function resolveLyricExportOrder(options: {
    showTranslation?: boolean;
    showRomanization?: boolean;
    preferredOrder?: DownloadLyricOrderItem[] | null;
}): DownloadLyricOrderItem[] {
    const preferred = normalizeDownloadLyricOrder(options.preferredOrder);
    const allowed = new Set<DownloadLyricOrderItem>(["original"]);
    if (options.showTranslation) {
        allowed.add("translation");
    }
    if (options.showRomanization) {
        allowed.add("romanization");
    }

    const ordered = preferred.filter((item) => allowed.has(item));
    if (!ordered.includes("original")) {
        ordered.unshift("original");
    }
    return ordered;
}

function formatPlainWordLine(words: ILyric.IWordData[] | undefined, fallback: string) {
    if (!words?.length) {
        return fallback;
    }
    return words.map((word) => word?.text ?? "").join("") || fallback;
}

/**
 * Format already-parsed lyric lines into LRC / plain text.
 */
export function formatLyricsFromItems(
    items: IExportableLyricItem[],
    lyricOrder?: DownloadLyricOrderItem[] | null,
    options?: IFormatLyricItemsOptions,
): string {
    if (!Array.isArray(items) || !items.length) {
        return "";
    }

    const normalizedOrder = normalizeDownloadLyricOrder(lyricOrder);
    const enableWordByWord = options?.enableWordByWord === true;
    const withTimestamp = options?.withTimestamp !== false;
    const meta = options?.meta ?? null;

    const resultLines: string[] = [];
    if (withTimestamp && meta) {
        const metaLines = ["ti", "ar", "al", "by", "offset"]
            .map((key) => {
                const value = stringifyMetaValue(key, meta[key]);
                return value ? `[${key}:${value}]` : null;
            })
            .filter((line): line is string => Boolean(line));
        if (metaLines.length) {
            resultLines.push(...metaLines, "");
        }
    }

    for (const item of items) {
        for (const lyricType of normalizedOrder) {
            if (lyricType === "original") {
                const content = item.lrc ?? "";
                if (!content.trim()) {
                    if (withTimestamp) {
                        resultLines.push(toLrcTimestamp(item.time));
                    }
                    continue;
                }

                if (enableWordByWord && item.hasWordTimeline && item.words?.length) {
                    if (withTimestamp) {
                        const line = formatWordByWordLine(item.time, item.words, item.endTime);
                        resultLines.push(line || `${toLrcTimestamp(item.time)}${content}`);
                    } else {
                        resultLines.push(formatPlainWordLine(item.words, content));
                    }
                } else if (withTimestamp) {
                    resultLines.push(`${toLrcTimestamp(item.time)}${content}`);
                } else {
                    resultLines.push(content);
                }
                continue;
            }

            if (lyricType === "translation") {
                if (item.translation == null || !item.translation.trim()) {
                    continue;
                }
                if (withTimestamp) {
                    resultLines.push(`${toLrcTimestamp(item.time)}${item.translation}`);
                } else {
                    resultLines.push(item.translation);
                }
                continue;
            }

            if (item.romanization == null || !item.romanization.trim()) {
                continue;
            }

            if (
                enableWordByWord
                && item.hasRomanizationWordTimeline
                && item.romanizationWords?.length
            ) {
                if (withTimestamp) {
                    const line = formatWordByWordLine(
                        item.time,
                        item.romanizationWords,
                        item.romanizationDuration ?? item.endTime,
                    );
                    resultLines.push(
                        line || `${toLrcTimestamp(item.time)}${item.romanization}`,
                    );
                } else {
                    resultLines.push(
                        formatPlainWordLine(item.romanizationWords, item.romanization),
                    );
                }
            } else if (withTimestamp) {
                resultLines.push(`${toLrcTimestamp(item.time)}${item.romanization}`);
            } else {
                resultLines.push(item.romanization);
            }
        }
    }

    return resultLines.join("\n").trim();
}

export function formatLyricsByTimestamp(
    rawLrc: string,
    translation?: string,
    romanization?: string,
    lyricOrder?: DownloadLyricOrderItem[] | null,
    options?: {
        enableWordByWord?: boolean;
        withTimestamp?: boolean;
    },
) {
    const parser = new LyricParser(rawLrc, {
        translation,
        romanization,
    });

    return formatLyricsFromItems(parser.getLyricItems(), lyricOrder, {
        enableWordByWord: options?.enableWordByWord,
        withTimestamp: options?.withTimestamp,
        meta: parser.getMeta(),
    });
}
