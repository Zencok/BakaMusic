import { DownloadState, localPluginName } from "@/common/constant";
import { isSameMedia } from "@/common/media-util";
import SvgAsset, { SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import { promptDownloadWithQuality } from "@/renderer/utils/download-quality";
import Downloader from "@/renderer/core/downloader";
import { getDownloadProgressPercent } from "@/renderer/core/downloader/progress";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import "./index.scss";

interface IMusicDownloadedProps {
    musicItem: IMusic.IMusicItem;
    size?: number;
    /** 点击热区撑满父容器，使整个按钮外壳都成为可点击范围 */
    fillContainer?: boolean;
}

function MusicDownloaded(props: IMusicDownloadedProps) {
    const { musicItem, size = 18, fillContainer } = props;
    const downloadStatus = Downloader.useDownloadStatus(musicItem);
    const downloaded = Downloader.useDownloaded(musicItem);
    const downloadState = downloadStatus?.state
        ?? (downloaded ? DownloadState.DONE : DownloadState.NONE);
    const progressPercent = getDownloadProgressPercent(downloadStatus);

    const { t } = useTranslation();
    const isDownloadedOrLocal =
        downloadState === DownloadState.DONE ||
        musicItem?.platform === localPluginName;

    let iconName: SvgAssetIconNames = "array-download-tray";

    if (isDownloadedOrLocal) {
        iconName = "check-circle";
    } else if (downloadState === DownloadState.PAUSED) {
        iconName = "pause";
    } else if (downloadState === DownloadState.WAITING) {
        iconName = "clock";
    }

    const title = isDownloadedOrLocal
        ? t("common.downloaded")
        : downloadState === DownloadState.DOWNLOADING
            ? `${t("download_page.downloading_now")} ${Math.round(progressPercent)}%`
            : downloadState === DownloadState.WAITING
                ? t("download_page.waiting")
                : downloadState === DownloadState.PAUSED
                    ? t("download_page.paused")
                    : downloadState === DownloadState.ERROR
                        ? t("download_page.retry")
                        : t("common.download");

    return (
        <div
            className={`music-download-base ${
                isDownloadedOrLocal ? "music-downloaded" : "music-can-download"
            }`}
            data-fill-container={fillContainer}
            title={title}
            onClick={(event) => {
                event.stopPropagation();
                if (musicItem && downloadState === DownloadState.PAUSED) {
                    Downloader.resumeTask(musicItem);
                } else if (musicItem && downloadState === DownloadState.ERROR) {
                    Downloader.retryTask(musicItem);
                } else if (musicItem && downloadState === DownloadState.NONE) {
                    promptDownloadWithQuality(musicItem, {
                        anchor: event.currentTarget,
                    });
                }
            }}
        >
            {downloadState === DownloadState.DOWNLOADING ? (
                <CircularDownloadProgress
                    label={t("download_page.downloading_now")}
                    percent={progressPercent}
                    size={size}
                ></CircularDownloadProgress>
            ) : (
                <SvgAsset iconName={iconName} size={size}></SvgAsset>
            )}
        </div>
    );
}

interface ICircularDownloadProgressProps {
    label: string;
    percent: number;
    size: number;
}

function CircularDownloadProgress({
    label,
    percent,
    size,
}: ICircularDownloadProgressProps) {
    return (
        <svg
            aria-label={label}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(percent)}
            className="music-download-progress"
            height={size}
            role="progressbar"
            viewBox="0 0 24 24"
            width={size}
        >
            <circle
                className="music-download-progress-track"
                cx="12"
                cy="12"
                r="9"
            ></circle>
            <circle
                className="music-download-progress-value"
                cx="12"
                cy="12"
                pathLength="100"
                r="9"
                strokeDasharray="100"
                strokeDashoffset={100 - percent}
            ></circle>
        </svg>
    );
}

export default memo(MusicDownloaded, (prev, curr) =>
    isSameMedia(prev.musicItem, curr.musicItem),
);
