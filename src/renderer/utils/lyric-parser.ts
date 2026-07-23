/**
 * 多格式歌词解析器
 * 支持 AMLL lyric/ttml 的 TTML、LRC、LRC A2、YRC、QRC、
 * ESLyric、LYL、LYS、LQE，以及兼容旧插件的混合时间戳和纯文本。
 */

import {
    parseEslrc,
    parseLqe,
    parseLrc,
    parseLrcA2,
    parseLyl,
    parseLys,
    parseQrc,
    parseYrc,
    type LyricLine as AmlLyricLine,
} from "@applemusic-like-lyrics/lyric";
import {
    TTMLParser,
    toAmllLyrics,
    type AmllLyricLine,
} from "@applemusic-like-lyrics/ttml";

type LyricMeta = Record<string, any>;
type LegacyLyricFormat = "qrc" | "angle" | "word-lrc" | "inline-word-lrc" | "lrc" | "plain";

interface IOptions {
    musicItem?: IMusic.IMusicItem;
    format?: ILyric.LyricFormat;
    translation?: string;
    romanization?: string;
}

interface IParsedLyricContent {
    items: IParsedLrcItem[];
    meta?: LyricMeta;
    preserveVocalLayout?: boolean;
}

type AmlLyricLineLike = AmlLyricLine | AmllLyricLine;

export interface IParsedLrcItem {
    /** 时间 s */
    time: number;
    /** 歌词 */
    lrc: string;
    /** 翻译 */
    translation?: string;
    /** 罗马音 */
    romanization?: string;
    /** 罗马音逐字数据 */
    romanizationWords?: ILyric.IWordData[];
    /** 罗马音是否有逐字时间轴 */
    hasRomanizationWordTimeline?: boolean;
    /** 罗马音行时长（秒） */
    romanizationDuration?: number;
    /** 位置 */
    index: number;
    /** 行结束时间（秒） */
    endTime?: number;
    /** 行时长（秒） */
    duration?: number;
    /** 逐字时间轴 */
    words?: ILyric.IWordData[];
    /** 是否具备真实逐字数据 */
    hasWordTimeline?: boolean;
    /** 是否为伪逐字（均分生成） */
    isVirtualWords?: boolean;
    /** 是否为附着在上一主歌词行的背景人声 */
    isBG?: boolean;
    /** 是否为第二演唱者（AMLL 右对齐行） */
    isDuet?: boolean;
    /** 是否为从主歌词括号中拆出的同时演唱行 */
    isDuetPartner?: boolean;
    /** 原始行是否带有已识别的演唱者标签 */
    hasSingerLabel?: boolean;
}

export interface IActiveLyricState {
    line: IParsedLrcItem | null;
    lineIndex: number;
    lineProgress: number;
    word: ILyric.IWordData | null;
    wordIndex: number;
    wordProgress: number;
}

// ============ 格式检测 ============

const QRC_LINE_REG = /\[\d+,\d+\]/;
const QRC_WORD_REG = /\(\d+,\d+(?:,\d+)?\)/;
const ANGLE_REG = /\[\d{2}:\d{2}(?:\.\d{2,3})?\]\s*<\d{2}:\d{2}/;
const WORD_LRC_REG = /\[\d{2}:\d{2}(?:\.\d{2,3})?\][^[\r\n]+\[\d{2}:\d{2}(?:\.\d{2,3})?\]/;
const WORD_LRC_ENTRY_REG = /\[(\d{2}:\d{2}(?:\.\d{2,3})?)\]([^[\r\n]*)/g;
const INLINE_WORD_TIME_REG = /\[[\d:.]+\][^\r\n]*\(\d+,\d+(?:,\d+)?\)/;
const LRC_TIME_REG = /\[\d{2}:\d{2}(?:\.\d{2,3})?\]/;
const TTML_REG = /<(?:[a-zA-Z][\w.-]*:)?tt(?:\s|>)/i;
const LQE_REG = /^\s*\[Lyricify Quick Export\]/i;
const LYL_REG = /^\s*\[type:LyricifyLines\]/im;
const LYS_REG = /^\s*\[[0-8]\].+?\(\d+,\d+\)/m;
const YRC_WORD_REG = /\(\d+,\d+,0\)/;
const META_REG = /\[([a-zA-Z]+):([^\]]+)\]/g;
const PARALLEL_LINE_EPSILON = 0.03;
const LYRIC_FIELD_DIRECT_EPSILON = 0.3;
const LYRIC_FIELD_ANCHOR_EPSILON = 1;
const LYRIC_FIELD_ANCHOR_DURATION_RATIO = 0.4;
const LYRIC_FIELD_ANCHOR_SCAN_LIMIT = 5;
const HAN_REG = /[\u3400-\u9fff\uf900-\ufaff]/;
const KANA_REG = /[\u3040-\u30ff\u31f0-\u31ff]/;
const HANGUL_REG = /[\uac00-\ud7af]/;
const LATIN_REG = /[A-Za-z\u00c0-\u024f]/;
const CREDIT_LINE_REG = /^(?:(?:作)?词|(?:作)?詞|曲|作曲|编曲|編曲|词曲|詞曲|原唱|演唱|歌手|制作(?:人)?|製作(?:人)?|出品|发行|發行|策划|策劃|统筹|統籌|监制|監製|导演|導演|混音|母带|母帶|录音|錄音|和声|和聲|翻唱|原曲|歌名|歌曲|专辑|專輯|标题|標題|调教|調教|调声|調聲|曲绘|曲繪|曲絵|绘图|繪圖|画师|畫師|视频|視頻|映像|动画|動畫|written\s+by|vocal|lyrics?|lyricist|composer|music|arrange(?:r|ment)?|producer|produced\s+by|mix|master(?:ing)?|recording|staff|pv|mv|movie|video|animation|illustration|illustrator)\s*[:：]/i;
const NON_SPEAKER_LABEL_REG = /^(?:制作|出品|发行|發行|策划|策劃|监制|監製|混音|母带|母帶|录音|錄音|和声|和聲|翻唱|原曲|歌名|歌曲|专辑|專輯|标题|標題|调教|調教|调声|調聲|曲绘|曲繪|曲絵|绘图|繪圖|画师|畫師|视频|視頻|映像|动画|動畫|artist|album|title|producer|produced\s+by|mix|master(?:ing)?|staff|pv|mv|movie|video|animation|illustration|illustrator)$/i;
const GROUP_SPEAKER_NAMES = new Set([
    "all",
    "chorus",
    "duet",
    "together",
    "合",
    "合唱",
    "齐唱",
    "齊唱",
]);
const PARENTHETICAL_VOCAL_REG = /[（(]([^()（）\r\n]+)[)）]/g;
const GENERIC_LABEL_PREFIX_REG = /^\s*[^:：\r\n]{1,24}\s*[:：]/;
const LEADING_CREDIT_WINDOW_SECONDS = 30;
const LEADING_NAME_DURATION_SECONDS = 0.8;
const DUET_TURN_GAP_SECONDS = 0.12;
const ROMANIZATION_HINT_REG = /(?:shi|chi|tsu|kyo|kyu|kya|ryo|ryu|rya|sho|shu|sha|cho|chu|cha|jyo|jyu|jya|dzu|desu|boku|kimi|kono|sono|ano|yume|sora|kokoro|namida|hikari|kaze|hana|machi|sekai|mirai|hoshi|koe|uta|sarang|hae)/i;
const CREDIT_ROMANIZATION_PREFIXES = new Set([
    "shi",
    "ci",
    "zuo ci",
    "saku shi",
    "sakushi",
    "kyo ku",
    "kyoku",
    "qu",
    "zuo qu",
    "sa kyo ku",
    "sa k kyo ku",
    "sa kkyoku",
    "sakkyoku",
    "he n kyo ku",
    "he n kyoku",
    "hen kyo ku",
    "henkyoku",
    "bian qu",
]);
const COMMON_ENGLISH_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "be",
    "but",
    "for",
    "from",
    "hello",
    "i",
    "in",
    "is",
    "it",
    "love",
    "me",
    "my",
    "of",
    "on",
    "that",
    "the",
    "this",
    "to",
    "we",
    "with",
    "world",
    "you",
    "your",
]);
const PINYIN_INITIAL_REG = /^(?:b|p|m|f|d|t|n|l|g|k|h|j|q|x|zh|ch|sh|r|z|c|s)?/;
const PINYIN_FINALS = new Set([
    "a",
    "o",
    "e",
    "ai",
    "ei",
    "ao",
    "ou",
    "an",
    "en",
    "ang",
    "eng",
    "ong",
    "i",
    "ia",
    "ie",
    "iao",
    "iu",
    "ian",
    "in",
    "iang",
    "ing",
    "iong",
    "u",
    "ua",
    "uo",
    "uai",
    "ui",
    "uan",
    "un",
    "uang",
    "ue",
    "ve",
    "er",
]);
const PINYIN_SPECIAL_SYLLABLES = new Set([
    "zhi",
    "chi",
    "shi",
    "ri",
    "zi",
    "ci",
    "si",
    "yi",
    "yin",
    "ying",
    "wu",
    "yu",
    "yue",
    "yuan",
    "yun",
    "ye",
    "yao",
    "you",
    "yang",
    "yong",
    "wa",
    "wai",
    "wan",
    "wang",
    "wei",
    "wen",
    "weng",
    "wo",
]);

interface ITextScriptStats {
    han: number;
    kana: number;
    hangul: number;
    latin: number;
    script: number;
}

interface ICollapseParallelResult {
    items: IParsedLrcItem[];
    hasTranslation: boolean;
    hasRomanization: boolean;
}

interface ILyricFieldAnchor {
    baseIndex: number;
    sourceIndex: number;
}

interface INeteaseJsonLyricItem {
    time: number;
    lrc: string;
}

function isMetaLine(line: string) {
    return /^\[[a-zA-Z]+:/.test(line.trim());
}

function parseNeteaseJsonLyricLine(line: string): INeteaseJsonLyricItem | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        return null;
    }

    try {
        const data = JSON.parse(trimmed);
        const time = typeof data?.t === "number"
            ? data.t / 1000
            : Number.NaN;
        if (!Number.isFinite(time) || !Array.isArray(data?.c)) {
            return null;
        }

        const lrc = data.c
            .map((word: { tx?: unknown }) => (
                typeof word?.tx === "string" ? word.tx : ""
            ))
            .join("")
            .trim();
        if (!lrc) {
            return null;
        }

        return { time, lrc };
    } catch {
        return null;
    }
}

