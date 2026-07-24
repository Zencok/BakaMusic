import { DownloadState, localPluginName } from "@/common/constant";
import { resolveDownloadExtension } from "@/common/download-extension";
import { IDownloadPostprocessPayload } from "@/common/download-postprocess";
import { toError } from "@/common/error-util";
import {
    filterQualityOrderByDeclaredQualities,
    getMediaPrimaryKey,
    getQualityOrder,
    isSameMedia,
    setInternalData,
} from "@/common/media-util";
import Store from "@/common/store";
import AppConfig from "@shared/app-config/renderer";
import { getGlobalContext } from "@shared/global-context/renderer";
import logger from "@shared/logger/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import PQueue from "p-queue";
import { useEffect, useState } from "react";
import {
    addDownloadedMusicToList,
    isDownloaded,
    removeDownloadedMusic,
    setupDownloadedMusicList,
    useDownloaded,
    useDownloadedMusicList,
} from "./downloaded-sheet";
import { DownloadEvts, ee } from "./ee";
import { buildDownloadPostprocessPayload } from "./postprocess";
import { resolveFilePath } from "@/common/path-util";
import {
    buildDownloadFileBaseName,
    DEFAULT_FILE_NAMING_CONFIG,
    type FileNamingPreset,
    type FileNamingType,
} from "@/common/file-naming-formatter";
import nodeRuntime from "@shared/node-runtime/renderer";
import { getMediaPluginDelegate } from "@/renderer/core/track-player/plugin-media";

interface IDownloadStatus {
    state: DownloadState;
    downloaded?: number;
    total?: number;
    msg?: string;
    speed?: number;
    updatedAt?: number;
    /** Final path when download completes (may be extension-corrected). */
    filePath?: string;
}

export interface IDownloadTaskSnapshot {
    musicItem: IMusic.IMusicItem;
    status: IDownloadStatus;
}

interface IDownloadTaskControl {
    musicItem: IMusic.IMusicItem;
    preferredQuality?: IMusic.IQualityKey;
    runId: number;
    release?: () => void;
}

type IOnStateChangeFunc = (data: IDownloadStatus) => void;

interface IDownloaderWorker {
    downloadFile: (
        taskId: string,
        mediaSource: IMusic.IMusicSource,
        filePath: string,
        onStateChange: IOnStateChangeFunc,
    ) => Promise<void>;
    abortDownload: (taskId: string, removePartial?: boolean) => Promise<void>;
    postprocessDownloadedFile: (
        filePath: string,
        payload?: IDownloadPostprocessPayload | null,
    ) => Promise<void>;
    /** Optional warm-up so the first real download does not pay process spawn cost. */
    warmUp?: () => Promise<void>;
}

const downloadingMusicStore = new Store<IMusic.IMusicItem[]>([]);
const downloadingTaskStore = new Store<IDownloadTaskSnapshot[]>([]);
const downloadingProgress = new Map<string, IDownloadStatus>();
const taskControls = new Map<string, IDownloadTaskControl>();
const downloadingQueue = new PQueue({ concurrency: 5 });
const concurrencyLimit = 20;
let downloaderWorker: IDownloaderWorker | undefined;
let downloaderWorkerRecovering = false;
let lastDownloadCompletedAt = 0;

function getNextDownloadCompletedAt() {
    const now = Date.now();
    lastDownloadCompletedAt = Math.max(now, lastDownloadCompletedAt + 1);
    return lastDownloadCompletedAt;
}

async function setupDownloader() {
    setupDownloaderWorker();
    await setupDownloadedMusicList();
    // Spawn node runtime early so the first download is not blocked on cold start.
    void (downloaderWorker as IDownloaderWorker | undefined)?.warmUp?.().catch((error) => {
        logger.logError("下载运行时预热失败", toError(error));
    });
}

function setupDownloaderWorker() {
    if (downloaderWorker) {
        return;
    }
    downloaderWorker = nodeRuntime as unknown as IDownloaderWorker;
    setDownloadingConcurrency(AppConfig.getConfig("download.concurrency") ?? 5);
}

