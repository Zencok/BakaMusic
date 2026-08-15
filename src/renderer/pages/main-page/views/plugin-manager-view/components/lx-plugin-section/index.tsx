import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import Condition from "@/renderer/components/Condition";
import Empty from "@/renderer/components/Empty";
import { hideModal, showModal } from "@/renderer/components/Modal";
import SvgAsset, { type SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import PluginManager, { useLxPlugins } from "@shared/plugin-manager/renderer";
import {
    getLxPlatformName,
    getLxSourceForPlatform,
    type LxPluginDescriptor,
    type LxSource,
} from "@shared/plugin-manager/lx-types";
import { dialogUtil } from "@shared/utils/renderer";
import "./index.scss";

interface LxPluginSectionProps {
    basePlugins: IPlugin.IPluginDelegate[];
}

interface LxActionButtonProps {
    children: ReactNode;
    iconName: SvgAssetIconNames;
    onClick: () => void | Promise<void>;
    variant?: "normal" | "danger";
}

function LxActionButton({
    children,
    iconName,
    onClick,
    variant = "normal",
}: LxActionButtonProps) {
    return (
        <button
            type="button"
            className="lx-plugin-action-button"
            data-variant={variant}
            onClick={onClick}
        >
            <SvgAsset iconName={iconName} size={14}></SvgAsset>
            <span>{children}</span>
        </button>
    );
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

    async function installFromLocal() {
        try {
            const result = await dialogUtil.showOpenDialog({
                title: t("plugin_management_page.choose_lx_plugin"),
                buttonLabel: t("plugin_management_page.install"),
                filters: [{
                    extensions: ["js"],
                    name: t("plugin_management_page.lx_plugin"),
                }],
            });
            if (result.canceled) {
                return;
            }
            await PluginManager.installLxPluginFromLocal(result.filePaths[0]);
            toast.success(t("plugin_management_page.lx_install_successfully"));
        } catch (error) {
            toast.warn(
                `${t("plugin_management_page.install_failed")}: ${
                    (error as Error)?.message ?? t("plugin_management_page.invalid_plugin")
                }`,
            );
        }
    }

    function installFromNetwork() {
        showModal("SimpleInputWithState", {
            title: t("plugin_management_page.install_lx_plugin_from_network"),
            placeholder: t("plugin_management_page.lx_url_hint"),
            okText: t("plugin_management_page.install"),
            loadingText: t("plugin_management_page.installing"),
            withLoading: true,
            async onOk(text) {
                const url = new URL(text.trim());
                if (url.protocol !== "https:") {
                    throw new Error(t("plugin_management_page.lx_url_hint"));
                }
                return PluginManager.installLxPluginFromRemote(text.trim());
            },
            onPromiseResolved() {
                toast.success(t("plugin_management_page.lx_install_successfully"));
                hideModal();
            },
            onPromiseRejected(error) {
                toast.warn(
                    `${t("plugin_management_page.install_failed")}: ${
                        error?.message ?? t("plugin_management_page.invalid_plugin")
                    }`,
                );
            },
        });
    }

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

    return (
        <section className="lx-plugin-section" aria-labelledby="lx-plugin-section-title">
            <div className="lx-plugin-section-header">
                <div className="lx-plugin-section-heading">
                    <span id="lx-plugin-section-title" className="lx-plugin-section-title">
                        {t("plugin_management_page.lx_sources")}
                    </span>
                    <span className="lx-plugin-section-count">{lxPlugins.length}</span>
                </div>
                <div className="lx-plugin-section-actions">
                    <LxActionButton iconName="folder-open" onClick={installFromLocal}>
                        {t("plugin_management_page.install_lx_from_local")}
                    </LxActionButton>
                    <LxActionButton iconName="code-bracket-square" onClick={installFromNetwork}>
                        {t("plugin_management_page.install_lx_from_network")}
                    </LxActionButton>
                </div>
            </div>

            <Condition
                condition={lxPlugins.length}
                falsy={<Empty style={{ minHeight: "112px" }}></Empty>}
            >
                <div className="lx-plugin-controls">
                    <label
                        className="lx-plugin-disable-selector"
                        data-active={String(!hasActiveLxPlugin)}
                    >
                        <input
                            type="radio"
                            name="active-lx-plugin"
                            checked={!hasActiveLxPlugin}
                            onChange={() => void PluginManager.setActiveLxPlugin(null)}
                        />
                        <span className="lx-plugin-radio" aria-hidden="true">
                            {!hasActiveLxPlugin
                                ? <span className="lx-plugin-radio-dot"></span>
                                : null}
                        </span>
                        <span className="lx-plugin-disable-copy">
                            <span className="lx-plugin-disable-title">
                                {t("plugin_management_page.disable_lx_source")}
                            </span>
                            <span className="lx-plugin-disable-description">
                                {t("plugin_management_page.disable_lx_source_desc")}
                            </span>
                        </span>
                    </label>

                    <div className="lx-plugin-list">
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
                                            onChange={() => void PluginManager.setActiveLxPlugin(plugin.hash)}
                                        />
                                        <span className="lx-plugin-radio" aria-hidden="true">
                                            {plugin.active
                                                ? <span className="lx-plugin-radio-dot"></span>
                                                : null}
                                        </span>
                                        <span>{t("plugin_management_page.use_lx_source")}</span>
                                    </label>

                                    <div className="lx-plugin-main">
                                        <div className="lx-plugin-title-line">
                                            <span className="lx-plugin-name" title={plugin.name}>{plugin.name}</span>
                                            <span className="lx-plugin-version">
                                                {plugin.version || "-"}
                                            </span>
                                            <span
                                                className="lx-plugin-availability"
                                                data-ready={String(availableCount > 0)}
                                            >
                                                {availableCount > 0
                                                    ? t("plugin_management_page.lx_base_ready", {
                                                        count: availableCount,
                                                    })
                                                    : t("plugin_management_page.lx_no_base")}
                                            </span>
                                        </div>
                                        <div className="lx-plugin-author">
                                            {plugin.author || t("media.unknown_artist")}
                                        </div>
                                        <div
                                            className="lx-plugin-bindings"
                                            aria-label={t("plugin_management_page.lx_supported_platforms")}
                                        >
                                            {sources.map((source) => {
                                                const ready = installedBaseSources.has(source);
                                                return (
                                                    <span
                                                        key={source}
                                                        className="lx-plugin-binding"
                                                        data-ready={String(ready)}
                                                        title={ready
                                                            ? t("plugin_management_page.lx_base_connected")
                                                            : t("plugin_management_page.lx_base_missing")}
                                                    >
                                                        <span>{getLxPlatformName(source)}</span>
                                                        <SvgAsset
                                                            iconName={ready ? "check-circle" : "question-mark-circle"}
                                                            size={13}
                                                        ></SvgAsset>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="lx-plugin-row-actions">
                                        <Condition condition={!!plugin.sourceUrl}>
                                            <LxActionButton iconName="sparkles" onClick={() => update(plugin)}>
                                                {t("plugin_management_page.update")}
                                            </LxActionButton>
                                        </Condition>
                                        <LxActionButton
                                            iconName="trash"
                                            variant="danger"
                                            onClick={() => uninstall(plugin)}
                                        >
                                            {t("plugin_management_page.uninstall")}
                                        </LxActionButton>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </div>
            </Condition>
        </section>
    );
}
