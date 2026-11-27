import { isV2Media } from "@/common/media-util";
export interface IPluginDelegateReference {
    platform: string;
    id?: string;
    hash?: string;
}

export interface IPluginMediaReference {
    platform: string;
    id: string | number;
    [key: string]: unknown;
}

export interface IPrefetchedMediaSource {
    mediaSource: {
        url?: string;
        headers?: Record<string, string>;
        userAgent?: string;
        quality?: string;
        ekey?: string;
        cek?: string;
    };
    quality: PrefetchedQualityKey;
}

type PrefetchedQualityKey =
    | "96k"
    | "128k"
    | "192k"
    | "320k"
    | "flac"
    | "flac24bit"
    | "hires"
    | "vinyl"
    | "dolby"
    | "atmos"
    | "atmos_plus"
    | "master";

const pluginDelegateIdKey = "$pluginDelegateId";

const PREFETCH_TTL_MS = 3 * 60 * 1000;
const PREFETCH_MAX_ENTRIES = 64;
let prefetchRevision = 0;
export function getPrefetchedMediaSourceRevision() {
    return prefetchRevision;
}
export function invalidatePrefetchedMediaSources() {
    prefetchRevision += 1;
    prefetchedMediaSources.clear();
}
const prefetchedMediaSources = new Map<string, {
    value: IPrefetchedMediaSource;
    expiresAt: number;
}>();

function nonEmptyString(value: unknown): string | null {
    if (value == null) {
        return null;
    }
    const text = String(value).trim();
    return text.length ? text : null;
}

function getPrefetchedMediaSourceKey(
    mediaItem: IPluginMediaReference,
    quality: PrefetchedQualityKey,
) {
    const delegate = getMediaPluginDelegate(mediaItem);
    return JSON.stringify([delegate.id ?? delegate.platform, mediaItem.platform, mediaItem.id, quality]);
}

function trimPrefetchedMediaSources(now = Date.now()) {
    for (const [key, entry] of prefetchedMediaSources) {
        if (entry.expiresAt <= now) {
            prefetchedMediaSources.delete(key);
        }
    }
    while (prefetchedMediaSources.size > PREFETCH_MAX_ENTRIES) {
        const oldestKey = prefetchedMediaSources.keys().next().value;
        if (oldestKey === undefined) {
            break;
        }
        prefetchedMediaSources.delete(oldestKey);
    }
}

/** Store a short-lived source resolved before the user presses play. */
export function cachePrefetchedMediaSource(
    mediaItem: IPluginMediaReference,
    quality: PrefetchedQualityKey,
    mediaSource: IPrefetchedMediaSource["mediaSource"],
    expectedRevision = prefetchRevision,
) {
    if (!mediaSource?.url || expectedRevision !== prefetchRevision) {
        return;
    }
    const now = Date.now();
    trimPrefetchedMediaSources(now);
    prefetchedMediaSources.set(getPrefetchedMediaSourceKey(mediaItem, quality), {
        value: { mediaSource, quality },
        expiresAt: now + PREFETCH_TTL_MS,
    });
    trimPrefetchedMediaSources(now);
}

/** Find a still-valid source for one of the player's quality fallbacks. */
export function getPrefetchedMediaSource(
    mediaItem: IPluginMediaReference,
    qualityOrder: PrefetchedQualityKey[],
): IPrefetchedMediaSource | null {
    const now = Date.now();
    trimPrefetchedMediaSources(now);
    for (const quality of qualityOrder) {
        const entry = prefetchedMediaSources.get(getPrefetchedMediaSourceKey(mediaItem, quality));
        if (entry && entry.expiresAt > now) {
            return entry.value;
        }
    }
    return null;
}

/**
 * Different plugins use different fields for a manually entered song ID.
 * Populate the established aliases so each plugin can interpret the value.
 */
export function createMusicIdentifierBase(platform: string, input: string): IPluginMediaReference {
    const identifier = String(input).trim();

    return { platform, id: identifier };
}

/** Prefer the plugin's canonical id when present; otherwise keep the user input. */
export function resolveMusicItemId(
    input: string,
    musicInfo?: { id?: unknown } | null,
): string | number {
    const id = musicInfo?.id;
    return typeof id === "number" && Number.isFinite(id) ? id : nonEmptyString(id) ?? String(input).trim();
}

/**
 * Keep mid/hash/etc. aliases available for getMediaSource even after the
 * canonical id is replaced by the plugin response.
 */
export interface IPlayByIdMusicItem extends IPluginMediaReference {
    title: string;
    artist: string;
    songid?: string;
    songmid?: string;
    mid?: string;
    hash?: string;
    copyrightId?: string;
}

/**
 * Build a playable music item from a user-entered id and optional getMusicInfo result.
 * When musicInfo is missing, falls back to bare aliases so getMediaSource can still run.
 */
export function buildPlayByIdMusicItem(
    platform: string,
    input: string,
    musicInfo?: Record<string, unknown> | null,
): IPlayByIdMusicItem {
    const identifierBase = createMusicIdentifierBase(platform, input);
    const info =
        musicInfo && typeof musicInfo === "object"
            ? musicInfo
            : null;
    const resolvedId = resolveMusicItemId(input, info);
    const title = nonEmptyString(info?.title) ?? String(identifierBase.id);
    const artist = nonEmptyString(info?.artist) ?? "";

    return {
        ...identifierBase,
        ...(info ?? {}),
        id: resolvedId,
        platform,
        title,
        artist,
    };
}

/** Match queue items by canonical id or any common plugin identifier alias. */
export function matchesMusicIdentifier(
    item: {
        platform?: string;
        id?: unknown;
        songid?: unknown;
        songmid?: unknown;
        mid?: unknown;
        hash?: unknown;
        copyrightId?: unknown;
    } | null | undefined,
    platform: string,
    input: string,
): boolean {
    if (!item || item.platform !== platform) {
        return false;
    }

    const target = String(input).trim();
    if (!target) {
        return false;
    }

    if (isV2Media(item)) return item.id === input;

    const candidates = [
        item.id,
        item.songid,
        item.songmid,
        item.mid,
        item.hash,
        item.copyrightId,
    ];

    return candidates.some((value) => value != null && String(value) === target);
}

/** Keep the selected plugin identity separate from media fields such as Kugou's song hash. */
export function bindMediaToPlugin<T extends IPluginMediaReference>(
    mediaItem: T,
    pluginDelegate: IPluginDelegateReference,
): T {
    if (!pluginDelegate.id && !pluginDelegate.hash) {
        return mediaItem;
    }

    return {
        ...mediaItem,
        [pluginDelegateIdKey]: pluginDelegate.id ?? pluginDelegate.hash,
    };
}

export function getMediaPluginDelegate(
    mediaItem: IPluginMediaReference,
): IPluginDelegateReference {
    const pluginHash = mediaItem?.[pluginDelegateIdKey] ?? mediaItem?.["$pluginDelegateHash"];

    return {
        platform: mediaItem.platform,
        ...(typeof pluginHash === "string" && pluginHash
            ? { id: pluginHash, hash: pluginHash }
            : {}),
    };
}
