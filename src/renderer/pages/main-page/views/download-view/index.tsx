import { DownloadState } from "@/common/constant";
import Downloader from "@/renderer/core/downloader";
import { useTranslation } from "react-i18next";
import Downloading from "./components/Downloading";
import "./index.scss";

export default function DownloadView() {
    const { t } = useTranslation();
    const tasks = Downloader.useDownloadingTaskList();
    const downloadedList = Downloader.useDownloadedMusicList();
    const failedCount = tasks.filter(({ status }) =>
        status.state === DownloadState.ERROR,
    ).length;

    return (
        <div id="page-container" className="page-container download-view--container">
            <header className="discovery-page-header download-hero">
                <div className="discovery-page-heading">
                    <span className="discovery-page-eyebrow">
                        {t("download_page.eyebrow")}
                    </span>
                    <h1>{t("download_page.title")}</h1>
                    <p>{t("download_page.description")}</p>
                </div>
                <div className="download-hero-stats">
                    <article className="download-hero-stat">
                        <span>{t("download_page.task_queue")}</span>
                        <strong>{tasks.length.toLocaleString()}</strong>
                    </article>
                    <article className="download-hero-stat">
                        <span>{t("common.downloaded")}</span>
                        <strong>{downloadedList.length.toLocaleString()}</strong>
                    </article>
                    <article className="download-hero-stat">
                        <span>{t("download_page.failed_count")}</span>
                        <strong>{failedCount.toLocaleString()}</strong>
                    </article>
                </div>
            </header>
            <Downloading></Downloading>
        </div>
    );
}
