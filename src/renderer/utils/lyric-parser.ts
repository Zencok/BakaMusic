/**
 * 多格式歌词解析器
 * 支持: QRC [ms,dur]text(ms,dur) / 尖括号 [mm:ss.xxx]<mm:ss.xxx>text / LRC / 纯文本
 */

type LyricMeta = Record<string, any>;
type LyricFormat = "qrc" | "angle" | "word-lrc" | "inline-word-lrc" | "lrc" | "plain";

interface IOptions {
    musicItem?: IMusic.IMusicItem;
    translation?: string;
    romanization?: string;
}

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
const CREDIT_LINE_REG = /^(?:(?:作)?词|(?:作)?詞|曲|作曲|编曲|編曲|词曲|詞曲|原唱|演唱|歌手|vocal|lyrics?|lyricist|composer|music|arrange(?:r|ment)?)\s*[:：]/i;
const ROMANIZATION_HINT_REG = /(?:shi|chi|tsu|kyo|kyu|kya|ryo|ryu|rya|sho|shu|sha|cho|chu|cha|jyo|jyu|jya|dzu|desu|boku|kimi|kono|sono|ano|yume|sora|kokoro|namida|hikari|kaze|hana|machi|sekai|mirai|hoshi|koe|uta|sarang|hae)/i;
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

function isMetaLine(line: string) {
    return /^\[[a-zA-Z]+:/.test(line.trim());
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

function detectLyricFormat(raw: string): LyricFormat {
    if (QRC_LINE_REG.test(raw) && QRC_WORD_REG.test(raw)) return "qrc";
    if (ANGLE_REG.test(raw)) return "angle";
    if (containsWordLrc(raw)) return "word-lrc";
    if (INLINE_WORD_TIME_REG.test(raw)) return "inline-word-lrc";
    if (LRC_TIME_REG.test(raw)) return "lrc";
    return "plain";
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
    const rawLrcs = raw.split(timeReg) ?? [];
    const rawTimes = raw.match(timeReg) ?? [];
    const len = rawTimes.length;

    rawLrcs.shift(); // 移除第一个空/元数据段

    let counter = 0;
    let j: number, lrc: string;
    let idx = 0;

    for (let i = 0; i < len; ++i) {
        counter = 0;
        while (rawLrcs[0] === "") {
            ++counter;
            rawLrcs.shift();
        }
        lrc = rawLrcs[0]?.trim?.() ?? "";
        for (j = i; j < i + counter; ++j) {
            items.push({
                time: parseTimeTag(rawTimes[j]),
                lrc,
                index: idx++,
            });
        }
        i += counter;
        if (i < len) {
            items.push({
                time: parseTimeTag(rawTimes[i]),
                lrc,
                index: idx++,
            });
        }
        rawLrcs.shift();
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

function parseLyricItemsByFormat(raw: string): IParsedLrcItem[] {
    raw = sanitizeLyricRaw(normalizeRawLyricText(raw));
    const format = detectLyricFormat(raw);

    switch (format) {
        case "qrc":
            return parseQrcLyric(raw);
        case "angle":
        case "word-lrc":
        case "inline-word-lrc":
            return parseMixedTimestampLyric(raw);
        case "lrc":
            return parseLrcLyric(raw);
        default:
            return parsePlainTextLyric(raw);
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
        if (ANGLE_REG.test(trimmed)) {
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

function isCreditRomanizationLine(text: string) {
    const trimmed = text.trim();
    if (!/[:：]/.test(trimmed) || isLyricCreditLine(trimmed)) {
        return false;
    }

    const prefix = trimmed.split(/[:：]/)[0];
    const prefixStats = getTextScriptStats(prefix);
    return isMostlyLatin(prefixStats) && looksLikeRomanizationText(prefix);
}

function canReceiveLyricField(item: IParsedLrcItem) {
    return !!item.lrc?.trim() && !isLyricCreditLine(item.lrc);
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
    if (group.length >= 3 && looksLikeRomanizationText(group[0].lrc)) {
        const kanaOrHangulIndex = group.findIndex((item, index) =>
            index > 0 && hasKanaOrHangul(getTextScriptStats(item.lrc)),
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

function collapseParallelGroup(group: IParsedLrcItem[]): ICollapseParallelResult {
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

        if (isLyricCreditLine(item.lrc)) {
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
): boolean {
    const sourceItems = parseLyricItemsByFormat(raw)
        .filter(isMeaningfulSecondaryLine);

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
        if (items[i].endTime == null) {
            const next = items[i + 1];
            const endTime = next ? next.time : items[i].time + 3;
            items[i].endTime = endTime;
            items[i].duration = endTime - items[i].time;
        }
    }
}

// ============ 主解析器类 ============

export default class LyricParser {
    private _musicItem?: IMusic.IMusicItem;
    private meta: LyricMeta;
    private lrcItems: Array<IParsedLrcItem>;
    private lastSearchIndex = 0;

    public hasTranslation = false;
    public hasRomanization = false;

    get musicItem() {
        return this._musicItem;
    }

    constructor(raw: string, options?: IOptions) {
        this._musicItem = options?.musicItem;
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
        this.hasTranslation = hasTranslation;
        this.hasRomanization = hasRomanization;

        if (translation) {
            this.hasTranslation = mergeLyricField(this.lrcItems, translation, "translation")
                || this.hasTranslation;
        }
        if (romanization) {
            this.hasRomanization = mergeLyricField(this.lrcItems, romanization, "romanization")
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

        const parsedItems = parseLyricItemsByFormat(raw);
        const {
            items,
            hasTranslation,
            hasRomanization,
        } = collapseParallelLyricItems(parsedItems);

        // 补全 endTime
        fillEndTimes(items);

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

        if (!this.lrcItems[0] || position < this.lrcItems[0].time) {
            this.lastSearchIndex = 0;
            return null;
        }

        // 从上次位置向后搜索
        for (
            let index = this.lastSearchIndex;
            index < this.lrcItems.length - 1;
            ++index
        ) {
            if (
                position >= this.lrcItems[index].time &&
                position < this.lrcItems[index + 1].time
            ) {
                this.lastSearchIndex = index;
                return this.lrcItems[index];
            }
        }

        // 从头搜索
        for (let index = 0; index < this.lastSearchIndex; ++index) {
            if (
                position >= this.lrcItems[index].time &&
                position < this.lrcItems[index + 1].time
            ) {
                this.lastSearchIndex = index;
                return this.lrcItems[index];
            }
        }

        // 最后一行
        const lastIdx = this.lrcItems.length - 1;
        this.lastSearchIndex = lastIdx;
        return this.lrcItems[lastIdx];
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
                default:
                    return item.lrc ?? "";
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