function containsWordLrc(raw: string) {
    return raw.split(/\r?\n/).some((line) => {
        const trimmed = line.trim();
        return !!trimmed && !isMetaLine(trimmed) && WORD_LRC_REG.test(trimmed);
    });
}

function isCommentLyricLine(line: string) {
    const trimmed = line.trim();
    return /^\[[\d:.]+\]\/\//.test(trimmed) || /^\[\d+,\d+\]\/\//.test(trimmed);
}

function sanitizeLyricRaw(raw: string) {
    return raw
        .split(/\r?\n/)
        .filter((line) => !isCommentLyricLine(line))
        .join("\n");
}

function normalizeRawLyricText(raw: string) {
    return raw
        .replace(/\r/g, "")
        .replace(/\\r\\n|\\n|\\r/g, "\n");
}

function detectLyricFormat(raw: string): LegacyLyricFormat {
    if (QRC_LINE_REG.test(raw) && QRC_WORD_REG.test(raw)) return "qrc";
    if (ANGLE_REG.test(raw)) return "angle";
    if (containsWordLrc(raw)) return "word-lrc";
    if (INLINE_WORD_TIME_REG.test(raw)) return "inline-word-lrc";
    if (LRC_TIME_REG.test(raw)) return "lrc";
    return "plain";
}

function detectAmlLyricFormat(
    raw: string,
    hint?: ILyric.LyricFormat,
): ILyric.LyricFormat | null {
    if (TTML_REG.test(raw)) return "ttml";
    if (LQE_REG.test(raw)) return "lqe";
    if (LYL_REG.test(raw)) return "lyl";
    if (YRC_WORD_REG.test(raw) && QRC_LINE_REG.test(raw)) return "yrc";
    if (QRC_LINE_REG.test(raw) && QRC_WORD_REG.test(raw)) {
        return hint === "lys" ? "lys" : "qrc";
    }
    if (LYS_REG.test(raw)) return hint === "lqe" ? "lqe" : "lys";
    if (ANGLE_REG.test(raw)) return "lrc-a2";
    if (containsWordLrc(raw)) return "eslrc";
    if (LRC_TIME_REG.test(raw)) {
        if (hint === "eslrc" || hint === "lrc-a2") {
            return hint;
        }
        return "lrc";
    }
    if (hint && hint !== "plain") return hint;
    return null;
}

function compactAmlWords(words: AmlLyricLineLike["words"]) {
    const compacted: typeof words = [];
    let leadingSpace = "";

    words.forEach((word) => {
        if (!word.word.trim()) {
            if (compacted.length) {
                compacted[compacted.length - 1].word += word.word;
            } else {
                leadingSpace += word.word;
            }
            return;
        }

        compacted.push({
            ...word,
            word: `${leadingSpace}${word.word}`,
        });
        leadingSpace = "";
    });

    if (leadingSpace && compacted.length) {
        compacted[compacted.length - 1].word += leadingSpace;
    }
    return compacted;
}

function convertAmlLyricLines(
    lines: AmlLyricLineLike[],
    hasWordTimeline: boolean,
): IParsedLrcItem[] {
    return lines.map((line, index) => {
        const sourceWords = compactAmlWords(line.words);
        const words = sourceWords.map((word, wordIndex): ILyric.IWordData => {
            const startTime = word.startTime / 1000;
            const endTime = Math.max(startTime, word.endTime / 1000);
            return {
                text: word.word,
                startTime,
                duration: endTime - startTime,
                endTime,
                index: wordIndex,
                space: !word.word.trim(),
                romanWord: word.romanWord || undefined,
                ruby: "ruby" in word
                    ? word.ruby?.map((ruby) => ({
                        text: ruby.word,
                        startTime: ruby.startTime / 1000,
                        endTime: ruby.endTime / 1000,
                    }))
                    : undefined,
                obscene: "obscene" in word ? word.obscene : undefined,
            };
        });
        const lrc = words.map((word) => word.text).join("");
        const startTime = line.startTime / 1000;
        const hasOpenEndedLine = !hasWordTimeline && line.endTime >= 60_000_000;
        const endTime = hasOpenEndedLine
            ? undefined
            : Math.max(startTime, line.endTime / 1000);
        const wordRomanization = sourceWords
            .map((word) => word.romanWord ?? "")
            .join("")
            .trim();
        const hasUsableWordTimeline = hasWordTimeline
            && sourceWords.some((word) => word.endTime > word.startTime);

        return {
            time: startTime,
            endTime,
            duration: endTime === undefined ? undefined : endTime - startTime,
            lrc,
            translation: line.translatedLyric || undefined,
            romanization: line.romanLyric || wordRomanization || undefined,
            index,
            words: words.length ? words : undefined,
            hasWordTimeline: hasUsableWordTimeline && words.length > 0,
            isBG: line.isBG,
            isDuet: line.isDuet,
        };
    }).filter((line) => !!line.lrc.trim());
}

function parseWithAmlLibraries(
    raw: string,
    hint?: ILyric.LyricFormat,
): IParsedLyricContent | null {
    const format = detectAmlLyricFormat(raw, hint);
    if (!format) {
        return null;
    }

    try {
        if (format === "ttml") {
            // Repair TTML emitted by browser XMLSerializer when a generator
            // created child elements without an explicit namespace. Removing
            // the empty reset lets them inherit the root TTML namespace.
            const normalizedTtml = raw.replace(/\sxmlns=(?:""|'')/g, "");
            const ttmlResult = TTMLParser.parse(normalizedTtml);
            const amllResult = toAmllLyrics(ttmlResult);
            const meta = Object.fromEntries(amllResult.metadata.map(([key, values]) => [
                key,
                values.length === 1 ? values[0] : values,
            ]));
            const hasWordTimeline = ttmlResult.metadata.timingMode === "Word"
                || amllResult.lines.some((line) => line.words.length > 1);
            const items = convertAmlLyricLines(amllResult.lines, hasWordTimeline);
            const ttmlLyricBases = ttmlResult.lines.flatMap((line) => [
                line,
                ...(line.backgroundVocal ? [line.backgroundVocal] : []),
            ]);
            items.forEach((item, index) => {
                const romanization = ttmlLyricBases[index]?.romanizations?.[0]?.text;
                if (romanization?.trim()) {
                    // toAmllLyrics aligns word-level romanization onto words and
                    // drops syllable spacing. Keep the source's complete text too.
                    item.romanization = romanization;
                }
            });
            return {
                items,
                meta,
                preserveVocalLayout: true,
            };
        }

        let lines: AmlLyricLine[];
        switch (format) {
            case "lrc-a2":
                lines = parseLrcA2(raw);
                break;
            case "yrc":
                lines = parseYrc(raw);
                break;
            case "qrc":
                lines = parseQrc(raw);
                break;
            case "eslrc":
                lines = parseEslrc(raw);
                break;
            case "lyl":
                lines = parseLyl(raw);
                break;
            case "lys":
                lines = parseLys(raw);
                break;
            case "lqe":
                lines = parseLqe(raw);
                break;
            default:
                lines = parseLrc(raw);
        }

        if (!lines.length) {
            return null;
        }
        const hasNativeVocalLayout = lines.some((line) => line.isBG || line.isDuet);
        return {
            items: convertAmlLyricLines(
                lines,
                !["lrc", "lyl"].includes(format),
            ),
            preserveVocalLayout: ["lqe", "lys"].includes(format)
                || hasNativeVocalLayout,
        };
    } catch {
        return format === "ttml"
            ? { items: [], preserveVocalLayout: true }
            : null;
    }
}

// ============ 工具函数 ============

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** [mm:ss.xx] => seconds */
function parseTimeTag(tag: string): number {
    const inner = tag.replace(/[[\]<>]/g, "");
    const parts = inner.split(":");
    let result = 0;
    for (let i = 0; i < parts.length; i++) {
        result = result * 60 + parseFloat(parts[i]);
    }
    return result;
}

/** seconds => [mm:ss.xx] */
function timeToLrcTag(sec: number): string {
    const min = Math.floor(sec / 60);
    sec = sec - min * 60;
    const secInt = Math.floor(sec);
    const secFloat = sec - secInt;
    return `[${min.toFixed(0).padStart(2, "0")}:${secInt
        .toString()
        .padStart(2, "0")}.${secFloat.toFixed(2).slice(2)}]`;
}

function parseMeta(raw: string): LyricMeta {
    const meta: LyricMeta = {};
    let match: RegExpExecArray | null;
    const reg = new RegExp(META_REG.source, "g");
    while ((match = reg.exec(raw)) !== null) {
        const k = match[1];
        const v = match[2];
        if (k === "offset") {
            meta[k] = parseFloat(v) / 1000;
        } else {
            meta[k] = v;
        }
    }
    return meta;
}

/** 提取元数据行之前的文本 */
function extractMetaPrefix(raw: string): string {
    const lines = raw.split("\n");
    const metaLines: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^\[[a-zA-Z]+:/.test(trimmed)) {
            metaLines.push(trimmed);
        } else {
            break;
        }
    }
    return metaLines.join("\n");
}

function createTimedWord(
    text: string,
    startMs: number,
    durationMs: number,
    index: number,
): ILyric.IWordData {
    const startTime = startMs / 1000;
    const duration = Math.max(0, durationMs / 1000);

    return {
        text,
        startTime,
        duration,
        endTime: startTime + duration,
        index,
        space: !text.trim(),
    };
}

function parsePrefixedTimedWords(body: string): ILyric.IWordData[] {
    const words: ILyric.IWordData[] = [];
    const wordRegex = /([^()]*)\((\d+),(\d+)(?:,\d+)?\)/g;
    let wordMatch: RegExpExecArray | null;

    while ((wordMatch = wordRegex.exec(body)) !== null) {
        const text = wordMatch[1];
        if (!text) {
            continue;
        }

        words.push(createTimedWord(
            text,
            parseInt(wordMatch[2]),
            parseInt(wordMatch[3]),
            words.length,
        ));
    }

    return words;
}

function parsePostfixedTimedWords(body: string): ILyric.IWordData[] {
    const words: ILyric.IWordData[] = [];
    const wordRegex = /\((\d+),(\d+)(?:,\d+)?\)([^()]*)/g;
    let wordMatch: RegExpExecArray | null;

    while ((wordMatch = wordRegex.exec(body)) !== null) {
        const text = wordMatch[3];
        if (!text) {
            continue;
        }

        words.push(createTimedWord(
            text,
            parseInt(wordMatch[1]),
            parseInt(wordMatch[2]),
            words.length,
        ));
    }

    return words;
}

function joinWordText(words: ILyric.IWordData[]) {
    return words.map((word) => word.text).join("");
}

