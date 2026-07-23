import { localPluginName, qualityKeys, qualityText } from "@/common/constant";
import { getInternalData } from "@/common/media-util";
import PluginManager from "@shared/plugin-manager/renderer";
import {
    formatQualitySize,
    getMusicQualitySize,
} from "./music-quality-metadata";

export {
    getQualityAbbr,
} from "./music-quality-metadata";

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

const spatialAudioQualityKeys: IMusic.IQualityKey[] = [
    "dolby",
    "atmos",
    "atmos_plus",
];

export function isSpatialAudioQuality(quality: IMusic.IQualityKey) {
    return spatialAudioQualityKeys.includes(quality);
}

export function isMasterQuality(quality: IMusic.IQualityKey) {
    return quality === "master";
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

function getAvailableQualityChoices(
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
