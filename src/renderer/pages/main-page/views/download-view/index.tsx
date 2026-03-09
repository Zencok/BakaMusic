import { Tab } from "@headlessui/react";
import { useTranslation } from "react-i18next";
import Downloaded from "./components/Downloaded";
import Downloading from "./components/Downloading";
import "./index.scss";

export default function DownloadView() {
    const { t } = useTranslation();

    return (
        <div
            id="page-container"
            className="page-container download-view--container"
        >
            <div className="download-view-hero">
                <span className="download-view-hero-title">{t("common.download")}</span>
                <span className="download-view-hero-subtitle">
                    {t("common.downloading")} / {t("common.downloaded")}
                </span>
            </div>
            <Tab.Group>
                <Tab.List className="tab-list-container">
                    <Tab as="div" className="tab-list-item">
                        {t("common.downloaded")}
                    </Tab>
                    <Tab as="div" className="tab-list-item">
                        {t("common.downloading")}
                    </Tab>
                </Tab.List>
                <Tab.Panels className="tab-panels-container">
                    <Tab.Panel className="tab-panel-container">
                        <Downloaded></Downloaded>
                    </Tab.Panel>
                    <Tab.Panel className="tab-panel-container">
                        <Downloading></Downloading>
                    </Tab.Panel>
                </Tab.Panels>
            </Tab.Group>
        </div>
    );
}