function shouldUseRelativeAngleWordTime(
    lineStart: number,
    wordEntries: Array<{ time: number; text: string }>,
) {
    if (lineStart <= 0 || !wordEntries.length) {
        return false;
    }

    const firstWordTime = wordEntries[0].time;
    const lastWordTime = wordEntries[wordEntries.length - 1].time;

    return firstWordTime <= 0.01
        || (
            firstWordTime < lineStart - 0.5
            && lastWordTime < lineStart + 0.5
        );
}

// ============ QRC 格式解析 ============
// 格式: [lineStartMs,lineDurMs]text(wordStartMs,wordDurMs)... 或 [lineStartMs,lineDurMs](wordStartMs,wordDurMs,0)text...

function parseQrcLyric(raw: string): IParsedLrcItem[] {
    const items: IParsedLrcItem[] = [];
    const lineRegex = /\[(\d+),(\d+)\]([\s\S]*?)(?=\[\d+,\d+\]|$)/g;
    let lineMatch: RegExpExecArray | null;
    let idx = 0;

    while ((lineMatch = lineRegex.exec(raw)) !== null) {
        const lineStartMs = parseInt(lineMatch[1]);
        const lineDurMs = parseInt(lineMatch[2]);
        const body = lineMatch[3] || "";

        const words = body.trim().startsWith("(")
            ? parsePostfixedTimedWords(body)
            : parsePrefixedTimedWords(body);
        const fullText = joinWordText(words);

        if (!fullText.trim()) continue;

        const lineStart = lineStartMs / 1000;
        const lineDur = lineDurMs / 1000;

        items.push({
            time: lineStart,
            endTime: lineStart + lineDur,
            duration: lineDur,
            lrc: fullText,
            index: idx++,
            words: words.length > 0 ? words : undefined,
            hasWordTimeline: words.length > 0,
        });
    }

    return items;
}

// ============ 尖括号格式解析 ============
// 格式: [mm:ss.xxx]<mm:ss.xxx>text<mm:ss.xxx>text...<mm:ss.xxx>

function parseAngleLyric(raw: string): IParsedLrcItem[] {
    const items: IParsedLrcItem[] = [];
    const lines = raw.split("\n");
    let idx = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // 提取行时间标签
        const lineTimeMatch = trimmed.match(/^\[(\d{2}:\d{2}(?:\.\d{2,3})?)\]/);
        if (!lineTimeMatch) continue;

        const lineStart = parseTimeTag(`[${lineTimeMatch[1]}]`);
        const afterLineTag = trimmed.slice(lineTimeMatch[0].length);

        // 解析尖括号词: <time>text<time>text...<endTime>
        const words: ILyric.IWordData[] = [];
        let fullText = "";
        let wIdx = 0;

        const angleRegex = /<(\d{2}:\d{2}(?:\.\d{2,3})?)>([^<]*)/g;
        let angleMatch: RegExpExecArray | null;
        const wordEntries: { time: number; text: string }[] = [];

        while ((angleMatch = angleRegex.exec(afterLineTag)) !== null) {
            const time = parseTimeTag(`<${angleMatch[1]}>`);
            const text = angleMatch[2];
            wordEntries.push({ time, text });
        }

        const useRelativeWordTime = shouldUseRelativeAngleWordTime(lineStart, wordEntries);
        if (useRelativeWordTime) {
            wordEntries.forEach((entry) => {
                entry.time += lineStart;
            });
        }

        // 最后一个尖括号可能是结束时间（无文本）
        const trailingTimeMatch = afterLineTag.match(/<(\d{2}:\d{2}(?:\.\d{2,3})?)>\s*$/);
        let lineEndTime = trailingTimeMatch
            ? parseTimeTag(`<${trailingTimeMatch[1]}>`)
            : undefined;
        if (lineEndTime !== undefined && useRelativeWordTime) {
            lineEndTime += lineStart;
        }

        for (let i = 0; i < wordEntries.length; i++) {
            const entry = wordEntries[i];
            if (!entry.text) continue;

            const startTime = entry.time;
            const nextTime = wordEntries[i + 1]?.time ?? lineEndTime ?? startTime + 0.5;
            const duration = nextTime - startTime;

            words.push({
                text: entry.text,
                startTime,
                duration: Math.max(0, duration),
                endTime: startTime + Math.max(0, duration),
                index: wIdx++,
            });
            fullText += entry.text;
        }

        if (!fullText.trim()) continue;

        const lastWord = words[words.length - 1];
        const endTime = lastWord ? lastWord.endTime : lineStart + 3;

        items.push({
            time: lineStart,
            endTime,
            duration: endTime - lineStart,
            lrc: fullText,
            index: idx++,
            words: words.length > 0 ? words : undefined,
            hasWordTimeline: words.length > 0,
        });
    }

    return items;
}

// ============ 行内逐字 LRC 格式解析 ============
// 格式: [mm:ss.xxx]字(offsetMs,durationMs)字(offsetMs,durationMs)...

function parseInlineWordTimeLrcLyric(raw: string): IParsedLrcItem[] {
    const items: IParsedLrcItem[] = [];
    const lines = raw.split("\n");
    let idx = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || isMetaLine(trimmed)) {
            continue;
        }

        const lineTimeMatch = trimmed.match(/^\[(\d{2}:\d{2}(?:\.\d{2,3})?)\]/);
        if (!lineTimeMatch) {
            continue;
        }

        const lineStart = parseTimeTag(`[${lineTimeMatch[1]}]`);
        const lineStartMs = Math.round(lineStart * 1000);
        const body = trimmed.slice(lineTimeMatch[0].length);
        const words = parsePrefixedTimedWords(body).map((word, index) => {
            const startTime = word.startTime + lineStart;
            return {
                ...word,
                startTime,
                endTime: startTime + word.duration,
                index,
            };
        });
        const fullText = joinWordText(words);

        if (!fullText.trim()) {
            continue;
        }

        const lastWord = words[words.length - 1];
        const endTime = lastWord?.endTime ?? (lineStartMs + 3000) / 1000;

        items.push({
            time: lineStart,
            endTime,
            duration: endTime - lineStart,
            lrc: fullText,
            index: idx++,
            words,
            hasWordTimeline: words.length > 0,
        });
    }

    return items.sort((a, b) => a.time - b.time);
}

// ============ 逐字 LRC 格式解析 ============
// 格式: [mm:ss.xxx]字[mm:ss.xxx]字...[mm:ss.xxx]

function parseWordLrcLyric(raw: string): IParsedLrcItem[] {
    const items: IParsedLrcItem[] = [];
    const lines = raw.split("\n");
    let idx = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || isMetaLine(trimmed)) {
            continue;
        }

        if (WORD_LRC_REG.test(trimmed)) {
            const entries: { time: number; text: string }[] = [];
            let match: RegExpExecArray | null;

            WORD_LRC_ENTRY_REG.lastIndex = 0;
            while ((match = WORD_LRC_ENTRY_REG.exec(trimmed)) !== null) {
                entries.push({
                    time: parseTimeTag(`[${match[1]}]`),
                    text: match[2] ?? "",
                });
            }

            if (!entries.length) {
                continue;
            }

            const words: ILyric.IWordData[] = [];
            let fullText = "";

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (!entry.text) {
                    continue;
                }

                const nextTime = entries[i + 1]?.time ?? entry.time + 0.5;
                const duration = Math.max(0, nextTime - entry.time);

                words.push({
                    text: entry.text,
                    startTime: entry.time,
                    duration,
                    endTime: entry.time + duration,
                    index: words.length,
                    space: !entry.text.trim(),
                });
                fullText += entry.text;
            }

            if (!fullText.trim()) {
                continue;
            }

            const lineStart = words[0]?.startTime ?? entries[0].time;
            const lineEnd = words[words.length - 1]?.endTime ?? Math.max(lineStart + 0.5, entries[entries.length - 1].time);

            items.push({
                time: lineStart,
                endTime: lineEnd,
                duration: lineEnd - lineStart,
                lrc: fullText,
                index: idx++,
                words,
                hasWordTimeline: words.length > 0,
            });
            continue;
        }

        const timeTags = trimmed.match(LRC_TIME_REG) ?? [];
        if (!timeTags.length) {
            continue;
        }

        const lrc = trimmed.replace(new RegExp(LRC_TIME_REG.source, "g"), "").trim();
        timeTags.forEach((tag) => {
            items.push({
                time: parseTimeTag(tag),
                lrc,
                index: idx++,
            });
        });
    }

    return items.sort((a, b) => a.time - b.time);
}

// ============ 标准 LRC 解析 ============

function parseLrcLyric(raw: string): IParsedLrcItem[] {
    const timeReg = /\[[\d:.]+\]/g;
    const items: IParsedLrcItem[] = [];
    let idx = 0;

    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || isMetaLine(trimmed) || isCommentLyricLine(trimmed)) {
            continue;
        }

        const jsonLyricItem = parseNeteaseJsonLyricLine(trimmed);
        if (jsonLyricItem) {
            items.push({
                time: jsonLyricItem.time,
                lrc: jsonLyricItem.lrc,
                index: idx++,
            });
            continue;
        }

        const rawTimes = trimmed.match(timeReg) ?? [];
        if (!rawTimes.length) {
            continue;
        }

        const lrc = trimmed.replace(timeReg, "").trim();
        for (const rawTime of rawTimes) {
            items.push({
                time: parseTimeTag(rawTime),
                lrc,
                index: idx++,
            });
        }
    }

    return items.sort((a, b) => a.time - b.time);
}

// ============ 纯文本解析 ============

function parsePlainTextLyric(raw: string): IParsedLrcItem[] {
    const SECONDS_PER_LINE = 3;
    return raw
        .split("\n")
        .filter((l) => l.trim())
        .map((line, index) => ({
            time: index * SECONDS_PER_LINE,
            endTime: (index + 1) * SECONDS_PER_LINE,
            duration: SECONDS_PER_LINE,
            lrc: line.trim(),
            index,
        }));
}

function parseLyricItemsByFormat(
    raw: string,
    hint?: ILyric.LyricFormat,
): IParsedLyricContent {
    raw = sanitizeLyricRaw(normalizeRawLyricText(raw));
    const amlFormat = detectAmlLyricFormat(raw, hint);
    const amlParsed = parseWithAmlLibraries(raw, hint);
    if (amlParsed) {
        if (amlFormat === "eslrc") {
            const compatibleItems = parseMixedTimestampLyric(raw);
            if (compatibleItems.length > amlParsed.items.length) {
                // Embedded SYLT commonly contains adjacent end/start tags such
                // as [00:01.000][00:01.001]. They preserve a word gap but are
                // rejected as empty words by strict ESLRC parsing. Keep AMLL
                // for canonical ESLRC and fall back only when it loses lines.
                return { items: compatibleItems };
            }
        }
        return amlParsed;
    }
    const format = detectLyricFormat(raw);

    switch (format) {
        case "qrc":
            return { items: parseQrcLyric(raw) };
        case "angle":
        case "word-lrc":
        case "inline-word-lrc":
            return { items: parseMixedTimestampLyric(raw) };
        case "lrc":
            return { items: parseLrcLyric(raw) };
        default:
            return { items: parsePlainTextLyric(raw) };
    }
}

