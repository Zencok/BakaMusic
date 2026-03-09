import { PlayerState } from "@/common/constant";
import type { LyricLine, LyricWord } from "@amll-core/interfaces";

const DEFAULT_LINE_DURATION_MS = 3000;
const DEFAULT_FALLBACK_DURATION_MS = 60 * 60 * 1000;

export interface IAmlLyricClockLike {
    anchorProgress: number;
    sentAt: number;
    speed: number;
    playerState: PlayerState;
}

export interface IAmlLyricWordSource {
    text: string;
    startTime: number;
    endTime: number;
}

export interface IAmlLyricLineSource {
    time: number;
    lrc: string;
    translation?: string;
    romanization?: string;
    romanizationWords?: IAmlLyricWordSource[];
    hasRomanizationWordTimeline?: boolean;
    duration?: number;
    endTime?: number;
    words?: IAmlLyricWordSource[];
    hasWordTimeline?: boolean;
}

interface IMapLyricOptions {
    includeTranslation?: boolean;
    includeRomanization?: boolean;
    fallbackDurationMs?: number;
}

function toMs(timeInSeconds = 0) {
    return Math.max(0, Math.round(timeInSeconds * 1000));
}

function getSafeLineEndTimeMs(
    line: IAmlLyricLineSource,
    nextLine?: IAmlLyricLineSource,
    fallbackDurationMs = DEFAULT_LINE_DURATION_MS,
) {
    const startTime = toMs(line.time);
    const declaredEndTime = line.endTime !== undefined
        ? toMs(line.endTime)
        : undefined;
    const declaredDuration = line.duration !== undefined
        ? Math.round(line.duration * 1000)
        : undefined;
    const nextStartTime = nextLine?.time !== undefined ? toMs(nextLine.time) : undefined;

    const fallbackEndTime = nextStartTime !== undefined
        ? Math.min(startTime + fallbackDurationMs, nextStartTime)
        : startTime + fallbackDurationMs;

    const candidate = declaredEndTime
        ?? (declaredDuration !== undefined ? startTime + declaredDuration : undefined)
        ?? fallbackEndTime;

    return Math.max(startTime + 320, candidate);
}

function mapWords(
    line: IAmlLyricLineSource,
    startTime: number,
    endTime: number,
    includeRomanization: boolean,
): LyricWord[] {
    const shouldUseTimedWords = !!line.words?.length && !!line.hasWordTimeline;

    if (shouldUseTimedWords && line.words?.length) {
        const romanWordMap = includeRomanization ? getRomanWordMap(line) : null;

        return line.words.map((word, index) => {
            const romanWord = romanWordMap?.get(index) ?? "";

            return {
                word: word.text,
                startTime: toMs(word.startTime),
                endTime: Math.max(toMs(word.startTime) + 120, toMs(word.endTime)),
                romanWord: romanWord || undefined,
                obscene: false,
            };
        });
    }

    return [{
        word: line.lrc || " ",
        startTime,
        endTime,
        obscene: false,
    }];
}

function getRomanWordMap(line: IAmlLyricLineSource) {
    if (!line.hasRomanizationWordTimeline || !line.words?.length || !line.romanizationWords?.length) {
        return null;
    }

    const lyricWordIndexes = line.words
        .map((word, index) => ({
            index,
            text: word.text,
        }))
        .filter((word) => word.text.trim().length > 0);
    const romanWords = line.romanizationWords
        .map((word) => word.text.replace(/\s+/g, " ").trim())
        .filter((word) => word.length > 0);

    if (!lyricWordIndexes.length || lyricWordIndexes.length !== romanWords.length) {
        return null;
    }

    const romanWordMap = new Map<number, string>();
    lyricWordIndexes.forEach((word, index) => {
        romanWordMap.set(word.index, romanWords[index]);
    });
    return romanWordMap;
}

export function mapLyricLinesToAml(
    lines?: IAmlLyricLineSource[] | null,
    options: IMapLyricOptions = {},
) {
    const {
        includeTranslation = true,
        includeRomanization = true,
        fallbackDurationMs = DEFAULT_LINE_DURATION_MS,
    } = options;

    if (!lines?.length) {
        return [] as LyricLine[];
    }

    const mappedLines: LyricLine[] = [];

    lines.forEach((line, index) => {
        const text = line.lrc?.trim?.() ?? "";
        if (!text && !line.translation?.trim?.() && !line.romanization?.trim?.()) {
            return;
        }

        const startTime = toMs(line.time);
        const endTime = getSafeLineEndTimeMs(lines[index], lines[index + 1], fallbackDurationMs);
        const words = mapWords(line, startTime, endTime, includeRomanization);
        const hasWordLevelRomanization = words.some((word) =>
            (word.romanWord?.trim().length ?? 0) > 0,
        );

        mappedLines.push({
            words,
            translatedLyric: includeTranslation ? (line.translation ?? "") : "",
            romanLyric: includeRomanization && !hasWordLevelRomanization
                ? (line.romanization ?? "")
                : "",
            startTime,
            endTime,
            isBG: false,
            isDuet: false,
        });
    });

    return mappedLines;
}

export function createFallbackAmlLyricLines(musicItem?: Pick<IMusic.IMusicItem, "title" | "artist"> | null) {
    const primaryText = musicItem?.title?.trim?.() || "暂无歌词";
    const secondaryText = musicItem?.artist?.trim?.() || "BakaMusic";

    return [
        {
            words: [{
                word: primaryText,
                startTime: 0,
                endTime: DEFAULT_FALLBACK_DURATION_MS,
                obscene: false,
            }],
            translatedLyric: secondaryText,
            romanLyric: "",
            startTime: 0,
            endTime: DEFAULT_FALLBACK_DURATION_MS,
            isBG: false,
            isDuet: false,
        },
    ] satisfies LyricLine[];
}

export function estimateLyricClockProgressMs(
    clock?: IAmlLyricClockLike | null,
    maxExtrapolationMs = 500,
) {
    if (!clock) {
        return 0;
    }

    const anchorProgressMs = clock.anchorProgress * 1000;
    if (clock.playerState !== PlayerState.Playing) {
        return anchorProgressMs;
    }

    const elapsedMs = Date.now() - clock.sentAt;
    const clampedElapsedMs = Math.min(elapsedMs, maxExtrapolationMs);
    return anchorProgressMs + clampedElapsedMs * (clock.speed || 1);
}
