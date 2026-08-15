import type { LxScriptInfo, LxSource } from "./lx-types";

const lxQualityOrder: readonly IMusic.IQualityKey[] = [
    "mgg",
    "128k",
    "192k",
    "320k",
    "flac",
    "flac24bit",
    "hires",
    "vinyl",
    "dolby",
    "atmos",
    "atmos_plus",
    "master",
];

function normalizeInfoValue(value: string | undefined, maxLength: number) {
    return (value ?? "").trim().slice(0, maxLength);
}

export function parseLxScriptInfo(code: string, fallbackName: string): LxScriptInfo {
    const header = /^\uFEFF?\s*\/\*[\s\S]*?\*\//.exec(code)?.[0] ?? "";
    const values: Record<string, string> = {};
    for (const line of header.split(/\r?\n/)) {
        const match = /^\s*\*?\s*@([A-Za-z]+)\s+(.+?)\s*$/.exec(line);
        if (match) {
            values[match[1].toLocaleLowerCase()] = match[2];
        }
    }
    return {
        name: normalizeInfoValue(values.name, 128)
            || normalizeInfoValue(fallbackName, 128)
            || "LX Source",
        description: normalizeInfoValue(values.description, 512),
        version: normalizeInfoValue(values.version, 64),
        author: normalizeInfoValue(values.author, 128),
        homepage: normalizeInfoValue(values.homepage, 2048),
    };
}

function formatDuration(value: unknown) {
    if (typeof value === "string" && /^\d{1,3}:\d{2}$/.test(value)) {
        return value;
    }
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) {
        return null;
    }
    const normalizedSeconds = seconds > 100_000 ? Math.floor(seconds / 1000) : Math.floor(seconds);
    return `${Math.floor(normalizedSeconds / 60).toString().padStart(2, "0")}:${
        (normalizedSeconds % 60).toString().padStart(2, "0")
    }`;
}

function getQualityHash(
    source: LxSource,
    quality: IMusic.IQualityKey,
    musicItem: Record<string, unknown>,
) {
    if (source !== "kg") {
        return undefined;
    }
    if (quality === "320k") {
        return musicItem["320hash"] ?? musicItem.hash ?? musicItem.id;
    }
    if (["flac", "flac24bit"].includes(quality)) {
        return musicItem.sqhash ?? musicItem.hash ?? musicItem.id;
    }
    if (["hires", "master"].includes(quality)) {
        return musicItem.ResFileHash ?? musicItem.sqhash ?? musicItem.hash ?? musicItem.id;
    }
    return musicItem.hash ?? musicItem.id;
}

export function toLxMusicInfo(
    source: LxSource,
    musicItem: IMusic.IMusicItemPartial,
) {
    const raw = musicItem as Record<string, unknown>;
    const rawQualities = raw.qualities && typeof raw.qualities === "object"
        ? raw.qualities as Record<string, { size?: unknown } | undefined>
        : {};
    const types = Object.entries(rawQualities).flatMap(([quality, value]) => {
        if (!value || typeof value !== "object") {
            return [];
        }
        const hash = getQualityHash(source, quality as IMusic.IQualityKey, raw);
        return [{
            type: quality,
            size: value.size == null ? null : String(value.size),
            ...(hash == null ? {} : { hash: String(hash) }),
        }];
    });
    const qualityMap = Object.fromEntries(types.map((quality) => [
        quality.type,
        {
            size: quality.size,
            ...(quality.hash == null ? {} : { hash: quality.hash }),
        },
    ]));
    const songId = source === "tx"
        ? raw.songmid ?? raw.mid ?? raw.id
        : source === "kg"
            ? raw.songmid ?? raw.audio_id ?? raw.album_audio_id ?? raw.id
            : source === "mg"
                ? raw.songmid ?? raw.songId ?? raw.id
                : raw.songmid ?? raw.id;
    const albumId = raw.albumId ?? raw.album_id ?? raw.albumid ?? "";
    const albumName = raw.album ?? raw.albumName ?? "";
    const artwork = raw.artwork ?? raw.img ?? "";
    const meta: Record<string, unknown> = {
        songId,
        albumName,
        albumId,
        picUrl: artwork,
        qualitys: types,
        _qualitys: qualityMap,
    };
    if (source === "kg") {
        meta.hash = raw.hash ?? raw.id;
    } else if (source === "tx") {
        meta.strMediaMid = raw.strMediaMid ?? raw.mediaMid ?? raw.songmid ?? raw.mid ?? raw.id;
        meta.albumMid = raw.albumMid ?? raw.albummid ?? "";
        meta.id = raw.songId ?? raw.id;
    } else if (source === "mg") {
        meta.copyrightId = raw.copyrightId ?? raw.id;
        meta.lrcUrl = raw.lrcUrl ?? raw.lrc;
        meta.mrcUrl = raw.mrcUrl;
        meta.trcUrl = raw.trcUrl;
    }
    return {
        ...raw,
        id: raw.id == null ? "" : String(raw.id),
        name: String(raw.title ?? raw.name ?? ""),
        singer: String(raw.artist ?? raw.singer ?? ""),
        source,
        songmid: songId,
        interval: formatDuration(raw.duration ?? raw.interval),
        albumName,
        albumId,
        img: artwork,
        types,
        _types: qualityMap,
        typeUrl: {},
        ...(source === "kg" ? { hash: raw.hash ?? raw.id } : {}),
        ...(source === "tx" ? {
            strMediaMid: meta.strMediaMid,
            albumMid: meta.albumMid,
            songId: meta.id,
        } : {}),
        ...(source === "mg" ? {
            copyrightId: meta.copyrightId,
            lrcUrl: meta.lrcUrl,
            mrcUrl: meta.mrcUrl,
            trcUrl: meta.trcUrl,
        } : {}),
        meta,
    };
}

