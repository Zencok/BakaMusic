import albumImg from "@/assets/imgs/album-cover.jpg";
import { secondsToDuration } from "@/common/time-util";
import {
    getListeningDurationParts,
    getListeningStatisticsKey,
} from "@/renderer/core/listening-statistics/model";
import {
    clearListeningStatistics,
    useListeningStatistics,
} from "@/renderer/core/listening-statistics";
import type { IListeningStatisticsEntry } from "@/renderer/core/listening-statistics";
import trackPlayer from "@/renderer/core/track-player";
import { useCurrentMusic } from "@/renderer/core/track-player/hooks";
import { hideModal, showModal } from "@/renderer/components/Modal";
import SvgAsset from "@/renderer/components/SvgAsset";
import CurrentMusicLocator from "@/renderer/components/CurrentMusicLocator";
import type { SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import Tag from "@/renderer/components/Tag";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import { getBestMusicQualityInfo } from "@/renderer/utils/music-quality-metadata";
import useVirtualList from "@/hooks/useVirtualList";
import { useCallback, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import "./index.scss";

type StatisticsTab = "recent" | "ranking";
const STATISTICS_ROW_HEIGHT = 72;

interface IStatisticsCard {
    icon: SvgAssetIconNames;
    label: string;
    value: string;
    unit?: string;
    hint: string;
}

interface IStatisticsTrackRowProps {
    entry: IListeningStatisticsEntry;
    index: number;
    mode: StatisticsTab;
    currentMusic: IMusic.IMusicItem | null;
    t: TFunction;
}

function formatRelativeTime(timestamp: number, t: TFunction) {
    const elapsed = Math.max(0, Date.now() - timestamp);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (elapsed < minute) {
        return t("statistics_page.just_now");
    }
    if (elapsed < hour) {
        return t("statistics_page.minutes_ago", {
            count: Math.floor(elapsed / minute),
        });
    }
    if (elapsed < day) {
        return t("statistics_page.hours_ago", {
            count: Math.floor(elapsed / hour),
        });
    }
    if (elapsed < 7 * day) {
        return t("statistics_page.days_ago", {
            count: Math.floor(elapsed / day),
        });
    }

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: new Date(timestamp).getFullYear() === new Date().getFullYear()
            ? undefined
            : "numeric",
    }).format(timestamp);
}

function formatListeningDuration(
    totalSeconds: number,
    t: TFunction,
    numberFormatter: Intl.NumberFormat,
) {
    return getListeningDurationParts(totalSeconds)
        .map(({ unit, value }) => t(`statistics_page.duration_${unit}`, {
            value: numberFormatter.format(value),
        }))
        .join(" ");
}

function playStatisticsEntry(entry: IListeningStatisticsEntry) {
    void trackPlayer.playMusic(entry.musicItem);
}

