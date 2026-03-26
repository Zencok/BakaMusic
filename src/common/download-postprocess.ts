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
        writeMetadata: false,
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

export function formatLyricsByTimestamp(
    rawLrc: string,
    translation?: string,
    romanization?: string,
    lyricOrder?: DownloadLyricOrderItem[] | null,
    options?: {
        enableWordByWord?: boolean;
    },
) {
    const parser = new LyricParser(rawLrc, {
        translation,
        romanization,
    });
    const parsedItems = parser.getLyricItems();

    if (!parsedItems.length) {
        return "";
    }

    const normalizedOrder = normalizeDownloadLyricOrder(lyricOrder);
    const enableWordByWord = options?.enableWordByWord === true;
    const meta = parser.getMeta();
    const metaLines = ["ti", "ar", "al", "by", "offset"]
        .map((key) => {
            const value = stringifyMetaValue(key, meta[key]);
            return value ? `[${key}:${value}]` : null;
        })
        .filter(Boolean);

    const resultLines: string[] = [];
    if (metaLines.length) {
        resultLines.push(...metaLines, "");
    }

    for (const item of parsedItems) {
        for (const lyricType of normalizedOrder) {
            if (lyricType === "original") {
                const content = item.lrc ?? "";
                if (!content.trim()) {
                    resultLines.push(toLrcTimestamp(item.time));
                    continue;
                }

                if (enableWordByWord && item.hasWordTimeline && item.words?.length) {
                    const line = formatWordByWordLine(item.time, item.words, item.endTime);
                    resultLines.push(line || `${toLrcTimestamp(item.time)}${content}`);
                } else {
                    resultLines.push(`${toLrcTimestamp(item.time)}${content}`);
                }
                continue;
            }

            if (lyricType === "translation") {
                if (item.translation == null || !item.translation.trim()) {
                    continue;
                }
                resultLines.push(`${toLrcTimestamp(item.time)}${item.translation}`);
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
                const line = formatWordByWordLine(
                    item.time,
                    item.romanizationWords,
                    item.romanizationDuration ?? item.endTime,
                );
                resultLines.push(line || `${toLrcTimestamp(item.time)}${item.romanization}`);
            } else {
                resultLines.push(`${toLrcTimestamp(item.time)}${item.romanization}`);
            }
        }
    }

    return resultLines.join("\n").trim();
}