export function getLxMusicQualityKeys(
    musicItem: IMusic.IMusicItemPartial,
    supportedQualities: readonly IMusic.IQualityKey[],
    useSupportedQualities = false,
) {
    const rawMusicItem = musicItem as IMusic.IMusicItemPartial & {
        qualities?: IMusic.IQuality;
        source?: Partial<Record<IMusic.IQualityKey, {
            size?: string | number;
            url?: string;
        }>>;
    };
    const baseQualities = rawMusicItem.qualities
        && typeof rawMusicItem.qualities === "object"
        ? rawMusicItem.qualities
        : {};
    const qualityKeys = Object.keys(baseQualities);
    if (qualityKeys.length) {
        if (useSupportedQualities) {
            return [...supportedQualities];
        }
        return supportedQualities.filter((quality) => baseQualities[quality] !== undefined);
    }
    if (useSupportedQualities) {
        return [...supportedQualities];
    }
    const source = rawMusicItem.source && typeof rawMusicItem.source === "object"
        ? rawMusicItem.source
        : {};
    return supportedQualities.filter((quality) => {
        const sourceItem = source[quality];
        return sourceItem?.url !== undefined || sourceItem?.size !== undefined;
    });
}

export function getLxQualityFallbacks(
    quality: IMusic.IQualityKey,
    supportedQualities: readonly IMusic.IQualityKey[],
) {
    const qualityIndex = lxQualityOrder.indexOf(quality);
    const supportedSet = new Set(supportedQualities);
    if (qualityIndex < 0) {
        return supportedSet.has(quality) ? [quality] : [];
    }
    return [
        quality,
        ...lxQualityOrder.slice(0, qualityIndex).reverse(),
    ].filter((candidate) => supportedSet.has(candidate));
}

export function replaceLxMusicQualities<T extends IMusic.IMusicItemPartial>(
    musicItem: T,
    supportedQualities: readonly IMusic.IQualityKey[],
    useSupportedQualities = false,
): T {
    const mutableMusicItem = musicItem as T & { qualities?: IMusic.IQuality };
    const baseQualities = mutableMusicItem.qualities
        && typeof mutableMusicItem.qualities === "object"
        ? mutableMusicItem.qualities
        : {};
    const musicQualities = getLxMusicQualityKeys(
        musicItem,
        supportedQualities,
        useSupportedQualities,
    );
    mutableMusicItem.qualities = Object.fromEntries(musicQualities.map((quality) => [
        quality,
        baseQualities[quality] && typeof baseQualities[quality] === "object"
            ? { ...baseQualities[quality] }
            : {},
    ]));
    return musicItem;
}
