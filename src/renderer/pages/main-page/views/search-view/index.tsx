import { useEffect } from "react";
import { Tab } from "@headlessui/react";
import { supportedMediaType } from "@/common/constant";
import NoPlugin from "@/renderer/components/NoPlugin";
import { currentMediaTypeStore, resetStore } from "./store/search-result";
import useSearch from "./hooks/useSearch";
import { useTranslation } from "react-i18next";
import { useMatch, useNavigate } from "react-router-dom";
import PluginManager, { useSortedSupportedPlugin } from "@shared/plugin-manager/renderer";
import SearchResult from "./components/SearchResult";
import "./index.scss";

export default function SearchView() {
    const match = useMatch("/main/search/:query");
    const query = decodeURIComponent(match?.params?.query ?? "");
    const plugins = useSortedSupportedPlugin("search");
    const { t } = useTranslation();
    const search = useSearch();
    const navigate = useNavigate();

    useEffect(() => {
        if (query) {
            const currentType = currentMediaTypeStore.getValue();
            search(query, 1, currentType);
        }
    }, [query]);

    useEffect(() => {
        return () => {
            resetStore();
        };
    }, []);

    return (
        <div id="page-container" className="page-container search-view-container">
            <div className="search-header">
                <span>{t("search_result_page.search_result_title")}</span>
                <span className="highlight">{query}</span>
            </div>
            {plugins.length ? (
                <Tab.Group
                    defaultIndex={history.state?.usr?.mediaIndex ?? 0}
                    onChange={(index) => {
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
                        {supportedMediaType.map((type) => (
                            <Tab.Panel className="tab-panel-container" key={type}>
                                <SearchResult
                                    type={type}
                                    plugins={PluginManager.getSortedSearchablePlugins(type)}
                                    query={query}
                                ></SearchResult>
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