function recoverDownloaderWorker(reason: unknown) {
    if (downloaderWorkerRecovering) {
        return;
    }
    downloaderWorkerRecovering = true;

    logger.logError(
        "下载 Worker 异常，正在恢复任务",
        reason instanceof ErrorEvent && reason.error instanceof Error
            ? reason.error
            : reason instanceof Error
                ? reason
                : new Error(reason instanceof Event ? reason.type : "worker failure"),
    );
    downloaderWorker = undefined;

    const interruptedTasks = downloadingTaskStore.getValue().filter(
        ({ status }) => status.state === DownloadState.DOWNLOADING,
    );
    interruptedTasks.forEach(({ musicItem }) => {
        const taskControl = taskControls.get(getMediaPrimaryKey(musicItem));
        if (!taskControl) {
            return;
        }
        taskControl.runId++;
        taskControl.release?.();
        updateTaskStatus(musicItem, { state: DownloadState.WAITING });
    });

    try {
        setupDownloaderWorker();
        interruptedTasks.forEach(({ musicItem }) => {
            const taskControl = taskControls.get(getMediaPrimaryKey(musicItem));
            if (taskControl) {
                queueTask(taskControl);
            }
        });
    } catch (error) {
        interruptedTasks.forEach(({ musicItem }) => {
            updateTaskStatus(musicItem, {
                state: DownloadState.ERROR,
                msg: toError(error).message,
            });
        });
    } finally {
        downloaderWorkerRecovering = false;
    }
}

function setDownloadingConcurrency(concurrency: number) {
    if (isNaN(concurrency)) {
        return;
    }
    downloadingQueue.concurrency = Math.min(
        concurrency < 1 ? 1 : concurrency,
        concurrencyLimit,
    );
}

function syncTaskStore() {
    downloadingTaskStore.setValue(
        downloadingMusicStore.getValue().flatMap((musicItem) => {
            const status = downloadingProgress.get(getMediaPrimaryKey(musicItem));
            return status ? [{ musicItem, status: { ...status } }] : [];
        }),
    );
}

function updateTaskStatus(
    musicItem: IMusic.IMusicItem,
    nextStatus: IDownloadStatus,
) {
    const taskId = getMediaPrimaryKey(musicItem);
    const previousStatus = downloadingProgress.get(taskId);
    const updatedAt = Date.now();
    let speed = nextStatus.speed;

    if (
        nextStatus.state === DownloadState.DOWNLOADING
        && nextStatus.downloaded !== undefined
        && previousStatus?.downloaded !== undefined
        && previousStatus.updatedAt
        && nextStatus.downloaded >= previousStatus.downloaded
    ) {
        const elapsed = (updatedAt - previousStatus.updatedAt) / 1000;
        if (elapsed > 0) {
            speed = (nextStatus.downloaded - previousStatus.downloaded) / elapsed;
        }
    }

    const status = { ...nextStatus, speed, updatedAt };
    downloadingProgress.set(taskId, status);
    ee.emit(DownloadEvts.DownloadStatusUpdated, musicItem, status);
    syncTaskStore();
}

function clearTaskStatus(musicItem: IMusic.IMusicItem) {
    downloadingProgress.delete(getMediaPrimaryKey(musicItem));
    ee.emit(DownloadEvts.DownloadStatusUpdated, musicItem, null);
}

function finishTask(musicItem: IMusic.IMusicItem) {
    const taskId = getMediaPrimaryKey(musicItem);
    const taskControl = taskControls.get(taskId);
    taskControl?.release?.();
    taskControls.delete(taskId);
    clearTaskStatus(musicItem);
    downloadingMusicStore.setValue((previous) =>
        previous.filter((item) => !isSameMedia(item, musicItem)),
    );
    syncTaskStore();
}

function queueTask(taskControl: IDownloadTaskControl) {
    const runId = ++taskControl.runId;
    updateTaskStatus(taskControl.musicItem, { state: DownloadState.WAITING });
    void downloadingQueue.add(() => runTask(taskControl, runId));
}

