/**
 * 多格式歌词解析器
 * 支持: QRC [ms,dur]text(ms,dur) / 尖括号 [mm:ss.xxx]<mm:ss.xxx>text / LRC / 纯文本
 */

type LyricMeta = Record<string, any>;
type LyricFormat = "qrc" | "angle" | "word-lrc" | "lrc" | "plain";

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
const QRC_WORD_REG = /\(\d+,\d+\)/;
const ANGLE_REG = /\[\d{2}:\d{2}(?:\.\d{2,3})?\]\s*<\d{2}:\d{2}/;
const WORD_LRC_REG = /\[\d{2}:\d{2}(?:\.\d{2,3})?\][^[\r\n]+\[\d{2}:\d{2}(?:\.\d{2,3})?\]/;
const WORD_LRC_ENTRY_REG = /\[(\d{2}:\d{2}(?:\.\d{2,3})?)\]([^[\r\n]*)/g;
const LRC_TIME_REG = /\[\d{2}:\d{2}(?:\.\d{2,3})?\]/;
const META_REG = /\[([a-zA-Z]+):([^\]]+)\]/g;

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

function detectLyricFormat(raw: string): LyricFormat {
    if (QRC_LINE_REG.test(raw) && QRC_WORD_REG.test(raw)) return "qrc";
    if (ANGLE_REG.test(raw)) return "angle";
    if (containsWordLrc(raw)) return "word-lrc";
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

// ============ QRC 格式解析 ============
// 格式: [lineStartMs,lineDurMs]text(wordStartMs,wordDurMs)text(wordStartMs,wordDurMs)...

function parseQrcLyric(raw: string): IParsedLrcItem[] {
    const items: IParsedLrcItem[] = [];
    const lineRegex = /\[(\d+),(\d+)\]([\s\S]*?)(?=\[\d+,\d+\]|$)/g;
    const wordRegex = /([^()]*)\((\d+),(\d+)\)/g;
    let lineMatch: RegExpExecArray | null;
    let idx = 0;

    while ((lineMatch = lineRegex.exec(raw)) !== null) {
        const lineStartMs = parseInt(lineMatch[1]);
        const lineDurMs = parseInt(lineMatch[2]);
        const body = lineMatch[3] || "";

        const words: ILyric.IWordData[] = [];
        let wordMatch: RegExpExecArray | null;
        let fullText = "";
        let wIdx = 0;

        // Reset wordRegex lastIndex
        wordRegex.lastIndex = 0;
        while ((wordMatch = wordRegex.exec(body)) !== null) {
            const text = wordMatch[1];
            const wStartMs = parseInt(wordMatch[2]);
            const wDurMs = parseInt(wordMatch[3]);

            if (text) {
                const startTime = wStartMs / 1000;
                const duration = wDurMs / 1000;
                words.push({
                    text,
                    startTime,
                    duration,
                    endTime: startTime + duration,
                    index: wIdx++,
                });
                fullText += text;
            }
        }

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

        // 最后一个尖括号可能是结束时间（无文本）
        const trailingTimeMatch = afterLineTag.match(/<(\d{2}:\d{2}(?:\.\d{2,3})?)>\s*$/);
        const lineEndTime = trailingTimeMatch
            ? parseTimeTag(`<${trailingTimeMatch[1]}>`)
            : undefined;

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
    raw = sanitizeLyricRaw(raw);
    const format = detectLyricFormat(raw);

    switch (format) {
        case "qrc":
            return parseQrcLyric(raw);
        case "angle":
            return parseAngleLyric(raw);
        case "word-lrc":
            return parseWordLrcLyric(raw);
        case "lrc":
            return parseLrcLyric(raw);
        default:
            return parsePlainTextLyric(raw);
    }
}

// ============ 翻译/罗马音合并（容差） ============

function mergeLyricField(
    base: IParsedLrcItem[],
    raw: string,
    field: "translation" | "romanization",
    epsilon = 0.15,
): boolean {
    const sourceItems = parseLyricItemsByFormat(raw);

    if (sourceItems.length === 0) {
        return false;
    }

    let i = 0;
    let j = 0;
    while (i < base.length && j < sourceItems.length) {
        const d = sourceItems[j].time - base[i].time;
        if (Math.abs(d) <= epsilon) {
            base[i][field] = sourceItems[j].lrc;
            if (field === "romanization") {
                base[i].romanizationWords = sourceItems[j].words;
                base[i].hasRomanizationWordTimeline =
                    sourceItems[j].hasWordTimeline;
                base[i].romanizationDuration = sourceItems[j].duration;
            }
            i++;
            j++;
        } else if (d < 0) {
            j++;
        } else {
            i++;
        }
    }

    return true;
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

        const { lrcItems, meta } = this.parseAll(raw || "");
        this.meta = meta;
        this.lrcItems = lrcItems;

        if (translation) {
            this.hasTranslation = mergeLyricField(this.lrcItems, translation, "translation");
        }
        if (romanization) {
            this.hasRomanization = mergeLyricField(this.lrcItems, romanization, "romanization");
        }
    }

    /** 统一解析入口 */
    private parseAll(raw: string): {
        lrcItems: IParsedLrcItem[];
        meta: LyricMeta;
    } {
        raw = raw.trim();
        if (!raw) return { lrcItems: [], meta: {} };

        const metaPrefix = extractMetaPrefix(raw);
        const meta = parseMeta(metaPrefix);

        const items = parseLyricItemsByFormat(raw);

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

        return { lrcItems: items, meta };
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