function parseMixedTimestampLyric(raw: string): IParsedLrcItem[] {
    const items: IParsedLrcItem[] = [];

    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || isMetaLine(trimmed)) {
            continue;
        }

        let lineItems: IParsedLrcItem[] = [];
        const jsonLyricItem = parseNeteaseJsonLyricLine(trimmed);
        if (jsonLyricItem) {
            lineItems = [{
                time: jsonLyricItem.time,
                lrc: jsonLyricItem.lrc,
                index: 0,
            }];
        } else if (ANGLE_REG.test(trimmed)) {
            lineItems = parseAngleLyric(trimmed);
        } else if (INLINE_WORD_TIME_REG.test(trimmed)) {
            lineItems = parseInlineWordTimeLrcLyric(trimmed);
        } else if (WORD_LRC_REG.test(trimmed)) {
            lineItems = parseWordLrcLyric(trimmed);
        } else if (LRC_TIME_REG.test(trimmed)) {
            lineItems = parseLrcLyric(trimmed);
        }

        items.push(...lineItems);
    }

    return items.sort((a, b) => a.time - b.time);
}

function getTextScriptStats(text: string): ITextScriptStats {
    const stats: ITextScriptStats = {
        han: 0,
        kana: 0,
        hangul: 0,
        latin: 0,
        script: 0,
    };

    for (const char of Array.from(text)) {
        if (HAN_REG.test(char)) {
            stats.han++;
            stats.script++;
        } else if (KANA_REG.test(char)) {
            stats.kana++;
            stats.script++;
        } else if (HANGUL_REG.test(char)) {
            stats.hangul++;
            stats.script++;
        } else if (LATIN_REG.test(char)) {
            stats.latin++;
            stats.script++;
        }
    }

    return stats;
}

function hasEastAsianScript(stats: ITextScriptStats) {
    return stats.han > 0 || stats.kana > 0 || stats.hangul > 0;
}

function isMostlyLatin(stats: ITextScriptStats) {
    return stats.latin > 0 && stats.latin / Math.max(1, stats.script) >= 0.65;
}

function hasKanaOrHangul(stats: ITextScriptStats) {
    return stats.kana > 0 || stats.hangul > 0;
}

function isLyricCreditLine(text: string) {
    return CREDIT_LINE_REG.test(text.trim());
}

function normalizeCreditRomanizationPrefix(text: string) {
    const words = getLatinWords(text);
    return words.join(" ");
}

function isCreditRomanizationLine(text: string) {
    const trimmed = text.trim();
    if (!/[:：]/.test(trimmed) || isLyricCreditLine(trimmed)) {
        return false;
    }

    const prefix = trimmed.split(/[:：]/)[0];
    return CREDIT_ROMANIZATION_PREFIXES.has(normalizeCreditRomanizationPrefix(prefix));
}

function isCreditSideLine(text: string) {
    return isLyricCreditLine(text) || isCreditRomanizationLine(text);
}

interface ISpeakerPrefix {
    content: string;
    explicitSide?: boolean;
    isGroup: boolean;
    name: string;
    normalizedName: string;
    prefixLength: number;
}

function normalizeSpeakerName(name: string) {
    return name
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s._·・'"“”‘’-]/g, "");
}

function matchSpeakerPrefix(text: string): ISpeakerPrefix | null {
    const match = text.match(/^\s*([^:：\r\n]{1,24}?)\s*[:：]\s*/);
    if (!match) {
        return null;
    }

    const name = match[1].trim();
    if (
        !name
        || /[，,。.!！?？;；()[\]（）]/.test(name)
        || isCreditSideLine(`${name}：`)
        || NON_SPEAKER_LABEL_REG.test(name)
    ) {
        return null;
    }

    const normalizedName = normalizeSpeakerName(name);
    const voiceMatch = normalizedName.match(/^v(\d+)$/);

    return {
        content: text.slice(match[0].length),
        explicitSide: voiceMatch
            ? Number.parseInt(voiceMatch[1], 10) !== 1
            : undefined,
        isGroup: GROUP_SPEAKER_NAMES.has(normalizedName),
        name,
        normalizedName,
        prefixLength: match[0].length,
    };
}

function removeLeadingTextFromWords(
    words: ILyric.IWordData[] | undefined,
    prefixLength: number,
) {
    if (!words?.length || prefixLength <= 0) {
        return words;
    }

    let remaining = prefixLength;
    const strippedWords: ILyric.IWordData[] = [];

    words.forEach((word) => {
        if (remaining >= word.text.length) {
            remaining -= word.text.length;
            return;
        }

        const text = remaining > 0
            ? word.text.slice(remaining)
            : word.text;
        remaining = 0;
        if (!text) {
            return;
        }

        strippedWords.push({
            ...word,
            index: strippedWords.length,
            space: !text.trim(),
            text,
        });
    });

    return strippedWords;
}

function stripMatchingSpeakerPrefix(
    text: string | undefined,
    normalizedSpeakerName: string,
) {
    if (!text) {
        return text;
    }

    const prefix = matchSpeakerPrefix(text);
    return prefix?.normalizedName === normalizedSpeakerName
        ? prefix.content.trim()
        : text;
}

function stripSpeakerPrefixFromItem(
    item: IParsedLrcItem,
    prefix: ISpeakerPrefix,
) {
    item.lrc = prefix.content.trim();
    item.words = removeLeadingTextFromWords(item.words, prefix.prefixLength);
    stripSpeakerPrefixFromSecondaryFields(item, prefix);
}

function stripSpeakerPrefixFromSecondaryFields(
    item: IParsedLrcItem,
    prefix: ISpeakerPrefix,
) {
    item.translation = stripMatchingSpeakerPrefix(
        item.translation,
        prefix.normalizedName,
    );

    const romanizationPrefix = item.romanization
        ? matchSpeakerPrefix(item.romanization)
        : null;
    if (romanizationPrefix?.normalizedName === prefix.normalizedName) {
        item.romanization = romanizationPrefix.content.trim();
        item.romanizationWords = removeLeadingTextFromWords(
            item.romanizationWords,
            romanizationPrefix.prefixLength,
        );
    }
}

function prependSpeakerMarkerToItem(
    item: IParsedLrcItem,
    markerItem: IParsedLrcItem,
) {
    const markerText = markerItem.lrc.trim();
    item.lrc = `${markerText}${item.lrc}`;
    item.time = markerItem.time;
    item.hasSingerLabel = true;

    const synthesizedMarkerWords: ILyric.IWordData[] = !markerItem.words?.length
        && item.words?.length
        ? [{
            duration: Math.max(0.01, item.words[0].startTime - markerItem.time),
            endTime: Math.max(markerItem.time + 0.01, item.words[0].startTime),
            index: 0,
            isVirtual: true,
            space: false,
            startTime: markerItem.time,
            text: markerText,
        }]
        : [];
    if (markerItem.words?.length || synthesizedMarkerWords.length || item.words?.length) {
        item.words = [
            ...(markerItem.words ?? synthesizedMarkerWords),
            ...(item.words ?? []),
        ].map((word, index) => ({
            ...word,
            index,
        }));
        item.hasWordTimeline = !!markerItem.hasWordTimeline
            || !!item.hasWordTimeline;
    }

    if (markerItem.translation?.trim()) {
        item.translation = `${markerItem.translation}${item.translation ?? ""}`;
    }
    if (markerItem.romanization?.trim()) {
        item.romanization = `${markerItem.romanization}${item.romanization ?? ""}`;
    }
    if (markerItem.romanizationWords?.length || item.romanizationWords?.length) {
        item.romanizationWords = [
            ...(markerItem.romanizationWords ?? []),
            ...(item.romanizationWords ?? []),
        ].map((word, index) => ({
            ...word,
            index,
        }));
        item.hasRomanizationWordTimeline = !!markerItem.hasRomanizationWordTimeline
            || !!item.hasRomanizationWordTimeline;
    }

    if (item.endTime !== undefined) {
        item.duration = item.endTime - item.time;
    }
}

function getNormalizedArtists(artist?: string) {
    return (artist ?? "")
        .split(/\s*(?:,|，|、|\/|&|;|；|\bfeat\.?\b|\bwith\b)\s*/i)
        .map(normalizeSpeakerName)
        .filter(Boolean);
}

function getArtistSide(speakerName: string, artist?: string) {
    const artists = getNormalizedArtists(artist);
    if (!artists.length) {
        return undefined;
    }

    const normalizedSpeaker = normalizeSpeakerName(speakerName);
    const artistIndex = artists.findIndex((candidate) =>
        candidate === normalizedSpeaker
        || candidate.includes(normalizedSpeaker)
        || normalizedSpeaker.includes(candidate),
    );

    if (artistIndex < 0) {
        return undefined;
    }
    return artistIndex > 0;
}

function getRecognizedNaturalSpeakerNames(
    prefixes: Array<ISpeakerPrefix | null>,
    artist?: string,
) {
    const candidates = prefixes.filter((prefix): prefix is ISpeakerPrefix =>
        !!prefix
        && prefix.explicitSide === undefined
        && !prefix.isGroup,
    );
    const artistSpeakerNames = new Set(
        candidates
            .filter((prefix) => getArtistSide(prefix.name, artist) !== undefined)
            .map((prefix) => prefix.normalizedName),
    );
    const recognizedSpeakerNames = new Set(artistSpeakerNames);

    if (artistSpeakerNames.size > 0) {
        const counts = new Map<string, number>();
        candidates.forEach((prefix) => {
            counts.set(
                prefix.normalizedName,
                (counts.get(prefix.normalizedName) ?? 0) + 1,
            );
        });
        counts.forEach((count, speakerName) => {
            if (count >= 2) {
                recognizedSpeakerNames.add(speakerName);
            }
        });
    }

    return {
        artistSpeakerNames,
        recognizedSpeakerNames,
    };
}

