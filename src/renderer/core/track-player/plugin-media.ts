export interface IPluginDelegateReference {
    platform: string;
    hash?: string;
}

export interface IPluginMediaReference {
    platform: string;
    id: string;
    [key: string]: unknown;
}

export const pluginDelegateHashKey = "$pluginDelegateHash";

const IDENTIFIER_ALIAS_KEYS = [
    "songid",
    "songmid",
    "mid",
    "hash",
    "copyrightId",
] as const;

type IdentifierAliasKey = (typeof IDENTIFIER_ALIAS_KEYS)[number];

function nonEmptyString(value: unknown): string | null {
    if (value == null) {
        return null;
    }
    const text = String(value).trim();
    return text.length ? text : null;
}

/**
 * Different plugins use different fields for a manually entered song ID.
 * Populate the established aliases so each plugin can interpret the value.
 */
export function createMusicIdentifierBase(platform: string, input: string): IPluginMediaReference {
    const identifier = String(input).trim();

    return {
        platform,
        id: identifier,
        songid: identifier,
        songmid: identifier,
        mid: identifier,
        hash: identifier,
        copyrightId: identifier,
    };
}

/** Prefer the plugin's canonical id when present; otherwise keep the user input. */
export function resolveMusicItemId(
    input: string,
    musicInfo?: { id?: unknown } | null,
): string {
    return nonEmptyString(musicInfo?.id) ?? String(input).trim();
}

/**
 * Keep mid/hash/etc. aliases available for getMediaSource even after the
 * canonical id is replaced by the plugin response.
 */
export function pickMusicIdentifierAliases(
    input: string,
    musicInfo?: Record<string, unknown> | null,
): Record<IdentifierAliasKey, string> {
    const identifier = String(input).trim();
    const aliases = {} as Record<IdentifierAliasKey, string>;

    for (const key of IDENTIFIER_ALIAS_KEYS) {
        aliases[key] = nonEmptyString(musicInfo?.[key]) ?? identifier;
    }

    return aliases;
}

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
    const aliases = pickMusicIdentifierAliases(input, info);
    const resolvedId = resolveMusicItemId(input, info);
    const title = nonEmptyString(info?.title) ?? identifierBase.id;
    const artist = nonEmptyString(info?.artist) ?? "";

    return {
        ...identifierBase,
        ...(info ?? {}),
        ...aliases,
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
    if (!pluginDelegate.hash) {
        return mediaItem;
    }

    return {
        ...mediaItem,
        [pluginDelegateHashKey]: pluginDelegate.hash,
    };
}

export function getMediaPluginDelegate(
    mediaItem: IPluginMediaReference,
): IPluginDelegateReference {
    const pluginHash = mediaItem?.[pluginDelegateHashKey];

    return {
        platform: mediaItem.platform,
        ...(typeof pluginHash === "string" && pluginHash
            ? { hash: pluginHash }
            : {}),
    };
}