function StatisticsTrackRow(props: IStatisticsTrackRowProps) {
    const { entry, index, mode, currentMusic, t } = props;
    const isCurrent = currentMusic
        ? getListeningStatisticsKey(currentMusic) === getListeningStatisticsKey(entry.musicItem)
        : false;
    const artwork = entry.musicItem.coverImg ?? entry.musicItem.artwork ?? albumImg;
    const qualityInfo = getBestMusicQualityInfo(entry.musicItem);

    return (
        <div
            className="statistics-track-row"
            data-current={isCurrent}
            role="button"
            tabIndex={0}
            onClick={() => playStatisticsEntry(entry)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    playStatisticsEntry(entry);
                }
            }}
        >
            <div className="statistics-track-position" data-top={mode === "ranking" && index < 3}>
                {String(index + 1).padStart(2, "0")}
            </div>
            <div className="statistics-track-cover-wrap">
                <img
                    alt={entry.musicItem.title || t("media.unknown_title")}
                    className="statistics-track-cover"
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    src={artwork}
                    onError={setFallbackAlbum}
                ></img>
                <div className="statistics-track-cover-play">
                    <SvgAsset iconName={isCurrent ? "pause" : "play"}></SvgAsset>
                </div>
            </div>
            <div className="statistics-track-copy">
                <strong>{entry.musicItem.title || t("media.unknown_title")}</strong>
                <span>
                    {entry.musicItem.artist || t("media.unknown_artist")}
                    {entry.musicItem.album ? ` · ${entry.musicItem.album}` : ""}
                </span>
                <div className="statistics-track-meta-row">
                    <Tag>
                        {entry.musicItem.duration
                            ? secondsToDuration(entry.musicItem.duration)
                            : "--:--"}
                    </Tag>
                    {qualityInfo ? (
                        <Tag>
                            {qualityInfo.label}
                            {qualityInfo.sizeText ? ` · ${qualityInfo.sizeText}` : ""}
                        </Tag>
                    ) : null}
                    {entry.musicItem.platform ? (
                        <Tag fill>
                            {entry.musicItem.platform}
                        </Tag>
                    ) : null}
                </div>
            </div>
            <div className="statistics-track-last-played">
                <span>{t("statistics_page.last_played")}</span>
                <strong>{formatRelativeTime(entry.lastPlayedAt, t)}</strong>
            </div>
            <div className="statistics-track-count">
                <strong>{entry.playCount.toLocaleString()}</strong>
                <span>{t("statistics_page.plays_unit")}</span>
            </div>
            <div className="statistics-track-action">
                <SvgAsset iconName="play"></SvgAsset>
            </div>
        </div>
    );
}

