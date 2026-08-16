import {
    getDeclaredQualityKeys,
    getInternalData,
    resetMediaItem,
} from "@/common/media-util";
import type { Plugin } from "./plugin";
import fs from "fs/promises";
import { delay } from "@/common/time-util";
import axios from "axios";
import { createHash } from "crypto";
import { safeStat } from "@/common/file-util";
import path from "path";
import { autoDecryptLyric } from "./lyric-decrypt";
import ServiceManager from "@shared/service-manager/main";
import { getLxMusicQualityKeys } from "../lx-adapter";

/** 新音质 -> 旧插件兼容的音质键 (用于旧插件不认识新音质时的回退) */
const newToLegacyQualityMap: Record<string, string> = {
    "mgg": "low",
    "128k": "low",
    "192k": "standard",
    "320k": "high",
    "flac": "super",
    "flac24bit": "super",
    "hires": "super",
    "vinyl": "super",
    "dolby": "super",
    "atmos": "super",
    "atmos_plus": "super",
    "master": "super",
};

const sourceExtAliasMap: Record<string, string> = {
    ".mflac": ".flac",
    ".mgg": ".ogg",
    ".mmp4": ".mp4",
};

const validAudioExtSet = new Set([
    ".mp3",
    ".flac",
    ".ogg",
    ".mp4",
    ".m4a",
    ".aac",
    ".wav",
    ".opus",
    ".m4s",
]);

const localLyricSidecarExtensions = [
    ".ttml", ".TTML",
    ".xml", ".XML",
    ".lqe", ".LQE",
    ".lys", ".LYS",
    ".yrc", ".YRC",
    ".qrc", ".QRC",
    ".alrc", ".ALRC",
    ".eslrc", ".ESLRC",
    ".lyl", ".LYL",
    ".lrc", ".LRC",
    ".txt", ".TXT",
];
const secondaryLyricSidecarExtensions = [".lrc", ".LRC", ".txt", ".TXT"];

const KUGOU_RECOGNIZE_URL = "https://gateway.kugou.com/fingerprint.service/v1/music_trackid_mulit";
const KUGOU_RECOGNIZE_SALT = "OIlwieks28dk2k092lksi2UIkp";
const KUGOU_RECOGNIZE_MID = createHash("md5")
    .update("bakamusic-recognize-device-v1")
    .digest("hex");

function isKugouPlatform(platform: string) {
    return /酷狗|kugou/i.test(platform) || platform.trim().toLocaleLowerCase() === "kg";
}

function hasQualitySize(value: unknown) {
    if (typeof value === "number") {
        return Number.isFinite(value) && value > 0;
    }
    return typeof value === "string" && value.trim().length > 0;
}

function getQualitySize(value: Record<string, unknown>) {
    return value.size
        ?? value.filesize
        ?? value.fileSize
        ?? value.size_bytes;
}

/** Recognition returns hashes first; KG details are needed to fill sizes. */
function hasCompleteKugouQualityMetadata(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const entries = Object.values(value as Record<string, unknown>);
    return entries.length > 0 && entries.every((entry) =>
        !!entry
        && typeof entry === "object"
        && !Array.isArray(entry)
        && hasQualitySize(getQualitySize(entry as Record<string, unknown>)),
    );
}

/** Normalize common KG quality-size field names for the renderer metadata UI. */
function normalizeKugouQualityMetadata(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
    }
    const source = value as Record<string, unknown>;
    const rawQualities = source.qualities ?? source.qualitys;
    if (!rawQualities || typeof rawQualities !== "object" || Array.isArray(rawQualities)) {
        return value;
    }
    const qualities = Object.fromEntries(Object.entries(rawQualities).map(([quality, entry]) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return [quality, entry];
        }
        const normalizedEntry = entry as Record<string, unknown>;
        const size = getQualitySize(normalizedEntry);
        return [quality, {
            ...normalizedEntry,
            ...(normalizedEntry.size == null && size != null ? { size } : {}),
        }];
    }));
    return {
        ...source,
        qualities,
    };
}

