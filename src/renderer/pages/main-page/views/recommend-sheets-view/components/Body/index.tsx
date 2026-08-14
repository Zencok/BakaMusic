import { useEffect, useId, useRef, useState } from "react";
import "./index.scss";
import classNames from "@/renderer/utils/classnames";
import useRecommendListTags from "../../hooks/useRecommendListTags";
import TagPanel from "./tag-panel";
import useRecommendSheets from "../../hooks/useRecommendSheets";
import Condition from "@/renderer/components/Condition";
import { RequestStateCode } from "@/common/constant";
import Loading from "@/renderer/components/Loading";
import { useNavigate } from "react-router-dom";
import { i18n, isCN } from "@/shared/i18n/renderer";
import { useTranslation } from "react-i18next";
import LazyImage from "@/renderer/components/LazyImage";
import albumImg from "@/assets/imgs/album-cover.jpg";
import getCompactArtworkSrc from "@/renderer/utils/get-compact-artwork-src";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import BottomLoadingState from "@/renderer/components/BottomLoadingState";
import Empty from "@/renderer/components/Empty";
import SvgAsset from "@/renderer/components/SvgAsset";
import { normalizeNumber } from "@/common/normalize-util";
import { getDiscoveryMetaText } from "../../../discovery-pages";

export function getDefaultTag(): IMedia.IUnique {
    return {
        title: i18n.t("common.default"),
        id: "",
    };
}

interface IBodyProps {
    plugin: IPlugin.IPluginDelegate;
}