function hasRecognizedSpeakerLayout(
    items: IParsedLrcItem[],
    artist?: string,
) {
    const prefixes = items.map((item) => matchSpeakerPrefix(item.lrc));
    const {
        artistSpeakerNames,
        recognizedSpeakerNames,
    } = getRecognizedNaturalSpeakerNames(prefixes, artist);

    return prefixes.some((prefix) => !!prefix && (
        prefix.explicitSide !== undefined
        || recognizedSpeakerNames.has(prefix.normalizedName)
        || (prefix.isGroup && artistSpeakerNames.size > 0)
    ));
}

function applyDuetSpeakerLayout(
    items: IParsedLrcItem[],
    artist?: string,
    preserveSingerLabels = true,
) {
    const prefixes = items.map((item) => matchSpeakerPrefix(item.lrc));
    const {
        artistSpeakerNames,
        recognizedSpeakerNames,
    } = getRecognizedNaturalSpeakerNames(prefixes, artist);
    const speakerSides = new Map<string, boolean>();
    const hasArtistSpeaker = artistSpeakerNames.size > 0;
    let currentSide = false;
    let hasCurrentSpeaker = false;
    let lastSingerName: string | undefined;
    let pendingSpeakerMarker: IParsedLrcItem | undefined;

    return items.filter((item, index) => {
        const prefix = prefixes[index];
        const shouldUsePrefix = !!prefix && (
            prefix.explicitSide !== undefined
            || (prefix.isGroup && hasArtistSpeaker)
            || recognizedSpeakerNames.has(prefix.normalizedName)
        );

        item.isBG = false;
        if (prefix && !shouldUsePrefix) {
            item.isDuet = false;
            return true;
        }
        if (!prefix || !shouldUsePrefix) {
            item.isDuet = hasCurrentSpeaker ? currentSide : false;
            if (!prefix && pendingSpeakerMarker) {
                prependSpeakerMarkerToItem(item, pendingSpeakerMarker);
                pendingSpeakerMarker = undefined;
            }
            return true;
        }

        let lineSide = false;
        if (prefix.explicitSide !== undefined) {
            lineSide = prefix.explicitSide;
            currentSide = lineSide;
            hasCurrentSpeaker = true;
        } else if (prefix.isGroup) {
            currentSide = false;
            hasCurrentSpeaker = true;
        } else {
            const knownSide = speakerSides.get(prefix.normalizedName);
            if (knownSide !== undefined) {
                lineSide = knownSide;
            } else {
                const artistSide = getArtistSide(prefix.name, artist);
                lineSide = artistSide
                    ?? Array.from(speakerSides.values()).some((side) => !side);
                speakerSides.set(prefix.normalizedName, lineSide);
            }
            currentSide = lineSide;
            hasCurrentSpeaker = true;
        }

        item.isDuet = lineSide;
        item.hasSingerLabel = prefix.explicitSide === undefined;

        const shouldPreserveLabel = preserveSingerLabels
            && prefix.explicitSide === undefined
            && prefix.normalizedName !== lastSingerName;
        if (prefix.explicitSide === undefined) {
            lastSingerName = prefix.normalizedName;
        } else {
            lastSingerName = undefined;
        }
        if (shouldPreserveLabel && !prefix.content.trim()) {
            pendingSpeakerMarker = item;
            return false;
        }
        if (!shouldPreserveLabel) {
            stripSpeakerPrefixFromItem(item, prefix);
        } else {
            stripSpeakerPrefixFromSecondaryFields(item, prefix);
        }

        const isLineScopedRole = !!prefix.content.trim()
            && prefix.explicitSide === undefined
            && !prefix.isGroup
            && !artistSpeakerNames.has(prefix.normalizedName);
        if (isLineScopedRole) {
            currentSide = false;
            hasCurrentSpeaker = false;
            lastSingerName = undefined;
        }

        return !!item.lrc.trim()
            || !!item.translation?.trim()
            || !!item.romanization?.trim();
    });
}

interface IParentheticalVocalParts {
    duetText: string;
    mainText: string;
}

interface IParentheticalVocalMatch {
    contentEnd: number;
    contentStart: number;
    duetText: string;
    fullEnd: number;
    fullStart: number;
}

function getParentheticalVocalMatches(text: string) {
    const matches: IParentheticalVocalMatch[] = [];
    const matcher = new RegExp(PARENTHETICAL_VOCAL_REG.source, "g");
    let match: RegExpExecArray | null;

    while ((match = matcher.exec(text)) !== null) {
        const normalizedContent = match[1].trim();
        if (
            !normalizedContent
            || KANA_REG.test(normalizedContent)
            || HANGUL_REG.test(normalizedContent)
        ) {
            continue;
        }

        const leadingWhitespace = match[1].length - match[1].trimStart().length;
        const trailingWhitespace = match[1].length - match[1].trimEnd().length;
        matches.push({
            contentEnd: match.index + match[0].length - 1 - trailingWhitespace,
            contentStart: match.index + 1 + leadingWhitespace,
            duetText: normalizedContent,
            fullEnd: match.index + match[0].length,
            fullStart: match.index,
        });
    }

    return matches;
}

function splitParentheticalVocalText(text?: string): IParentheticalVocalParts | null {
    if (!text) {
        return null;
    }

    const matches = getParentheticalVocalMatches(text);
    if (!matches.length) {
        return null;
    }

    let cursor = 0;
    const mainParts: string[] = [];
    matches.forEach((match) => {
        mainParts.push(text.slice(cursor, match.fullStart));
        cursor = match.fullEnd;
    });
    mainParts.push(text.slice(cursor));

    return {
        duetText: matches.map((match) => match.duetText).join(" "),
        mainText: mainParts.join("")
            .replace(/\u00a0/g, " ")
            .replace(/[ \t]{2,}/g, " ")
            .trim(),
    };
}

function splitParentheticalVocalWords(
    words: ILyric.IWordData[] | undefined,
) {
    if (!words?.length) {
        return null;
    }

    const fullText = words.map((word) => word.text).join("");
    const matches = getParentheticalVocalMatches(fullText);
    if (!matches.length) {
        return null;
    }

    const mainWords: ILyric.IWordData[] = [];
    const duetWords: ILyric.IWordData[] = [];
    let wordOffset = 0;

    words.forEach((word) => {
        const wordStart = wordOffset;
        const wordEnd = wordStart + word.text.length;
        const boundaries = new Set([wordStart, wordEnd]);

        matches.forEach((match) => {
            [
                match.fullStart,
                match.contentStart,
                match.contentEnd,
                match.fullEnd,
            ].forEach((boundary) => {
                if (boundary > wordStart && boundary < wordEnd) {
                    boundaries.add(boundary);
                }
            });
        });

        const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
        const wordDuration = word.duration
            ?? Math.max(0, word.endTime - word.startTime);

        for (let index = 0; index < sortedBoundaries.length - 1; index++) {
            const segmentStart = sortedBoundaries[index];
            const segmentEnd = sortedBoundaries[index + 1];
            const segmentText = word.text.slice(
                segmentStart - wordStart,
                segmentEnd - wordStart,
            );
            if (!segmentText) {
                continue;
            }

            const match = matches.find((candidate) =>
                segmentStart >= candidate.fullStart
                && segmentEnd <= candidate.fullEnd,
            );
            if (
                match
                && !(
                    segmentStart >= match.contentStart
                    && segmentEnd <= match.contentEnd
                )
            ) {
                continue;
            }

            const startRatio = word.text.length
                ? (segmentStart - wordStart) / word.text.length
                : 0;
            const endRatio = word.text.length
                ? (segmentEnd - wordStart) / word.text.length
                : 1;
            const startTime = word.startTime + wordDuration * startRatio;
            const endTime = word.startTime + wordDuration * endRatio;
            const target = match ? duetWords : mainWords;
            target.push({
                ...word,
                duration: endTime - startTime,
                endTime,
                index: target.length,
                space: !segmentText.trim(),
                startTime,
                text: segmentText,
            });
        }

        wordOffset = wordEnd;
    });

    return {
        duetWords,
        mainWords,
    };
}

function hasParentheticalDuetVocals(
    items: IParsedLrcItem[],
    artist?: string,
) {
    return getNormalizedArtists(artist).length >= 2
        && items.some((item) =>
            !isCreditSideLine(item.lrc)
            && !!splitParentheticalVocalText(item.lrc),
        );
}

