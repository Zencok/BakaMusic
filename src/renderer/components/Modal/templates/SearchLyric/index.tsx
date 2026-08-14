import { useEffect, useState } from "react";
import Base from "../Base";
import "./index.scss";
import SvgAsset from "@/renderer/components/SvgAsset";
import useSearchLyric from "./hooks/useSearchLyric";
import searchResultStore from "./hooks/searchResultStore";
import { Tab } from "@headlessui/react";
import SearchResult from "./searchResult";
import { useTranslation } from "react-i18next";
import PluginManager from "@shared/plugin-manager/renderer";
import { RequestStateCode } from "@/common/constant";

interface IProps {
    defaultTitle?: string;
    musicItem?: IMusic.IMusicItem;
    defaultExtra?: boolean;
}

export default function SearchLyric(props: IProps) {
    const { defaultTitle, musicItem } = props;

    const [inputSearch, setInputSearch] = useState(defaultTitle ?? "");
    const [selectedPlatformIndex, setSelectedPlatformIndex] = useState(0);

    const searchLyric = useSearchLyric();
    const searchResults = searchResultStore.useValue();
    const { t } = useTranslation();

    const availablePlugins = PluginManager.getSortedSearchablePlugins("lyric");
    const activePlugin = availablePlugins[selectedPlatformIndex]
        ?? availablePlugins[0];
    const activeResult = activePlugin?.hash
        ? searchResults.data[activePlugin.hash]
        : undefined;
    const isRefreshing =
        activeResult?.state === RequestStateCode.PENDING_FIRST_PAGE ||
        activeResult?.state === RequestStateCode.PENDING_REST_PAGE;
    const canRefresh = Boolean(
        activePlugin?.hash && searchResults.query && !isRefreshing,
    );

    useEffect(() => {
        if (defaultTitle) {
            searchLyric(defaultTitle);
        }
    }, [defaultTitle, searchLyric]);

    return (
        <Base defaultClose withBlur={false}>
            <div className="modal--search-lyric-container shadow">
                <Base.Header>
                    <div className="search-lyric-input-container">
                        <input
                            className="search-lyric-input"
                            placeholder={t("modal.search_lyric")}
                            value={inputSearch}
                            onChange={(evt) => {
                                setInputSearch(evt.target.value);
                            }}
                            onKeyDown={(key) => {
                                if (key.key === "Enter") {
                                    searchLyric(inputSearch);
                                }
                            }}
                        ></input>
                        <div
                            className="search-lyric-search"
                            role="button"
                            onClick={() => {
                                searchLyric(inputSearch);
                            }}
                        >
                            <SvgAsset iconName="magnifying-glass"></SvgAsset>
                        </div>
                    </div>
                </Base.Header>
                <Tab.Group
                    selectedIndex={selectedPlatformIndex}
                    onChange={setSelectedPlatformIndex}
                >
                    <div className="search-lyric-platform-switcher">
                        <Tab.List
                            className="search-lyric-platform-rail"
                            aria-label={t("discovery_pages.source")}
                        >
                            {availablePlugins.map((plugin) => (
                                <Tab
                                    key={plugin.hash}
                                    className="search-lyric-platform-tab"
                                >
                                    <span data-text={plugin.platform}>
                                        {plugin.platform}
                                    </span>
                                </Tab>
                            ))}
                        </Tab.List>
                        <button
                            type="button"
                            className="search-lyric-refresh-button"
                            title={t("search_result_page.refresh_current_platform")}
                            aria-label={t("search_result_page.refresh_current_platform")}
                            disabled={!canRefresh}
                            data-loading={isRefreshing}
                            onClick={() => {
                                if (!activePlugin?.hash || !searchResults.query) {
                                    return;
                                }

                                searchLyric(
                                    searchResults.query,
                                    1,
                                    activePlugin.hash,
                                );
                            }}
                        >
                            <SvgAsset iconName="arrow-path"></SvgAsset>
                        </button>
                    </div>
                    <Tab.Panels className={"tab-panels-container"}>
                        {availablePlugins.map((plugin) => (
                            <Tab.Panel className="tab-panel-container" key={plugin.hash}>
                                <SearchResult
                                    data={searchResults.data[plugin.hash]}
                                    musicItem={musicItem}
                                ></SearchResult>
                            </Tab.Panel>
                        ))}
                    </Tab.Panels>
                </Tab.Group>
            </div>
        </Base>
    );
}