export default function Body(props: IBodyProps) {
    const { plugin } = props;
    // 选中的tag
    const [selectedTag, setSelectedTag] = useState<IMedia.IUnique | null>(null);

    // 第一个tag
    const [firstTag, setFirstTag] = useState<IMedia.IUnique>(getDefaultTag);

    const tags = useRecommendListTags(plugin);
    //   const tags: any[] = [];

    const [showPanel, setShowPanel] = useState(false);
    const tagPanelId = useId();
    const tagButtonRef = useRef<HTMLButtonElement | null>(null);

    const [query, sheets, status] = useRecommendSheets(plugin, selectedTag);

    const navigate = useNavigate();
    const { t } = useTranslation();

    useEffect(() => {
        if (tags) {
            const cachedTag = history.state?.usr?.tag;
            if (cachedTag) {
                if (tags.pinned?.findIndex?.((it) => it.id === cachedTag.id) === -1) {
                    setFirstTag(cachedTag);
                }
                setSelectedTag(cachedTag);
            } else {
                setSelectedTag(getDefaultTag);
            }
        }
    }, [tags]);

    useEffect(() => {
        if (!showPanel) {
            return;
        }

        const closeOnOutsidePress = (event: PointerEvent) => {
            if (!(event.target as Element).closest(".tags-container")) {
                setShowPanel(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setShowPanel(false);
                tagButtonRef.current?.focus();
            }
        };

        window.addEventListener("pointerdown", closeOnOutsidePress);
        window.addEventListener("keydown", closeOnEscape);

        return () => {
            window.removeEventListener("pointerdown", closeOnOutsidePress);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [showPanel]);

    const openSheet = (sheetItem: IMusic.IMusicSheetItem) => {
        navigate(
            `/main/musicsheet/${encodeURIComponent(sheetItem.platform)}/${encodeURIComponent(sheetItem.id)}`,
            {
                state: {
                    sheetItem,
                },
            },
        );
    };

    return (
        <div className="recommend-sheet-view--body-container">
            <div className="tags-container">
                <span className="tags-label">{t("discovery_pages.mood_filter")}</span>
                <TagPanel
                    id={tagPanelId}
                    show={showPanel}
                    tagsGroups={tags?.data ?? []}
                    selectedId={selectedTag?.id}
                    onTagClick={(tag) => {
                        setSelectedTag(tag);
                        setFirstTag(tag);
                        const usr = history.state?.usr ?? {};

                        navigate("", {
                            replace: true,
                            state: {
                                ...usr,
                                tag: tag,
                            },
                        });
                        setShowPanel(false);
                    }}
                ></TagPanel>
                <button
                    ref={tagButtonRef}
                    type="button"
                    className={classNames({
                        "first-tag": true,
                        highlight: selectedTag?.id === firstTag.id,
                    })}
                    data-panel-open={showPanel}
                    title={firstTag.title}
                    aria-controls={tagPanelId}
                    aria-expanded={showPanel}
                    onClick={() => {
                        setShowPanel((prev) => !prev);
                    }}
                >
                    {firstTag.title}
                    <SvgAsset iconName="chevron-down" size={14}></SvgAsset>
                </button>
                {tags?.pinned?.map?.((tag) => (
                    <button
                        type="button"
                        key={tag.id}
                        className={classNames({
                            "pinned-tag": true,
                            highlight: selectedTag?.id === tag.id,
                        })}
                        title={tag.title}
                        onClick={() => {
                            setSelectedTag(tag);
                            const usr = history.state?.usr ?? {};

                            navigate("", {
                                replace: true,
                                state: {
                                    ...usr,
                                    tag: tag,
                                },
                            });
                        }}
                    >
                        {tag.title}
                    </button>
                ))}
            </div>
            <div className="list-container">
                <Condition
                    condition={status !== RequestStateCode.PENDING_FIRST_PAGE}
                    falsy={<Loading></Loading>}
                >
                    <Condition condition={sheets.length} falsy={<Empty></Empty>}>
                        <div className="recommend-editorial-grid">
                            {sheets.map((sheet, index) => (
                                <RecommendSheetCard
                                    key={`${sheet.platform}-${sheet.id}-${index}`}
                                    sheet={sheet}
                                    index={index}
                                    featured={index === 0}
                                    onOpen={openSheet}
                                ></RecommendSheetCard>
                            ))}
                        </div>
                        <BottomLoadingState
                            state={status}
                            onLoadMore={query}
                        ></BottomLoadingState>
                    </Condition>
                </Condition>
            </div>
        </div>
    );
}

interface IRecommendSheetCardProps {
    sheet: IMusic.IMusicSheetItem;
    index: number;
    featured: boolean;
    onOpen: (sheet: IMusic.IMusicSheetItem) => void;
}

function RecommendSheetCard(props: IRecommendSheetCardProps) {
    const { sheet, index, featured, onOpen } = props;
    const { t } = useTranslation();
    const metaText = getDiscoveryMetaText(sheet);
    const count = sheet.playCount ?? sheet.worksNum;

    return (
        <button
            type="button"
            className="recommend-editorial-card"
            data-featured={featured}
            aria-label={t("discovery_pages.open_playlist", { title: sheet.title })}
            onClick={() => onOpen(sheet)}
        >
            <span className="recommend-card-artwork">
                <LazyImage
                    src={getCompactArtworkSrc(sheet, featured ? 720 : 420) ?? albumImg}
                    fallbackSrc={albumImg}
                    releaseWhenHidden={false}
                    onError={setFallbackAlbum}
                    alt=""
                ></LazyImage>
                <span className="recommend-card-index">
                    {String(index + 1).padStart(2, "0")}
                </span>
                {featured && (
                    <span className="recommend-featured-mark">
                        <SvgAsset iconName="sparkles" size={14}></SvgAsset>
                        {t("discovery_pages.featured")}
                    </span>
                )}
            </span>
            <span className="recommend-card-copy">
                <span className="recommend-card-title">{sheet.title}</span>
                <span className="recommend-card-meta">
                    <span>{metaText ?? sheet.platform}</span>
                    {count ? (
                        <span className="recommend-card-count">
                            <SvgAsset
                                iconName={sheet.playCount ? "headphone" : "musical-note"}
                                size={13}
                            ></SvgAsset>
                            {normalizeNumber(count, !isCN())}
                        </span>
                    ) : null}
                </span>
            </span>
        </button>
    );
}