function normalizeComparableText(text?: string) {
    return (text ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s._·・'"“”‘’\-—–/:：,，、()[\]（）《》「」]/g, "");
}

function isLeadingUnlabeledCredit(
    item: IParsedLrcItem,
    musicItem?: IMusic.IMusicItem,
) {
    const text = item.lrc.trim();
    const duration = Math.max(0, (item.endTime ?? item.time) - item.time);
    const normalizedTitle = normalizeComparableText(musicItem?.title);
    const normalizedText = normalizeComparableText(text);
    const isTitleLine = normalizedTitle.length >= 2
        && normalizedText.startsWith(normalizedTitle)
        && getNormalizedArtists(musicItem?.artist).some((artistName) =>
            normalizedText.includes(artistName),
        );

    return !text
        || GENERIC_LABEL_PREFIX_REG.test(text)
        || isCreditSideLine(text)
        || isTitleLine
        || /[@／/]/.test(text)
        || duration < LEADING_NAME_DURATION_SECONDS;
}

function applyUnlabeledDuetLayout(
    items: IParsedLrcItem[],
    musicItem?: IMusic.IMusicItem,
) {
    if (getNormalizedArtists(musicItem?.artist).length < 2) {
        return;
    }

    let startIndex = 0;
    items.forEach((item, index) => {
        if (
            item.time <= LEADING_CREDIT_WINDOW_SECONDS
            && GENERIC_LABEL_PREFIX_REG.test(item.lrc)
        ) {
            startIndex = index + 1;
        }
    });

    while (
        startIndex < items.length
        && isLeadingUnlabeledCredit(items[startIndex], musicItem)
    ) {
        startIndex++;
    }

    const vocalItems = items.slice(startIndex).filter((item) =>
        !!item.lrc.trim()
        && !GENERIC_LABEL_PREFIX_REG.test(item.lrc)
        && !isCreditSideLine(item.lrc),
    );
    const openingDialogue = vocalItems.slice(0, 10);
    const questionLineCount = openingDialogue.filter((item) =>
        /[?？]/.test(item.lrc),
    ).length;
    if (vocalItems.length < 2 || questionLineCount < 2) {
        return;
    }

    let currentSide = false;
    let previousVocal: IParsedLrcItem | undefined;

    items.slice(startIndex).forEach((item) => {
        if (
            !item.lrc.trim()
            || GENERIC_LABEL_PREFIX_REG.test(item.lrc)
            || isCreditSideLine(item.lrc)
        ) {
            item.isDuet = false;
            return;
        }

        if (previousVocal) {
            const hasRealTiming = !!previousVocal.hasWordTimeline
                && !!item.hasWordTimeline;
            const startsNewTurn = hasRealTiming
                ? item.time - (previousVocal.endTime ?? previousVocal.time)
                    > DUET_TURN_GAP_SECONDS
                : true;
            if (startsNewTurn) {
                currentSide = !currentSide;
            }
        }

        item.isDuet = currentSide;
        previousVocal = item;
    });
}

function expandParentheticalDuetVocals(
    items: IParsedLrcItem[],
    artist?: string,
    hasSpeakerLayout = false,
) {
    if (getNormalizedArtists(artist).length < 2) {
        return items;
    }

    const expandedItems: IParsedLrcItem[] = [];

    items.forEach((item) => {
        if (
            isCreditSideLine(item.lrc)
            || (hasSpeakerLayout && !item.hasSingerLabel)
        ) {
            expandedItems.push(item);
            return;
        }

        const lyricParts = splitParentheticalVocalText(item.lrc);
        if (!lyricParts) {
            expandedItems.push(item);
            return;
        }

        const translationParts = splitParentheticalVocalText(item.translation);
        const romanizationParts = splitParentheticalVocalText(item.romanization);
        const timedWordParts = splitParentheticalVocalWords(item.words);
        const timedRomanizationParts = splitParentheticalVocalWords(
            item.romanizationWords,
        );

        if (!lyricParts.mainText) {
            expandedItems.push({
                ...item,
                hasRomanizationWordTimeline: !!timedRomanizationParts?.duetWords.length,
                hasWordTimeline: !!timedWordParts?.duetWords.length,
                isBG: false,
                isDuet: !item.isDuet,
                lrc: lyricParts.duetText,
                romanization: romanizationParts?.duetText,
                romanizationWords: timedRomanizationParts?.duetWords,
                translation: translationParts?.duetText,
                words: timedWordParts?.duetWords,
            });
            return;
        }

        expandedItems.push({
            ...item,
            hasRomanizationWordTimeline: timedRomanizationParts
                ? !!timedRomanizationParts.mainWords.length
                : item.hasRomanizationWordTimeline,
            hasWordTimeline: timedWordParts
                ? !!timedWordParts.mainWords.length
                : item.hasWordTimeline,
            lrc: lyricParts.mainText,
            romanization: romanizationParts?.mainText ?? item.romanization,
            romanizationWords: timedRomanizationParts?.mainWords
                ?? item.romanizationWords,
            translation: translationParts?.mainText ?? item.translation,
            words: timedWordParts?.mainWords ?? item.words,
        });
        expandedItems.push({
            ...item,
            hasRomanizationWordTimeline: !!timedRomanizationParts?.duetWords.length,
            hasWordTimeline: !!timedWordParts?.duetWords.length,
            isBG: false,
            isDuet: !item.isDuet,
            isDuetPartner: true,
            isVirtualWords: undefined,
            lrc: lyricParts.duetText,
            romanization: romanizationParts?.duetText,
            romanizationWords: timedRomanizationParts?.duetWords,
            translation: translationParts?.duetText,
            words: timedWordParts?.duetWords,
        });
    });

    return expandedItems;
}

function canReceiveLyricField(item: IParsedLrcItem) {
    return !!item.lrc?.trim()
        && !item.isBG
        && !item.isDuetPartner
        && !isCreditSideLine(item.lrc);
}

function getLatinWords(text: string) {
    return text
        .toLowerCase()
        .match(/[a-z\u00c0-\u024f]+/g) ?? [];
}

function isPinyinSyllable(word: string) {
    if (PINYIN_SPECIAL_SYLLABLES.has(word)) {
        return true;
    }

    const match = word.match(PINYIN_INITIAL_REG);
    const rest = word.slice(match?.[0].length ?? 0);
    return !!rest && PINYIN_FINALS.has(rest);
}

function looksLikeRomanizationText(text: string) {
    const words = getLatinWords(text);
    if (!words.length) {
        return false;
    }

    const englishWords = words.filter((word) => COMMON_ENGLISH_WORDS.has(word)).length;
    if (englishWords >= Math.max(1, Math.ceil(words.length * 0.35))) {
        return false;
    }

    const pinyinWords = words.filter(isPinyinSyllable).length;
    if (pinyinWords / words.length >= 0.75) {
        return true;
    }

    return ROMANIZATION_HINT_REG.test(text);
}

function chooseParallelMainIndex(group: IParsedLrcItem[]) {
    if (
        group.length >= 3
        && isMostlyLatin(getTextScriptStats(group[0].lrc))
        && (group[0].words?.length ?? 0) > 1
    ) {
        const kanaOrHangulIndex = group.findIndex((item, index) =>
            index > 0
            && hasKanaOrHangul(getTextScriptStats(item.lrc))
            && (item.words?.length ?? 0) > 1,
        );

        if (kanaOrHangulIndex > 0) {
            return kanaOrHangulIndex;
        }
    }

    if (
        group.length >= 3
        && looksLikeRomanizationText(group[0].lrc)
        && hasEastAsianScript(getTextScriptStats(group[1].lrc))
    ) {
        return 1;
    }

    return 0;
}

function cloneParsedLrcItem(item: IParsedLrcItem): IParsedLrcItem {
    return {
        ...item,
        romanizationWords: item.romanizationWords
            ? [...item.romanizationWords]
            : undefined,
        words: item.words ? [...item.words] : undefined,
    };
}

function cloneCreditItemWithRomanization(
    creditItem: IParsedLrcItem,
    romanizationItem: IParsedLrcItem,
) {
    const cloned = cloneParsedLrcItem(creditItem);
    appendLyricField(cloned, "romanization", romanizationItem.lrc);
    if (romanizationItem.words?.length) {
        cloned.romanizationWords = romanizationItem.words;
        cloned.hasRomanizationWordTimeline = romanizationItem.hasWordTimeline;
        cloned.romanizationDuration = romanizationItem.duration;
    }
    return cloned;
}

function appendLyricField(
    item: IParsedLrcItem,
    field: "translation" | "romanization",
    text: string,
) {
    const normalized = text.trim();
    if (!normalized) {
        return;
    }

    if (!item[field]?.trim()) {
        item[field] = normalized;
        return;
    }

    if (item[field] !== normalized) {
        item[field] = `${item[field]}\n${normalized}`;
    }
}

function assignParallelSecondaryLine(
    base: IParsedLrcItem,
    source: IParsedLrcItem,
) {
    const baseStats = getTextScriptStats(base.lrc);
    const sourceStats = getTextScriptStats(source.lrc);
    const sourceIsRomanization = hasEastAsianScript(baseStats)
        && isMostlyLatin(sourceStats)
        && (source.hasWordTimeline || looksLikeRomanizationText(source.lrc));

    if (!sourceIsRomanization) {
        stripDuplicatedTranslationSuffix(base, source.lrc);
        appendLyricField(base, "translation", source.lrc);
        return;
    }

    appendLyricField(base, "romanization", source.lrc);
    if (source.words?.length) {
        base.romanizationWords = source.words;
        base.hasRomanizationWordTimeline = source.hasWordTimeline;
        base.romanizationDuration = source.duration;
    }
}

function collapseParallelContentGroup(group: IParsedLrcItem[]): ICollapseParallelResult {
    if (group.length === 1) {
        return {
            items: [group[0]],
            hasTranslation: false,
            hasRomanization: false,
        };
    }

    const mainIndex = chooseParallelMainIndex(group);
    const main = group[mainIndex];
    const collapsed = cloneParsedLrcItem(main);
    let hasTranslation = false;
    let hasRomanization = false;

    group.forEach((item, groupIndex) => {
        if (groupIndex === mainIndex) {
            return;
        }

        assignParallelSecondaryLine(
            collapsed,
            item,
        );
    });

    hasTranslation = !!collapsed.translation?.trim();
    hasRomanization = !!collapsed.romanization?.trim();

    return {
        items: [collapsed],
        hasTranslation,
        hasRomanization,
    };
}

function mergeParallelSpeakerMarkers(group: IParsedLrcItem[]) {
    const mergedGroup = [...group];

    for (let index = 0; index < mergedGroup.length; index++) {
        const markerItem = mergedGroup[index];
        const prefix = matchSpeakerPrefix(markerItem.lrc);
        if (!prefix || prefix.content.trim()) {
            continue;
        }

        const contentIndex = mergedGroup.findIndex((candidate, candidateIndex) =>
            candidateIndex > index
            && !!candidate.lrc.trim()
            && !isCreditSideLine(candidate.lrc)
            && !matchSpeakerPrefix(candidate.lrc),
        );
        if (contentIndex < 0) {
            continue;
        }

        const contentItem = cloneParsedLrcItem(mergedGroup[contentIndex]);
        prependSpeakerMarkerToItem(contentItem, markerItem);
        mergedGroup[contentIndex] = contentItem;
        mergedGroup.splice(index, 1);
        index--;
    }

    return mergedGroup;
}

function collapseParallelGroup(group: IParsedLrcItem[]): ICollapseParallelResult {
    const meaningfulItems = group.filter((item) => !!item.lrc.trim());
    if (meaningfulItems.length && meaningfulItems.length !== group.length) {
        group = meaningfulItems;
    }
    group = mergeParallelSpeakerMarkers(group);

    const lyricItems: IParsedLrcItem[] = [];
    const sequence: Array<{
        type: "item" | "lyric";
        item: IParsedLrcItem;
    }> = [];

    for (let index = 0; index < group.length; index++) {
        const item = group[index];
        const next = group[index + 1];

        if (
            next
            && isCreditRomanizationLine(item.lrc)
            && isLyricCreditLine(next.lrc)
        ) {
            sequence.push({
                type: "item",
                item: cloneCreditItemWithRomanization(next, item),
            });
            index++;
            continue;
        }

        if (
            next
            && isLyricCreditLine(item.lrc)
            && isCreditRomanizationLine(next.lrc)
        ) {
            sequence.push({
                type: "item",
                item: cloneCreditItemWithRomanization(item, next),
            });
            index++;
            continue;
        }

        if (isCreditSideLine(item.lrc)) {
            sequence.push({
                type: "item",
                item,
            });
            continue;
        }

        lyricItems.push(item);
        sequence.push({
            type: "lyric",
            item,
        });
    }

    if (lyricItems.length === group.length) {
        return collapseParallelContentGroup(group);
    }

    if (!lyricItems.length) {
        return {
            items: sequence.map((entry) => entry.item),
            hasTranslation: false,
            hasRomanization: sequence.some((entry) => !!entry.item.romanization?.trim()),
        };
    }

    if (lyricItems.length === 1) {
        return {
            items: sequence.map((entry) => entry.item),
            hasTranslation: false,
            hasRomanization: sequence.some((entry) => !!entry.item.romanization?.trim()),
        };
    }

    const mainLyricItem = lyricItems[chooseParallelMainIndex(lyricItems)];
    const collapsed = collapseParallelContentGroup(lyricItems);
    const mergedItems: IParsedLrcItem[] = [];
    let insertedMergedLyric = false;

    sequence.forEach((entry) => {
        if (entry.type === "item") {
            mergedItems.push(entry.item);
            return;
        }

        if (entry.item === mainLyricItem && !insertedMergedLyric) {
            mergedItems.push(collapsed.items[0]);
            insertedMergedLyric = true;
        }
    });

    if (!insertedMergedLyric) {
        mergedItems.push(collapsed.items[0]);
    }

    return {
        items: mergedItems,
        hasTranslation: collapsed.hasTranslation,
        hasRomanization: collapsed.hasRomanization
            || sequence.some((entry) => !!entry.item.romanization?.trim()),
    };
}

function repairCreditCollisionTranslation(items: IParsedLrcItem[]) {
    let repaired = false;

    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (
            item.hasWordTimeline
            || isCreditSideLine(item.lrc)
            || !hasEastAsianScript(getTextScriptStats(item.lrc))
        ) {
            continue;
        }

        const sharesCreditTimestamp = items.some((candidate, candidateIndex) =>
            candidateIndex !== index
            && isCreditSideLine(candidate.lrc)
            && Math.abs(candidate.time - item.time) <= PARALLEL_LINE_EPSILON,
        );
        if (!sharesCreditTimestamp) {
            continue;
        }

        const nextIndex = items.findIndex((candidate, candidateIndex) =>
            candidateIndex > index
            && !!candidate.lrc.trim()
            && !isCreditSideLine(candidate.lrc),
        );
        if (nextIndex < 0) {
            continue;
        }

        const nextItem = items[nextIndex];
        const timeDifference = nextItem.time - item.time;
        if (
            timeDifference <= PARALLEL_LINE_EPSILON
            || timeDifference > LYRIC_FIELD_ANCHOR_EPSILON
            || !isMostlyLatin(getTextScriptStats(nextItem.lrc))
            || !!nextItem.translation?.trim()
        ) {
            continue;
        }

        const followingItem = items.find((candidate, candidateIndex) =>
            candidateIndex > nextIndex
            && !!candidate.lrc.trim()
            && !isCreditSideLine(candidate.lrc),
        );
        if (
            !followingItem
            || !isMostlyLatin(getTextScriptStats(followingItem.lrc))
        ) {
            continue;
        }

        appendLyricField(nextItem, "translation", item.lrc);
        items.splice(index, 1);
        index--;
        repaired = true;
    }

    return repaired;
}

