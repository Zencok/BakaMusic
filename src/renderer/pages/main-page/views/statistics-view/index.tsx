import albumImg from "@/assets/imgs/album-cover.jpg";
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
import type { SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import "./index.scss";

type StatisticsTab = "recent" | "ranking";

interface IStatisticsCard {
    icon: SvgAssetIconNames;
    label: string;
    value: string;
    hint: string;
    compact?: boolean;
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
                {mode === "ranking" ? index + 1 : String(index + 1).padStart(2, "0")}
            </div>
            <div className="statistics-track-cover-wrap">
                <img
                    className="statistics-track-cover"
                    draggable={false}
                    src={artwork}
                    onError={setFallbackAlbum}
                ></img>
                <div className="statistics-track-cover-play">
                    <SvgAsset iconName={isCurrent ? "speaker-wave" : "play"}></SvgAsset>
                </div>
            </div>
            <div className="statistics-track-copy">
                <strong>{entry.musicItem.title || t("media.unknown_title")}</strong>
                <span>
                    {entry.musicItem.artist || t("media.unknown_artist")}
                    {entry.musicItem.album ? ` · ${entry.musicItem.album}` : ""}
                </span>
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
    const cards: IStatisticsCard[] = [
        {
            icon: "motion-play",
            label: t("statistics_page.total_plays"),
            value: numberFormatter.format(statistics.totalPlays),
            hint: t("statistics_page.total_plays_hint"),
        },
        {
            icon: "musical-note",
            label: t("statistics_page.unique_tracks"),
            value: numberFormatter.format(Object.keys(statistics.entries).length),
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
            compact: true,
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
        <div id="page-container" className="page-container statistics-page">
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
                    <article className="statistics-summary-card" key={card.label} data-compact={card.compact}>
                        <div className="statistics-summary-icon">
                            <SvgAsset iconName={card.icon}></SvgAsset>
                        </div>
                        <div className="statistics-summary-copy">
                            <span>{card.label}</span>
                            <strong title={card.value}>{card.value}</strong>
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
                        <h2>{t(`statistics_page.${activeTab}`)}</h2>
                        <p>{t(`statistics_page.${activeTab}_hint`)}</p>
                    </div>
                    <span>{t("statistics_page.track_count", { count: visibleEntries.length })}</span>
                </div>

                {visibleEntries.length ? (
                    <div className="statistics-track-list">
                        {visibleEntries.map((entry, index) => (
                            <StatisticsTrackRow
                                currentMusic={currentMusic}
                                entry={entry}
                                index={index}
                                key={getListeningStatisticsKey(entry.musicItem)}
                                mode={activeTab}
                                t={t}
                            ></StatisticsTrackRow>
                        ))}
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
            </section>
        </div>
    );
}
