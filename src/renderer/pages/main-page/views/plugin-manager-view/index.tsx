import { hideModal, showModal } from "@/renderer/components/Modal";
import A from "@/renderer/components/A";
import { showContextMenu } from "@/renderer/components/ContextMenu";
import PluginTable from "./components/plugin-table";
import SvgAsset from "@/renderer/components/SvgAsset";
import "./index.scss";
import {
    getUserPreference,
    useUserPreference,
} from "@/renderer/utils/user-perference";
import { toast } from "react-toastify";
import { Trans, useTranslation } from "react-i18next";
import { dialogUtil } from "@shared/utils/renderer";
import PluginManager, {
    usePluginRegistryState,
    useSortedPlugins,
} from "@shared/plugin-manager/renderer";
import { useState, type MouseEvent } from "react";
import ResolverBindings from "./components/resolver-bindings";
import useAppConfig from "@/hooks/useAppConfig";
import PluginLogConsole from "./components/plugin-log-console";
import { getSubscriptionUpdateOptions, pluginImportKinds } from "./import-format";

export default function PluginManagerView() {
    const { t } = useTranslation();
    const plugins = useSortedPlugins();
    const { resolverBindings } = usePluginRegistryState();
    const pluginMeta = useAppConfig("private.pluginMeta") ?? {};
    const [subscriptionList] = useUserPreference("subscription");
    const [logConsoleOpen, setLogConsoleOpen] = useState(false);
    const [importKind, setImportKind] = useState<IPlugin.ImportKind>("auto");
    const enabledPluginCount = plugins.filter(
        (plugin) => !(pluginMeta[plugin.platform]?.disabled ?? false),
    ).length;

    async function onInstallFromLocal() {
        try {
            const result = await dialogUtil.showOpenDialog({
                title: t("plugin_management_page.choose_plugin"),
                buttonLabel: t("plugin_management_page.install"),
                filters: [
                    {
                        extensions: ["js", "json"],
                        name: t("plugin_management_page.plugin_files"),
                    },
                ],
            });
            if (result.canceled) {
                return;
            }
            await PluginManager.installPluginFromLocal(result.filePaths[0], { kind: importKind });
            toast.success(t("plugin_management_page.install_successfully"));
        } catch (error) {
            toast.warn(
                `${t("plugin_management_page.install_failed")}: ${
                    (error as Error)?.message ??
                    t("plugin_management_page.invalid_plugin")
                }`,
            );
        }
    }

    function onInstallFromNetwork() {
        showModal("SimpleInputWithState", {
            title: t("plugin_management_page.install_plugin_from_network") +
                ` · ${t(`plugin_management_page.import_format_${importKind}`)}`,
            placeholder: t(
                "plugin_management_page.plugin_url_hint",
            ),
            okText: t("plugin_management_page.install"),
            loadingText: t("plugin_management_page.installing"),
            withLoading: true,
            hints: [t(`plugin_management_page.import_${importKind}_hint`)],
            async onOk(text) {
                const url = new URL(text.trim());
                if (url.protocol !== "https:") {
                    throw new Error(t("plugin_management_page.plugin_url_hint"));
                }
                return PluginManager.installPluginFromRemote(text.trim(), { kind: importKind });
            },
            onPromiseResolved() {
                toast.success(t("plugin_management_page.install_successfully"));
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

    function onUninstallAllPlugins() {
        showModal("Reconfirm", {
            title: t("plugin_management_page.uninstall_all_plugins"),
            content: t("plugin_management_page.confirm_text_uninstall_all_plugins"),
            async onConfirm() {
                hideModal();
                try {
                    await PluginManager.uninstallAllPlugins();
                    toast.success(
                        t("plugin_management_page.uninstall_all_successfully"),
                    );
                } catch {
                    toast.error(t("plugin_management_page.uninstall_all_failed"));
                }
            },
        });
    }

    async function onUpdateSubscriptions() {
        const currentSubscriptions = (
            getUserPreference("subscription") ??
            subscriptionList ??
            []
        )
            .map((subscription) => ({
                ...subscription,
                srcUrl: (subscription.srcUrl ?? "").trim(),
            }))
            .filter((subscription) => subscription.srcUrl);

        if (!currentSubscriptions.length) {
            toast.warn(t("plugin_management_page.no_subscription"));
            return;
        }

        showModal("Loading", {
            title: t("plugin_management_page.update_subscription"),
            text: t("plugin_management_page.installing"),
        });

        const failedErrors: Error[] = [];
        for (const subscription of currentSubscriptions) {
            try {
                await PluginManager.installPluginFromRemote(
                    subscription.srcUrl,
                    getSubscriptionUpdateOptions(plugins, subscription.srcUrl),
                );
            } catch (error) {
                failedErrors.push(error as Error);
            }
        }

        hideModal();

        if (!failedErrors.length) {
            toast.success(t("plugin_management_page.update_successfully"));
            return;
        }

        toast.error(
            `${t("plugin_management_page.update_failed")} ` +
            `(${failedErrors.length}/${currentSubscriptions.length}): ${
                failedErrors[0]?.message ??
                t("plugin_management_page.invalid_plugin")
            }`,
        );
    }

    function openInstallMenu(event: MouseEvent<HTMLButtonElement>) {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        showContextMenu({
            x: rect.right,
            y: rect.bottom,
            placement: "bottom-end",
            menuItems: [
                {
                    icon: "folder-open",
                    title: t("plugin_management_page.install_from_local_file"),
                    onClick: () => void onInstallFromLocal(),
                },
                {
                    icon: "code-bracket-square",
                    title: t("plugin_management_page.install_plugin_from_network"),
                    onClick: onInstallFromNetwork,
                },
            ],
        });
    }

    function openManageMenu(event: MouseEvent<HTMLButtonElement>) {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        showContextMenu({
            x: rect.right,
            y: rect.bottom,
            placement: "bottom-end",
            menuItems: [
                {
                    icon: "playlist",
                    title: t("plugin_management_page.subscription_setting"),
                    onClick: () => showModal("PluginSubscription"),
                },
                {
                    icon: "arrow-path",
                    title: t("plugin_management_page.update_subscription"),
                    onClick: () => void onUpdateSubscriptions(),
                },
                { divider: true },
                {
                    icon: "trash",
                    title: t("plugin_management_page.uninstall_all_plugins"),
                    onClick: onUninstallAllPlugins,
                },
            ],
        });
    }

    return (
        <div
            id="page-container"
            className="page-container plugin-manager-view-container"
        >
            <div className="plugin-manager-content">
                <header className="plugin-manager-header discovery-page-header">
                    <div className="discovery-page-heading">
                        <span className="discovery-page-eyebrow">
                            {t("plugin_management_page.eyebrow")}
                        </span>
                        <h1>
                            {t("plugin_management_page.plugin_management")}
                        </h1>
                        <p>
                            <Trans
                                i18nKey={"plugin_management_page.info_hint_install_plugin"}
                                components={{
                                    a: <A href="https://github.com/Zencok/BakaMusic"></A>,
                                }}
                            ></Trans>
                        </p>
                    </div>
                    <div className="plugin-manager-install-controls">
                        <label className="plugin-manager-import-format">
                            <span>{t("plugin_management_page.import_format")}</span>
                            <select
                                value={importKind}
                                onChange={(event) => setImportKind(event.currentTarget.value as IPlugin.ImportKind)}
                            >
                                {pluginImportKinds.map((kind) => <option key={kind} value={kind}>
                                    {t(`plugin_management_page.import_format_${kind}`)}
                                </option>)}
                            </select>
                        </label>
                        <p className="plugin-manager-import-hint">
                            {t(`plugin_management_page.import_${importKind}_hint`)}
                        </p>
                        <div className="plugin-manager-header-actions">
                            <button
                                type="button"
                                className="plugin-manager-log-button"
                                onClick={() => setLogConsoleOpen(true)}
                            >
                                <SvgAsset iconName="code-bracket-square" size={17}></SvgAsset>
                                <span>{t("plugin_management_page.plugin_logs")}</span>
                            </button>
                            <button
                                type="button"
                                className="plugin-manager-install-button"
                                aria-haspopup="menu"
                                onClick={openInstallMenu}
                            >
                                <SvgAsset iconName="plus" size={17}></SvgAsset>
                                <span>{t("plugin_management_page.install_plugin")}</span>
                                <SvgAsset iconName="chevron-down" size={14}></SvgAsset>
                            </button>
                            <button
                                type="button"
                                className="plugin-manager-more-button"
                                aria-label={t("plugin_management_page.more_actions")}
                                title={t("plugin_management_page.more_actions")}
                                aria-haspopup="menu"
                                onClick={openManageMenu}
                            >
                                <SvgAsset iconName="ellipsis-horizontal" size={19}></SvgAsset>
                            </button>
                        </div>
                    </div>
                </header>

                <dl
                    className="plugin-manager-overview"
                    aria-label={t("plugin_management_page.overview")}
                >
                    <div className="plugin-manager-metric">
                        <dt>{t("plugin_management_page.installed_plugins")}</dt>
                        <dd>{plugins.length}</dd>
                    </div>
                    <div className="plugin-manager-metric">
                        <dt>{t("plugin_management_page.enabled_plugins")}</dt>
                        <dd>{enabledPluginCount}</dd>
                    </div>
                    <div className="plugin-manager-metric">
                        <dt>{t("plugin_management_page.subscription_setting")}</dt>
                        <dd>{subscriptionList?.length ?? 0}</dd>
                    </div>
                    <div className="plugin-manager-metric plugin-manager-metric-source">
                        <dt>{t("plugin_management_page.playback_bindings")}</dt>
                        <dd>
                            {resolverBindings.length}
                        </dd>
                    </div>
                </dl>

                <ResolverBindings plugins={plugins}></ResolverBindings>

                <PluginTable plugins={plugins}></PluginTable>
            </div>
            <PluginLogConsole
                open={logConsoleOpen}
                onClose={() => setLogConsoleOpen(false)}
            ></PluginLogConsole>
        </div>
    );
}
