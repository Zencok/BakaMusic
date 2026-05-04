import {
    getDeclaredQualityKeys,
    getInternalData,
    resetMediaItem,
} from "@/common/media-util";
import type { Plugin } from "./plugin";
import fs from "fs/promises";
import { delay } from "@/common/time-util";
import axios from "axios";
import { safeStat } from "@/common/file-util";
import path from "path";
import { autoDecryptLyric } from "./lyric-decrypt";
import ServiceManager from "@shared/service-manager/main";

/** 新音质 -> 旧插件兼容的音质键 (用于旧插件不认识新音质时的回退) */
const newToLegacyQualityMap: Record<string, string> = {
    "mgg": "low",
    "128k": "low",
    "192k": "standard",
    "320k": "high",
    "flac": "super",
    "flac24bit": "super",
    "hires": "super",
    "vinyl": "super",
    "dolby": "super",
    "atmos": "super",
    "atmos_plus": "super",
    "master": "super",
};

const sourceExtAliasMap: Record<string, string> = {
    ".mflac": ".flac",
    ".mgg": ".ogg",
    ".mmp4": ".mp4",
};

const validAudioExtSet = new Set([
    ".mp3",
    ".flac",
    ".ogg",
    ".mp4",
    ".m4a",
    ".aac",
    ".wav",
    ".opus",
    ".m4s",
]);

function normalizeSourceExt(ext?: string | null) {
    if (!ext) {
        return null;
    }

    const normalizedExt = (sourceExtAliasMap[ext.toLowerCase()] ?? ext.toLowerCase()).trim();
    return validAudioExtSet.has(normalizedExt) ? normalizedExt : null;
}

