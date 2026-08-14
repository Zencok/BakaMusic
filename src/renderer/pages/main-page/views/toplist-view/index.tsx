import Condition from "@/renderer/components/Condition";
import LazyImage from "@/renderer/components/LazyImage";
import albumImg from "@/assets/imgs/album-cover.jpg";
import getCompactArtworkSrc from "@/renderer/utils/get-compact-artwork-src";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import { Tab } from "@headlessui/react";
import { pluginsTopListStore } from "./store";
import { RequestStateCode } from "@/common/constant";
import Loading from "@/renderer/components/Loading";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import useGetTopList from "./hooks/useGetTopList";
import NoPlugin from "@/renderer/components/NoPlugin";
import Empty from "@/renderer/components/Empty";
import { useTranslation } from "react-i18next";
import SvgAsset from "@/renderer/components/SvgAsset";
import { getDiscoveryMetaText } from "../discovery-pages";
import DiscoverySourceSwitcher from "../DiscoverySourceSwitcher";

import "./index.scss";
import PluginManager from "@shared/plugin-manager/renderer";

export default function ToplistView() {
    const availablePlugins = PluginManager.getSortedSupportedPlugin("getTopLists");
    const navigate = useNavigate();
    const { t } = useTranslation();

    return (
        <div id="page-container" className="page-container toplist-view--container">
            <Condition
                condition={availablePlugins.length}
                falsy={
                    <NoPlugin
                        supportMethod={t("plugin.method_get_top_lists")}
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
                                pluginIndex: index,
                            },
                        });
                    }}
                >
                    <header className="discovery-page-header">
                        <div className="discovery-page-heading">
                            <span className="discovery-page-eyebrow">
                                {t("discovery_pages.toplist_eyebrow")}
                            </span>
                            <h1>{t("discovery_pages.toplist_title")}</h1>
                            <p>{t("discovery_pages.toplist_subtitle")}</p>
                        </div>
                        <DiscoverySourceSwitcher
                            label={t("discovery_pages.source")}
                            plugins={availablePlugins}
                        ></DiscoverySourceSwitcher>
                    </header>
                    <Tab.Panels className={"tab-panels-container"}>
                        {availablePlugins.map((plugin) => (
                            <Tab.Panel className="tab-panel-container" key={plugin.hash}>
                                <ToplistBody plugin={plugin}></ToplistBody>
                            </Tab.Panel>
                        ))}
                    </Tab.Panels>
                </Tab.Group>
            </Condition>
        </div>
    );
}

interface IToplistBodyProps {
    plugin: IPlugin.IPluginDelegate;
}

function ToplistBody(props: IToplistBodyProps) {
    const topLists = pluginsTopListStore.useValue();
    const { plugin } = props;
    const getTopList = useGetTopList();

    useEffect(() => {
        getTopList(plugin.hash);
    }, [getTopList, plugin.hash]);

    return (
        <Condition
            condition={
                topLists[plugin.hash]?.state !== RequestStateCode.PENDING_FIRST_PAGE
            }
            falsy={<Loading></Loading>}
        >
            <Condition
                condition={topLists[plugin.hash]?.data?.length}
                falsy={<Empty></Empty>}
            >
                {topLists[plugin.hash]?.data?.map((item, index) => (
                    <ToplistGroupItem
                        groupItem={item}
                        key={index}
                        platform={plugin.platform}
                    ></ToplistGroupItem>
                ))}
            </Condition>
        </Condition>
    );
}

interface IToplistGroupItemProps {
    groupItem: IMusic.IMusicSheetGroupItem;
    platform: string;
}
function ToplistGroupItem(props: IToplistGroupItemProps) {
    const { groupItem, platform } = props;
    const items = groupItem.data ?? [];

    return (
        <section className="toplist-group-item--container">
            <header className="toplist-group-header">
                <span className="toplist-group-rule" aria-hidden="true"></span>
                <h2>{groupItem.title ?? platform}</h2>
                <span className="toplist-group-total">
                    {String(items.length).padStart(2, "0")}
                </span>
            </header>
            <div className="toplist-group-stage" data-single={items.length === 1}>
                {items[0] ? (
                    <ToplistCoverItem
                        key={items[0].id}
                        item={items[0]}
                        platform={platform}
                        rank={1}
                        featured
                    ></ToplistCoverItem>
                ) : null}
                {items.length > 1 ? (
                    <div className="toplist-ranked-list">
                        {items.slice(1).map((item, index) => (
                            <ToplistCoverItem
                                key={item.id}
                                item={item}
                                platform={platform}
                                rank={index + 2}
                            ></ToplistCoverItem>
                        ))}
                    </div>
                ) : null}
            </div>
        </section>
    );
}

interface IToplistCoverItemProps {
    item: IMusic.IMusicSheetItem;
    platform: string;
    rank: number;
    featured?: boolean;
}

function ToplistCoverItem(props: IToplistCoverItemProps) {
    const { item, platform, rank, featured = false } = props;
    const navigate = useNavigate();
    const metaText = getDiscoveryMetaText(item);

    const openToplist = () => {
        navigate(`/main/toplist-detail/${platform}`, {
            state: {
                toplist: {
                    ...item,
                    platform,
                },
            },
        });
    };

    return (
        <button
            type="button"
            className="toplist-cover-item"
            data-featured={featured}
            title={item.title}
            onClick={openToplist}
        >
            <span className="toplist-rank-number">
                {String(rank).padStart(2, "0")}
            </span>
            <span className="toplist-cover-artwork">
                <LazyImage
                    src={getCompactArtworkSrc(item, featured ? 720 : 240) ?? albumImg}
                    fallbackSrc={albumImg}
                    releaseWhenHidden={false}
                    onError={setFallbackAlbum}
                    alt=""
                ></LazyImage>
            </span>
            <div className="toplist-cover-item--overlay">
                <div className="toplist-cover-item--title">{item.title}</div>
                <Condition condition={metaText}>
                    <div className="toplist-cover-item--meta">{metaText}</div>
                </Condition>
            </div>
            <span className="toplist-open-indicator" aria-hidden="true">
                <SvgAsset iconName="chevron-right" size={16}></SvgAsset>
            </span>
        </button>
    );
}
