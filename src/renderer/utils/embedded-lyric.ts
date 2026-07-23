import {
    TTMLGenerator,
    type BackgroundVocal,
    type LyricLine as TtmlLyricLine,
    type Syllable,
    type SubLyricContent,
    type TTMLMetadata,
} from "@applemusic-like-lyrics/ttml";
import type LyricParser from "./lyric-parser";
import type { IParsedLrcItem } from "./lyric-parser";

const DEFAULT_LINE_DURATION_SECONDS = 3;

function toMilliseconds(seconds: number | undefined) {
    return Math.max(0, Math.round((seconds ?? 0) * 1000));
}

function getLineEndTime(line: IParsedLrcItem) {
    const startTime = toMilliseconds(line.time);
    const declaredEndTime = line.endTime !== undefined
        ? toMilliseconds(line.endTime)
        : line.duration !== undefined
            ? startTime + toMilliseconds(line.duration)
            : startTime + DEFAULT_LINE_DURATION_SECONDS * 1000;
    return Math.max(startTime + 1, declaredEndTime);
}

function toSyllable(word: ILyric.IWordData): Syllable {
    const rawText = word.text ?? "";
    const text = rawText.trimEnd();
    const startTime = toMilliseconds(word.startTime);
    const endTime = Math.max(startTime + 1, toMilliseconds(word.endTime));

    return {
        text,
        startTime,
        endTime,
        endsWithSpace: rawText !== text || undefined,
        ruby: word.ruby?.map((ruby) => ({
            text: ruby.text,
            startTime: toMilliseconds(ruby.startTime),
            endTime: Math.max(
                toMilliseconds(ruby.startTime) + 1,
                toMilliseconds(ruby.endTime),
            ),
        })),
        obscene: word.obscene || undefined,
    };
}

function getRomanization(line: IParsedLrcItem): SubLyricContent[] | undefined {
    let words: Syllable[] | undefined;

    if (line.hasRomanizationWordTimeline && line.romanizationWords?.length) {
        words = line.romanizationWords.map(toSyllable);
    } else if (line.hasWordTimeline && line.words?.some((word) => word.romanWord)) {
        words = line.words.flatMap((word) => {
            if (!word.romanWord) {
                return [];
            }
            return [{
                ...toSyllable(word),
                text: word.romanWord,
                endsWithSpace: /\s$/.test(word.romanWord) || undefined,
            }];
        });
    }

    const text = line.romanization?.trim()
        || words?.map((word) => `${word.text}${word.endsWithSpace ? " " : ""}`).join("").trim()
        || "";
    if (!text) {
        return undefined;
    }

    return [{
        text,
        words: words?.length ? words : undefined,
    }];
}

function createLyricBase(line: IParsedLrcItem): BackgroundVocal {
    const startTime = toMilliseconds(line.time);
    const endTime = getLineEndTime(line);

    return {
        text: line.lrc ?? "",
        startTime,
        endTime,
        words: line.hasWordTimeline && line.words?.length
            ? line.words.map(toSyllable)
            : undefined,
        translations: line.translation?.trim()
            ? [{ text: line.translation }]
            : undefined,
        romanizations: getRomanization(line),
    };
}

function normalizeMetadata(meta: Record<string, unknown> | null | undefined) {
    const rawProperties: Record<string, string[]> = {};

    Object.entries(meta ?? {}).forEach(([key, value]) => {
        const values = (Array.isArray(value) ? value : [value])
            .filter((item) => item !== null && item !== undefined && item !== "")
            .map(String);
        if (values.length) {
            rawProperties[key] = values;
        }
    });

    return rawProperties;
}

/**
 * Materialize the currently parsed lyric as TTML before putting it into an
 * audio tag. TTML keeps word timing, translation, romanization, ruby, duet,
 * and background-vocal information in one embedded text value.
 */
export function serializeEmbeddedLyric(
    parser: Pick<LyricParser, "getLyricItems" | "getMeta">,
) {
    const sourceLines = parser.getLyricItems();
    const lines: TtmlLyricLine[] = [];
    let lastMainLine: TtmlLyricLine | undefined;

    sourceLines.forEach((sourceLine, index) => {
        const lyricBase = createLyricBase(sourceLine);

        if (sourceLine.isBG && lastMainLine && !lastMainLine.backgroundVocal) {
            lastMainLine.backgroundVocal = lyricBase;
            return;
        }

        const line: TtmlLyricLine = {
            ...lyricBase,
            id: `L${index + 1}`,
            agentId: sourceLine.isDuet ? "v2" : "v1",
        };
        lines.push(line);
        lastMainLine = line;
    });

    if (!lines.some((line) => line.text.trim() || line.backgroundVocal?.text.trim())) {
        return "";
    }

    const metadata: TTMLMetadata = {
        timingMode: sourceLines.some((line) =>
            line.hasWordTimeline || line.hasRomanizationWordTimeline)
            ? "Word"
            : "Line",
        agents: {
            v1: { id: "v1", type: "person" },
            v2: { id: "v2", type: "person" },
        },
        rawProperties: normalizeMetadata(parser.getMeta()),
    };

    return TTMLGenerator.generate({ lines, metadata })
        // Native browser DOM creates the generator's unqualified TTML child
        // elements in the empty namespace and XMLSerializer emits xmlns="".
        // Those resets make the document unreadable as TTML after embedding.
        .replace(/\sxmlns=""/g, "");
}
