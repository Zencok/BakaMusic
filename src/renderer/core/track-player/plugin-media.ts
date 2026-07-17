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
