import { type MouseEvent, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import Condition from "@/renderer/components/Condition";
import {
    showContextMenu,
    type IContextMenuItem,
} from "@/renderer/components/ContextMenu";
import Empty from "@/renderer/components/Empty";
import { hideModal, showModal } from "@/renderer/components/Modal";
import SvgAsset from "@/renderer/components/SvgAsset";
import PluginManager, { useLxPlugins } from "@shared/plugin-manager/renderer";
import {
    getLxPlatformName,
    getLxSourceForPlatform,
    type LxPluginDescriptor,
    type LxSource,
} from "@shared/plugin-manager/lx-types";
import "./index.scss";

interface LxPluginSectionProps {
    basePlugins: IPlugin.IPluginDelegate[];
}

function getSourceEntries(plugin: LxPluginDescriptor) {
    return Object.keys(plugin.sources) as LxSource[];
}

export default function LxPluginSection({ basePlugins }: LxPluginSectionProps) {
    const { t } = useTranslation();
    const lxPlugins = useLxPlugins();
    const hasActiveLxPlugin = lxPlugins.some((plugin) => plugin.active);
    const installedBaseSources = useMemo(() => new Set(
        basePlugins
            .map((plugin) => getLxSourceForPlatform(plugin.platform))
            .filter((source): source is LxSource => source !== null),
    ), [basePlugins]);

    function uninstall(plugin: LxPluginDescriptor) {
        showModal("Reconfirm", {
            title: t("plugin_management_page.uninstall_lx_plugin"),
            content: t("plugin_management_page.confirm_uninstall_lx_plugin", {
                plugin: plugin.name,
            }),
            async onConfirm() {
                hideModal();
                try {
                    await PluginManager.uninstallLxPlugin(plugin.hash);
                    toast.success(t("plugin_management_page.uninstall_successfully", {
                        plugin: plugin.name,
                    }));
                } catch {
                    toast.error(t("plugin_management_page.uninstall_failed"));
                }
            },
        });
    }

    async function update(plugin: LxPluginDescriptor) {
        if (!plugin.sourceUrl) {
            return;
        }
        try {
            await PluginManager.installLxPluginFromRemote(plugin.sourceUrl);
            toast.success(t("plugin_management_page.toast_plugin_is_latest", {
                plugin: plugin.name,
            }));
        } catch (error) {
            toast.error((error as Error)?.message ?? t("plugin_management_page.update_failed"));
        }
    }

    function openPluginActions(
        event: MouseEvent<HTMLButtonElement>,
        plugin: LxPluginDescriptor,
    ) {
        event.stopPropagation();
        const menuItems: IContextMenuItem[] = [];

        if (plugin.sourceUrl) {
            menuItems.push({
                icon: "arrow-path",
                title: t("plugin_management_page.update"),
                onClick: () => void update(plugin),
            });
        }
        if (menuItems.length) {
            menuItems.push({ divider: true });
        }
        menuItems.push({
            icon: "trash",
            title: t("plugin_management_page.uninstall"),
            onClick: () => uninstall(plugin),
        });

        const rect = event.currentTarget.getBoundingClientRect();
        showContextMenu({
            x: rect.right,
            y: rect.bottom,
            placement: "bottom-end",
            menuItems,
        });
    }

    return (
        <section
            className="lx-plugin-section plugin-manager-section"
            aria-labelledby="lx-plugin-section-title"
        >
            <div className="plugin-manager-section-header">
                <div>
                    <div className="plugin-manager-section-title-row">
                        <h2
                            id="lx-plugin-section-title"
                            className="plugin-manager-section-title"
                        >
                            {t("plugin_management_page.lx_sources")}
                        </h2>
                        <span className="plugin-manager-section-count">
                            {lxPlugins.length}
                        </span>
                    </div>
                    <p className="plugin-manager-section-description">
                        {t("plugin_management_page.lx_sources_description")}
                    </p>
                </div>
            </div>

            <div className="plugin-manager-list-surface">
                <Condition
                    condition={lxPlugins.length}
                    falsy={<Empty style={{ minHeight: "148px" }}></Empty>}
                >
                    <div className="lx-plugin-columns" aria-hidden="true">
                        <span>{t("plugin_management_page.playback_source")}</span>
                        <span>{t("plugin_management_page.supported_platforms")}</span>
                        <span>{t("plugin_management_page.status")}</span>
                        <span></span>
                    </div>
                    <div className="lx-plugin-list">
                        <article
                            className="lx-plugin-row lx-plugin-native-row"
                            data-active={String(!hasActiveLxPlugin)}
                        >
                            <label className="lx-plugin-selector">
                                <input
                                    type="radio"
                                    name="active-lx-plugin"
                                    checked={!hasActiveLxPlugin}
                                    onChange={() => void PluginManager
                                        .setActiveLxPlugin(null)}
                                />
                                <span className="lx-plugin-radio" aria-hidden="true">
                                    {!hasActiveLxPlugin
                                        ? (
                                            <SvgAsset
                                                iconName="check"
                                                size={13}
                                            ></SvgAsset>
                                        )
                                        : null}
                                </span>
                                <span className="lx-plugin-main">
                                    <span className="lx-plugin-name">
                                        {t("plugin_management_page.plugin_native_source")}
                                    </span>
                                    <span className="lx-plugin-meta">
                                        {t("plugin_management_page.disable_lx_source_desc")}
                                    </span>
                                </span>
                            </label>
                            <span className="lx-plugin-native-coverage">
                                {t("plugin_management_page.all_installed_plugins")}
                            </span>
                            <span
                                className="lx-plugin-state"
                                data-active={String(!hasActiveLxPlugin)}
                            >
                                {t(!hasActiveLxPlugin
                                    ? "plugin_management_page.active"
                                    : "plugin_management_page.inactive")}
                            </span>
                        </article>

                        {lxPlugins.map((plugin) => {
                            const sources = getSourceEntries(plugin);
                            const availableCount = sources.filter((source) =>
                                installedBaseSources.has(source),
                            ).length;
                            return (
                                <article
                                    key={plugin.hash}
                                    className="lx-plugin-row"
                                    data-active={String(plugin.active)}
                                    data-available={String(availableCount > 0)}
                                >
                                    <label className="lx-plugin-selector">
                                        <input
                                            type="radio"
                                            name="active-lx-plugin"
                                            checked={plugin.active}
                                            onChange={() => void PluginManager
                                                .setActiveLxPlugin(plugin.hash)}
                                        />
                                        <span
                                            className="lx-plugin-radio"
                                            aria-hidden="true"
                                        >
                                            {plugin.active
                                                ? (
                                                    <SvgAsset
                                                        iconName="check"
                                                        size={13}
                                                    ></SvgAsset>
                                                )
                                                : null}
                                        </span>
                                        <span className="lx-plugin-main">
                                            <span className="lx-plugin-title-line">
                                                <span
                                                    className="lx-plugin-name"
                                                    title={plugin.name}
                                                >
                                                    {plugin.name}
                                                </span>
                                                <span className="lx-plugin-meta">
                                                    {plugin.version || "-"}
                                                    <span aria-hidden="true"> · </span>
                                                    {plugin.author ||
                                                        t("media.unknown_artist")}
                                                </span>
                                            </span>
                                        </span>
                                    </label>
                                    <span
                                        className="lx-plugin-bindings"
                                        aria-label={t(
                                            "plugin_management_page.lx_supported_platforms",
                                        )}
                                    >
                                        {sources.map((source) => {
                                            const ready = installedBaseSources.has(source);
                                            return (
                                                <span
                                                    key={source}
                                                    className="lx-plugin-binding"
                                                    data-ready={String(ready)}
                                                    title={ready
                                                        ? t(
                                                            "plugin_management_page.lx_base_connected",
                                                        )
                                                        : t(
                                                            "plugin_management_page.lx_base_missing",
                                                        )}
                                                >
                                                    <SvgAsset
                                                        iconName={ready
                                                            ? "check-circle"
                                                            : "question-mark-circle"}
                                                        size={12}
                                                    ></SvgAsset>
                                                    <span>{getLxPlatformName(source)}</span>
                                                </span>
                                            );
                                        })}
                                    </span>
                                    <span
                                        className="lx-plugin-state"
                                        data-active={String(plugin.active)}
                                        data-ready={String(availableCount > 0)}
                                    >
                                        {plugin.active
                                            ? t("plugin_management_page.active")
                                            : availableCount > 0
                                                ? t("plugin_management_page.available")
                                                : t("plugin_management_page.lx_no_base")}
                                    </span>
                                    <button
                                        type="button"
                                        className="plugin-manager-row-menu-button"
                                        aria-label={t(
                                            "plugin_management_page.plugin_actions",
                                            { plugin: plugin.name },
                                        )}
                                        title={t(
                                            "plugin_management_page.plugin_actions",
                                            { plugin: plugin.name },
                                        )}
                                        aria-haspopup="menu"
                                        onClick={(event) =>
                                            openPluginActions(event, plugin)}
                                    >
                                        <SvgAsset
                                            iconName="ellipsis-horizontal"
                                            size={18}
                                        ></SvgAsset>
                                    </button>
                                </article>
                            );
                        })}
                    </div>
                </Condition>
            </div>
        </section>
    );
}
