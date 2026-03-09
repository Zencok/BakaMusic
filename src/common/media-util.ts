import { produce, setAutoFreeze } from "immer";
import {
    internalDataKey,
    localPluginName,
    qualityKeys,
    sortIndexSymbol,
    timeStampSymbol,
} from "./constant";
import { parseDurationSeconds } from "./time-util";
setAutoFreeze(false);

type IDurationCarrier = IMedia.IMediaBase & {
    duration?: number;
};

function setNormalizedDuration<T extends IMedia.IMediaBase>(
    mediaItem: T,
    duration?: number,
) {
    if (duration !== undefined) {
        (mediaItem as IDurationCarrier).duration = duration;
    }
    return mediaItem;
}

function getNormalizedDuration(mediaItem?: IMedia.IMediaBase | null) {
    if (!mediaItem) {
        return undefined;
    }

    const secondCandidates = [
        mediaItem.duration,
        mediaItem.interval,
        mediaItem.DURATION,
        mediaItem?._gitcodeData?.duration,
    ];

    for (const candidate of secondCandidates) {
        const normalizedDuration = parseDurationSeconds(candidate);
        if (normalizedDuration !== undefined) {
            return normalizedDuration;
        }
    }

    const millisecondCandidates = [
        mediaItem.dt,
        mediaItem.durationMs,
        mediaItem.duration_ms,
    ];

    for (const candidate of millisecondCandidates) {
        const normalizedDuration = parseDurationSeconds(candidate);
        if (normalizedDuration !== undefined) {
            return Math.floor(normalizedDuration / 1000);
        }
    }

    return undefined;
}

export function isSameMedia(
    a?: IMedia.IMediaBase | null,
    b?: IMedia.IMediaBase | null,
) {
    if (a && b) {
        return a.id === b.id && a.platform === b.platform;
    }
    return false;
}

export function resetMediaItem<T extends IMedia.IMediaBase>(
    mediaItem: T,
    platform?: string,
    newObj?: boolean,
): T {
    const normalizedDuration = getNormalizedDuration(mediaItem);

    // 本地音乐不做处理
    if (mediaItem.platform === localPluginName || platform === localPluginName) {
        if (!newObj) {
            return setNormalizedDuration(mediaItem, normalizedDuration);
        }
        return {
            ...mediaItem,
            ...(normalizedDuration !== undefined
                ? { duration: normalizedDuration }
                : {}),
        };
    }
    if (!newObj) {
        mediaItem.platform = platform ?? mediaItem.platform;
        mediaItem[internalDataKey] = undefined;
        return setNormalizedDuration(mediaItem, normalizedDuration);
    } else {
        return produce(mediaItem, (_) => {
            _.platform = platform ?? mediaItem.platform;
            _[internalDataKey] = undefined;
            setNormalizedDuration(_, normalizedDuration);
        });
    }
}

export function getMediaPrimaryKey(mediaItem: IMedia.IUnique) {
    if (mediaItem) {
        return `${mediaItem.platform}@${mediaItem.id}`;
    }
    return "invalid@invalid";
}

export function sortByTimestampAndIndex(array: any[], newArray = false) {
    if (newArray) {
        array = [...array];
    }
    return array.sort((a, b) => {
        const ts = a[timeStampSymbol] - b[timeStampSymbol];
        if (ts !== 0) {
            return ts;
        }
        return a[sortIndexSymbol] - b[sortIndexSymbol];
    });
}

export function addSortProperty(
    mediaItems: IMedia.IMediaBase | IMedia.IMediaBase[],
) {
    const now = Date.now();
    if (Array.isArray(mediaItems)) {
        mediaItems.forEach((item, index) => {
            if (!item) {
                return;
            }
            item[timeStampSymbol] = now;
            item[sortIndexSymbol] = index;
        });
    } else {
        if (!mediaItems) {
            return;
        }
        mediaItems[timeStampSymbol] = now;
        mediaItems[sortIndexSymbol] = 0;
    }
}

