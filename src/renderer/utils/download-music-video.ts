import { DownloadState } from "@/common/constant";
import {
    buildDownloadFileBaseName,
    DEFAULT_FILE_NAMING_CONFIG,
    escapeFilenameCharacter,
    type FileNamingPreset,
    type FileNamingType,
} from "@/common/file-naming-formatter";
import { resolveFilePath } from "@/common/path-util";
import AppConfig from "@shared/app-config/renderer";
import { getGlobalContext } from "@shared/global-context/renderer";
import nodeRuntime from "@shared/node-runtime/renderer";

export interface IVideoDownloadProgress {
    state: DownloadState;
    downloaded?: number;
    total?: number;
    filePath?: string;
    msg?: string;
}

export interface IVideoDownloadTask {
    taskId: string;
    filePath: string;
    completion: Promise<string>;
    cancel: () => Promise<void>;
}

function buildVideoDownloadPath(
    musicItem: IMusic.IMusicItem,
    quality: string,
) {
    const baseName = buildDownloadFileBaseName(
        musicItem,
        {
            type: (AppConfig.getConfig("download.fileNamingType")
                ?? DEFAULT_FILE_NAMING_CONFIG.type) as FileNamingType,
            preset: (AppConfig.getConfig("download.fileNamingPreset")
                ?? DEFAULT_FILE_NAMING_CONFIG.preset) as FileNamingPreset,
            custom: AppConfig.getConfig("download.fileNamingCustom")
                ?? DEFAULT_FILE_NAMING_CONFIG.custom,
            maxLength: AppConfig.getConfig("download.fileNamingMaxLength")
                ?? DEFAULT_FILE_NAMING_CONFIG.maxLength,
            keepExtension: true,
        },
        quality,
    );
    const fileName = escapeFilenameCharacter(`${baseName} [MV ${quality}]`).slice(0, 200);
    const downloadDirectory = AppConfig.getConfig("download.path")
        ?? getGlobalContext().appPath.downloads;
    return resolveFilePath(downloadDirectory, `./${fileName}.mp4`);
}

export function startMusicVideoDownload(
    musicItem: IMusic.IMusicItem,
    sourceUrl: string,
    quality: string,
    onProgress: (progress: IVideoDownloadProgress) => void,
): IVideoDownloadTask {
    const taskId = `mv:${crypto.randomUUID()}`;
    const filePath = buildVideoDownloadPath(musicItem, quality);
    let terminalState: IVideoDownloadProgress | null = null;
    let canceled = false;
    const completion = nodeRuntime.downloadFile(
        taskId,
        { url: sourceUrl },
        filePath,
        (progress) => {
            terminalState = progress;
            onProgress(progress);
        },
    ).then(() => {
        if (canceled) {
            throw new DOMException("Video download canceled", "AbortError");
        }
        if (terminalState?.state !== DownloadState.DONE) {
            throw new Error(terminalState?.msg || "Video download failed");
        }
        return terminalState.filePath || filePath;
    });

    return {
        taskId,
        filePath,
        completion,
        cancel: () => {
            canceled = true;
            return nodeRuntime.abortDownload(taskId, true);
        },
    };
}