export default function StatisticsView() {
    const { t } = useTranslation();
    const currentMusic = useCurrentMusic();
    const { statistics, recentEntries, mostPlayedEntries } = useListeningStatistics();
    const [activeTab, setActiveTab] = useState<StatisticsTab>("recent");
    const [searchText, setSearchText] = useState("");
    const pageRef = useRef<HTMLDivElement>(null);
    const trackListRef = useRef<HTMLDivElement>(null);
    const topEntry = mostPlayedEntries[0];
    const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);
    const currentEntries = activeTab === "recent" ? recentEntries : mostPlayedEntries;
    const normalizedSearch = searchText.trim().toLocaleLowerCase();
    const visibleEntries = useMemo(() => {
        if (!normalizedSearch) {
            return currentEntries;
        }

        return currentEntries.filter(({ musicItem }) =>
            [musicItem.title, musicItem.artist, musicItem.album]
                .some((value) => value?.toLocaleLowerCase().includes(normalizedSearch)),
        );
    }, [currentEntries, normalizedSearch]);
    const getScrollElement = useCallback(() => pageRef.current, []);
    const getTrackListOffset = useCallback(
        () => trackListRef.current?.offsetTop ?? 0,
        [],
    );
    const virtualController = useVirtualList({
        data: visibleEntries,
        estimateItemHeight: STATISTICS_ROW_HEIGHT,
        fallbackRenderCount: 40,
        getScrollElement,
        offsetHeight: getTrackListOffset,
        overscan: 5,
    });
    const cards: IStatisticsCard[] = [
        {
            icon: "motion-play",
            label: t("statistics_page.total_plays"),
            value: numberFormatter.format(statistics.totalPlays),
            unit: t("statistics_page.plays_unit"),
            hint: t("statistics_page.total_plays_hint"),
        },
        {
            icon: "musical-note",
            label: t("statistics_page.unique_tracks"),
            value: numberFormatter.format(Object.keys(statistics.entries).length),
            unit: t("statistics_page.tracks_unit"),
            hint: t("statistics_page.unique_tracks_hint"),
        },
        {
            icon: "clock",
            label: t("statistics_page.total_listening_time"),
            value: formatListeningDuration(
                statistics.totalListeningSeconds,
                t,
                numberFormatter,
            ),
            hint: t("statistics_page.total_listening_time_hint"),
        },
        {
            icon: "trophy",
            label: t("statistics_page.top_track"),
            value: topEntry?.musicItem.title || "—",
            hint: topEntry
                ? t("statistics_page.top_track_hint", { count: topEntry.playCount })
                : t("statistics_page.no_data"),
        },
    ];

    function confirmClearStatistics() {
        showModal("Reconfirm", {
            title: t("statistics_page.clear_statistics"),
            content: t("statistics_page.clear_statistics_confirm"),
            async onConfirm() {
                hideModal();
                await clearListeningStatistics();
            },
        });
    }

    return (
        <div
            id="page-container"
            className="page-container statistics-page"
            ref={pageRef}
        >
            <header className="statistics-header">
                <h1>{t("statistics_page.title")}</h1>
                <button
                    className="statistics-clear-button"
                    type="button"
                    disabled={!statistics.totalPlays && !statistics.totalListeningSeconds}
                    onClick={confirmClearStatistics}
                >
                    <SvgAsset iconName="trash"></SvgAsset>
                    {t("statistics_page.clear_statistics")}
                </button>
            </header>

            <section className="statistics-summary-bar">
                {cards.map((card) => (
                    <article className="statistics-summary-card" key={card.label}>
                        <div className="statistics-summary-icon">
                            <SvgAsset iconName={card.icon}></SvgAsset>
                        </div>
                        <div className="statistics-summary-copy">
                            <span>{card.label}</span>
                            <strong title={card.value}>
                                <span className="statistics-summary-value-text">{card.value}</span>
                                {card.unit && (
                                    <span className="statistics-summary-value-unit">{card.unit}</span>
                                )}
                            </strong>
                            <small>{card.hint}</small>
                        </div>
                    </article>
                ))}
            </section>

            <section className="statistics-library">
                <div className="statistics-library-toolbar">
                    <div className="statistics-tabs" role="tablist">
                        {(["recent", "ranking"] as const).map((tab) => (
                            <button
                                type="button"
                                role="tab"
                                aria-selected={activeTab === tab}
                                data-active={activeTab === tab}
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                            >
                                <SvgAsset iconName={tab === "recent" ? "clock" : "trophy"}></SvgAsset>
                                {t(`statistics_page.${tab}`)}
                            </button>
                        ))}
                    </div>
                    <label className="statistics-search">
                        <SvgAsset iconName="magnifying-glass"></SvgAsset>
                        <input
                            value={searchText}
                            spellCheck={false}
                            placeholder={t("statistics_page.search_placeholder")}
                            onChange={(event) => setSearchText(event.target.value)}
                        ></input>
                    </label>
                </div>

                <div className="statistics-section-heading">
                    <div>
                        <div className="statistics-section-title-row">
                            <h2>{t(`statistics_page.${activeTab}`)}</h2>
                            <span className="statistics-section-count">
                                {visibleEntries.length}
                            </span>
                        </div>
                        <p>{t(`statistics_page.${activeTab}_hint`)}</p>
                    </div>
                </div>

                {visibleEntries.length ? (
                    <div
                        className="statistics-track-list"
                        ref={trackListRef}
                        style={{ height: virtualController.totalHeight }}
                    >
                        <div
                            className="statistics-track-virtual-content"
                            style={{
                                transform: `translateY(${virtualController.startTop}px)`,
                            }}
                        >
                            {virtualController.virtualItems.map((virtualItem) => (
                                <StatisticsTrackRow
                                    currentMusic={currentMusic}
                                    entry={virtualItem.dataItem}
                                    index={virtualItem.rowIndex}
                                    key={getListeningStatisticsKey(
                                        virtualItem.dataItem.musicItem,
                                    )}
                                    mode={activeTab}
                                    t={t}
                                ></StatisticsTrackRow>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="statistics-empty">
                        <div className="statistics-empty-icon">
                            <SvgAsset iconName="musical-note"></SvgAsset>
                        </div>
                        <strong>{t(normalizedSearch
                            ? "statistics_page.no_search_result"
                            : "statistics_page.empty_title")}</strong>
                        <span>{t(normalizedSearch
                            ? "statistics_page.no_search_result_hint"
                            : "statistics_page.empty_hint")}</span>
                    </div>
                )}
                <CurrentMusicLocator
                    musicList={visibleEntries.map(({ musicItem }) => musicItem)}
                    getScrollElement={getScrollElement}
                    scrollToIndex={virtualController.scrollToIndex}
                ></CurrentMusicLocator>
            </section>
        </div>
    );
}