async function runTask(taskControl: IDownloadTaskControl, runId: number) {
    const taskId = getMediaPrimaryKey(taskControl.musicItem);
    const status = downloadingProgress.get(taskId);
    if (
        taskControls.get(taskId)?.runId !== runId
        || status?.state !== DownloadState.WAITING
    ) {
        return;
    }

    updateTaskStatus(taskControl.musicItem, { state: DownloadState.DOWNLOADING });
    await new Promise<void>((resolve) => {
        let released = false;
        taskControl.release = () => {
            if (!released) {
                released = true;
                resolve();
            }
        };

        void downloadMusicImpl(
            taskId,
            taskControl.musicItem,
            taskControl.preferredQuality,
            () => taskControls.get(taskId)?.runId !== runId,
            (stateData) => handleTaskState(taskControl, runId, stateData),
        );
    });
    taskControl.release = undefined;
}

function handleTaskState(
    taskControl: IDownloadTaskControl,
    runId: number,
    stateData: IDownloadStatus,
) {
    const taskId = getMediaPrimaryKey(taskControl.musicItem);
    if (taskControls.get(taskId)?.runId !== runId) {
        return;
    }

    if (stateData.state === DownloadState.DONE) {
        finishTask(taskControl.musicItem);
        return;
    }

    updateTaskStatus(taskControl.musicItem, stateData);
    if (stateData.state === DownloadState.ERROR) {
        taskControl.release?.();
    }
}

async function startDownload(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
    preferredQuality?: IMusic.IQualityKey,
) {
    if (!downloaderWorker) {
        setupDownloaderWorker();
    }

    const candidates = Array.isArray(musicItems) ? musicItems : [musicItems];
    const seenTaskIds = new Set<string>();
    const validMusicItems = candidates.filter((musicItem) => {
        const taskId = getMediaPrimaryKey(musicItem);
        const isValid = !seenTaskIds.has(taskId)
            && !isDownloaded(musicItem)
            && musicItem.platform !== localPluginName
            && !taskControls.has(taskId);
        seenTaskIds.add(taskId);
        return isValid;
    });

    if (!validMusicItems.length) {
        return;
    }

    downloadingMusicStore.setValue((previous) => [...previous, ...validMusicItems]);
    validMusicItems.forEach((musicItem) => {
        const taskId = getMediaPrimaryKey(musicItem);
        const taskControl = { musicItem, preferredQuality, runId: 0 };
        taskControls.set(taskId, taskControl);
        queueTask(taskControl);
    });
}

async function setTaskPaused(musicItem: IMusic.IMusicItem) {
    const taskId = getMediaPrimaryKey(musicItem);
    const taskControl = taskControls.get(taskId);
    const status = downloadingProgress.get(taskId);
    if (
        !taskControl
        || !status
        || ![DownloadState.WAITING, DownloadState.DOWNLOADING].includes(status.state)
    ) {
        return;
    }

    taskControl.runId++;
    taskControl.release?.();
    await downloaderWorker?.abortDownload(taskId, false).catch(() => undefined);
    updateTaskStatus(musicItem, {
        ...status,
        state: DownloadState.PAUSED,
        speed: 0,
    });
}

function resumeTask(musicItem: IMusic.IMusicItem) {
    const taskId = getMediaPrimaryKey(musicItem);
    const taskControl = taskControls.get(taskId);
    const status = downloadingProgress.get(taskId);
    if (
        !taskControl
        || !status
        || ![DownloadState.PAUSED, DownloadState.ERROR].includes(status.state)
    ) {
        return;
    }
    queueTask(taskControl);
}

async function removeTask(musicItem: IMusic.IMusicItem) {
    const taskId = getMediaPrimaryKey(musicItem);
    const taskControl = taskControls.get(taskId);
    if (!taskControl) {
        return;
    }

    taskControl.runId++;
    taskControl.release?.();
    taskControls.delete(taskId);
    clearTaskStatus(musicItem);
    downloadingMusicStore.setValue((previous) =>
        previous.filter((item) => !isSameMedia(item, musicItem)),
    );
    syncTaskStore();
    await downloaderWorker?.abortDownload(taskId).catch(() => undefined);
}

async function pauseAllTasks() {
    const activeTasks = downloadingTaskStore.getValue().filter(({ status }) =>
        [DownloadState.WAITING, DownloadState.DOWNLOADING].includes(status.state),
    );
    await Promise.all(activeTasks.map(({ musicItem }) => setTaskPaused(musicItem)));
}

