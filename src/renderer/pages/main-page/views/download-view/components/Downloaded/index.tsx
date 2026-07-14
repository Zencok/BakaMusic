import { hideModal, showModal } from "@/renderer/components/Modal";
import MusicList from "@/renderer/components/MusicList";
import SvgAsset from "@/renderer/components/SvgAsset";
import Downloader from "@/renderer/core/downloader";
import AppConfig from "@shared/app-config/renderer";
import { getGlobalContext } from "@shared/global-context/renderer";
import { shellUtil } from "@shared/utils/renderer";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import "./index.scss";

interface IDownloadedProps {
    musicList?: IMusic.IMusicItem[];
    embedded?: boolean;
}

export default function Downloaded(props: IDownloadedProps) {
    const { t } = useTranslation();
    const downloadedList = Downloader.useDownloadedMusicList();
    const visibleMusicList = props.musicList ?? downloadedList;
    const musicListContainerRef = useRef<HTMLDivElement>(null);

    function openDownloadDirectory() {
        const downloadPath = AppConfig.getConfig("download.path")
            ?? getGlobalContext().appPath.downloads;
        shellUtil.openPath(downloadPath);
    }

    function confirmClear(removeFiles: boolean) {
        showModal("Reconfirm", {
            title: removeFiles
                ? t("download_page.delete_all_files")
                : t("download_page.clear_downloaded_records"),
            content: removeFiles
                ? t("download_page.delete_all_files_confirm", { count: downloadedList.length })
                : t("download_page.clear_downloaded_records_confirm", { count: downloadedList.length }),
            async onConfirm() {
                hideModal();
                const [success, info] = await Downloader.removeDownloadedMusic(
                    downloadedList,
                    removeFiles,
                );
                if (success) {
                    toast.success(t("download_page.clear_downloaded_success"));
                } else {
                    toast.error(info?.msg ?? t("download_page.clear_downloaded_failed"));
                }
            },
        });
    }

    return (
        <section className="downloaded-container" data-embedded={props.embedded}>
            <div className="downloaded-toolbar">
                <div className="downloaded-toolbar-copy">
                    <strong>{t("download_page.downloaded_library")}</strong>
                    <span>{t("download_page.downloaded_library_hint", {
                        count: downloadedList.length,
                    })}</span>
                </div>
                <div className="downloaded-toolbar-actions">
                    <button type="button" onClick={openDownloadDirectory}>
                        <SvgAsset iconName="folder-open" size={15}></SvgAsset>
                        {t("download_page.open_folder")}
                    </button>
                    <button
                        type="button"
                        disabled={!downloadedList.length}
                        onClick={() => confirmClear(false)}
                    >
                        <SvgAsset iconName="x-mark" size={15}></SvgAsset>
                        {t("download_page.clear_records")}
                    </button>
                    <button
                        type="button"
                        data-variant="danger"
                        disabled={!downloadedList.length}
                        onClick={() => confirmClear(true)}
                    >
                        <SvgAsset iconName="trash" size={15}></SvgAsset>
                        {t("download_page.delete_files")}
                    </button>
                </div>
            </div>
            <div className="downloaded-list" ref={musicListContainerRef}>
                <MusicList
                    sortStorageKey="downloaded"
                    musicList={visibleMusicList}
                    virtualProps={{
                        getScrollElement() {
                            return document.querySelector("#page-container");
                        },
                        offsetHeight: () => musicListContainerRef.current?.offsetTop ?? 0,
                    }}
                ></MusicList>
            </div>
        </section>
    );
}
