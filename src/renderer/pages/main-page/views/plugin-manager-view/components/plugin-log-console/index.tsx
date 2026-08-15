import { isModalOpen, hideModal, showModal } from "@/renderer/components/Modal";
import SvgAsset from "@/renderer/components/SvgAsset";
import PluginManager, {
    usePluginPlaybackLogs,
} from "@shared/plugin-manager/renderer";
import type {
    PluginPlaybackLogEntry,
    PluginPlaybackLogKind,
    PluginPlaybackLogLevel,
} from "@shared/plugin-manager/playback-log";
import { dialogUtil, fsUtil } from "@shared/utils/renderer";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import "./index.scss";

type SourceFilter = "all" | PluginPlaybackLogKind;
type LevelFilter = "all" | PluginPlaybackLogLevel;

interface IProps {
    open: boolean;
    onClose: () => void;
}

interface LogRow {
    entry: PluginPlaybackLogEntry;
    depth: number;
}

function getLogRows(entries: PluginPlaybackLogEntry[]): LogRow[] {
    const depths = new Map<string, number>();
    return entries.map((entry) => {
        let depth = depths.get(entry.callId) ?? 0;
        if (entry.level === "groupEnd") {
            depth = Math.max(0, depth - 1);
            depths.set(entry.callId, depth);
        }
        const row = { entry, depth };
        if (entry.level === "group") {
            depths.set(entry.callId, depth + 1);
        }
        return row;
    });
}

function formatDuration(durationMs?: number) {
    if (durationMs === undefined) {
        return "";
    }
    return durationMs < 1000
        ? `${Math.round(durationMs)} ms`
        : `${(durationMs / 1000).toFixed(2)} s`;
}

function formatTimestamp(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        hour12: false,
    }).format(new Date(timestamp));
}

