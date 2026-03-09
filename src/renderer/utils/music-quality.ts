import { qualityKeys, qualityText } from "@/common/constant";
import { normalizeFileSize } from "@/common/normalize-util";
import PluginManager from "@shared/plugin-manager/renderer";

export interface IMusicQualityChoice {
    value: IMusic.IQualityKey;
    label: string;
}

export function getQualityDisplayText(
    quality: IMusic.IQualityKey,
    t: (key: string) => string,
) {
    const translated = t(`media.music_quality_${quality}`);
    if (translated && translated !== `media.music_quality_${quality}`) {
        return translated;
    }
    return qualityText[quality] || quality.toUpperCase();
}

export function getMusicQualitySize(
    musicItem: IMusic.IMusicItem,
    quality: IMusic.IQualityKey,
) {
    const qualities = musicItem?.qualities as IMusic.IQuality | undefined;
    if (qualities?.[quality]?.size !== undefined && qualities?.[quality]?.size !== null) {
        return qualities[quality]?.size;
    }

    const source =
        musicItem?.source && typeof musicItem.source === "object"
            ? musicItem.source as Partial<Record<IMusic.IQualityKey, { size?: string | number; url?: string }>>
            : undefined;

    if (source?.[quality]?.size !== undefined && source?.[quality]?.size !== null) {
        return source[quality]?.size;
    }

    return undefined;
}

export function formatQualitySize(size?: string | number) {
    if (size === undefined || size === null || size === "") {
        return "";
    }

    if (typeof size === "number") {
        return normalizeFileSize(size);
    }

    const normalizedNumber = Number(size);
    if (!isNaN(normalizedNumber) && isFinite(normalizedNumber)) {
        return normalizeFileSize(normalizedNumber);
    }

    return `${size}`;
}

export function getAvailableQualityChoices(
    musicItem: IMusic.IMusicItem,
    t: (key: string) => string,
): IMusicQualityChoice[] {
    const qualities = musicItem?.qualities as IMusic.IQuality | undefined;
    const source =
        musicItem?.source && typeof musicItem.source === "object"
            ? musicItem.source as Partial<Record<IMusic.IQualityKey, { size?: string | number; url?: string }>>
            : undefined;

    return [...qualityKeys].reverse()
        .filter((quality) => {
            if (qualities?.[quality] !== undefined) {
                return true;
            }

            const sourceItem = source?.[quality];
            return !!sourceItem && (
                sourceItem.url !== undefined ||
                sourceItem.size !== undefined
            );
        })
        .map((quality) => {
            const sizeText = formatQualitySize(getMusicQualitySize(musicItem, quality));
            return {
                value: quality,
                label: sizeText
                    ? `${getQualityDisplayText(quality, t)} (${sizeText})`
                    : getQualityDisplayText(quality, t),
            };
        });
}

export function getPreferredQualityChoices(
    t: (key: string) => string,
    musicItem?: IMusic.IMusicItem | null,
): IMusicQualityChoice[] {
    return [...qualityKeys].reverse().map((quality) => {
        const sizeText = musicItem
            ? formatQualitySize(getMusicQualitySize(musicItem, quality))
            : "";

        return {
            value: quality,
            label: sizeText
                ? `${getQualityDisplayText(quality, t)} (${sizeText})`
                : getQualityDisplayText(quality, t),
        };
    });
}

export async function resolveMusicQualityChoices(
    musicItem: IMusic.IMusicItem,
    t: (key: string) => string,
    options?: {
        fallbackToPreferred?: boolean;
    },
) {
    let detailMusic = musicItem;
    let choices = getAvailableQualityChoices(detailMusic, t);

    if (!choices.length && PluginManager.isSupportFeatureMethod(musicItem.platform, "getMusicInfo")) {
        const musicInfo = await PluginManager.callPluginDelegateMethod(
            { platform: musicItem.platform },
            "getMusicInfo",
            musicItem,
        ).catch(() => null);

        if (musicInfo && typeof musicInfo === "object") {
            detailMusic = {
                ...musicItem,
                ...musicInfo,
                platform: musicItem.platform,
                id: musicItem.id,
            };
            choices = getAvailableQualityChoices(detailMusic, t);
        }
    }

    if (!choices.length && options?.fallbackToPreferred) {
        choices = getPreferredQualityChoices(t, detailMusic);
    }

    return {
        detailMusic,
        choices,
    };
}
