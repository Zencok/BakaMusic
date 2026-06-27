import { localPluginName, qualityKeys, qualityText } from "@/common/constant";
import { getInternalData } from "@/common/media-util";
import { normalizeFileSize } from "@/common/normalize-util";
import PluginManager from "@shared/plugin-manager/renderer";

export interface IMusicQualityChoice {
    value: IMusic.IQualityKey;
    label: string;
    qualityLabel: string;
    sizeText: string;
}

interface IResolvedMusicQualityChoices {
    detailMusic: IMusic.IMusicItem;
    choices: IMusicQualityChoice[];
}

export const aiUpscaleQualityKeys: IMusic.IQualityKey[] = [
    "master",
    "atmos_plus",
    "atmos",
];

export const qualityAbbr: Record<IMusic.IQualityKey, string> = {
    "mgg": "MG",
    "128k": "LQ",
    "192k": "MQ",
    "320k": "HQ",
    "flac": "SQ",
    "flac24bit": "HR",
    "hires": "HR",
    "vinyl": "VN",
    "dolby": "DB",
    "atmos": "AT",
    "atmos_plus": "A+",
    "master": "MS",
};

export function isAiUpscaleQuality(quality: IMusic.IQualityKey) {
    return aiUpscaleQualityKeys.includes(quality);
}

export function getQualityAbbr(quality: IMusic.IQualityKey) {
    return qualityAbbr[quality] || "HQ";
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

    const downloadedData = getInternalData<IMusic.IMusicItemInternalData>(
        musicItem,
        "downloadData",
    );
    if (downloadedData?.quality === quality) {
        return (musicItem as { size?: string | number })?.size;
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

function createMusicQualityChoice(
    quality: IMusic.IQualityKey,
    t: (key: string) => string,
    sizeText = "",
): IMusicQualityChoice {
    const qualityLabel = getQualityDisplayText(quality, t);

    return {
        value: quality,
        qualityLabel,
        sizeText,
        label: sizeText ? `${qualityLabel} (${sizeText})` : qualityLabel,
    };
}

export function getAvailableQualityChoices(
    musicItem: IMusic.IMusicItem,
    t: (key: string) => string,
): IMusicQualityChoice[] {
    const downloadedData = getInternalData<IMusic.IMusicItemInternalData>(
        musicItem,
        "downloadData",
    );
    if (musicItem?.platform === localPluginName && downloadedData?.path && downloadedData.quality) {
        const sizeText = formatQualitySize(getMusicQualitySize(musicItem, downloadedData.quality));
        return [createMusicQualityChoice(downloadedData.quality, t, sizeText)];
    }

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
            return createMusicQualityChoice(quality, t, sizeText);
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

        return createMusicQualityChoice(quality, t, sizeText);
    });
}

export async function resolveMusicQualityChoices(
    musicItem: IMusic.IMusicItem,
    t: (key: string) => string,
    options?: {
        fallbackToPreferred?: boolean;
    },
): Promise<IResolvedMusicQualityChoices> {
    let detailMusic = musicItem;
    let choices = getAvailableQualityChoices(detailMusic, t);

    if (!choices.length && PluginManager.isSupportFeatureMethod(musicItem.platform, "getMusicInfo")) {
        const musicInfo = await PluginManager.callPluginDelegateMethod(
            { platform: musicItem.platform },
            "getMusicInfo",
            musicItem,
        ).catch((): null => null);

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
