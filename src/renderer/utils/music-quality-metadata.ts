import { qualityKeys } from "../../common/constant";
import { getInternalData } from "../../common/media-util";
import { normalizeFileSize } from "../../common/normalize-util";

type MusicQualitySource = Partial<Record<
    IMusic.IQualityKey,
    { size?: string | number; url?: string }
>>;

interface IMusicQualityInfo {
    quality: IMusic.IQualityKey;
    label: string;
    sizeText: string;
}

const qualityAbbr: Record<IMusic.IQualityKey, string> = {
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

function getQualityContainers(musicItem: IMusic.IMusicItem) {
    const qualities = musicItem?.qualities as IMusic.IQuality | undefined;
    const source = musicItem?.source && typeof musicItem.source === "object"
        ? musicItem.source as MusicQualitySource
        : undefined;

    return { qualities, source };
}

export function getQualityAbbr(quality: IMusic.IQualityKey) {
    return qualityAbbr[quality] || "HQ";
}

export function getMusicQualitySize(
    musicItem: IMusic.IMusicItem,
    quality: IMusic.IQualityKey,
) {
    const { qualities, source } = getQualityContainers(musicItem);
    if (qualities?.[quality]?.size !== undefined && qualities[quality]?.size !== null) {
        return qualities[quality]?.size;
    }

    if (source?.[quality]?.size !== undefined && source[quality]?.size !== null) {
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

export function getBestMusicQualityInfo(
    musicItem: IMusic.IMusicItem,
): IMusicQualityInfo | null {
    const { qualities, source } = getQualityContainers(musicItem);
    const downloadedData = getInternalData<IMusic.IMusicItemInternalData>(
        musicItem,
        "downloadData",
    );
    const quality = [...qualityKeys].reverse().find((item) => {
        if (qualities?.[item] !== undefined) {
            return true;
        }

        const sourceItem = source?.[item];
        return downloadedData?.quality === item || !!sourceItem && (
            sourceItem.url !== undefined
            || sourceItem.size !== undefined
        );
    });

    if (!quality) {
        return null;
    }

    const size = qualities?.[quality]?.size
        ?? source?.[quality]?.size
        ?? (musicItem as { size?: string | number }).size;

    return {
        quality,
        label: getQualityAbbr(quality),
        sizeText: formatQualitySize(size),
    };
}
