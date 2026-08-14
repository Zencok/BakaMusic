import { useEffect, useMemo, useState } from "react";
import { Tab } from "@headlessui/react";
import { RequestStateCode, supportedMediaType } from "@/common/constant";
import NoPlugin from "@/renderer/components/NoPlugin";
import {
    currentMediaTypeStore,
    resetStore,
    searchResultsStore,
} from "./store/search-result";
import { Trans, useTranslation } from "react-i18next";
import { useMatch, useNavigate } from "react-router-dom";
import PluginManager, { useSortedSupportedPlugin } from "@shared/plugin-manager/renderer";
import SearchResult from "./components/SearchResult";
import SvgAsset, { SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import useSearch from "./hooks/useSearch";
import "./index.scss";

const mediaTypeIconMap = {
    music: "musical-note",
    album: "cd",
    artist: "user",
    sheet: "list-bullet",
} satisfies Record<(typeof supportedMediaType)[number], SvgAssetIconNames>;

export default function SearchView() {
    const match = useMatch("/main/search/:query");
    const query = decodeURIComponent(match?.params?.query ?? "");
    const plugins = useSortedSupportedPlugin("search");
    const { t } = useTranslation();
    const navigate = useNavigate();
    const search = useSearch();
    const searchResults = searchResultsStore.useValue();
    const initialIndex = useMemo(() => {
        const mediaIndex = Number(history.state?.usr?.mediaIndex ?? 0);
        if (!Number.isFinite(mediaIndex)) {
            return 0;
        }

        return Math.min(Math.max(mediaIndex, 0), supportedMediaType.length - 1);
    }, []);
    const [selectedIndex, setSelectedIndex] = useState(initialIndex);
    const [selectedPlugin, setSelectedPlugin] =
        useState<IPlugin.IPluginDelegate | null>(
            history.state?.usr?.plugin ?? null,
        );
    const currentMediaType = supportedMediaType[selectedIndex] ?? "music";
    const searchablePlugins = useMemo(() => {
        if (!plugins.length) {
            return [];
        }

        return PluginManager.getSortedSearchablePlugins(currentMediaType);
    }, [currentMediaType, plugins]);
    const activePlugin = searchablePlugins.find(
        ({ hash }) => hash === selectedPlugin?.hash,
    ) ?? searchablePlugins[0] ?? null;
    const currentResult = activePlugin?.hash
        ? searchResults[currentMediaType][activePlugin.hash]
        : undefined;
    const isRefreshing =
        currentResult?.state === RequestStateCode.PENDING_FIRST_PAGE ||
        currentResult?.state === RequestStateCode.PENDING_REST_PAGE;
    const canRefresh = Boolean(activePlugin?.hash && query && !isRefreshing);

    useEffect(() => {
        currentMediaTypeStore.setValue(currentMediaType);
    }, [currentMediaType]);

    useEffect(() => {
        setSelectedPlugin((current) => {
            const next = searchablePlugins.find(({ hash }) => hash === current?.hash)
                ?? searchablePlugins[0]
                ?? null;

            return current?.hash === next?.hash ? current : next;
        });
    }, [searchablePlugins]);

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
            <header className="discovery-page-header search-page-header">
                <div className="discovery-page-heading">
                    <span className="discovery-page-eyebrow">
                        {t("search_result_page.eyebrow")}
                    </span>
                    <h1>
                        <Trans
                            i18nKey="search_result_page.search_result_title"
                            values={{ query }}
                            components={{
                                highlight: <span className="highlight" />,
                            }}
                        />
                    </h1>
                    <p>{t("search_result_page.subtitle")}</p>
                </div>
            </header>
            {plugins.length ? (
                <Tab.Group
                    selectedIndex={selectedIndex}
                    onChange={(index) => {
                        setSelectedIndex(index);
                        currentMediaTypeStore.setValue(supportedMediaType[index]);
                        const usr = history.state?.usr ?? {};
                        navigate("", {
                            replace: true,
                            state: {
                                ...usr,
                                mediaIndex: index,
                            },
                        });
                    }}
                >
                    <Tab.List
                        className="search-type-list"
                        aria-label={t("search_result_page.search_type")}
                    >
                        {supportedMediaType.map((type, index) => (
                            <Tab key={type} className="search-type-tab">
                                <span className="search-type-index">
                                    {String(index + 1).padStart(2, "0")}
                                </span>
                                <span className="search-type-label">
                                    <SvgAsset iconName={mediaTypeIconMap[type]}></SvgAsset>
                                    {t(`media.media_type_${type}`)}
                                </span>
                            </Tab>
                        ))}
                    </Tab.List>
                    <div className="search-platform-switcher">
                        <div
                            className="search-platform-rail"
                            role="group"
                            aria-label={t("discovery_pages.source")}
                        >
                            {searchablePlugins.map((plugin) => (
                                <button
                                    type="button"
                                    className="search-platform-tab"
                                    data-selected={activePlugin?.hash === plugin.hash}
                                    aria-pressed={activePlugin?.hash === plugin.hash}
                                    title={plugin.platform}
                                    key={plugin.hash}
                                    onClick={() => {
                                        setSelectedPlugin(plugin);
                                        const usr = history.state?.usr ?? {};

                                        navigate("", {
                                            replace: true,
                                            state: {
                                                ...usr,
                                                plugin,
                                            },
                                        });
                                    }}
                                >
                                    <span data-text={plugin.platform}>
                                        {plugin.platform}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            className="search-refresh-button"
                            title={t("search_result_page.refresh_current_platform")}
                            aria-label={t("search_result_page.refresh_current_platform")}
                            disabled={!canRefresh}
                            data-loading={isRefreshing}
                            onClick={() => {
                                if (!activePlugin?.hash || !query) {
                                    return;
                                }

                                search(query, 1, currentMediaType, activePlugin.hash, {
                                    force: true,
                                });
                            }}
                        >
                            <SvgAsset iconName="arrow-path"></SvgAsset>
                        </button>
                    </div>
                    <Tab.Panels className="search-result-panels">
                        {supportedMediaType.map((type, index) => (
                            <Tab.Panel className="search-result-panel" key={type}>
                                {selectedIndex === index ? (
                                    <SearchResult
                                        type={type}
                                        pluginHash={activePlugin?.hash}
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
