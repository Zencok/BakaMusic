import albumImg from "@/assets/imgs/album-cover.jpg";
import { DownloadState } from "@/common/constant";
import { normalizeFileSize } from "@/common/normalize-util";
import { secondsToDuration } from "@/common/time-util";
import useVirtualList from "@/hooks/useVirtualList";
import { hideModal, showModal } from "@/renderer/components/Modal";
import SvgAsset from "@/renderer/components/SvgAsset";
import Tag from "@/renderer/components/Tag";
import Downloader, { IDownloadTaskSnapshot } from "@/renderer/core/downloader";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Downloaded from "../Downloaded";
import "./index.scss";

const estimateItemHeight = 132;
const compactTagStyle = {
    fontSize: "0.7rem",
    lineHeight: 1.2,
    padding: "2px 8px",
    borderRadius: 999,
    maxWidth: "none",
};

type TaskFilter = "all" | "active" | "paused" | "failed" | "downloaded";

function getTaskFilterState(filter: TaskFilter, state: DownloadState) {
    if (filter === "active") {
        return [DownloadState.WAITING, DownloadState.DOWNLOADING].includes(state);
    }
    if (filter === "paused") {
        return state === DownloadState.PAUSED;
    }
    if (filter === "failed") {
        return state === DownloadState.ERROR;
    }
    return filter === "all";
}

function TaskAction({ task }: { task: IDownloadTaskSnapshot }) {
    const { t } = useTranslation();
    const { musicItem, status } = task;
    const canPause = [DownloadState.WAITING, DownloadState.DOWNLOADING]
        .includes(status.state);
    const canResume = status.state === DownloadState.PAUSED;
    const canRetry = status.state === DownloadState.ERROR;

    return (
        <div className="downloading-item-actions">
            {canPause ? (
                <button
                    type="button"
                    className="downloading-item-action"
                    title={t("download_page.pause")}
                    onClick={() => void Downloader.pauseTask(musicItem)}
                >
                    <SvgAsset iconName="pause" size={15}></SvgAsset>
                </button>
            ) : null}
            {canResume || canRetry ? (
                <button
                    type="button"
                    className="downloading-item-action"
                    title={canRetry ? t("download_page.retry") : t("download_page.resume")}
                    onClick={() => Downloader.resumeTask(musicItem)}
                >
                    <SvgAsset
                        iconName={canRetry ? "arrow-path" : "play"}
                        size={15}
                    ></SvgAsset>
                </button>
            ) : null}
            <button
                type="button"
                className="downloading-item-action"
                data-variant="danger"
                title={t("download_page.remove_task")}
                onClick={() => void Downloader.removeTask(musicItem)}
            >
                <SvgAsset iconName="x-mark" size={15}></SvgAsset>
            </button>
        </div>
    );
}