export function flatMediaItem<T extends IMedia.IMediaBase>(mediaItem: T) {
    if (!mediaItem) {
        return mediaItem;
    }

    return {
        ...mediaItem,
        ...(mediaItem?.$raw || {}),
        platform: mediaItem.platform || mediaItem?.$raw?.platform,
        id: mediaItem.id || mediaItem?.$raw?.id,
    } as T;
}

export function removeInternalProperties<T extends IMedia.IMediaBase>(
    mediaItem: T,
) {
    if (!mediaItem) {
        return mediaItem;
    }

    const keys = Object.keys(mediaItem);
    return keys.reduce((obj, key) => {
        if (!key.startsWith("$")) {
            obj[key] = mediaItem[key];
        }
        return obj;
    }, {} as any) as T;
}

/**
 *  获取音质顺序
 *
 * higher: 优先高音质
 * lower：优先低音质
 */
export function getQualityOrder(
    qualityKey: IMusic.IQualityKey,
    sort: "higher" | "lower" | "skip",
) {
    if (sort === "skip") {
        return [qualityKey];
    }

    const idx = qualityKeys.indexOf(qualityKey);
    const left = qualityKeys.slice(0, idx);
    const right = qualityKeys.slice(idx + 1);
    if (sort === "higher") {
    /** 优先高音质 */
        return [qualityKey, ...right, ...left.reverse()];
    } else {
    /** 优先低音质 */
        return [qualityKey, ...left.reverse(), ...right];
    }
}

export function getDeclaredQualityKeys(
    mediaItem?: Partial<IMusic.IMusicItem> | null,
) {
    const qualities = mediaItem?.qualities as IMusic.IQuality | undefined;
    if (qualities && typeof qualities === "object" && Object.keys(qualities).length > 0) {
        return qualityKeys.filter((quality) => qualities[quality] !== undefined);
    }

    const source =
        mediaItem?.source && typeof mediaItem.source === "object"
            ? mediaItem.source as Partial<Record<IMusic.IQualityKey, {
                url?: string;
                size?: string | number;
            }>>
            : undefined;

    if (source) {
        return qualityKeys.filter((quality) => {
            const sourceItem = source[quality];
            return !!sourceItem && (
                sourceItem.url !== undefined ||
                sourceItem.size !== undefined
            );
        });
    }

    return [];
}

export function filterQualityOrderByDeclaredQualities(
    mediaItem: Partial<IMusic.IMusicItem> | null | undefined,
    qualityOrder: IMusic.IQualityKey[],
) {
    const declaredQualityKeys = getDeclaredQualityKeys(mediaItem);
    if (!declaredQualityKeys.length) {
        return qualityOrder;
    }

    const declaredQualitySet = new Set(declaredQualityKeys);
    return qualityOrder.filter((quality) => declaredQualitySet.has(quality));
}

/** 获取内部属性 */
export function getInternalData<
    T extends Record<string, any>,
    K extends keyof T = keyof T,
>(mediaItem: IMedia.IMediaBase, internalProp: K): T[K] | null {
    if (!mediaItem || !mediaItem[internalDataKey]) {
        return null;
    }
    return mediaItem[internalDataKey][internalProp] ?? null;
}

export function setInternalData<
    T extends Record<string, any>,
    K extends keyof T = keyof T,
    R extends IMedia.IMediaBase = IMedia.IMediaBase,
>(mediaItem: R, internalProp: K, value: T[K] | null, newObj = false): R {
    if (newObj) {
        return {
            ...mediaItem,
            [internalDataKey]: {
                ...(mediaItem[internalDataKey] ?? {}),
                [internalProp]: value,
            },
        };
    }

    mediaItem[internalDataKey] = mediaItem[internalDataKey] ?? {};
    mediaItem[internalDataKey][internalProp] = value;
    return mediaItem;
}

export function toMediaBase(media: IMedia.IMediaBase) {
    return {
        platform: media.platform,
        id: media.id,
    };
}