export default function PluginLogConsole({ open, onClose }: IProps) {
    const { t } = useTranslation();
    const logs = usePluginPlaybackLogs();
    const dialogRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const backdropPressedRef = useRef(false);
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
    const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
    const [query, setQuery] = useState("");
    const [follow, setFollow] = useState(true);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");

    const filteredLogs = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        return logs.filter((entry) => {
            if (sourceFilter !== "all" && entry.kind !== sourceFilter) {
                return false;
            }
            if (levelFilter !== "all" && entry.level !== levelFilter) {
                return false;
            }
            if (!normalizedQuery) {
                return true;
            }
            return [
                entry.pluginName,
                entry.platform,
                entry.quality,
                entry.message,
                entry.kind,
                entry.level,
                entry.phase,
            ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
        });
    }, [levelFilter, logs, query, sourceFilter]);
    const rows = useMemo(() => getLogRows(filteredLogs), [filteredLogs]);
    const errorCount = logs.filter(
        (entry) => entry.phase === "error" || entry.level === "error",
    ).length;
    const callCount = logs.filter((entry) => entry.phase === "request").length;

    async function refreshLogs() {
        setLoading(true);
        setLoadError("");
        try {
            await PluginManager.reloadPlaybackLogs();
        } catch (error) {
            setLoadError((error as Error)?.message ?? t("plugin_management_page.log_load_failed"));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!open) {
            return;
        }
        void refreshLogs();
    // Refresh only when the console is opened; live entries arrive through the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!open || !follow) {
            return;
        }
        scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: "auto",
        });
    }, [follow, open, rows.length]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const focusTimer = requestAnimationFrame(() => {
            dialogRef.current?.querySelector<HTMLElement>("button, input, select")?.focus();
        });
        const onKeyDown = (event: KeyboardEvent) => {
            if (isModalOpen()) {
                return;
            }
            if (event.code === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                onClose();
                return;
            }
            if (event.code !== "Tab") {
                return;
            }
            const dialog = dialogRef.current;
            if (!dialog) {
                return;
            }
            const focusable = [...dialog.querySelectorAll<HTMLElement>(
                "button:not([disabled]), input:not([disabled]), select:not([disabled]), "
                + "[tabindex]:not([tabindex='-1'])",
            )].filter((element) => !element.hidden && element.offsetParent !== null);
            if (!focusable.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            cancelAnimationFrame(focusTimer);
            window.removeEventListener("keydown", onKeyDown, true);
            previousFocus?.focus();
        };
    }, [onClose, open]);

    function getMessage(entry: PluginPlaybackLogEntry) {
        if (entry.phase === "console") {
            return entry.message || t("plugin_management_page.log_empty_console");
        }
        if (entry.phase === "request") {
            return t("plugin_management_page.log_call_started");
        }
        if (entry.phase === "success") {
            return t("plugin_management_page.log_call_succeeded");
        }
        return entry.message
            ? `${t("plugin_management_page.log_call_failed")}: ${entry.message}`
            : t("plugin_management_page.log_call_failed");
    }

    async function exportLogs() {
        try {
            const result = await dialogUtil.showSaveDialog({
                title: t("plugin_management_page.log_export"),
                defaultPath: `bakamusic-plugin-playback-${new Date().toISOString().slice(0, 10)}.ndjson`,
                filters: [{ name: "NDJSON", extensions: ["ndjson"] }],
            });
            if (result.canceled || !result.filePath) {
                return;
            }
            const output = filteredLogs.map((entry) => JSON.stringify(entry)).join("\n");
            await fsUtil.writeFile(result.filePath, output ? `${output}\n` : "", "utf8");
            toast.success(t("plugin_management_page.log_exported"));
        } catch (error) {
            toast.error(
                `${t("plugin_management_page.log_export_failed")}: ${(error as Error)?.message ?? ""}`,
            );
        }
    }

    function confirmClearLogs() {
        showModal("Reconfirm", {
            title: t("plugin_management_page.log_clear"),
            content: t("plugin_management_page.log_clear_confirm"),
            async onConfirm() {
                try {
                    await PluginManager.clearPlaybackLogs();
                    hideModal();
                    toast.success(t("plugin_management_page.log_cleared"));
                } catch (error) {
                    hideModal();
                    toast.error(
                        `${t("plugin_management_page.log_clear_failed")}: ${(error as Error)?.message ?? ""}`,
                    );
                }
            },
        });
    }

    function onScroll() {
        const element = scrollRef.current;
        if (!element) {
            return;
        }
        const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        if (!atBottom && follow) {
            setFollow(false);
        }
    }

    function onBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
        backdropPressedRef.current = event.target === event.currentTarget;
    }

    function onBackdropMouseUp(event: MouseEvent<HTMLDivElement>) {
        if (backdropPressedRef.current && event.target === event.currentTarget) {
            onClose();
        }
        backdropPressedRef.current = false;
    }

    if (!open) {
        return null;
    }

    return createPortal(
        <div
            className="plugin-log-console-backdrop"
            onMouseDown={onBackdropMouseDown}
            onMouseUp={onBackdropMouseUp}
        >
            <div
                ref={dialogRef}
                className="plugin-log-console-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="plugin-log-console-title"
                tabIndex={-1}
            >
                <header className="plugin-log-console-header">
                    <div className="plugin-log-console-title-block">
                        <div className="plugin-log-console-mark" aria-hidden="true">
                            <SvgAsset iconName="code-bracket-square" size={18}></SvgAsset>
                        </div>
                        <div className="plugin-log-console-heading">
                            <div className="plugin-log-console-title-line">
                                <h2 id="plugin-log-console-title">
                                    {t("plugin_management_page.plugin_logs")}
                                </h2>
                                <span className="plugin-log-console-live">
                                    <span aria-hidden="true"></span>
                                    {t("plugin_management_page.log_live")}
                                </span>
                            </div>
                            <p>{t("plugin_management_page.plugin_logs_description")}</p>
                        </div>
                    </div>
                    <dl className="plugin-log-console-summary">
                        <div>
                            <dt>{t("plugin_management_page.log_calls")}</dt>
                            <dd>{callCount}</dd>
                        </div>
                        <div>
                            <dt>{t("plugin_management_page.log_events")}</dt>
                            <dd>{logs.length}</dd>
                        </div>
                        <div data-tone={errorCount ? "error" : "quiet"}>
                            <dt>{t("plugin_management_page.log_errors")}</dt>
                            <dd>{errorCount}</dd>
                        </div>
                    </dl>
                    <button
                        type="button"
                        className="plugin-log-console-close"
                        aria-label={t("common.close")}
                        title={t("common.close")}
                        onClick={onClose}
                    >
                        <SvgAsset iconName="x-mark" size={16}></SvgAsset>
                    </button>
                </header>

                <div className="plugin-log-console-toolbar">
                    <div className="plugin-log-console-filters">
                        <div
                            className="plugin-log-source-filter"
                            role="group"
                            aria-label={t("plugin_management_page.log_source_filter")}
                        >
                            {(["all", "plugin", "lx"] as SourceFilter[]).map((source) => (
                                <button
                                    key={source}
                                    type="button"
                                    aria-pressed={sourceFilter === source}
                                    onClick={() => setSourceFilter(source)}
                                >
                                    {t(`plugin_management_page.log_source_${source}`)}
                                </button>
                            ))}
                        </div>
                        <div className="plugin-log-search">
                            <SvgAsset iconName="magnifying-glass" size={15}></SvgAsset>
                            <input
                                value={query}
                                aria-label={t("plugin_management_page.log_search")}
                                placeholder={t("plugin_management_page.log_search")}
                                onChange={(event) => setQuery(event.target.value)}
                            />
                            {query && (
                                <button
                                    type="button"
                                    aria-label={t("common.clear")}
                                    title={t("common.clear")}
                                    onClick={() => setQuery("")}
                                >
                                    <SvgAsset iconName="x-mark" size={13}></SvgAsset>
                                </button>
                            )}
                        </div>
                        <label className="plugin-log-level-filter">
                            <span className="sr-only">
                                {t("plugin_management_page.log_level_filter")}
                            </span>
                            <select
                                value={levelFilter}
                                aria-label={t("plugin_management_page.log_level_filter")}
                                onChange={(event) => setLevelFilter(event.target.value as LevelFilter)}
                            >
                                {(["all", "debug", "log", "info", "warn", "error"] as LevelFilter[])
                                    .map((level) => (
                                        <option key={level} value={level}>
                                            {t(`plugin_management_page.log_level_${level}`)}
                                        </option>
                                    ))}
                            </select>
                        </label>
                    </div>
                    <div className="plugin-log-console-actions">
                        <button
                            type="button"
                            aria-pressed={follow}
                            className={`plugin-log-follow-toggle${follow ? " is-active" : ""}`}
                            title={t("plugin_management_page.log_follow")}
                            aria-label={t("plugin_management_page.log_follow")}
                            onClick={() => setFollow((value) => !value)}
                        >
                            <span className="plugin-log-follow-indicator" aria-hidden="true"></span>
                            <span>
                                {t(follow
                                    ? "plugin_management_page.log_following"
                                    : "plugin_management_page.log_follow_paused")}
                            </span>
                        </button>
                        <button
                            type="button"
                            disabled={loading}
                            className={loading ? "is-loading" : ""}
                            title={t("plugin_management_page.log_refresh")}
                            aria-label={t("plugin_management_page.log_refresh")}
                            onClick={() => void refreshLogs()}
                        >
                            <SvgAsset iconName="arrow-path" size={15}></SvgAsset>
                        </button>
                        <button
                            type="button"
                            title={t("plugin_management_page.log_export")}
                            aria-label={t("plugin_management_page.log_export")}
                            onClick={() => void exportLogs()}
                        >
                            <SvgAsset iconName="array-download-tray" size={15}></SvgAsset>
                        </button>
                        <button
                            type="button"
                            className="is-danger"
                            disabled={!logs.length}
                            title={t("plugin_management_page.log_clear")}
                            aria-label={t("plugin_management_page.log_clear")}
                            onClick={confirmClearLogs}
                        >
                            <SvgAsset iconName="trash" size={15}></SvgAsset>
                        </button>
                    </div>
                </div>

                <div className="plugin-log-console-body">
                    <div
                        ref={scrollRef}
                        className="plugin-log-console-stream"
                        onScroll={onScroll}
                    >
                        <div className="plugin-log-console-table-head" aria-hidden="true">
                            <div className="plugin-log-console-column-head">
                                <span>{t("plugin_management_page.log_time")}</span>
                                <span>{t("plugin_management_page.log_level")}</span>
                                <span>{t("plugin_management_page.log_source")}</span>
                                <span>{t("plugin_management_page.log_plugin")}</span>
                                <span>{t("plugin_management_page.log_message")}</span>
                                <span>{t("plugin_management_page.log_duration")}</span>
                            </div>
                        </div>
                        {loading && !logs.length ? (
                            <div className="plugin-log-console-state">
                                <SvgAsset iconName="arrow-path" size={22}></SvgAsset>
                                <span>{t("plugin_management_page.log_loading")}</span>
                            </div>
                        ) : loadError ? (
                            <div className="plugin-log-console-state is-error" role="alert">
                                <span>{t("plugin_management_page.log_load_failed")}</span>
                                <small>{loadError}</small>
                            </div>
                        ) : !rows.length ? (
                            <div className="plugin-log-console-state">
                                <SvgAsset iconName="code-bracket-square" size={24}></SvgAsset>
                                <span>
                                    {logs.length
                                        ? t("plugin_management_page.log_no_matches")
                                        : t("plugin_management_page.log_empty")}
                                </span>
                                {!logs.length && (
                                    <small>{t("plugin_management_page.log_empty_hint")}</small>
                                )}
                            </div>
                        ) : (
                            <div className="plugin-log-console-rows" role="log" aria-live="polite">
                                {rows.map(({ entry, depth }) => (
                                    <div
                                        key={entry.id}
                                        className="plugin-log-row"
                                        data-level={entry.level}
                                        data-phase={entry.phase}
                                        style={{ "--log-depth": depth } as React.CSSProperties}
                                    >
                                        <time dateTime={new Date(entry.timestamp).toISOString()}>
                                            {formatTimestamp(entry.timestamp)}
                                        </time>
                                        <span className="plugin-log-level">{entry.level}</span>
                                        <span className="plugin-log-kind">{entry.kind}</span>
                                        <span className="plugin-log-origin" title={entry.pluginName}>
                                            <strong>{entry.pluginName || entry.platform}</strong>
                                            {entry.kind === "lx" && entry.platform && (
                                                <small>{entry.platform}</small>
                                            )}
                                        </span>
                                        <span className="plugin-log-message">
                                            {entry.level === "group" && (
                                                <span aria-hidden="true">›</span>
                                            )}
                                            {entry.level === "groupEnd" ? "└" : getMessage(entry)}
                                            {entry.quality && entry.phase === "request" && (
                                                <small>{entry.quality}</small>
                                            )}
                                            {entry.attempt && entry.phase === "request" && (
                                                <small>
                                                    {t("plugin_management_page.log_attempt", {
                                                        count: entry.attempt,
                                                    })}
                                                </small>
                                            )}
                                        </span>
                                        <span className="plugin-log-duration">
                                            {formatDuration(entry.durationMs)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {!follow && rows.length > 0 && (
                        <button
                            type="button"
                            className="plugin-log-console-resume"
                            onClick={() => setFollow(true)}
                        >
                            <SvgAsset iconName="play" size={12}></SvgAsset>
                            <span>{t("plugin_management_page.log_jump_to_latest")}</span>
                        </button>
                    )}
                </div>
                <footer className="plugin-log-console-footer">
                    <span>
                        {t("plugin_management_page.log_showing", {
                            count: filteredLogs.length,
                            total: logs.length,
                        })}
                    </span>
                    <span>{t("plugin_management_page.log_retention")}</span>
                </footer>
            </div>
        </div>,
        document.body,
    );
}
