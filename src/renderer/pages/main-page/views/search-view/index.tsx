import { useEffect, useMemo, useState } from "react";
import { Tab } from "@headlessui/react";
import { supportedMediaType } from "@/common/constant";
import NoPlugin from "@/renderer/components/NoPlugin";
import { currentMediaTypeStore, resetStore } from "./store/search-result";
import { Trans, useTranslation } from "react-i18next";
import { useMatch, useNavigate } from "react-router-dom";
import PluginManager, { useSortedSupportedPlugin } from "@shared/plugin-manager/renderer";
import SearchResult from "./components/SearchResult";
import "./index.scss";

export default function SearchView() {
    const match = useMatch("/main/search/:query");
    const query = decodeURIComponent(match?.params?.query ?? "");
    const plugins = useSortedSupportedPlugin("search");
    const { t } = useTranslation();
    const navigate = useNavigate();
    const initialIndex = useMemo(() => {
        const mediaIndex = Number(history.state?.usr?.mediaIndex ?? 0);
        if (!Number.isFinite(mediaIndex)) {
            return 0;
        }

        return Math.min(Math.max(mediaIndex, 0), supportedMediaType.length - 1);
    }, []);
    const [selectedIndex, setSelectedIndex] = useState(initialIndex);
    const currentMediaType = supportedMediaType[selectedIndex] ?? "music";

    useEffect(() => {
        currentMediaTypeStore.setValue(currentMediaType);
    }, [currentMediaType]);

    useEffect(() => {
        const mediaIndex = Number(history.state?.usr?.mediaIndex ?? 0);
        if (!Number.isFinite(mediaIndex)) {
            setSelectedIndex(0);
            return;
        }

        setSelectedIndex(
            Math.min(Math.max(mediaIndex, 0), supportedMediaType.length - 1),
        );
    }, [query]);

    useEffect(() => {
        return () => {
            resetStore();
        };
    }, []);

    return (
        <div id="page-container" className="page-container search-view-container">
            <div className="search-header">
                <Trans
                    i18nKey="search_result_page.search_result_title"
                    values={{ query }}
                    components={{
                        highlight: <span className="highlight" />,
                    }}
                />
            </div>
            {plugins.length ? (
                <Tab.Group
                    selectedIndex={selectedIndex}
                    onChange={(index) => {
                        setSelectedIndex(index);
                        currentMediaTypeStore.setValue(supportedMediaType[index]);
                        navigate("", {
                            replace: true,
                            state: {
                                mediaIndex: index,
                            },
                        });
                    }}
                >
                    <Tab.List className="tab-list-container">
                        {supportedMediaType.map((type) => (
                            <Tab key={type} as="div" className="tab-list-item">
                                {t(`media.media_type_${type}`)}
                            </Tab>
                        ))}
                    </Tab.List>
                    <Tab.Panels className="tab-panels-container">
                        {supportedMediaType.map((type, index) => (
                            <Tab.Panel className="tab-panel-container" key={type}>
                                {selectedIndex === index ? (
                                    <SearchResult
                                        type={type}
                                        plugins={PluginManager.getSortedSearchablePlugins(type)}
                                        query={query}
                                    ></SearchResult>
                                ) : null}
                            </Tab.Panel>
                        ))}
                    </Tab.Panels>
                </Tab.Group>
            ) : (
                <NoPlugin supportMethod={t("plugin.method_search")}></NoPlugin>
            )}
        </div>
    );
}