function resumeAllTasks() {
    downloadingTaskStore.getValue().forEach(({ musicItem, status }) => {
        if (status.state === DownloadState.PAUSED) {
            resumeTask(musicItem);
        }
    });
}

async function clearTasks(states?: DownloadState[]) {
    const targets = downloadingTaskStore.getValue().filter(({ status }) =>
        !states || states.includes(status.state),
    );
    await Promise.all(targets.map(({ musicItem }) => removeTask(musicItem)));
}

async function downloadMusicImpl(
    taskId: string,
    musicItem: IMusic.IMusicItem,
    preferredQuality: IMusic.IQualityKey | undefined,
    isCancelled: () => boolean,
    onStateChange: IOnStateChangeFunc,
) {
    const [defaultQuality, whenQualityMissing] = [
        preferredQuality ?? AppConfig.getConfig("download.defaultQuality") ?? "128k",
        AppConfig.getConfig("download.whenQualityMissing") ?? "lower",
    ];
    const qualityOrder = filterQualityOrderByDeclaredQualities(
        musicItem,
        getQualityOrder(defaultQuality, whenQualityMissing),
    );
    let mediaSource: IPlugin.IMediaSourceResult | null = null;
    let realQuality: IMusic.IQualityKey = qualityOrder[0] ?? defaultQuality;

    // Surface progress immediately — getMediaSource can take several seconds
    // before the first network byte arrives.
    onStateChange({
        state: DownloadState.DOWNLOADING,
        downloaded: 0,
        total: 0,
        msg: "获取音源…",
    });

    // Same entry as track-player: plugin delegate + getMediaSource only.
    // Plugin/main (mflac/luna proxy) own the real stream URL — no client re-fetch.
    const pluginDelegate = getMediaPluginDelegate(musicItem);

    for (const quality of qualityOrder) {
        if (isCancelled()) {
            return;
        }
        try {
            mediaSource = await PluginManager.callPluginDelegateMethod(
                pluginDelegate,
                "getMediaSource",
                musicItem,
                quality,
            );
            if (mediaSource?.url) {
                realQuality = quality;
                // Prefer plugin-reported quality when present.
                if (mediaSource.quality) {
                    realQuality = mediaSource.quality;
                }
                break;
            }
        } catch (error) {
            logger.logError("下载获取音源失败", toError(error), {
                platform: musicItem.platform,
                quality,
                title: musicItem.title,
            });
            continue;
        }
    }

    if (isCancelled()) {
        return;
    }

    const worker = downloaderWorker;
    try {
        if (!mediaSource?.url) {
            throw new Error("Invalid Source");
        }
        // Extension rules mirror MusicFree prepareDownloadSource:
        // luna/cek → m4a; mflac/mgg/mmp4 → decrypted ext; else URL ext; else quality.
        const ext = resolveDownloadExtension(mediaSource.url, realQuality, {
            hasCencCek: Boolean(
                (mediaSource as IPlugin.IMediaSourceResult).cek
                || /\/l\/[a-f0-9]+(\.m4a)?$/i.test(mediaSource.url.split(/[?#]/)[0]),
            ),
        });
        const downloadBasePath = AppConfig.getConfig("download.path")
            ?? getGlobalContext().appPath.downloads;
        const fileNamingType = AppConfig.getConfig("download.fileNamingType")
            ?? DEFAULT_FILE_NAMING_CONFIG.type;
        const fileNamingPreset = AppConfig.getConfig("download.fileNamingPreset")
            ?? DEFAULT_FILE_NAMING_CONFIG.preset;
        const fileName = buildDownloadFileBaseName(
            musicItem,
            {
                type: fileNamingType as FileNamingType,
                preset: fileNamingPreset as FileNamingPreset,
                custom: AppConfig.getConfig("download.fileNamingCustom")
                    ?? DEFAULT_FILE_NAMING_CONFIG.custom,
                maxLength: AppConfig.getConfig("download.fileNamingMaxLength")
                    ?? DEFAULT_FILE_NAMING_CONFIG.maxLength,
                keepExtension: true,
            },
            realQuality,
        );
        const downloadPath = resolveFilePath(downloadBasePath, `./${fileName}.${ext}`);

        if (!worker) {
            throw new Error("Downloader worker is unavailable");
        }
        let finalizeStarted = false;
        await worker.downloadFile(
            taskId,
            mediaSource,
            downloadPath,
            (dataState) => {
                if (isCancelled()) {
                    return;
                }
                if (dataState.state !== DownloadState.DONE) {
                    onStateChange(dataState);
                    return;
                }
                // DONE may arrive both from progress events and from the RPC
                // result fallback — only finalize once.
                if (finalizeStarted) {
                    return;
                }
                finalizeStarted = true;
                const finalPath = dataState.filePath || downloadPath;
                void finalizeDownloadedMusic(musicItem, finalPath, realQuality)
                    .then(() => onStateChange({ ...dataState, filePath: finalPath }))
                    .catch((error) => {
                        logger.logError("下载收尾失败", toError(error), {
                            musicItem: {
                                id: musicItem.id,
                                platform: musicItem.platform,
                                title: musicItem.title,
                            },
                            downloadPath: finalPath,
                        });
                        onStateChange({
                            state: DownloadState.ERROR,
                            msg: toError(error).message,
                        });
                    });
            },
        );
    } catch (error) {
        if (worker === downloaderWorker) {
            recoverDownloaderWorker(toError(error));
        }
        if (!isCancelled()) {
            const err = toError(error);
            logger.logError("下载失败", err, {
                musicItem: {
                    id: musicItem.id,
                    platform: musicItem.platform,
                    title: musicItem.title,
                    artist: musicItem.artist,
                },
            });
            onStateChange({
                state: DownloadState.ERROR,
                msg: err.message,
            });
        }
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
            completedAt: getNextDownloadCompletedAt(),
        },
        true,
    ) as IMusic.IMusicItem;

    const payload = await buildDownloadPostprocessPayload(musicItem);
    if (payload) {
        const worker = downloaderWorker;
        if (!worker) {
            throw new Error("Downloader worker is unavailable");
        }
        try {
            await worker.postprocessDownloadedFile(downloadPath, payload);
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
            // Metadata write is part of a successful download when enabled.
            if (payload.options.writeMetadata) {
                throw error;
            }
        }
    }

    await addDownloadedMusicToList(downloadedMusic);
}

function useDownloadStatus(musicItem: IMusic.IMusicItem) {
    const [downloadStatus, setDownloadStatus] = useState<IDownloadStatus | null>(null);

    useEffect(() => {
        setDownloadStatus(downloadingProgress.get(getMediaPrimaryKey(musicItem)) || null);
        const updateStatus = (
            item: IMusic.IMusicItem,
            status: IDownloadStatus | null,
        ) => {
            if (isSameMedia(item, musicItem)) {
                setDownloadStatus(status);
            }
        };
        ee.on(DownloadEvts.DownloadStatusUpdated, updateStatus);
        return () => {
            ee.off(DownloadEvts.DownloadStatusUpdated, updateStatus);
        };
    }, [musicItem]);

    return downloadStatus;
}

function useDownloadState(musicItem: IMusic.IMusicItem) {
    const musicStatus = useDownloadStatus(musicItem);
    const downloaded = useDownloaded(musicItem);
    return musicStatus?.state || (downloaded ? DownloadState.DONE : DownloadState.NONE);
}

const Downloader = {
    setupDownloader,
    startDownload,
    pauseTask: setTaskPaused,
    resumeTask,
    retryTask: resumeTask,
    removeTask,
    pauseAllTasks,
    resumeAllTasks,
    clearAllTasks: () => clearTasks(),
    clearFailedTasks: () => clearTasks([DownloadState.ERROR]),
    useDownloadStatus,
    useDownloadingMusicList: downloadingMusicStore.useValue,
    useDownloadingTaskList: downloadingTaskStore.useValue,
    useDownloaded,
    isDownloaded,
    useDownloadedMusicList,
    removeDownloadedMusic,
    setDownloadingConcurrency,
    useDownloadState,
};

export default Downloader;