function normalizeRecognizeCover(...values: unknown[]) {
    for (const value of values) {
        if (typeof value !== "string" || !value.trim()) {
            continue;
        }
        return value
            .replace(/\{size\}/g, "400")
            .replace(/^\/\//, "https://")
            .replace(/^http:\/\//, "https://")
            .replace("c1.kgimg.com", "imge.kugou.com");
    }
    return undefined;
}

function pickRecognizeString(...values: unknown[]) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim();
        }
    }
    return "";
}

function mapKugouRecognizeItem(raw: Record<string, unknown>, platform: string): IPlugin.IRecognizeItem {
    const authors = Array.isArray(raw.authors) ? raw.authors[0] as Record<string, unknown> : undefined;
    const albums = Array.isArray(raw.album) ? raw.album[0] as Record<string, unknown> : undefined;
    const title = pickRecognizeString(raw.songname, raw.filename, raw.name) || "未知歌曲";
    const artist = pickRecognizeString(raw.singername, raw.author_name, raw.singer, authors?.author_name) || "未知歌手";
    const album = pickRecognizeString(albums?.albumname, raw.album_name, raw.albumname);
    const hash = pickRecognizeString(raw.hash, raw.hash_128, raw.FileHash, raw.hash_320, raw.hash_flac);
    const hash320 = pickRecognizeString(raw.hash_320, raw["320hash"]);
    const hashFlac = pickRecognizeString(raw.hash_flac, raw.sqhash);
    const hashHires = pickRecognizeString(raw.hash_high, raw.ResFileHash);
    const id = pickRecognizeString(
        hash,
        raw.album_audio_id,
        raw.mixsongid,
        raw.audio_id,
        raw.songid,
        raw.song_id,
    );
    const rawDuration = Number(raw.timelength ?? raw.timelength_128 ?? raw.duration ?? 0);
    const duration = Number.isFinite(rawDuration) ? (rawDuration > 1000 ? rawDuration / 1000 : rawDuration) : undefined;
    const dist = Number(raw.dist);
    const confidence = Number.isFinite(dist) ? Math.max(0, Math.min(1, 1 - dist)) : undefined;
    const artwork = normalizeRecognizeCover(
        raw.union_cover,
        albums?.sizable_cover,
        raw.album_sizable_cover,
        raw.cover,
    );
    const rawQualities = raw.qualities && typeof raw.qualities === "object"
        ? raw.qualities as Record<string, Record<string, unknown>>
        : {};
    const qualities = {
        ...rawQualities,
        ...(hash ? { "128k": { ...rawQualities["128k"], hash } } : {}),
        ...(hash320 ? { "320k": { ...rawQualities["320k"], hash: hash320 } } : {}),
        ...(hashFlac ? { flac: { ...rawQualities.flac, hash: hashFlac } } : {}),
        ...(hashHires ? { hires: { ...rawQualities.hires, hash: hashHires } } : {}),
    };
    return {
        ...raw,
        id: id || hash || `${title}-${artist}`,
        platform,
        title,
        artist,
        album: album || undefined,
        artwork,
        duration,
        hash,
        "320hash": hash320 || undefined,
        sqhash: hashFlac || undefined,
        ResFileHash: hashHires || undefined,
        qualities,
        album_audio_id: raw.album_audio_id,
        album_id: albums?.album_id ?? albums?.albumid ?? raw.album_id ?? raw.albumid,
        confidence,
    };
}

