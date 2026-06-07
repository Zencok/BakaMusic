import { useEffect, useState, memo } from "react";
import "./index.scss";
import Condition from "@/renderer/components/Condition";
import AlbumResult from "./AlbumResult";
import MusicResult from "./MusicResult";
import ArtistResult from "./ArtistResult";
import { searchResultsStore } from "../../store/search-result";
import { RequestStateCode } from "@/common/constant";
import Loading from "@/renderer/components/Loading";
import useSearch from "../../hooks/useSearch";
import SwitchCase from "@/renderer/components/SwitchCase";
import { useNavigate } from "react-router-dom";
import SheetResult from "./SheetResult";
import SvgAsset from "@/renderer/components/SvgAsset";
import { useTranslation } from "react-i18next";

type SearchAction = ReturnType<typeof useSearch>;

interface ISearchResultProps {
    type: IMedia.SupportMediaType;
    query: string;
    plugins: IPlugin.IPluginDelegate[];
}

export default function SearchResult(props: ISearchResultProps) {
    const { type, plugins, query } = props;
    const { t } = useTranslation();
    const search = useSearch();
    const searchResults = searchResultsStore.useValue();
    const [selectedPlugin, setSelectedPlugin] =
    useState<IPlugin.IPluginDelegate | null>(
        history.state?.usr?.plugin ?? null,
    );
    const currentResult = selectedPlugin?.hash
        ? searchResults[type][selectedPlugin.hash]
        : undefined;
    const isRefreshing =
        currentResult?.state === RequestStateCode.PENDING_FIRST_PAGE ||
        currentResult?.state === RequestStateCode.PENDING_REST_PAGE;
    const canRefresh = Boolean(selectedPlugin?.hash && query && !isRefreshing);

    useEffect(() => {
        if (plugins.length && !selectedPlugin) {
            setSelectedPlugin(plugins[0]);
        }
    }, [plugins, selectedPlugin]);

    const navigate = useNavigate();

    return (
        <>
            <div className="search-view--platform-bar">
                <div className="search-view--plugins">
                    {plugins?.map?.((plugin) => (
                        <div
                            className="plugin-item"
                            role="button"
                            key={plugin.hash}
                            onClick={() => {
                                setSelectedPlugin(plugin);
                                const usr = history.state.usr ?? {};

                                // 获取history
                                navigate("", {
                                    replace: true,
                                    state: {
                                        ...usr,
                                        plugin: plugin,
                                    },
                                });
                            }}
                            data-selected={selectedPlugin?.hash === plugin.hash}
                        >
                            {plugin.platform}
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    className="search-view--refresh-button"
                    title={t("search_result_page.refresh_current_platform")}
                    aria-label={t("search_result_page.refresh_current_platform")}
                    disabled={!canRefresh}
                    data-loading={isRefreshing}
                    onClick={() => {
                        if (!selectedPlugin?.hash || !query) {
                            return;
                        }

                        search(query, 1, type, selectedPlugin.hash, {
                            force: true,
                        });
                    }}
                >
                    <SvgAsset
                        iconName="arrow-path"
                        size={17}
                    ></SvgAsset>
                </button>
            </div>
            <SearchResultBody
                query={query}
                type={type}
                pluginHash={selectedPlugin?.hash}
                search={search}
            ></SearchResultBody>
        </>
    );
}

interface ISearchResultBodyProps {
    type: IMedia.SupportMediaType;
    pluginHash?: string;
    query: string;
    search: SearchAction;
}
function _SearchResultBody(props: ISearchResultBodyProps) {
    const { type, pluginHash, query, search } = props;
    const searchResults = searchResultsStore.useValue();
    const currentResult = pluginHash
        ? searchResults[type][pluginHash]
        : undefined;
    const data = currentResult?.data ?? ([] as any[]);

    useEffect(() => {
        if (pluginHash && type && query) {
            search(query, 1, type, pluginHash);
        }
    }, [pluginHash, query, search, type]);

    return (
        <>
            <Condition
                condition={
                    currentResult?.state !== RequestStateCode.PENDING_FIRST_PAGE ||
          !pluginHash
                }
                falsy={<Loading></Loading>}
            >
                <SwitchCase.Switch switch={type}>
                    <SwitchCase.Case case="music">
                        <MusicResult
                            data={data}
                            state={currentResult?.state ?? RequestStateCode.IDLE}
                            pluginHash={pluginHash}
                        ></MusicResult>
                    </SwitchCase.Case>
                    <SwitchCase.Case case="album">
                        <AlbumResult
                            data={data}
                            state={currentResult?.state ?? RequestStateCode.IDLE}
                            pluginHash={pluginHash}
                        ></AlbumResult>
                    </SwitchCase.Case>
                    <SwitchCase.Case case="artist">
                        <ArtistResult
                            data={data}
                            state={currentResult?.state ?? RequestStateCode.IDLE}
                            pluginHash={pluginHash}
                        ></ArtistResult>
                    </SwitchCase.Case>
                    <SwitchCase.Case case="sheet">
                        <SheetResult
                            data={data}
                            state={currentResult?.state ?? RequestStateCode.IDLE}
                            pluginHash={pluginHash}
                        ></SheetResult>
                    </SwitchCase.Case>
                </SwitchCase.Switch>
            </Condition>
        </>
    );
}

const SearchResultBody = memo(
    _SearchResultBody,
    (prev, curr) =>
        prev.pluginHash === curr.pluginHash &&
        prev.type === curr.type &&
        prev.query === curr.query,
);