function collapseParallelLyricItems(items: IParsedLrcItem[]): ICollapseParallelResult {
    const collapsedItems: IParsedLrcItem[] = [];
    let hasTranslation = false;
    let hasRomanization = false;

    for (let index = 0; index < items.length;) {
        const group = [items[index]];
        let nextIndex = index + 1;
        while (
            nextIndex < items.length
            && Math.abs(items[nextIndex].time - group[0].time) <= PARALLEL_LINE_EPSILON
        ) {
            group.push(items[nextIndex]);
            nextIndex++;
        }

        const collapsed = collapseParallelGroup(group);
        hasTranslation = hasTranslation || collapsed.hasTranslation;
        hasRomanization = hasRomanization || collapsed.hasRomanization;
        collapsedItems.push(...collapsed.items);
        index = nextIndex;
    }

    hasTranslation = repairCreditCollisionTranslation(collapsedItems)
        || hasTranslation;

    return {
        items: collapsedItems,
        hasTranslation,
        hasRomanization,
    };
}

// ============ 翻译/罗马音合并（容差 + 顺序兜底） ============

function isMeaningfulSecondaryLine(item: IParsedLrcItem) {
    const text = item.lrc?.trim();
    return !!text && text !== "//";
}

function isMergeableSecondaryLine(item: IParsedLrcItem) {
    return isMeaningfulSecondaryLine(item) && !isCreditSideLine(item.lrc);
}

function stripDuplicatedTranslationSuffix(
    baseItem: IParsedLrcItem,
    translationText: string,
) {
    const baseText = baseItem.lrc?.trim();
    const normalizedTranslation = translationText.trim();
    if (
        !baseText
        || !normalizedTranslation
        || baseText.length <= normalizedTranslation.length
        || !baseText.endsWith(normalizedTranslation)
    ) {
        return;
    }

    const possibleMainText = baseText.slice(0, -normalizedTranslation.length).trim();
    if (!possibleMainText) {
        return;
    }

    const mainStats = getTextScriptStats(possibleMainText);
    const translationStats = getTextScriptStats(normalizedTranslation);
    if (hasKanaOrHangul(mainStats) && translationStats.han > 0) {
        baseItem.lrc = possibleMainText;
    }
}

function getLyricFieldAnchorTolerance(item: IParsedLrcItem, epsilon: number) {
    const duration = item.duration
        ?? (item.endTime !== undefined ? item.endTime - item.time : undefined)
        ?? 0;
    const durationTolerance = duration > 0
        ? duration * LYRIC_FIELD_ANCHOR_DURATION_RATIO
        : LYRIC_FIELD_ANCHOR_EPSILON;

    return Math.max(
        epsilon,
        Math.min(LYRIC_FIELD_ANCHOR_EPSILON, durationTolerance),
    );
}

function applyLyricField(
    baseItem: IParsedLrcItem,
    sourceItem: IParsedLrcItem,
    field: "translation" | "romanization",
    overwrite = true,
) {
    if (!overwrite && baseItem[field]?.trim()) {
        return false;
    }

    if (field === "translation") {
        stripDuplicatedTranslationSuffix(baseItem, sourceItem.lrc);
    }

    baseItem[field] = sourceItem.lrc;
    if (field === "romanization") {
        baseItem.romanizationWords = sourceItem.words;
        baseItem.hasRomanizationWordTimeline = sourceItem.hasWordTimeline;
        baseItem.romanizationDuration = sourceItem.duration;
    }
    return true;
}

function mergeLyricFieldByTime(
    base: IParsedLrcItem[],
    sourceItems: IParsedLrcItem[],
    field: "translation" | "romanization",
    epsilon: number,
) {
    const matchedBase = new Set<number>();
    const matchedSource = new Set<number>();
    const anchors: ILyricFieldAnchor[] = [];
    let baseIndex = 0;
    let sourceIndex = 0;

    while (baseIndex < base.length && sourceIndex < sourceItems.length) {
        if (!canReceiveLyricField(base[baseIndex])) {
            baseIndex++;
            continue;
        }

        const diff = sourceItems[sourceIndex].time - base[baseIndex].time;
        if (Math.abs(diff) <= epsilon) {
            if (applyLyricField(base[baseIndex], sourceItems[sourceIndex], field)) {
                matchedBase.add(baseIndex);
                matchedSource.add(sourceIndex);
                anchors.push({
                    baseIndex,
                    sourceIndex,
                });
            }
            baseIndex++;
            sourceIndex++;
        } else if (diff < 0) {
            sourceIndex++;
        } else {
            baseIndex++;
        }
    }

    return {
        anchors,
        matchedBase,
        matchedSource,
    };
}

function findLyricFieldAnchor(
    base: IParsedLrcItem[],
    sourceItems: IParsedLrcItem[],
    matchedAnchors: ILyricFieldAnchor[],
    epsilon: number,
): ILyricFieldAnchor | null {
    if (matchedAnchors.length) {
        return matchedAnchors[0];
    }

    let bestAnchor: ILyricFieldAnchor | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    const baseScanLimit = Math.min(base.length, LYRIC_FIELD_ANCHOR_SCAN_LIMIT);
    const sourceScanLimit = Math.min(sourceItems.length, LYRIC_FIELD_ANCHOR_SCAN_LIMIT);

    for (let baseIndex = 0; baseIndex < baseScanLimit; baseIndex++) {
        if (!canReceiveLyricField(base[baseIndex])) {
            continue;
        }

        const tolerance = getLyricFieldAnchorTolerance(base[baseIndex], epsilon);
        for (let sourceIndex = 0; sourceIndex < sourceScanLimit; sourceIndex++) {
            const diff = Math.abs(sourceItems[sourceIndex].time - base[baseIndex].time);
            if (diff <= tolerance && diff < bestDiff) {
                bestAnchor = {
                    baseIndex,
                    sourceIndex,
                };
                bestDiff = diff;
            }
        }
    }

    return bestAnchor;
}

function mergeLyricFieldSequential(
    base: IParsedLrcItem[],
    sourceItems: IParsedLrcItem[],
    field: "translation" | "romanization",
    anchor: ILyricFieldAnchor,
    matchedBase: Set<number>,
    matchedSource: Set<number>,
) {
    let assignedCount = 0;

    const assign = (baseIndex: number, sourceIndex: number) => {
        if (
            matchedBase.has(baseIndex)
            || matchedSource.has(sourceIndex)
            || !canReceiveLyricField(base[baseIndex])
            || !applyLyricField(base[baseIndex], sourceItems[sourceIndex], field, false)
        ) {
            return false;
        }

        matchedBase.add(baseIndex);
        matchedSource.add(sourceIndex);
        assignedCount++;
        return true;
    };

    let baseIndex = anchor.baseIndex - 1;
    let sourceIndex = anchor.sourceIndex - 1;

    while (baseIndex >= 0 && sourceIndex >= 0) {
        if (!canReceiveLyricField(base[baseIndex])) {
            baseIndex--;
            continue;
        }

        assign(baseIndex, sourceIndex);
        baseIndex--;
        sourceIndex--;
    }

    baseIndex = anchor.baseIndex;
    sourceIndex = anchor.sourceIndex;

    while (baseIndex < base.length && sourceIndex < sourceItems.length) {
        if (!canReceiveLyricField(base[baseIndex])) {
            baseIndex++;
            continue;
        }

        assign(baseIndex, sourceIndex);
        baseIndex++;
        sourceIndex++;
    }

    return assignedCount;
}

