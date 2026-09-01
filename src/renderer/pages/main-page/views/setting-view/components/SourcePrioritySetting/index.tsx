import "./index.scss";
import SvgAsset from "@/renderer/components/SvgAsset";
import AppConfig from "@shared/app-config/renderer";
import useAppConfig from "@/hooks/useAppConfig";
import { useMemo, useState } from "react";
import { useSortedSupportedPlugin } from "@shared/plugin-manager/renderer";
import { useTranslation } from "react-i18next";

export type SourcePriorityMode = "playback" | "download";

function getPluginIdentifier(plugin: IPlugin.IPluginDelegate) {
    return plugin.hash || plugin.platform;
}

export default function SourcePrioritySetting() {
    const { t } = useTranslation();
    const [mode, setMode] = useState<SourcePriorityMode>("playback");
    const plugins = useSortedSupportedPlugin("getMediaSource");
    const configured = useAppConfig(
        mode === "playback" ? "playMusic.sourcePriority" : "download.sourcePriority",
    );
    const keyPath = mode === "playback"
        ? "playMusic.sourcePriority"
        : "download.sourcePriority";
    const [draggingHash, setDraggingHash] = useState<string | null>(null);
    const [dropHash, setDropHash] = useState<string | null>(null);

    const orderedPlugins = useMemo(() => {
        const byId = new Map(plugins.map((plugin) => [plugin.hash, plugin]));
        const byPlatform = new Map(plugins.map((plugin) => [plugin.platform, plugin]));
        const result: IPlugin.IPluginDelegate[] = [];
        const seen = new Set<string>();
        for (const identifier of configured ?? []) {
            const plugin = byId.get(identifier) ?? byPlatform.get(identifier);
            if (plugin && !seen.has(plugin.hash)) {
                result.push(plugin);
                seen.add(plugin.hash);
            }
        }
        for (const plugin of plugins) {
            if (!seen.has(plugin.hash)) {
                result.push(plugin);
                seen.add(plugin.hash);
            }
        }
        return result;
    }, [configured, plugins]);

    const persist = (next: IPlugin.IPluginDelegate[]) => {
        void AppConfig.setConfig({
            [keyPath]: next.map(getPluginIdentifier),
        });
    };

    const move = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= orderedPlugins.length) {
            return;
        }
        const next = [...orderedPlugins];
        [next[index], next[target]] = [next[target], next[index]];
        persist(next);
    };

    const movePluginBefore = (dragHash: string, targetHash: string) => {
        if (dragHash === targetHash) {
            return;
        }
        const fromIndex = orderedPlugins.findIndex((plugin) => plugin.hash === dragHash);
        const targetIndex = orderedPlugins.findIndex((plugin) => plugin.hash === targetHash);
        if (fromIndex < 0 || targetIndex < 0) {
            return;
        }
        const next = [...orderedPlugins];
        const [dragged] = next.splice(fromIndex, 1);
        next.splice(fromIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, dragged);
        persist(next);
    };

    const resetOrder = () => {
        persist(plugins);
    };

    return (
        <div className="source-priority-setting">
            <div className="source-priority-setting__toolbar">
                <div
                    className="source-priority-setting__mode"
                    role="tablist"
                    aria-label={t("settings.plugin.source_priority_mode_label")}
                >
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "playback"}
                        className={mode === "playback" ? "is-active" : ""}
                        onClick={() => setMode("playback")}
                    >
                        {t("settings.plugin.playback_source_priority")}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "download"}
                        className={mode === "download" ? "is-active" : ""}
                        onClick={() => setMode("download")}
                    >
                        {t("settings.plugin.download_source_priority")}
                    </button>
                </div>
                <button
                    type="button"
                    className="source-priority-setting__reset"
                    onClick={resetOrder}
                >
                    <SvgAsset iconName="arrow-uturn-left" size={14}></SvgAsset>
                    <span>{t("settings.plugin.reset_source_priority")}</span>
                </button>
            </div>
            {orderedPlugins.length ? (
                <ol className="source-priority-setting__list">
                    {orderedPlugins.map((plugin, index) => (
                        <li
                            className="source-priority-setting__item"
                            data-dragging={String(draggingHash === plugin.hash)}
                            data-drop-target={String(dropHash === plugin.hash)}
                            key={plugin.hash}
                            draggable
                            onDragStart={(event) => {
                                setDraggingHash(plugin.hash);
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", plugin.hash);
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                if (draggingHash !== plugin.hash) {
                                    setDropHash(plugin.hash);
                                }
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                const sourceHash = draggingHash
                                    ?? event.dataTransfer.getData("text/plain");
                                if (sourceHash) {
                                    movePluginBefore(sourceHash, plugin.hash);
                                }
                                setDraggingHash(null);
                                setDropHash(null);
                            }}
                            onDragEnd={() => {
                                setDraggingHash(null);
                                setDropHash(null);
                            }}
                        >
                            <span className="source-priority-setting__grip" aria-hidden="true">
                                <SvgAsset iconName="grip-vertical" size={16}></SvgAsset>
                            </span>
                            <span className="source-priority-setting__index">
                                {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className="source-priority-setting__name">
                                {plugin.platform}
                            </span>
                            <span className="source-priority-setting__role">
                                {index === 0
                                    ? t("settings.plugin.source_priority_primary")
                                    : t("settings.plugin.source_priority_fallback", {
                                        index,
                                    })}
                            </span>
                            <span className="source-priority-setting__actions">
                                <button
                                    type="button"
                                    aria-label={t("settings.plugin.move_source_up")}
                                    title={t("settings.plugin.move_source_up")}
                                    disabled={index === 0}
                                    onClick={() => move(index, -1)}
                                >
                                    <SvgAsset iconName="chevron-double-up" size={15}></SvgAsset>
                                </button>
                                <button
                                    type="button"
                                    aria-label={t("settings.plugin.move_source_down")}
                                    title={t("settings.plugin.move_source_down")}
                                    disabled={index === orderedPlugins.length - 1}
                                    onClick={() => move(index, 1)}
                                >
                                    <SvgAsset iconName="chevron-double-down" size={15}></SvgAsset>
                                </button>
                            </span>
                        </li>
                    ))}
                </ol>
            ) : (
                <div className="source-priority-setting__empty">
                    {t("settings.plugin.no_source_plugin")}
                </div>
            )}
        </div>
    );
}