function TaskProgress({ task }: { task: IDownloadTaskSnapshot }) {
    const { t } = useTranslation();
    const { status } = task;
    const percent = status.total
        ? Math.min(100, Math.round(((status.downloaded ?? 0) / status.total) * 100))
        : 0;
    const labels: Partial<Record<DownloadState, string>> = {
        [DownloadState.WAITING]: t("download_page.waiting"),
        [DownloadState.DOWNLOADING]: t("download_page.downloading_now"),
        [DownloadState.PAUSED]: t("download_page.paused"),
        [DownloadState.ERROR]: t("download_page.failed"),
    };

    return (
        <div className="downloading-item-progress" data-state={status.state.toLowerCase()}>
            <div className="downloading-item-progress-header">
                <span className="downloading-item-state">
                    <i></i>
                    {labels[status.state] ?? status.state}
                </span>
                <span className="downloading-item-percent">
                    {status.total ? `${percent}%` : "—"}
                </span>
            </div>
            <div className="downloading-progress-track" aria-hidden="true">
                <span style={{ width: `${percent}%` }}></span>
            </div>
            <div className="downloading-progress-detail">
                {status.state === DownloadState.ERROR ? (
                    <span title={status.msg}>{status.msg || t("download_page.unknown_error")}</span>
                ) : (
                    <>
                        <span>
                            {normalizeFileSize(status.downloaded ?? 0)} / {status.total
                                ? normalizeFileSize(status.total)
                                : "—"}
                        </span>
                        {status.state === DownloadState.DOWNLOADING && status.speed ? (
                            <span>{normalizeFileSize(status.speed)}/s</span>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}

export default function Downloading() {
    const { t } = useTranslation();
    const tasks = Downloader.useDownloadingTaskList();
    const downloadedList = Downloader.useDownloadedMusicList();
    const [filter, setFilter] = useState<TaskFilter>("all");
    const [query, setQuery] = useState("");
    const counts = useMemo(() => ({
        active: tasks.filter(({ status }) => [
            DownloadState.WAITING,
            DownloadState.DOWNLOADING,
        ].includes(status.state)).length,
        paused: tasks.filter(({ status }) => status.state === DownloadState.PAUSED).length,
        failed: tasks.filter(({ status }) => status.state === DownloadState.ERROR).length,
    }), [tasks]);
    const visibleTasks = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        return tasks.filter(({ musicItem, status }) => {
            const matchesState = getTaskFilterState(filter, status.state);
            const matchesQuery = !normalizedQuery || [
                musicItem.title,
                musicItem.artist,
                musicItem.album,
                musicItem.platform,
            ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
            return matchesState && matchesQuery;
        });
    }, [filter, query, tasks]);
    const visibleDownloadedList = useMemo(() => {
        if (!["all", "downloaded"].includes(filter)) {
            return [];
        }
        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (!normalizedQuery) {
            return downloadedList;
        }
        return downloadedList.filter((musicItem) => [
            musicItem.title,
            musicItem.artist,
            musicItem.album,
            musicItem.platform,
        ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
    }, [downloadedList, filter, query]);
    const virtualController = useVirtualList({
        data: visibleTasks,
        scrollElementQuery: "#page-container",
        estimateItemHeight,
    });
    const filters: Array<{ key: TaskFilter; label: string; count: number }> = [
        {
            key: "all",
            label: t("download_page.all_tasks"),
            count: tasks.length + downloadedList.length,
        },
        { key: "active", label: t("download_page.active"), count: counts.active },
        { key: "paused", label: t("download_page.paused"), count: counts.paused },
        { key: "failed", label: t("download_page.failed_count"), count: counts.failed },
        {
            key: "downloaded",
            label: t("common.downloaded"),
            count: downloadedList.length,
        },
    ];

    function confirmClearAllTasks() {
        showModal("Reconfirm", {
            title: t("download_page.clear_all_tasks"),
            content: t("download_page.clear_all_tasks_confirm"),
            async onConfirm() {
                hideModal();
                await Downloader.clearAllTasks();
            },
        });
    }

    return (
        <section className="downloading-container">
            <div className="downloading-controls">
                <div className="downloading-toolbar">
                    <div className="downloading-toolbar-actions">
                        <button
                            type="button"
                            className="downloading-toolbar-button"
                            disabled={!counts.active}
                            onClick={() => void Downloader.pauseAllTasks()}
                        >
                            <SvgAsset iconName="pause" size={15}></SvgAsset>
                            {t("download_page.pause_all")}
                        </button>
                        <button
                            type="button"
                            className="downloading-toolbar-button"
                            disabled={!counts.paused}
                            onClick={() => Downloader.resumeAllTasks()}
                        >
                            <SvgAsset iconName="play" size={15}></SvgAsset>
                            {t("download_page.resume_all")}
                        </button>
                        <button
                            type="button"
                            className="downloading-toolbar-button"
                            disabled={!counts.failed}
                            onClick={() => void Downloader.clearFailedTasks()}
                        >
                            <SvgAsset iconName="arrow-path" size={15}></SvgAsset>
                            {t("download_page.clear_failed")}
                        </button>
                        <button
                            type="button"
                            className="downloading-toolbar-button"
                            data-variant="danger"
                            disabled={!tasks.length}
                            onClick={confirmClearAllTasks}
                        >
                            <SvgAsset iconName="trash" size={15}></SvgAsset>
                            {t("common.clear")}
                        </button>
                    </div>
                    <label className="downloading-search">
                        <SvgAsset iconName="magnifying-glass" size={15}></SvgAsset>
                        <input
                            value={query}
                            placeholder={t("download_page.search_tasks")}
                            onChange={(event) => setQuery(event.target.value)}
                        ></input>
                        {query ? (
                            <button type="button" onClick={() => setQuery("")}>
                                <SvgAsset iconName="x-mark" size={13}></SvgAsset>
                            </button>
                        ) : null}
                    </label>
                </div>
                <div className="downloading-filterbar">
                    <div className="downloading-filters">
                        {filters.map((item) => (
                            <button
                                type="button"
                                className="downloading-filter"
                                data-active={filter === item.key}
                                key={item.key}
                                onClick={() => setFilter(item.key)}
                            >
                                {item.label}
                                <span>{item.count}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            {visibleDownloadedList.length ? (
                <Downloaded
                    embedded
                    musicList={visibleDownloadedList}
                ></Downloaded>
            ) : null}
            {visibleTasks.length ? (
                <div
                    className="downloading-virtual-spacer"
                    style={{ height: virtualController.totalHeight }}
                >
                    <div
                        className="downloading-virtual-content"
                        style={{ transform: `translateY(${virtualController.startTop}px)` }}
                    >
                        {virtualController.virtualItems.map((virtualItem) => {
                            const task = virtualItem.dataItem;
                            const { musicItem } = task;
                            return (
                                <div className="downloading-item-wrapper" key={`${musicItem.platform}-${musicItem.id}`}>
                                    <article className="downloading-item-card">
                                        <div className="downloading-item-cover">
                                            <img
                                                src={musicItem.artwork ?? albumImg}
                                                alt=""
                                                onError={setFallbackAlbum}
                                            ></img>
                                            <span>{String(virtualItem.rowIndex + 1).padStart(2, "0")}</span>
                                        </div>
                                        <div className="downloading-item-main">
                                            <div className="downloading-item-title" title={musicItem.title}>
                                                {musicItem.title}
                                            </div>
                                            <div className="downloading-item-subtitle">
                                                {musicItem.artist || t("download_page.unknown_artist")}
                                                {musicItem.album ? ` · ${musicItem.album}` : ""}
                                            </div>
                                            <div className="downloading-item-meta">
                                                <Tag fill style={compactTagStyle}>{musicItem.platform}</Tag>
                                                <Tag style={compactTagStyle}>
                                                    {musicItem.duration
                                                        ? secondsToDuration(musicItem.duration)
                                                        : "--:--"}
                                                </Tag>
                                            </div>
                                        </div>
                                        <TaskProgress task={task}></TaskProgress>
                                        <TaskAction task={task}></TaskAction>
                                    </article>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}
            {!visibleTasks.length && !visibleDownloadedList.length ? (
                <div className="downloading-empty">
                    <span><SvgAsset iconName="array-download-tray" size={26}></SvgAsset></span>
                    <strong>{query || filter !== "all"
                        ? t("download_page.no_matching_tasks")
                        : t("download_page.no_tasks")}</strong>
                    <p>{query || filter !== "all"
                        ? t("download_page.adjust_filter")
                        : t("download_page.no_tasks_hint")}</p>
                </div>
            ) : null}
        </section>
    );
}