function getSourceAudioExt(url?: string, visited = new Set<string>()): string | null {
    if (!url || visited.has(url)) {
        return null;
    }
    visited.add(url);

    try {
        const urlObj = new URL(url);
        const directExt = normalizeSourceExt(
            path.posix.extname(decodeURIComponent(urlObj.pathname)),
        );
        if (directExt) {
            return directExt;
        }

        for (const paramKey of ["url", "src", "file", "filename", "path"]) {
            const nestedUrl = urlObj.searchParams.get(paramKey);
            if (!nestedUrl) {
                continue;
            }

            const nestedExt = getSourceAudioExt(decodeURIComponent(nestedUrl), visited);
            if (nestedExt) {
                return nestedExt;
            }
        }
    } catch {
        return normalizeSourceExt(path.posix.extname(url.split(/[?#]/)[0] ?? ""));
    }

    return null;
}

export default class PluginMethods implements IPlugin.IPluginInstanceMethods {
    private plugin;
    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }
    /** 搜索 */
    async search<T extends IMedia.SupportMediaType>(
        query: string,
        page: number,
        type: T,
    ): Promise<IPlugin.ISearchResult<T>> {
        if (!this.plugin.instance.search) {
            return {
                isEnd: true,
                data: [],
            };
        }

        const result = await this.plugin.instance.search(query, page, type);
        if (Array.isArray(result.data)) {
            result.data.forEach((_) => {
                resetMediaItem(_, this.plugin.name);
            });
            return {
                isEnd: result.isEnd ?? true,
                data: result.data,
            };
        }
        return {
            isEnd: true,
            data: [],
        };
    }

    /** 获取真实源 */
    async getMediaSource(
        musicItem: IMedia.IMediaBase,
        quality: IMusic.IQualityKey = "128k",
        retryCount = 1,
        _notUpdateCache = false,
    ): Promise<IPlugin.IMediaSourceResult | null> {
    // TODO 2. url 缓存策略，先略过

        // 3 插件解析
        if (!this.plugin.instance.getMediaSource) {
            return { url: musicItem?.qualities?.[quality]?.url ?? musicItem.url };
        }
        try {
            const declaredQualityKeys = getDeclaredQualityKeys(musicItem);
            if (declaredQualityKeys.length && !declaredQualityKeys.includes(quality)) {
                return null;
            }

            // 先用新音质键请求，如果插件不认识则回退到旧音质键
            let result = await this.plugin.instance.getMediaSource(
                musicItem,
                quality,
            );
            if (!result?.url) {
                // 新音质键没结果，尝试旧插件兼容的音质键
                const legacyQuality = newToLegacyQualityMap[quality];
                if (legacyQuality && legacyQuality !== quality) {
                    result = await this.plugin.instance.getMediaSource(
                        musicItem,
                        legacyQuality as any,
                    );
                }
            }
            const { url, headers } = result ?? { url: musicItem?.qualities?.[quality]?.url };
            if (!url) {
                throw new Error("NOT RETRY");
            }

            // Intercept ekey: register with mflac-proxy for transparent decryption
            if (result?.ekey && url) {
                try {
                    const localUrl = await ServiceManager.registerMflacStream(url, result.ekey, headers);
                    if (localUrl) {
                        const sourceExt = getSourceAudioExt(url);
                        return {
                            url: sourceExt ? `${localUrl}${sourceExt}` : localUrl,
                        } as IPlugin.IMediaSourceResult;
                    }
                } catch {
                    return {
                        url,
                        headers,
                        userAgent: headers?.["user-agent"],
                    } as IPlugin.IMediaSourceResult;
                }
            }

            const mediaResult = {
                url,
                headers,
                userAgent: headers?.["user-agent"],
            } as IPlugin.IMediaSourceResult;

            //   if (pluginCacheControl !== CacheControl.NoStore && !notUpdateCache) {
            //     Cache.update(musicItem, [
            //       ["headers", result.headers],
            //       ["userAgent", result.userAgent],
            //       [`qualities.${quality}.url`, url],
            //     ]);
            //   }

            return mediaResult;
        } catch (e: any) {
            if (retryCount > 0 && e?.message !== "NOT RETRY") {
                await delay(150);
                return this.plugin.methods.getMediaSource(
                    musicItem,
                    quality,
                    --retryCount,
                );
            }
            // devLog('error', '获取真实源失败', e, e?.message);
            return null;
        }
    }

    /** 获取音乐详情 */
    async getMusicInfo(
        musicItem: IMedia.IMediaBase,
    ): Promise<Partial<IMusic.IMusicItem> | null> {
        if (!this.plugin.instance.getMusicInfo) {
            return null;
        }
        try {
            return (
                this.plugin.instance.getMusicInfo(
                    resetMediaItem(musicItem, undefined, true),
                ) ?? null
            );
        } catch {
            // devLog('error', '获取音乐详情失败', e, e?.message);
            return null;
        }
    }

    /** 获取歌词 */
    async getLyric(
        musicItem: IMusic.IMusicItem,
    ): Promise<ILyric.ILyricSource | null> {
        const mergeLyricText = (
            currentValue?: string,
            nextValue?: string | null,
        ) => {
            if (typeof nextValue === "string" && nextValue.trim().length) {
                return nextValue;
            }
            return currentValue;
        };
        const decryptLyricText = (value?: string) => {
            if (!value) {
                return value;
            }
            return autoDecryptLyric(value);
        };
        const readLocalLyric = async (basePaths: string[], exts: string[]) => {
            for (const basePath of basePaths) {
                for (const ext of exts) {
                    const filePath = basePath + ext;
                    if ((await safeStat(filePath))?.isFile()) {
                        return fs.readFile(filePath, "utf8");
                    }
                }
            }
            return undefined;
        };

        let rawLrc = mergeLyricText(undefined, musicItem.rawLrc);
        let lrcUrl = musicItem.lrc;
        let translation: string | undefined;
        let romanization: string | undefined;

        const localPath =
            getInternalData<IMusic.IMusicItemInternalData>(musicItem, "downloadData")
                ?.path || musicItem.$$localPath;
        if (localPath) {
            const fileName = path.parse(localPath).name;
            const localDir = path.dirname(localPath);
            const exts = [".lrc", ".LRC", ".txt"];
            const translationBasePaths = [
                path.join(localDir, `${fileName}-tr`),
                path.join(localDir, `${fileName}.tran`),
            ];
            const romanizationBasePaths = [
                path.join(localDir, `${fileName}.roma`),
                path.join(localDir, `${fileName}-roma`),
            ];
            rawLrc = rawLrc ?? await readLocalLyric([path.join(localDir, fileName)], exts);
            translation = translation ?? await readLocalLyric(translationBasePaths, exts);
            romanization = romanization ?? await readLocalLyric(romanizationBasePaths, exts);
        }

        try {
            const lrcSource = await this.plugin.instance?.getLyric?.(
                resetMediaItem(musicItem, undefined, true),
            );

            rawLrc = mergeLyricText(rawLrc, lrcSource?.rawLrc);
            translation = mergeLyricText(translation, lrcSource?.translation);
            romanization = mergeLyricText(romanization, lrcSource?.romanization);

            if (lrcSource?.lrc) {
                lrcUrl = lrcSource.lrc;
            }
        } catch {
            // trace('插件获取歌词失败', e?.message, 'error');
            // devLog('error', '插件获取歌词失败', e, e?.message);
        }

        if (!rawLrc && lrcUrl) {
            try {
                rawLrc = mergeLyricText(
                    rawLrc,
                    (await axios.get(lrcUrl, { timeout: 5000 })).data,
                );
            } catch {
                lrcUrl = undefined;
            }
        }

        rawLrc = decryptLyricText(rawLrc);
        translation = decryptLyricText(translation);
        romanization = decryptLyricText(romanization);

        if (rawLrc || translation || romanization) {
            return {
                rawLrc,
                translation,
                romanization,
                lrc: lrcUrl,
            };
        }

        return null;
    }

    /** 获取专辑信息 */
    async getAlbumInfo(
        albumItem: IAlbum.IAlbumItem,
        page = 1,
    ): Promise<IPlugin.IAlbumInfoResult | null> {
        if (!this.plugin.instance.getAlbumInfo) {
            return {
                albumItem,
                musicList: (albumItem?.musicList ?? []).map((it) =>
                    resetMediaItem(it, this.plugin.name),
                ),
                isEnd: true,
            };
        }
        try {
            const result = await this.plugin.instance.getAlbumInfo(
                resetMediaItem(albumItem, undefined, true),
                page,
            );
            if (!result) {
                throw new Error();
            }
            result?.musicList?.forEach((_) => {
                resetMediaItem(_, this.plugin.name);
                _.album = albumItem.title;
            });

            if (page <= 1) {
                // 合并信息
                return {
                    albumItem: { ...albumItem, ...(result?.albumItem ?? {}) },
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            } else {
                return {
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            }
        } catch {
            // trace('获取专辑信息失败', e?.message);
            // devLog('error', '获取专辑信息失败', e, e?.message);

            return null;
        }
    }

    /** 获取歌单信息 */
    async getMusicSheetInfo(
        sheetItem: IMusic.IMusicSheetItem,
        page = 1,
    ): Promise<IPlugin.ISheetInfoResult | null> {
        if (!this.plugin.instance.getMusicSheetInfo) {
            return {
                sheetItem,
                musicList: sheetItem?.musicList ?? [],
                isEnd: true,
            };
        }
        try {
            const result = await this.plugin.instance?.getMusicSheetInfo?.(
                resetMediaItem(sheetItem, undefined, true),
                page,
            );
            if (!result) {
                throw new Error();
            }
            result?.musicList?.forEach((_) => {
                resetMediaItem(_, this.plugin.name);
            });

            if (page <= 1) {
                // 合并信息
                return {
                    sheetItem: { ...sheetItem, ...(result?.sheetItem ?? {}) },
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            } else {
                return {
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            }
        } catch {
            // trace('获取歌单信息失败', e, e?.message);
            // devLog('error', '获取歌单信息失败', e, e?.message);

            return null;
        }
    }

    /** 查询作者信息 */
    async getArtistWorks<T extends IArtist.ArtistMediaType>(
        artistItem: IArtist.IArtistItem,
        page: number,
        type: T,
    ): Promise<IPlugin.ISearchResult<T>> {
        if (!this.plugin.instance.getArtistWorks) {
            return {
                isEnd: true,
                data: [],
            };
        }
        const result = await this.plugin.instance.getArtistWorks(
            artistItem,
            page,
            type,
        );
        if (!result.data) {
            return {
                isEnd: true,
                data: [],
            };
        }
        result.data?.forEach((_) => resetMediaItem(_, this.plugin.name));
        return {
            isEnd: result.isEnd ?? true,
            data: result.data,
        };
    }

    /** 导入歌单 */
    async importMusicSheet(urlLike: string): Promise<IMusic.IMusicItem[]> {
        try {
            const result =
        (await this.plugin.instance?.importMusicSheet?.(urlLike)) ?? [];
            result.forEach((_) => resetMediaItem(_, this.plugin.name));
            return result;
        } catch {
            // devLog('error', '导入歌单失败', e, e?.message);

            return [];
        }
    }
    /** 导入单曲 */
    async importMusicItem(urlLike: string): Promise<IMusic.IMusicItem | null> {
        try {
            const result = await this.plugin.instance?.importMusicItem?.(urlLike);
            if (!result) {
                throw new Error();
            }
            resetMediaItem(result, this.plugin.name);
            return result;
        } catch {
            // devLog('error', '导入单曲失败', e, e?.message);

            return null;
        }
    }
    /** 获取榜单 */
    async getTopLists(): Promise<IMusic.IMusicSheetGroupItem[]> {
        try {
            const result = await this.plugin.instance?.getTopLists?.();
            if (!result) {
                throw new Error();
            }
            return result;
        } catch {
            // devLog('error', '获取榜单失败', e, e?.message);
            return [];
        }
    }
    /** 获取榜单详情 */
    async getTopListDetail(
        topListItem: IMusic.IMusicSheetItem,
        page: number,
    ): Promise<IPlugin.ITopListInfoResult> {
        try {
            const result = await this.plugin.instance?.getTopListDetail?.(
                topListItem,
                page,
            );
            if (!result) {
                throw new Error();
            }
            if (result.musicList) {
                result.musicList.forEach((_) => resetMediaItem(_, this.plugin.name));
            }
            if (result.isEnd !== false) {
                result.isEnd = true;
            }
            return result;
        } catch {
            // devLog('error', '获取榜单详情失败', e, e?.message);
            return {
                isEnd: true,
                topListItem,
                musicList: [],
            };
        }
    }

    /** 获取推荐歌单的tag */
    async getRecommendSheetTags(): Promise<IPlugin.IGetRecommendSheetTagsResult> {
        try {
            const result = await this.plugin.instance?.getRecommendSheetTags?.();
            if (!result) {
                throw new Error();
            }
            return result;
        } catch {
            // devLog('error', '获取推荐歌单失败', e, e?.message);
            return {
                data: [],
            };
        }
    }
    /** 获取某个tag的推荐歌单 */
    async getRecommendSheetsByTag(
        tagItem: IMedia.IUnique,
        page?: number,
    ): Promise<ICommon.PaginationResponse<IMusic.IMusicSheetItem>> {
        try {
            const result = await this.plugin.instance?.getRecommendSheetsByTag?.(
                tagItem,
                page ?? 1,
            );
            if (!result) {
                throw new Error();
            }
            if (result.isEnd !== false) {
                result.isEnd = true;
            }
            if (!result.data) {
                result.data = [];
            }
            result.data.forEach((item) => resetMediaItem(item, this.plugin.name));

            return result;
        } catch {
            // devLog('error', '获取推荐歌单详情失败', e, e?.message);
            return {
                isEnd: true,
                data: [],
            };
        }
    }

    async getMusicComments(musicItem: IMusic.IMusicItem, page = 1): Promise<IPlugin.IGetCommentResult> {
        try {
            const result = await this.plugin.instance?.getMusicComments?.(
                musicItem,
                page,
            );
            if (!result || typeof result !== "object") {
                throw new Error();
            }
            return {
                isEnd: result.isEnd === false ? false : true,
                data: Array.isArray(result.data) ? result.data.filter(Boolean) : [],
            };
        } catch {
            return {
                isEnd: true,
                data: [],
            };
        }
    }
}