async function recognizeKugou(audioBase64: string, platform: string) {
    const pcm = Buffer.from(audioBase64, "base64");
    if (!pcm.length || pcm.length > 16 * 1024 * 1024) {
        throw new Error("识曲音频数据无效");
    }
    const now = Date.now();
    const clienttime = Math.floor(now / 1000).toString();
    const params: Record<string, string> = {
        area_code: "1",
        appid: "1005",
        clienttime,
        clientver: "20489",
        dfid: "-",
        fpid: String(now),
        include_unpublish: "1",
        mid: KUGOU_RECOGNIZE_MID,
        multi_result: "1",
        useid: "0",
        uuid: "-",
    };
    const paramsString = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("");
    params.signature = createHash("md5")
        .update(Buffer.concat([
            Buffer.from(KUGOU_RECOGNIZE_SALT + paramsString, "utf8"),
            pcm,
            Buffer.from(KUGOU_RECOGNIZE_SALT, "utf8"),
        ]))
        .digest("hex");
    const query = new URLSearchParams(params).toString();
    const response = await axios.post(`${KUGOU_RECOGNIZE_URL}?${query}`, pcm, {
        timeout: 30_000,
        maxContentLength: 4 * 1024 * 1024,
        maxBodyLength: 16 * 1024 * 1024,
        responseType: "text",
        headers: {
            dfid: "-",
            clienttime,
            mid: KUGOU_RECOGNIZE_MID,
            "kg-rc": "1",
            "kg-thash": "5d816a0",
            "kg-rec": "1",
            "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
            "User-Agent": "KuGou/11490 (Android)",
            "Content-Type": "application/octet-stream",
        },
        transformResponse: [(value) => value],
    });
    const body = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    const rows = Array.isArray(body?.data) ? body.data : [];
    return {
        isEnd: true,
        data: rows
            .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === "object")
            .map((item: Record<string, unknown>) => mapKugouRecognizeItem(item, platform))
            .sort((a: IPlugin.IRecognizeItem, b: IPlugin.IRecognizeItem) =>
                Number(b.confidence ?? 0) - Number(a.confidence ?? 0)),
    } satisfies IPlugin.IRecognizeResult;
}

function getLyricFormat(filePath: string): ILyric.LyricFormat {
    let normalizedPath = filePath;
    try {
        normalizedPath = new URL(filePath).pathname;
    } catch {
        // 本地路径直接交给 path.extname。
    }
    switch (path.extname(normalizedPath).toLowerCase()) {
        case ".ttml":
        case ".xml":
            return "ttml";
        case ".alrc":
            return "lrc-a2";
        case ".yrc":
            return "yrc";
        case ".qrc":
            return "qrc";
        case ".eslrc":
            return "eslrc";
        case ".lyl":
            return "lyl";
        case ".lys":
            return "lys";
        case ".lqe":
            return "lqe";
        case ".lrc":
            return "lrc";
        default:
            return "plain";
    }
}

function normalizeSourceExt(ext?: string | null) {
    if (!ext) {
        return null;
    }

    const normalizedExt = (sourceExtAliasMap[ext.toLowerCase()] ?? ext.toLowerCase()).trim();
    return validAudioExtSet.has(normalizedExt) ? normalizedExt : null;
}

