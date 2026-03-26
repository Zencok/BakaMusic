import {
    getDefaultDownloadTagWriteOptions,
    hasDownloadPostprocessEnabled,
    IDownloadPostprocessPayload,
    IDownloadPostprocessMusicItem,
    IDownloadTagWriteOptions,
    needsLyricForDownloadPostprocess,
    normalizeDownloadLyricOrder,
} from "@/common/download-postprocess";
import AppConfig from "@shared/app-config/renderer";
import logger from "@shared/logger/renderer";
import PluginManager from "@shared/plugin-manager/renderer";

function pickMusicItemPayload(
    musicItem: IMusic.IMusicItem,
): IDownloadPostprocessMusicItem {
    return {
        id: musicItem.id,
        platform: musicItem.platform,
        title: musicItem.title,
        artist: musicItem.artist,
        album: musicItem.album,
    };
}

async function resolveCoverUrl(
    musicItem: IMusic.IMusicItem,
    options: IDownloadTagWriteOptions,
) {
    if (!options.writeMetadata || !options.writeMetadataCover) {
        return undefined;
    }

    if (typeof musicItem.artwork === "string" && musicItem.artwork.trim()) {
        return musicItem.artwork.trim();
    }

    try {
        const musicInfo = await PluginManager.callPluginDelegateMethod(
            musicItem,
            "getMusicInfo",
            musicItem,
        );

        if (typeof musicInfo?.artwork === "string" && musicInfo.artwork.trim()) {
            return musicInfo.artwork.trim();
        }
    } catch (error) {
        logger.logError("获取下载封面失败", error as Error, {
            musicItem: pickMusicItemPayload(musicItem),
        });
    }

    return undefined;
}

async function resolveLyricSource(
    musicItem: IMusic.IMusicItem,
    options: IDownloadTagWriteOptions,
) {
    if (!needsLyricForDownloadPostprocess(options)) {
        return null;
    }

    try {
        return await PluginManager.callPluginDelegateMethod(
            musicItem,
            "getLyric",
            musicItem,
        );
    } catch (error) {
        logger.logError("获取下载歌词失败", error as Error, {
            musicItem: pickMusicItemPayload(musicItem),
        });
        return null;
    }
}

export function getDownloadTagWriteOptions(): IDownloadTagWriteOptions {
    const defaults = getDefaultDownloadTagWriteOptions();

    return {
        writeMetadata: AppConfig.getConfig("download.writeMetadata")
            ?? defaults.writeMetadata,
        writeMetadataCover: AppConfig.getConfig("download.writeMetadataCover")
            ?? defaults.writeMetadataCover,
        writeMetadataLyric: AppConfig.getConfig("download.writeMetadataLyric")
            ?? defaults.writeMetadataLyric,
        downloadLyricFile: AppConfig.getConfig("download.downloadLyricFile")
            ?? defaults.downloadLyricFile,
        lyricFileFormat: AppConfig.getConfig("download.lyricFileFormat")
            ?? defaults.lyricFileFormat,
        lyricOrder: normalizeDownloadLyricOrder(
            AppConfig.getConfig("download.lyricOrder"),
        ),
        enableWordByWordLyric: AppConfig.getConfig("download.enableWordByWordLyric")
            ?? defaults.enableWordByWordLyric,
    };
}

export async function buildDownloadPostprocessPayload(
    musicItem: IMusic.IMusicItem,
): Promise<IDownloadPostprocessPayload | null> {
    const options = getDownloadTagWriteOptions();
    if (!hasDownloadPostprocessEnabled(options)) {
        return null;
    }

    const [coverUrl, lyricSource] = await Promise.all([
        resolveCoverUrl(musicItem, options),
        resolveLyricSource(musicItem, options),
    ]);

    return {
        musicItem: pickMusicItemPayload(musicItem),
        coverUrl,
        lyricSource,
        options,
    };
}