function mergeLyricField(
    base: IParsedLrcItem[],
    raw: string,
    field: "translation" | "romanization",
    epsilon = LYRIC_FIELD_DIRECT_EPSILON,
    artist?: string,
): boolean {
    const sourceItems = applyDuetSpeakerLayout(
        parseLyricItemsByFormat(raw).items,
        artist,
        false,
    )
        .filter(isMergeableSecondaryLine);

    if (sourceItems.length === 0) {
        return false;
    }

    const {
        anchors,
        matchedBase,
        matchedSource,
    } = mergeLyricFieldByTime(base, sourceItems, field, epsilon);
    const directAssignedCount = matchedBase.size;
    const anchor = findLyricFieldAnchor(base, sourceItems, anchors, epsilon);
    let sequentialAssignedCount = 0;

    if (anchor) {
        sequentialAssignedCount = mergeLyricFieldSequential(
            base,
            sourceItems,
            field,
            anchor,
            matchedBase,
            matchedSource,
        );
    }

    return directAssignedCount + sequentialAssignedCount > 0;
}

// ============ 伪逐字生成 ============

function generateVirtualWords(
    text: string,
    startTime: number,
    endTime: number,
): ILyric.IWordData[] {
    const chars = Array.from(text); // 支持 Unicode
    if (chars.length === 0) return [];

    const totalDur = Math.max(0.1, endTime - startTime);
    const charDur = totalDur / chars.length;

    return chars.map((ch, i) => ({
        text: ch,
        startTime: startTime + i * charDur,
        duration: charDur,
        endTime: startTime + (i + 1) * charDur,
        index: i,
        isVirtual: true,
    }));
}

// ============ 行 endTime 补全 ============

function fillEndTimes(items: IParsedLrcItem[]): void {
    for (let i = 0; i < items.length; i++) {
        const current = items[i];
        if (
            current.endTime == null
            || !Number.isFinite(current.endTime)
            || current.endTime <= current.time
        ) {
            const next = items.slice(i + 1).find((item) =>
                item.time > current.time + PARALLEL_LINE_EPSILON,
            );
            const endTime = next ? next.time : current.time + 3;
            items[i].endTime = endTime;
            items[i].duration = endTime - items[i].time;
        }
    }
}

// ============ 主解析器类 ============

export default class LyricParser {
    private _musicItem?: IMusic.IMusicItem;
    private format?: ILyric.LyricFormat;
    private meta: LyricMeta;
    private lrcItems: Array<IParsedLrcItem>;
    private searchableLrcItems: Array<IParsedLrcItem>;
    private lastSearchIndex = 0;

    public hasTranslation = false;
    public hasRomanization = false;

    get musicItem() {
        return this._musicItem;
    }

    constructor(raw: string, options?: IOptions) {
        this._musicItem = options?.musicItem;
        this.format = options?.format;
        let translation = options?.translation;
        let romanization = options?.romanization;

        if (!raw) {
            if (translation) {
                raw = translation;
                translation = undefined;
            } else if (romanization) {
                raw = romanization;
                romanization = undefined;
            }
        }

        const {
            lrcItems,
            meta,
            hasTranslation,
            hasRomanization,
        } = this.parseAll(raw || "");
        this.meta = meta;
        this.lrcItems = lrcItems;
        const mainLrcItems = lrcItems.filter((item) =>
            !item.isBG && !item.isDuetPartner,
        );
        this.searchableLrcItems = mainLrcItems.length ? mainLrcItems : lrcItems;
        this.hasTranslation = hasTranslation;
        this.hasRomanization = hasRomanization;

        if (translation) {
            this.hasTranslation = mergeLyricField(
                this.lrcItems,
                translation,
                "translation",
                LYRIC_FIELD_DIRECT_EPSILON,
                this._musicItem?.artist,
            )
                || this.hasTranslation;
        }
        if (romanization) {
            this.hasRomanization = mergeLyricField(
                this.lrcItems,
                romanization,
                "romanization",
                LYRIC_FIELD_DIRECT_EPSILON,
                this._musicItem?.artist,
            )
                || this.hasRomanization;
        }
    }

    /** 统一解析入口 */
    private parseAll(raw: string): {
        lrcItems: IParsedLrcItem[];
        meta: LyricMeta;
        hasTranslation: boolean;
        hasRomanization: boolean;
    } {
        raw = normalizeRawLyricText(raw).trim();
        if (!raw) {
            return {
                lrcItems: [],
                meta: {},
                hasTranslation: false,
                hasRomanization: false,
            };
        }

        const metaPrefix = extractMetaPrefix(raw);
        const meta = parseMeta(metaPrefix);

        const parsedContent = parseLyricItemsByFormat(raw, this.format);
        const parsedItems = parsedContent.items;
        Object.assign(meta, parsedContent.meta);
        const collapsed = parsedContent.preserveVocalLayout
            ? {
                items: parsedItems,
                hasTranslation: parsedItems.some((item) => !!item.translation?.trim()),
                hasRomanization: parsedItems.some((item) => !!item.romanization?.trim()),
            }
            : collapseParallelLyricItems(parsedItems);
        const collapsedItems = collapsed.items;
        const hasTranslation = collapsed.hasTranslation
            || collapsedItems.some((item) => !!item.translation?.trim());
        const hasRomanization = collapsed.hasRomanization
            || collapsedItems.some((item) => !!item.romanization?.trim());
        const preserveVocalLayout = !!parsedContent.preserveVocalLayout
            || collapsedItems.some((item) => !!item.isBG || !!item.isDuet);
        const hasSpeakerLayout = hasRecognizedSpeakerLayout(
            collapsedItems,
            this._musicItem?.artist,
        );
        const hasStructuredDuetLayout = preserveVocalLayout
            || hasSpeakerLayout
            || hasParentheticalDuetVocals(
                collapsedItems,
                this._musicItem?.artist,
            );
        let items = preserveVocalLayout
            ? collapsedItems
            : applyDuetSpeakerLayout(collapsedItems, this._musicItem?.artist);

        // 补全 endTime
        fillEndTimes(items);

        // 双歌手且没有演唱者标签时，从前置信息结束后按演唱段落交替布局。
        // 制作信息和任意 A:BC 标签仅保留展示，不参与换边。
        if (!hasStructuredDuetLayout) {
            applyUnlabeledDuetLayout(items, this._musicItem);
        }

        // 行级 LRC 的括号内容按 AMLL 对唱另一方展开；逐字歌词中的括号
        // 常用于日语注音，因此保留原样。
        if (!preserveVocalLayout) {
            items = expandParentheticalDuetVocals(
                items,
                this._musicItem?.artist,
                hasSpeakerLayout,
            );
        }

        // 为无词级时间轴的行生成伪逐字
        for (const item of items) {
            if (!item.hasWordTimeline && item.lrc && item.endTime != null) {
                item.words = generateVirtualWords(item.lrc, item.time, item.endTime);
                item.isVirtualWords = true;
            }
        }

        // 重新编号 index
        items.forEach((item, i) => {
            item.index = i;
        });

        return {
            lrcItems: items,
            meta,
            hasTranslation,
            hasRomanization,
        };
    }

    /** 获取当前行（兼容旧接口） */
    getPosition(position: number): IParsedLrcItem | null {
        position = position - (this.meta?.offset ?? 0);
        const searchableItems = this.searchableLrcItems;

        if (!searchableItems[0] || position < searchableItems[0].time) {
            this.lastSearchIndex = 0;
            return null;
        }

        // 从上次位置向后搜索
        for (
            let index = this.lastSearchIndex;
            index < searchableItems.length - 1;
            ++index
        ) {
            if (
                position >= searchableItems[index].time &&
                position < searchableItems[index + 1].time
            ) {
                this.lastSearchIndex = index;
                return searchableItems[index];
            }
        }

        // 从头搜索
        for (let index = 0; index < this.lastSearchIndex; ++index) {
            if (
                position >= searchableItems[index].time &&
                position < searchableItems[index + 1].time
            ) {
                this.lastSearchIndex = index;
                return searchableItems[index];
            }
        }

        // 最后一行
        const lastIdx = searchableItems.length - 1;
        this.lastSearchIndex = lastIdx;
        return searchableItems[lastIdx];
    }

    /** 获取词级活跃状态 */
    getActiveState(position: number): IActiveLyricState {
        const line = this.getPosition(position);
        if (!line) {
            return {
                line: null,
                lineIndex: -1,
                lineProgress: 0,
                word: null,
                wordIndex: -1,
                wordProgress: 0,
            };
        }

        const lineEnd = line.endTime ?? line.time + (line.duration ?? 0);
        const lineDur = Math.max(0.001, lineEnd - line.time);
        const lineProgress = clamp01((position - line.time) / lineDur);

        const words = line.words;
        if (!words || words.length === 0) {
            return {
                line,
                lineIndex: line.index,
                lineProgress,
                word: null,
                wordIndex: -1,
                wordProgress: 0,
            };
        }

        // 二分查找活跃词
        let word: ILyric.IWordData | null = null;
        let lo = 0;
        let hi = words.length - 1;

        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (position < words[mid].startTime) {
                hi = mid - 1;
            } else if (position >= words[mid].endTime) {
                lo = mid + 1;
            } else {
                word = words[mid];
                break;
            }
        }

        // 如果没找到精确匹配，取最近的已过词
        if (!word) {
            for (let i = words.length - 1; i >= 0; i--) {
                if (position >= words[i].startTime) {
                    word = words[i];
                    break;
                }
            }
        }

        if (!word) {
            return {
                line,
                lineIndex: line.index,
                lineProgress,
                word: null,
                wordIndex: -1,
                wordProgress: 0,
            };
        }

        const wordDur = Math.max(0.001, word.duration);
        const wordProgress = clamp01((position - word.startTime) / wordDur);

        return {
            line,
            lineIndex: line.index,
            lineProgress,
            word,
            wordIndex: word.index,
            wordProgress,
        };
    }

    getLyricItems() {
        return this.lrcItems;
    }

    getMeta() {
        return this.meta;
    }

    toString(options?: {
        withTimestamp?: boolean;
        type?: "raw" | "translation" | "romanization";
    }) {
        const { type = "raw", withTimestamp = true } = options || {};
        const getItemText = (item: IParsedLrcItem) => {
            switch (type) {
                case "translation":
                    return item.translation ?? "";
                case "romanization":
                    return item.romanization ?? "";
                default: {
                    const text = item.lrc ?? "";
                    return (item.isBG || item.isDuetPartner) && text
                        ? `（${text}）`
                        : text;
                }
            }
        };

        if (withTimestamp) {
            return this.lrcItems
                .map(
                    (item) =>
                        `${timeToLrcTag(item.time)} ${getItemText(item)}`,
                )
                .join("\r\n");
        } else {
            return this.lrcItems.map((item) => getItemText(item)).join("\r\n");
        }
    }
}
