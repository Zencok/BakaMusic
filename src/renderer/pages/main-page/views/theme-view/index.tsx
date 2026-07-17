import { Tab } from "@headlessui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import SvgAsset from "@/renderer/components/SvgAsset";
import RemoteThemes from "./components/RemoteThemes";
import LocalThemes from "./components/LocalThemes";
import "./index.scss";

const routes = ["local", "remote"];

export default function ThemeView() {
    const { t } = useTranslation();
    const [searchText, setSearchText] = useState("");

    return (
        <div id="page-container" className="page-container theme-view--container">
            <Tab.Group>
                <div className="theme-view-toolbar">
                    <Tab.List className="tab-list-container">
                        {routes.map((it) => (
                            <Tab key={it} as="div" className="tab-list-item">
                                {t(`theme.tab_${it}`)}
                            </Tab>
                        ))}
                    </Tab.List>
                    <div className="theme-view-search">
                        <SvgAsset iconName="magnifying-glass"></SvgAsset>
                        <input
                            aria-label={t("theme.search_placeholder")}
                            placeholder={t("theme.search_placeholder")}
                            spellCheck={false}
                            type="search"
                            value={searchText}
                            onChange={(event) => setSearchText(event.target.value)}
                        ></input>
                        {searchText ? (
                            <button
                                aria-label={t("common.clear")}
                                title={t("common.clear")}
                                type="button"
                                onClick={() => setSearchText("")}
                            >
                                <SvgAsset iconName="x-mark"></SvgAsset>
                            </button>
                        ) : null}
                    </div>
                </div>
                <Tab.Panels className={"tab-panels-container"}>
                    <Tab.Panel>
                        <LocalThemes searchText={searchText}></LocalThemes>
                    </Tab.Panel>
                    <Tab.Panel>
                        <RemoteThemes searchText={searchText}></RemoteThemes>
                    </Tab.Panel>
                </Tab.Panels>
            </Tab.Group>
        </div>
    );
}
