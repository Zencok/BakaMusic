import {
    formatLyricsByTimestamp,
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
import nodeRuntime from "@shared/node-runtime/renderer";
import { getMediaPluginDelegate } from "@/renderer/core/track-player/plugin-media";

/** Plugin getLyric / getMusicInfo must not block the download DONE path forever. */
const POSTPROCESS_PLUGIN_TIMEOUT_MS = 20_000;

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

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`${label} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

/** Use the same artwork field the plugin already put on the music item. */
function resolveCoverUrlFromItem(musicItem: IMusic.IMusicItem): string | undefined {
    const raw = musicItem.artwork;
    if (typeof raw !== "string") {
        return undefined;
    }
    let url = raw.trim();
    if (!url) {
        return undefined;
    }
    if (url.startsWith("//")) {
        url = `https:${url}`;
    }
    if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url)) {
        return url;
    }
    return undefined;
}

async function resolveCoverUrl(
    musicItem: IMusic.IMusicItem,
    options: IDownloadTagWriteOptions,
) {
    if (!options.writeMetadata || !options.writeMetadataCover) {
        return undefined;
    }

    const fromItem = resolveCoverUrlFromItem(musicItem);
    if (fromItem) {
        return fromItem;
    }

    // Same as play detail: ask the plugin for full music info when artwork missing.
    const pluginDelegate = getMediaPluginDelegate(musicItem);
    try {
        const musicInfo = await withTimeout(
            PluginManager.callPluginDelegateMethod(
                pluginDelegate,
                "getMusicInfo",
                musicItem,
            ),
            POSTPROCESS_PLUGIN_TIMEOUT_MS,
            "getMusicInfo",
        );
        if (musicInfo && typeof musicInfo === "object") {
            return resolveCoverUrlFromItem(musicInfo as IMusic.IMusicItem);
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

    const pluginDelegate = getMediaPluginDelegate(musicItem);
    try {
        return await withTimeout(
            PluginManager.callPluginDelegateMethod(
                pluginDelegate,
                "getLyric",
                musicItem,
            ),
            POSTPROCESS_PLUGIN_TIMEOUT_MS,
            "getLyric",
        );
    } catch (error) {
        logger.logError("获取下载歌词失败", error as Error, {
            musicItem: pickMusicItemPayload(musicItem),
        });
        return null;
    }
}

function getDownloadTagWriteOptions(): IDownloadTagWriteOptions {
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

/**
 * Plugin owns media identity / artwork / lyrics.
 * Main only pulls cover bytes with bare net.fetch.
 * Utility only writes the prepared payload to disk.
 */
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

    let coverImage: IDownloadPostprocessPayload["coverImage"];
    if (coverUrl) {
        try {
            const fetchCover = (
                nodeRuntime as {
                    fetchCoverImage?: (url: string) => Promise<{
                        dataBase64: string;
                        mimeType: string;
                    }>;
                }
            ).fetchCoverImage;
            if (typeof fetchCover !== "function") {
                throw new Error("fetchCoverImage IPC is unavailable (restart app)");
            }
            coverImage = await fetchCover(coverUrl);
        } catch (error) {
            logger.logError("下载封面拉取失败", error as Error, {
                musicItem: pickMusicItemPayload(musicItem),
                coverUrl: coverUrl.slice(0, 200),
            });
        }
    }

    let lyricContent = "";
    if (lyricSource?.rawLrc) {
        lyricContent = formatLyricsByTimestamp(
            lyricSource.rawLrc,
            lyricSource.translation,
            lyricSource.romanization,
            options.lyricOrder,
            {
                enableWordByWord: options.enableWordByWordLyric === true,
                format: lyricSource.format,
            },
        );
    }

    return {
        musicItem: pickMusicItemPayload(musicItem),
        coverUrl,
        coverImage,
        lyricContent,
        options,
    };
}
