import { hideModal, showModal } from "@/renderer/components/Modal";
import A from "@/renderer/components/A";
import PluginTable from "./components/plugin-table";
import SvgAsset, { type SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import "./index.scss";
import { getUserPreference } from "@/renderer/utils/user-perference";
import { toast } from "react-toastify";
import { Trans, useTranslation } from "react-i18next";
import { dialogUtil } from "@shared/utils/renderer";
import PluginManager, { useSortedPlugins } from "@shared/plugin-manager/renderer";
import { ReactNode } from "react";

interface IActionButtonProps {
    children: ReactNode;
    iconName: SvgAssetIconNames;
    onClick: () => void | Promise<void>;
    variant?: "normal" | "danger";
}

function ActionButton(props: IActionButtonProps) {
    const { children, iconName, onClick, variant = "normal" } = props;

    return (
        <button
            type="button"
            className="plugin-manager-action-button"
            data-variant={variant}
            onClick={onClick}
        >
            <SvgAsset iconName={iconName} size={18}></SvgAsset>
            <span>{children}</span>
        </button>
    );
}

export default function PluginManagerView() {
    const { t } = useTranslation();
    const plugins = useSortedPlugins();
    const subscriptionList = getUserPreference("subscription") ?? [];

    async function onInstallFromLocal() {
        try {
            const result = await dialogUtil.showOpenDialog({
                title: t("plugin_management_page.choose_plugin"),
                buttonLabel: t("plugin_management_page.install"),
                filters: [
                    {
                        extensions: ["js", "json"],
                        name: t("plugin_management_page.bakamusic_plugin"),
                    },
                ],
            });
            if (result.canceled) {
                return;
            }
            await PluginManager.installPluginFromLocal(result.filePaths[0]);
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
            title: t("plugin_management_page.install_plugin_from_network"),
            placeholder: t(
                "plugin_management_page.error_hint_plugin_should_end_with_js_or_json",
            ),
            okText: t("plugin_management_page.install"),
            loadingText: t("plugin_management_page.installing"),
            withLoading: true,
            async onOk(text) {
                if (text.trim().endsWith(".json") || text.trim().endsWith(".js")) {
                    return PluginManager.installPluginFromRemote(text);
                }
                throw new Error(
                    t(
                        "plugin_management_page.error_hint_plugin_should_end_with_js_or_json",
                    ),
                );
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
        if (!subscriptionList.length) {
            toast.warn(t("plugin_management_page.no_subscription"));
            return;
        }

        try {
            for (const subscription of subscriptionList) {
                await PluginManager.installPluginFromRemote(subscription.srcUrl);
            }
            toast.success(t("plugin_management_page.update_successfully"));
        } catch (error) {
            toast.error(
                (error as Error)?.message ??
                t("plugin_management_page.update_failed"),
            );
        }
    }

    return (
        <div
            id="page-container"
            className="page-container plugin-manager-view-container"
        >
            <section className="plugin-manager-header">
                <div className="plugin-manager-header-copy">
                    <div className="plugin-manager-title">
                        {t("plugin_management_page.plugin_management")}
                    </div>
                    <div className="plugin-manager-header-description">
                        <Trans
                            i18nKey={"plugin_management_page.info_hint_install_plugin"}
                            components={{
                                a: <A href="https://github.com/Zencok/BakaMusic"></A>,
                            }}
                        ></Trans>
                    </div>
                </div>
            </section>

            <section className="plugin-manager-toolbar">
                <ActionButton
                    iconName="folder-open"
                    onClick={onInstallFromLocal}
                >
                    {t("plugin_management_page.install_from_local_file")}
                </ActionButton>
                <ActionButton
                    iconName="code-bracket-square"
                    onClick={onInstallFromNetwork}
                >
                    {t("plugin_management_page.install_plugin_from_network")}
                </ActionButton>
                <ActionButton
                    iconName="playlist"
                    onClick={() => {
                        showModal("PluginSubscription");
                    }}
                >
                    {t("plugin_management_page.subscription_setting")}
                </ActionButton>
                <ActionButton
                    iconName="sparkles"
                    onClick={onUpdateSubscriptions}
                >
                    {t("plugin_management_page.update_subscription")}
                </ActionButton>
                <ActionButton
                    iconName="trash"
                    variant="danger"
                    onClick={onUninstallAllPlugins}
                >
                    {t("plugin_management_page.uninstall_all_plugins")}
                </ActionButton>
            </section>

            <PluginTable plugins={plugins}></PluginTable>
        </div>
    );
}
