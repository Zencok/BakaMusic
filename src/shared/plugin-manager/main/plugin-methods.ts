import { getDeclaredQualityKeys, getInternalData } from "@/common/media-util";
import type { Plugin } from "./plugin";
import fs from "fs/promises";
import { safeStat } from "@/common/file-util";
import path from "path";
import { autoDecryptLyric } from "./lyric-decrypt";
import ServiceManager from "@shared/service-manager/main";
import type { PluginCapability } from "../rpc";
import { assertPathAccess } from "@shared/ipc-security/main";
import { assertLocalSourceAccess } from "./internal-plugins/local-file-access";

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

const MAX_VIDEO_SOURCE_URL_LENGTH = 8192;
const MAX_VIDEO_SOURCE_HEADERS = 64;
const MAX_VIDEO_SOURCE_HEADER_LENGTH = 8192;

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

function normalizeVideoSourceHeaders(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const entries = Object.entries(value).flatMap(([key, headerValue]) => {
        if (
            !key.trim()
            || key.length > 256
            || typeof headerValue !== "string"
            || headerValue.length > MAX_VIDEO_SOURCE_HEADER_LENGTH
        ) {
            return [];
        }
        return [[key, headerValue] as const];
    }).slice(0, MAX_VIDEO_SOURCE_HEADERS);
    return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeVideoSourceNumber(value: unknown) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0
        ? numberValue
        : undefined;
}

function normalizeVideoSourceSize(value: unknown) {
    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized.length > 0 && normalized.length <= 128 ? normalized : undefined;
    }
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function normalizeVideoDynamicRange(value: unknown): IPlugin.VideoDynamicRange | undefined {
    return value === "sdr" || value === "hdr10" || value === "dolby-vision"
        ? value
        : undefined;
}

function normalizeVideoQualityOptions(value: unknown) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const seen = new Set<string>();
    const options = value.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const item = entry as Record<string, unknown>;
        const key = typeof item.key === "string" ? item.key.trim() : "";
        if (!key || key.length > 64 || seen.has(key)) return [];
        seen.add(key);
        const stringValue = (name: string, maxLength = 128) =>
            typeof item[name] === "string" && item[name].length <= maxLength
                ? item[name].trim()
                : undefined;
        return [{
            key,
            label: stringValue("label"),
            width: normalizeVideoSourceNumber(item.width),
            height: normalizeVideoSourceNumber(item.height),
            bitrate: normalizeVideoSourceNumber(item.bitrate),
            size: normalizeVideoSourceSize(item.size),
            codec: stringValue("codec"),
            mimeType: stringValue("mimeType"),
            dynamicRange: normalizeVideoDynamicRange(item.dynamicRange),
        }];
    }).slice(0, 32);
    return options.length ? options : undefined;
}

function normalizeVideoSourceResult(value: unknown): IPlugin.IVideoSourceResult | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const source = value as Record<string, unknown>;
    const url = typeof source.url === "string" ? source.url.trim() : "";
    if (!url || url.length > MAX_VIDEO_SOURCE_URL_LENGTH) {
        return null;
    }
    const stringValue = (key: string, maxLength = 256) =>
        typeof source[key] === "string" && source[key].length <= maxLength
            ? source[key]
            : undefined;
    const backupUrls = Array.isArray(source.backupUrls)
        ? source.backupUrls.flatMap((item) => {
            if (typeof item !== "string" || item.length > MAX_VIDEO_SOURCE_URL_LENGTH) {
                return [];
            }
            try {
                const parsed = new URL(item);
                return parsed.protocol === "http:" || parsed.protocol === "https:"
                    ? [parsed.toString()]
                    : [];
            } catch {
                return [];
            }
        }).slice(0, 4)
        : undefined;
    return {
        url,
        headers: normalizeVideoSourceHeaders(source.headers),
        userAgent: stringValue("userAgent", MAX_VIDEO_SOURCE_HEADER_LENGTH),
        videoQuality: stringValue("videoQuality") ?? stringValue("quality"),
        mimeType: stringValue("mimeType"),
        codec: stringValue("codec"),
        dynamicRange: normalizeVideoDynamicRange(source.dynamicRange),
        bitrate: normalizeVideoSourceNumber(source.bitrate),
        size: normalizeVideoSourceSize(source.size),
        duration: normalizeVideoSourceNumber(source.duration),
        width: normalizeVideoSourceNumber(source.width),
        height: normalizeVideoSourceNumber(source.height),
        availableVideoQualities: normalizeVideoQualityOptions(source.availableVideoQualities),
        backupUrls,
        expiresAt: normalizeVideoSourceNumber(source.expiresAt),
    };
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

/** Application media adaptation; no plugin protocol compatibility executes here. */
export default class PluginMethods {
    constructor(private readonly plugin: Plugin) {}

