import { useTranslation } from "react-i18next";
import Downloading from "./components/Downloading";
import "./index.scss";

export default function DownloadView() {
    const { t } = useTranslation();

    return (
        <div id="page-container" className="page-container download-view--container">
            <div className="header">{t("download_page.title")}</div>
            <Downloading></Downloading>
        </div>
    );
}
