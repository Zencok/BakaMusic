import { DownloadState, localPluginName } from "@/common/constant";
import { isSameMedia } from "@/common/media-util";
import SvgAsset, { SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import { promptDownloadWithQuality } from "@/renderer/utils/download-quality";
import Downloader from "@/renderer/core/downloader";
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
    const downloadState = Downloader.useDownloadState(musicItem);

    const { t } = useTranslation();
    const isDownloadedOrLocal =
        downloadState === DownloadState.DONE ||
        musicItem?.platform === localPluginName;

    let iconName: SvgAssetIconNames = "array-download-tray";

    if (isDownloadedOrLocal) {
        iconName = "check-circle";
    } else if (
        downloadState !== DownloadState.NONE &&
        downloadState !== DownloadState.ERROR
    ) {
        iconName = "rolling-1s";
    }

    return (
        <div
            className={`music-download-base ${
                isDownloadedOrLocal ? "music-downloaded" : "music-can-download"
            }`}
            data-fill-container={fillContainer}
            title={
                isDownloadedOrLocal ? t("common.downloaded") : t("common.download")
            }
            onClick={(event) => {
                event.stopPropagation();
                if (
                    musicItem &&
                    (downloadState === DownloadState.NONE ||
                        downloadState === DownloadState.ERROR)
                ) {
                    promptDownloadWithQuality(musicItem, {
                        anchor: event.currentTarget,
                    });
                }
            }}
        >
            <SvgAsset iconName={iconName} size={size}></SvgAsset>
        </div>
    );
}

export default memo(MusicDownloaded, (prev, curr) =>
    isSameMedia(prev.musicItem, curr.musicItem),
);
