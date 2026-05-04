import {
    filterQualityOrderByDeclaredQualities,
    getMediaPrimaryKey,
    getQualityOrder,
    isSameMedia,
    setInternalData,
} from "@/common/media-util";
import * as Comlink from "comlink";
import { DownloadState, localPluginName } from "@/common/constant";
import PQueue from "p-queue";
import {
    addDownloadedMusicToList,
    isDownloaded,
    removeDownloadedMusic,
    setupDownloadedMusicList,
    useDownloaded,
    useDownloadedMusicList,
} from "./downloaded-sheet";
import { getGlobalContext } from "@/shared/global-context/renderer";
import Store from "@/common/store";
import { useEffect, useState } from "react";
import { DownloadEvts, ee } from "./ee";
import AppConfig from "@shared/app-config/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import logger from "@shared/logger/renderer";
import getUrlExt from "@/renderer/utils/get-url-ext";
import { IDownloadPostprocessPayload } from "@/common/download-postprocess";
import { buildDownloadPostprocessPayload } from "./postprocess";


export interface IDownloadStatus {
    state: DownloadState;
    downloaded?: number;
    total?: number;
    msg?: string;
}

const downloadingMusicStore = new Store<Array<IMusic.IMusicItem>>([]);
const downloadingProgress = new Map<string, IDownloadStatus>();

type ProxyMarkedFunction<T extends (...args: any) => void> = T &
  Comlink.ProxyMarked;

type IOnStateChangeFunc = (data: IDownloadStatus) => void;

interface IDownloaderWorker {
    downloadFile: (
        mediaSource: IMusic.IMusicSource,
        filePath: string,
        onStateChange: ProxyMarkedFunction<IOnStateChangeFunc>
    ) => Promise<void>;
    postprocessDownloadedFile: (
        filePath: string,
        payload?: IDownloadPostprocessPayload | null,
    ) => Promise<void>;
}

let downloaderWorker: IDownloaderWorker;

async function setupDownloader() {
    setupDownloaderWorker();
    setupDownloadedMusicList();
}

function setupDownloaderWorker() {
    // 初始化 worker
    const downloaderWorkerPath = getGlobalContext().workersPath.downloader;
    if (downloaderWorkerPath) {
        const worker = new Worker(downloaderWorkerPath);
        downloaderWorker = Comlink.wrap(worker);
    }
    setDownloadingConcurrency(AppConfig.getConfig("download.concurrency"));
}

const concurrencyLimit = 20;
const downloadingQueue = new PQueue({
    concurrency: 5,
});

function setDownloadingConcurrency(concurrency: number) {
    if (isNaN(concurrency)) {
        return;
    }
    downloadingQueue.concurrency = Math.min(
        concurrency < 1 ? 1 : concurrency,
        concurrencyLimit,
    );
}

