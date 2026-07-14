import { DownloadState, localPluginName } from "@/common/constant";
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
import getUrlExt from "@/renderer/utils/get-url-ext";
import AppConfig from "@shared/app-config/renderer";
import { getGlobalContext } from "@shared/global-context/renderer";
import logger from "@shared/logger/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import * as Comlink from "comlink";
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

export interface IDownloadStatus {
    state: DownloadState;
    downloaded?: number;
    total?: number;
    msg?: string;
    speed?: number;
    updatedAt?: number;
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

type ProxyMarkedFunction<T extends (...args: any) => void> = T & Comlink.ProxyMarked;
type IOnStateChangeFunc = (data: IDownloadStatus) => void;

interface IDownloaderWorker {
    downloadFile: (
        taskId: string,
        mediaSource: IMusic.IMusicSource,
        filePath: string,
        onStateChange: ProxyMarkedFunction<IOnStateChangeFunc>,
    ) => Promise<void>;
    abortDownload: (taskId: string, removePartial?: boolean) => Promise<void>;
    postprocessDownloadedFile: (
        filePath: string,
        payload?: IDownloadPostprocessPayload | null,
    ) => Promise<void>;
}

const downloadingMusicStore = new Store<IMusic.IMusicItem[]>([]);
const downloadingTaskStore = new Store<IDownloadTaskSnapshot[]>([]);
const downloadingProgress = new Map<string, IDownloadStatus>();
const taskControls = new Map<string, IDownloadTaskControl>();
const downloadingQueue = new PQueue({ concurrency: 5 });
const concurrencyLimit = 20;
let downloaderWorker: IDownloaderWorker;
let lastDownloadCompletedAt = 0;

function getNextDownloadCompletedAt() {
    const now = Date.now();
    lastDownloadCompletedAt = Math.max(now, lastDownloadCompletedAt + 1);
    return lastDownloadCompletedAt;
}

async function setupDownloader() {
    setupDownloaderWorker();
    await setupDownloadedMusicList();
}

function setupDownloaderWorker() {
    const downloaderWorkerPath = getGlobalContext().workersPath.downloader;
    if (downloaderWorkerPath) {
        const worker = new Worker(downloaderWorkerPath);
        downloaderWorker = Comlink.wrap(worker);
    }
    setDownloadingConcurrency(AppConfig.getConfig("download.concurrency") ?? 5);
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

function finishTask(musicItem: IMusic.IMusicItem) {
    const taskId = getMediaPrimaryKey(musicItem);
    const taskControl = taskControls.get(taskId);
    taskControl?.release?.();
    taskControls.delete(taskId);
    downloadingProgress.delete(taskId);
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
    await downloaderWorker?.abortDownload(taskId, false);
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
    downloadingProgress.delete(taskId);
    downloadingMusicStore.setValue((previous) =>
        previous.filter((item) => !isSameMedia(item, musicItem)),
    );
    syncTaskStore();
    await downloaderWorker?.abortDownload(taskId);
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

    for (const quality of qualityOrder) {
        if (isCancelled()) {
            return;
        }
        try {
            mediaSource = await PluginManager.callPluginDelegateMethod(
                musicItem,
                "getMediaSource",
                musicItem,
                quality,
            );
            if (mediaSource?.url) {
                realQuality = quality;
                break;
            }
        } catch {
            continue;
        }
    }

    if (isCancelled()) {
        return;
    }

    try {
        if (!mediaSource?.url) {
            throw new Error("Invalid Source");
        }
        const ext = getUrlExt(mediaSource.url)?.slice(1) ?? "mp3";
        const downloadBasePath = AppConfig.getConfig("download.path")
            ?? getGlobalContext().appPath.downloads;
        const fileName = `${musicItem.title}-${musicItem.artist}`
            .replace(/[/|\\?*"<>:]/g, "_");
        const downloadPath = window.path.resolve(downloadBasePath, `./${fileName}.${ext}`);

        await downloaderWorker.downloadFile(
            taskId,
            mediaSource,
            downloadPath,
            Comlink.proxy((dataState) => {
                if (isCancelled()) {
                    return;
                }
                if (dataState.state !== DownloadState.DONE) {
                    onStateChange(dataState);
                    return;
                }
                void finalizeDownloadedMusic(musicItem, downloadPath, realQuality)
                    .then(() => onStateChange(dataState))
                    .catch((error) => onStateChange({
                        state: DownloadState.ERROR,
                        msg: toError(error).message,
                    }));
            }),
        );
    } catch (error) {
        if (!isCancelled()) {
            onStateChange({
                state: DownloadState.ERROR,
                msg: toError(error).message,
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

    await addDownloadedMusicToList(downloadedMusic);
}

function useDownloadStatus(musicItem: IMusic.IMusicItem) {
    const [downloadStatus, setDownloadStatus] = useState<IDownloadStatus | null>(null);

    useEffect(() => {
        setDownloadStatus(downloadingProgress.get(getMediaPrimaryKey(musicItem)) || null);
        const updateStatus = (item: IMusic.IMusicItem, status: IDownloadStatus) => {
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
