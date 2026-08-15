import Condition from "@/renderer/components/Condition";
import NoPlugin from "@/renderer/components/NoPlugin";
import { Tab } from "@headlessui/react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Body from "./components/Body";
import PluginManager from "@shared/plugin-manager/renderer";
import DiscoverySourceSwitcher from "../DiscoverySourceSwitcher";
import usePageScrollPosition from "../../hooks/usePageScrollPosition";

import "./index.scss";

export default function RecommendSheetsView() {
    const availablePlugins = PluginManager.getSortedSupportedPlugin("getRecommendSheetsByTag");
    const navigate = useNavigate();
    const { t } = useTranslation();
    const pageScrollRef = usePageScrollPosition<HTMLDivElement>();

    return (
        <div
            ref={pageScrollRef}
            id="page-container"
            className="page-container recommend-sheets-view--container"
        >
            <Condition
                condition={availablePlugins.length}
                falsy={
                    <NoPlugin
                        supportMethod={t("discovery_pages.recommend_title")}
                        height={"100%"}
                    ></NoPlugin>
                }
            >
                <Tab.Group
                    defaultIndex={history.state?.usr?.pluginIndex}
                    onChange={(index) => {
                        const usr = history.state?.usr ?? {};

                        navigate("", {
                            replace: true,
                            state: {
                                ...usr,
                                pluginHash: availablePlugins[index].hash,
                                pluginIndex: index,
                                tag: null,
                            },
                        });
                    }}
                >
                    <header className="discovery-page-header">
                        <div className="discovery-page-heading">
                            <span className="discovery-page-eyebrow">
                                {t("discovery_pages.recommend_eyebrow")}
                            </span>
                            <h1>{t("discovery_pages.recommend_title")}</h1>
                            <p>{t("discovery_pages.recommend_subtitle")}</p>
                        </div>
                        <DiscoverySourceSwitcher
                            label={t("discovery_pages.source")}
                            plugins={availablePlugins}
                        ></DiscoverySourceSwitcher>
                    </header>
                    <Tab.Panels className={"tab-panels-container"}>
                        {availablePlugins.map((plugin) => (
                            <Tab.Panel className="tab-panel-container" key={plugin.hash}>
                                <Body plugin={plugin}></Body>
                            </Tab.Panel>
                        ))}
                    </Tab.Panels>
                </Tab.Group>
            </Condition>
        </div>
    );
}