async function startDownload(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
    preferredQuality?: IMusic.IQualityKey,
) {
    if (!downloaderWorker) {
        setupDownloaderWorker();
    }

    const _musicItems = Array.isArray(musicItems) ? musicItems : [musicItems];
    const _validMusicItems = _musicItems.filter(
        (it) => !isDownloaded(it) && it.platform !== localPluginName,
    );

    const downloadCallbacks = _validMusicItems.map((it) => {
        const pk = getMediaPrimaryKey(it);
        downloadingProgress.set(pk, {
            state: DownloadState.WAITING,
        });

        return async () => {
            if (!downloadingProgress.has(pk)) {
                return;
            }

            downloadingProgress.get(pk).state = DownloadState.DOWNLOADING;
            const fileName = `${it.title}-${it.artist}`.replace(/[/|\\?*"<>:]/g, "_");
            await new Promise<void>((resolve) => {
                downloadMusicImpl(it, fileName, preferredQuality, (stateData) => {
                    downloadingProgress.set(pk, stateData);
                    ee.emit(DownloadEvts.DownloadStatusUpdated, it, stateData);
                    if (stateData.state === DownloadState.DONE) {
                        downloadingMusicStore.setValue((prev) =>
                            prev.filter((di) => !isSameMedia(it, di)),
                        );
                        downloadingProgress.delete(pk);
                        resolve();
                    } else if (stateData.state === DownloadState.ERROR) {
                        resolve();
                    }
                });
            });
        };
    });

    downloadingMusicStore.setValue((prev) => [...prev, ..._validMusicItems]);
    downloadingQueue.addAll(downloadCallbacks);
}

async function downloadMusicImpl(
    musicItem: IMusic.IMusicItem,
    fileName: string,
    preferredQuality: IMusic.IQualityKey | undefined,
    onStateChange: IOnStateChangeFunc,
) {
    const [defaultQuality, whenQualityMissing] = [
        preferredQuality ?? AppConfig.getConfig("download.defaultQuality"),
        AppConfig.getConfig("download.whenQualityMissing"),
    ];
    const qualityOrder = filterQualityOrderByDeclaredQualities(
        musicItem,
        getQualityOrder(defaultQuality, whenQualityMissing),
    );
    let mediaSource: IPlugin.IMediaSourceResult | null = null;
    let realQuality: IMusic.IQualityKey = qualityOrder[0] ?? defaultQuality;
    for (const quality of qualityOrder) {
        try {
            mediaSource = await PluginManager.callPluginDelegateMethod(
                musicItem,
                "getMediaSource",
                musicItem,
                quality,
            );
            if (!mediaSource?.url) {
                continue;
            }
            realQuality = quality;
            break;
        } catch {
            continue;
        }
    }

    try {
        if (mediaSource?.url) {
            const ext = getUrlExt(mediaSource.url)?.slice(1) ?? "mp3";
            const downloadBasePath =
        AppConfig.getConfig("download.path") ??
        getGlobalContext().appPath.downloads;
            const downloadPath = window.path.resolve(
                downloadBasePath,
                `./${fileName}.${ext}`,
            );
            downloaderWorker.downloadFile(
                mediaSource,
                downloadPath,
                Comlink.proxy((dataState) => {
                    if (dataState.state === DownloadState.DONE) {
                        void finalizeDownloadedMusic(
                            musicItem,
                            downloadPath,
                            realQuality,
                        ).finally(() => {
                            onStateChange(dataState);
                        });
                        return;
                    }
                    onStateChange(dataState);
                }),
            );
        } else {
            throw new Error("Invalid Source");
        }
    } catch (e) {
        onStateChange({
            state: DownloadState.ERROR,
            msg: e?.message,
        });
    }
}

async function finalizeDownloadedMusic(
    musicItem: IMusic.IMusicItem,
    downloadPath: string,
    realQuality: IMusic.IQualityKey,
) {
    const downloadedMusic = setInternalData<IMusic.IMusicItemInternalData>(
        musicItem as any,
        "downloadData",
        {
            path: downloadPath,
            quality: realQuality,
        },
        true,
    ) as IMusic.IMusicItem;

    try {
        const payload = await buildDownloadPostprocessPayload(musicItem);
        if (payload) {
            await downloaderWorker.postprocessDownloadedFile(downloadPath, payload);
        }
    } catch (error) {
        logger.logError("下载后写入标签失败", error as Error, {
            musicItem: {
                id: musicItem.id,
                platform: musicItem.platform,
                title: musicItem.title,
                artist: musicItem.artist,
            },
            downloadPath,
        });
    }

    addDownloadedMusicToList(downloadedMusic);
}

function useDownloadStatus(musicItem: IMusic.IMusicItem) {
    const [downloadStatus, setDownloadStatus] = useState<IDownloadStatus | null>(
        null,
    );

    useEffect(() => {
        setDownloadStatus(
            downloadingProgress.get(getMediaPrimaryKey(musicItem)) || null,
        );

        const updateFn = (mi: IMusic.IMusicItem, stateData: IDownloadStatus) => {
            if (isSameMedia(mi, musicItem)) {
                setDownloadStatus(stateData);
            }
        };

        ee.on(DownloadEvts.DownloadStatusUpdated, updateFn);

        return () => {
            ee.off(DownloadEvts.DownloadStatusUpdated, updateFn);
        };
    }, [musicItem]);

    return downloadStatus;
}

// 下载状态
function useDownloadState(musicItem: IMusic.IMusicItem) {
    const musicStatus = useDownloadStatus(musicItem);
    const downloaded = useDownloaded(musicItem);

    return (
        musicStatus?.state || (downloaded ? DownloadState.DONE : DownloadState.NONE)
    );
}

const Downloader = {
    setupDownloader,
    startDownload,
    useDownloadStatus,
    useDownloadingMusicList: downloadingMusicStore.useValue,
    useDownloaded,
    isDownloaded,
    useDownloadedMusicList,
    removeDownloadedMusic,
    setDownloadingConcurrency,
    useDownloadState,
};
export default Downloader;