    async invoke<T extends PluginCapability>(capability: T, request: IPlugin.Requests[T], operation?: () => Promise<unknown>): Promise<IPlugin.Results[T]> {
        if (capability === "lyrics.get") {
            return await this.getLyric((request as IPlugin.Requests["lyrics.get"]).entity) as IPlugin.Results[T];
        }
        const result = await (operation ? operation() : this.plugin.invokeRaw(capability, request));
        if (capability === "media.resolve") {
            return await this.normalizeMediaSource(result, request as IPlugin.Requests["media.resolve"]) as IPlugin.Results[T];
        }
        if (capability === "media.video") return normalizeVideoSourceResult(result) as IPlugin.Results[T];
        return this.normalizeEntities(result, capability) as IPlugin.Results[T];
    }

    private normalizeEntities(result: unknown, capability: PluginCapability): unknown {
        if (!result || typeof result !== "object") return result;
        const normalize = (entity: unknown) => {
            if (!entity || typeof entity !== "object" || Array.isArray(entity)) return entity;
            return { ...entity, platform: this.plugin.id, $pluginDelegateHash: this.plugin.id };
        };
        const record = result as Record<string, unknown>;
        if (Array.isArray(record.items)) return { ...record, items: record.items.map(normalize),
            ...(record.entity ? { entity: normalize(record.entity) } : {}) };
        if (capability === "recognition.identify" && Array.isArray(record.candidates)) {
            return { ...record, candidates: record.candidates.map(normalize) };
        }
        return ["entities.get", "collections.get", "links.resolve"].includes(capability) ? normalize(result) : result;
    }

    private async normalizeMediaSource(value: unknown, request: IPlugin.Requests["media.resolve"]): Promise<IPlugin.IMediaSourceResult | null> {
        const declared = getDeclaredQualityKeys(request.entity);
        if (request.quality && declared.length && !declared.includes(request.quality)) return null;
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const source = value as IPlugin.IMediaSourceResult;
        if (typeof source.url !== "string" || !source.url || source.url.length > 8192) return null;
        const headers = normalizeVideoSourceHeaders(source.headers);
        if (source.ekey) {
            const localUrl = await ServiceManager.registerMflacStream(source.url, source.ekey, headers);
            if (localUrl) return { ...source, url: `${localUrl}${getSourceAudioExt(source.url) ?? ""}`, headers: undefined, ekey: undefined };
        }
        if (source.cek) {
            const localUrl = await ServiceManager.registerLunaStream(source.url, source.cek, headers);
            if (localUrl) return { ...source, url: `${localUrl}.m4a`, headers: undefined, cek: undefined };
        }
        return { ...source, headers,
            quality: typeof source.quality === "string" && source.quality.trim() ? source.quality.trim() as IMusic.IQualityKey : undefined,
            userAgent: source.userAgent ?? headers?.["user-agent"] ?? headers?.["User-Agent"] };
    }

    private async getLyric(entity: IMusic.IMusicItemPartial): Promise<ILyric.ILyricSource | null> {
        let source: ILyric.ILyricSource | null = null;
        let sourceFailure: unknown;
        try {
            source = await this.plugin.invokeRaw("lyrics.get", { entity }) as ILyric.ILyricSource | null;
        } catch (error) {
            sourceFailure = error;
        }
        const result: ILyric.ILyricSource = { ...source };
        result.rawLrc = source?.rawLrc || entity.rawLrc;
        const localPath = getInternalData<IMusic.IMusicItemInternalData>(entity as IMedia.IMediaBase, "downloadData")?.path
            || entity.$$localPath || entity.localPath;
        if (localPath) {
            const authorizedPath = await assertLocalSourceAccess(localPath);
            const basePath = path.join(path.dirname(authorizedPath), path.parse(authorizedPath).name);
            const readSidecar = async (paths: string[], extensions: string[]) => {
                for (const base of paths) {
                    for (const ext of extensions) {
                        const filePath = assertPathAccess(base + ext, { allowMissing: true, extraRoots: [path.dirname(authorizedPath)] });
                        if ((await safeStat(filePath))?.isFile()) return { text: autoDecryptLyric(await decodeTextFile(filePath)), format: getLyricFormat(filePath) };
                    }
                }
                return null;
            };
            const original = await readSidecar([basePath], localLyricSidecarExtensions);
            if (original?.text.trim()) {
                result.rawLrc = original.text; result.format = original.format;
            }
            result.translation = (await readSidecar([`${basePath}-tr`, `${basePath}.tran`], secondaryLyricSidecarExtensions))?.text ?? result.translation;
            result.romanization = (await readSidecar([`${basePath}.roma`, `${basePath}-roma`], secondaryLyricSidecarExtensions))?.text ?? result.romanization;
        }
        if (result.rawLrc || result.translation || result.romanization || result.lrc) return result;
        if (sourceFailure) throw sourceFailure;
        return null;
    }
}