function getSourceAudioExt(url?: string, visited = new Set<string>()): string | null {
    if (!url || visited.has(url)) {
        return null;
    }
    visited.add(url);

    try {
        const urlObj = new URL(url);
        const directExt = normalizeSourceExt(
            path.posix.extname(decodeURIComponent(urlObj.pathname)),
        );
        if (directExt) {
            return directExt;
        }

        for (const paramKey of ["url", "src", "file", "filename", "path"]) {
            const nestedUrl = urlObj.searchParams.get(paramKey);
            if (!nestedUrl) {
                continue;
            }

            const nestedExt = getSourceAudioExt(decodeURIComponent(nestedUrl), visited);
            if (nestedExt) {
                return nestedExt;
            }
        }
    } catch {
        return normalizeSourceExt(path.posix.extname(url.split(/[?#]/)[0] ?? ""));
    }

    return null;
}

function normalizeLyricText(text: string) {
    return text
        .replace(/\r/g, "")
        .replace(/\\r\\n|\\n|\\r/g, "\n");
}

async function decodeTextFile(filePath: string) {
    const buffer = await fs.readFile(filePath);

    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return normalizeLyricText(buffer.subarray(3).toString("utf8"));
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return normalizeLyricText(buffer.subarray(2).toString("utf16le"));
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        const iconv = await import("iconv-lite");
        return normalizeLyricText(iconv.decode(buffer.subarray(2), "utf16-be"));
    }

    const jschardet = await import("jschardet");
    const detected = jschardet.detect(buffer, {
        minimumThreshold: 0.4,
    });
    const encoding = detected.encoding?.toLowerCase();

    if (
        encoding
        && detected.confidence >= 0.5
        && !["ascii", "utf-8", "utf8"].includes(encoding)
    ) {
        const iconv = await import("iconv-lite");
        if (iconv.encodingExists(encoding)) {
            return normalizeLyricText(iconv.decode(buffer, encoding));
        }
    }

    return normalizeLyricText(buffer.toString("utf8"));
}

export default class PluginMethods implements IPlugin.IPluginInstanceMethods {
    private plugin;
    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }
    /** 搜索 */
    async search<T extends IMedia.SupportMediaType>(
        query: string,
        page: number,
        type: T,
    ): Promise<IPlugin.ISearchResult<T>> {
        if (!this.plugin.instance.search) {
            return {
                isEnd: true,
                data: [],
            };
        }

        const result = await this.plugin.instance.search(query, page, type);
        if (Array.isArray(result.data)) {
            result.data.forEach((_) => {
                resetMediaItem(_, this.plugin.name);
                if (type === "music") {
                    this.plugin.applyMediaQualityOverride(_ as IMusic.IMusicItem);
                }
            });
            return {
                isEnd: result.isEnd ?? true,
                data: result.data,
            };
        }
        return {
            isEnd: true,
            data: [],
        };
    }

    /** 听歌识曲。优先使用平台插件实现；酷狗插件缺少该方法时使用内置接口适配。 */
    async recognize(
        audioBase64: string,
        _sampleRate = 8000,
        _channels = 1,
    ): Promise<IPlugin.IRecognizeResult | null> {
        if (typeof audioBase64 !== "string" || !audioBase64.trim()) {
            throw new Error("识曲音频数据为空");
        }
        if (typeof this.plugin.instance.recognize === "function") {
            const result = await this.plugin.instance.recognize(audioBase64, _sampleRate, _channels);
            if (!result || !Array.isArray(result.data)) {
                return { isEnd: true, data: [] };
            }
            return result;
        }
        if (isKugouPlatform(this.plugin.name)) {
            return recognizeKugou(audioBase64, this.plugin.name);
        }
        return null;
    }

    /** 获取真实源 */
    async getMediaSource(
        musicItem: IMusic.IMusicItemPartial,
        quality: IMusic.IQualityKey = "128k",
        retryCount = 1,
        _notUpdateCache = false,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        // TODO 2. url 缓存策略，先略过

        try {
            const lxQualityKeys = this.plugin.mediaQualityOverride?.();
            // A non-null override means the platform has an LX base source.
            // In that case the base source is authoritative (not a hint): do
            // not call a second platform plugin when it returns no URL.
            const hasLxSource = lxQualityKeys !== null && lxQualityKeys !== undefined;
            const declaredQualityKeys = lxQualityKeys !== null && lxQualityKeys !== undefined
                ? getLxMusicQualityKeys(musicItem, lxQualityKeys, true)
                : getDeclaredQualityKeys(musicItem);
            const hasLxQualityOverride = hasLxSource;
            if (
                (hasLxQualityOverride || declaredQualityKeys.length)
                && !declaredQualityKeys.includes(quality)
            ) {
                return null;
            }

            // LX 兼容层仅覆盖播放解析；没有可用 LX 底座映射时继续调用原插件。
            let result = hasLxSource
                ? await this.plugin.mediaSourceOverride?.(musicItem, quality)
                : null;
            if (!result?.url && !hasLxSource && this.plugin.instance.getMediaSource) {
                // 先用新音质键请求，如果插件不认识则回退到旧音质键
                result = await this.plugin.instance.getMediaSource(
                    musicItem,
                    quality,
                );
                if (!result?.url) {
                    // 新音质键没结果，尝试旧插件兼容的音质键
                    const legacyQuality = newToLegacyQualityMap[quality];
                    if (legacyQuality && legacyQuality !== quality) {
                        result = await this.plugin.instance.getMediaSource(
                            musicItem,
                            legacyQuality as any,
                        );
                    }
                }
            }
            const { url, headers } = result ?? {
                url: musicItem?.qualities?.[quality]?.url ?? musicItem.url,
            };
            if (!url) {
                throw new Error("NOT RETRY");
            }

            // Intercept ekey: register with mflac-proxy for transparent decryption
            if (result?.ekey && url) {
                try {
                    const localUrl = await ServiceManager.registerMflacStream(url, result.ekey, headers);
                    if (localUrl) {
                        const sourceExt = getSourceAudioExt(url);
                        return {
                            url: sourceExt ? `${localUrl}${sourceExt}` : localUrl,
                        } as IPlugin.IMediaSourceResult;
                    }
                } catch {
                    return {
                        url,
                        headers,
                        userAgent: headers?.["user-agent"],
                    } as IPlugin.IMediaSourceResult;
                }
            }

            // Intercept cek: register with luna-proxy for CENC streaming decryption
            if (result?.cek && url) {
                try {
                    const localUrl = await ServiceManager.registerLunaStream(url, result.cek, headers);
                    if (localUrl) {
                        return {
                            url: `${localUrl}.m4a`,
                        } as IPlugin.IMediaSourceResult;
                    }
                } catch {
                    return {
                        url,
                        headers,
                        userAgent: headers?.["user-agent"],
                    } as IPlugin.IMediaSourceResult;
                }
            }

            const mediaResult = {
                url,
                headers,
                // Quality is an IQualityKey string.  Older plugins sometimes
                // returned a numeric platform stream id (for example 30280),
                // which later reached filename templates and crashed at
                // `quality.trim()`.
                quality: typeof result?.quality === "string" && result.quality.trim()
                    ? result.quality.trim() as IMusic.IQualityKey
                    : undefined,
                userAgent: result?.userAgent ?? headers?.["user-agent"] ?? headers?.["User-Agent"],
            } as IPlugin.IMediaSourceResult;

            //   if (pluginCacheControl !== CacheControl.NoStore && !notUpdateCache) {
            //     Cache.update(musicItem, [
            //       ["headers", result.headers],
            //       ["userAgent", result.userAgent],
            //       [`qualities.${quality}.url`, url],
            //     ]);
            //   }

            return mediaResult;
        } catch (e: any) {
            if (retryCount > 0 && e?.message !== "NOT RETRY") {
                await delay(150);
                return this.plugin.methods.getMediaSource(
                    musicItem,
                    quality,
                    --retryCount,
                );
            }
            // devLog('error', '获取真实源失败', e, e?.message);
            return null;
        }
    }

    private async resolveVideoSource(
        musicItem: IMusic.IMusicItemPartial,
        videoQuality = "1080p",
    ): Promise<IPlugin.IVideoSourceResult | null> {
        const method = this.plugin.instance.getMvSource;
        if (!method) {
            return null;
        }
        try {
            const result = await method.call(
                this.plugin.instance,
                resetMediaItem(
                    musicItem as IMedia.IMediaBase,
                    undefined,
                    true,
                ) as IMusic.IMusicItemPartial,
                videoQuality,
            );
            return normalizeVideoSourceResult(result);
        } catch {
            return null;
        }
    }

    /** 获取 MV 播放源。 */
    async getMvSource(
        musicItem: IMusic.IMusicItemPartial,
        videoQuality = "1080p",
    ): Promise<IPlugin.IVideoSourceResult | null> {
        return this.resolveVideoSource(musicItem, videoQuality);
    }

    /** 获取音乐详情 */
    async getMusicInfo(
        musicItem: IMedia.IMediaBase,
    ): Promise<Partial<IMusic.IMusicItem> | null> {
        if (!this.plugin.instance.getMusicInfo) {
            return null;
        }
        try {
            // The KG plugin treats any non-empty `qualities` object as already
            // hydrated and returns it unchanged. Recognition only has hashes
            // at this point, so remove the skeleton map to force the plugin's
            // detail/quality endpoint and preserve size metadata.
            const shouldRefreshKugouQualities = isKugouPlatform(this.plugin.name)
                && musicItem.qualities
                && !hasCompleteKugouQualityMetadata(musicItem.qualities);
            const requestItem = shouldRefreshKugouQualities
                ? { ...musicItem, qualities: undefined }
                : musicItem;
            const result = await this.plugin.instance.getMusicInfo(
                resetMediaItem(requestItem, undefined, true),
            );
            const normalizedResult = result
                ? normalizeKugouQualityMetadata(result)
                : null;
            return normalizedResult
                ? this.plugin.applyMediaQualityOverride(normalizedResult)
                : null;
        } catch {
            // devLog('error', '获取音乐详情失败', e, e?.message);
            return null;
        }
    }

    /** 歌曲详情/分享页链接 */
    async getMusicDetailPageUrl(
        musicItem: IMusic.IMusicItemPartial,
    ): Promise<string | null> {
        if (!this.plugin.instance.getMusicDetailPageUrl) {
            return null;
        }
        try {
            const url = await this.plugin.instance.getMusicDetailPageUrl(
                resetMediaItem(musicItem as IMedia.IMediaBase, undefined, true),
            );
            if (typeof url === "string" && url.trim()) {
                return url.trim();
            }
            return null;
        } catch {
            return null;
        }
    }

    /** 获取歌词 */
    async getLyric(
        musicItem: IMusic.IMusicItemPartial,
    ): Promise<ILyric.ILyricSource | null> {
        const mergeLyricText = (
            currentValue?: string,
            nextValue?: string | null,
        ) => {
            if (typeof nextValue === "string" && nextValue.trim().length) {
                return nextValue;
            }
            return currentValue;
        };
        const decryptLyricText = (value?: string) => {
            if (!value) {
                return value;
            }
            return autoDecryptLyric(value);
        };
        const readLocalLyric = async (basePaths: string[], exts: string[]) => {
            for (const basePath of basePaths) {
                for (const ext of exts) {
                    const filePath = basePath + ext;
                    if ((await safeStat(filePath))?.isFile()) {
                        return {
                            format: getLyricFormat(filePath),
                            text: await decodeTextFile(filePath),
                        };
                    }
                }
            }
            return undefined;
        };

        let rawLrc = mergeLyricText(undefined, musicItem.rawLrc);
        let rawLrcFormat: ILyric.LyricFormat | undefined;
        let lrcUrl = musicItem.lrc;
        let translation: string | undefined;
        let romanization: string | undefined;
        let hasLocalSidecar = false;

        const localPath =
            getInternalData<IMusic.IMusicItemInternalData>(musicItem as IMedia.IMediaBase, "downloadData")
                ?.path || musicItem.$$localPath;
        if (localPath) {
            const fileName = path.parse(localPath).name;
            const localDir = path.dirname(localPath);
            const translationBasePaths = [
                path.join(localDir, `${fileName}-tr`),
                path.join(localDir, `${fileName}.tran`),
            ];
            const romanizationBasePaths = [
                path.join(localDir, `${fileName}.roma`),
                path.join(localDir, `${fileName}-roma`),
            ];
            const localLyric = await readLocalLyric(
                [path.join(localDir, fileName)],
                localLyricSidecarExtensions,
            );
            if (localLyric?.text.trim()) {
                rawLrc = localLyric.text;
                rawLrcFormat = localLyric.format;
                hasLocalSidecar = true;
            }
            translation = translation ?? (await readLocalLyric(
                translationBasePaths,
                secondaryLyricSidecarExtensions,
            ))?.text;
            romanization = romanization ?? (await readLocalLyric(
                romanizationBasePaths,
                secondaryLyricSidecarExtensions,
            ))?.text;
        }

        try {
            if (!musicItem.platform || !musicItem.id) {
                return null;
            }
            const lrcSource = await this.plugin.instance?.getLyric?.(
                resetMediaItem(musicItem as IMedia.IMediaBase, undefined, true),
            );

            if (!hasLocalSidecar) {
                const mergedRawLrc = mergeLyricText(rawLrc, lrcSource?.rawLrc);
                if (lrcSource?.rawLrc?.trim()) {
                    rawLrcFormat = lrcSource?.format;
                }
                rawLrc = mergedRawLrc;
            }
            translation = mergeLyricText(translation, lrcSource?.translation);
            romanization = mergeLyricText(romanization, lrcSource?.romanization);

            if (lrcSource?.lrc) {
                lrcUrl = lrcSource.lrc;
            }
        } catch {
            // trace('插件获取歌词失败', e?.message, 'error');
            // devLog('error', '插件获取歌词失败', e, e?.message);
        }

        if (!rawLrc && lrcUrl) {
            try {
                rawLrc = mergeLyricText(
                    rawLrc,
                    (await axios.get(lrcUrl, { timeout: 5000 })).data,
                );
                rawLrcFormat ??= getLyricFormat(lrcUrl);
            } catch {
                lrcUrl = undefined;
            }
        }

        rawLrc = decryptLyricText(rawLrc);
        translation = decryptLyricText(translation);
        romanization = decryptLyricText(romanization);

        if (rawLrc || translation || romanization) {
            return {
                rawLrc,
                format: rawLrcFormat,
                translation,
                romanization,
                lrc: lrcUrl,
            };
        }

        return null;
    }

    /** 获取专辑信息 */
    async getAlbumInfo(
        albumItem: IAlbum.IAlbumItem,
        page = 1,
    ): Promise<IPlugin.IAlbumInfoResult | null> {
        if (!this.plugin.instance.getAlbumInfo) {
            return {
                albumItem,
                musicList: (albumItem?.musicList ?? []).map((it) =>
                    this.plugin.applyMediaQualityOverride(
                        resetMediaItem(it, this.plugin.name),
                    ),
                ),
                isEnd: true,
            };
        }
        try {
            const result = await this.plugin.instance.getAlbumInfo(
                resetMediaItem(albumItem, undefined, true),
                page,
            );
            if (!result) {
                throw new Error();
            }
            result?.musicList?.forEach((_) => {
                resetMediaItem(_, this.plugin.name);
                this.plugin.applyMediaQualityOverride(_);
                _.album = albumItem.title;
            });

            if (page <= 1) {
                // 合并信息
                return {
                    albumItem: { ...albumItem, ...(result?.albumItem ?? {}) },
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            } else {
                return {
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            }
        } catch {
            // trace('获取专辑信息失败', e?.message);
            // devLog('error', '获取专辑信息失败', e, e?.message);

            return null;
        }
    }

    /** 获取歌单信息 */
    async getMusicSheetInfo(
        sheetItem: IMusic.IMusicSheetItem,
        page = 1,
    ): Promise<IPlugin.ISheetInfoResult | null> {
        if (!this.plugin.instance.getMusicSheetInfo) {
            return {
                sheetItem,
                musicList: (sheetItem?.musicList ?? []).map((item) =>
                    this.plugin.applyMediaQualityOverride(item),
                ),
                isEnd: true,
            };
        }
        try {
            const result = await this.plugin.instance?.getMusicSheetInfo?.(
                resetMediaItem(sheetItem, undefined, true),
                page,
            );
            if (!result) {
                throw new Error();
            }
            result?.musicList?.forEach((_) => {
                resetMediaItem(_, this.plugin.name);
                this.plugin.applyMediaQualityOverride(_);
            });

            if (page <= 1) {
                // 合并信息
                return {
                    sheetItem: { ...sheetItem, ...(result?.sheetItem ?? {}) },
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            } else {
                return {
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            }
        } catch {
            // trace('获取歌单信息失败', e, e?.message);
            // devLog('error', '获取歌单信息失败', e, e?.message);

            return null;
        }
    }

    /** 查询作者信息 */
    async getArtistWorks<T extends IArtist.ArtistMediaType>(
        artistItem: IArtist.IArtistItem,
        page: number,
        type: T,
    ): Promise<IPlugin.ISearchResult<T>> {
        if (!this.plugin.instance.getArtistWorks) {
            return {
                isEnd: true,
                data: [],
            };
        }
        const result = await this.plugin.instance.getArtistWorks(
            artistItem,
            page,
            type,
        );
        if (!result.data) {
            return {
                isEnd: true,
                data: [],
            };
        }
        result.data?.forEach((_) => {
            resetMediaItem(_, this.plugin.name);
            if (type === "music") {
                this.plugin.applyMediaQualityOverride(_ as IMusic.IMusicItem);
            }
        });
        return {
            isEnd: result.isEnd ?? true,
            data: result.data,
        };
    }

    /** 作者详情（头像 / 简介） */
    async getArtistInfo(
        artistItem: IArtist.IArtistItem,
    ): Promise<Partial<IArtist.IArtistItem> | null> {
        if (!this.plugin.instance.getArtistInfo) {
            return null;
        }
        try {
            const result = await this.plugin.instance.getArtistInfo(
                resetMediaItem(artistItem as IMedia.IMediaBase, undefined, true) as IArtist.IArtistItem,
            );
            if (!result || typeof result !== "object") {
                return null;
            }
            return {
                ...result,
                platform: result.platform || this.plugin.name,
            };
        } catch {
            return null;
        }
    }

    /** 导入歌单 */
    async importMusicSheet(
        urlLike: string,
    ): Promise<IPlugin.IImportMusicSheetResult | null> {
        try {
            const result = await this.plugin.instance?.importMusicSheet?.(urlLike);
            if (!result) {
                return null;
            }
            if (Array.isArray(result)) {
                result.forEach((_) => {
                    resetMediaItem(_, this.plugin.name);
                    this.plugin.applyMediaQualityOverride(_);
                });
                return result;
            }
            if (typeof result !== "object") {
                return null;
            }

            resetMediaItem(result, this.plugin.name);
            result.musicList?.forEach((_) => {
                resetMediaItem(_, this.plugin.name);
                this.plugin.applyMediaQualityOverride(_);
            });
            return result;
        } catch {
            // devLog('error', '导入歌单失败', e, e?.message);

            return null;
        }
    }
    /** 导入单曲 */
    async importMusicItem(urlLike: string): Promise<IMusic.IMusicItem | null> {
        try {
            const result = await this.plugin.instance?.importMusicItem?.(urlLike);
            if (!result) {
                throw new Error();
            }
            resetMediaItem(result, this.plugin.name);
            return this.plugin.applyMediaQualityOverride(result);
        } catch {
            // devLog('error', '导入单曲失败', e, e?.message);

            return null;
        }
    }
    /** 获取榜单 */
    async getTopLists(): Promise<IMusic.IMusicSheetGroupItem[]> {
        try {
            const result = await this.plugin.instance?.getTopLists?.();
            if (!result) {
                throw new Error();
            }
            return result;
        } catch {
            // devLog('error', '获取榜单失败', e, e?.message);
            return [];
        }
    }
    /** 获取榜单详情 */
    async getTopListDetail(
        topListItem: IMusic.IMusicSheetItem,
        page: number,
    ): Promise<IPlugin.ITopListInfoResult> {
        try {
            const result = await this.plugin.instance?.getTopListDetail?.(
                topListItem,
                page,
            );
            if (!result) {
                throw new Error();
            }
            if (result.musicList) {
                result.musicList.forEach((_) => {
                    resetMediaItem(_, this.plugin.name);
                    this.plugin.applyMediaQualityOverride(_);
                });
            }
            if (result.isEnd !== false) {
                result.isEnd = true;
            }
            return result;
        } catch {
            // devLog('error', '获取榜单详情失败', e, e?.message);
            return {
                isEnd: true,
                topListItem,
                musicList: [],
            };
        }
    }

    /** 获取推荐歌单的tag */
    async getRecommendSheetTags(): Promise<IPlugin.IGetRecommendSheetTagsResult> {
        try {
            const result = await this.plugin.instance?.getRecommendSheetTags?.();
            if (!result) {
                throw new Error();
            }
            return result;
        } catch {
            // devLog('error', '获取推荐歌单失败', e, e?.message);
            return {
                data: [],
            };
        }
    }
    /** 获取某个tag的推荐歌单 */
    async getRecommendSheetsByTag(
        tagItem: IMedia.IUnique,
        page?: number,
    ): Promise<ICommon.PaginationResponse<IMusic.IMusicSheetItem>> {
        try {
            const result = await this.plugin.instance?.getRecommendSheetsByTag?.(
                tagItem,
                page ?? 1,
            );
            if (!result) {
                throw new Error();
            }
            if (result.isEnd !== false) {
                result.isEnd = true;
            }
            if (!result.data) {
                result.data = [];
            }
            result.data.forEach((item) => resetMediaItem(item, this.plugin.name));

            return result;
        } catch {
            // devLog('error', '获取推荐歌单详情失败', e, e?.message);
            return {
                isEnd: true,
                data: [],
            };
        }
    }

    async getMusicComments(musicItem: IMusic.IMusicItem, page = 1): Promise<IPlugin.IGetCommentResult> {
        try {
            const result = await this.plugin.instance?.getMusicComments?.(
                musicItem,
                page,
            );
            if (!result || typeof result !== "object") {
                throw new Error();
            }
            return {
                isEnd: result.isEnd === false ? false : true,
                data: Array.isArray(result.data) ? result.data.filter(Boolean) : [],
            };
        } catch {
            return {
                isEnd: true,
                data: [],
            };
        }
    }
}
