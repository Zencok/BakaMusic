import AppConfig from "@shared/app-config/renderer";
import "./index.scss";
import { ReactNode } from "react";
import Condition from "@/renderer/components/Condition";
import { hideModal, showModal } from "@/renderer/components/Modal";
import Empty from "@/renderer/components/Empty";
import { toast } from "react-toastify";
import { showPanel } from "@/renderer/components/Panel";
import DragReceiver, { startDrag } from "@/renderer/components/DragReceiver";
import { produce } from "immer";
import { i18n } from "@/shared/i18n/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import SvgAsset, { type SvgAssetIconNames } from "@/renderer/components/SvgAsset";

const t = i18n.t;
const DRAG_TAG = "plugin-manager";

interface IPluginTableProps {
    plugins: IPlugin.IPluginDelegate[];
}

interface IActionButtonProps {
    children: ReactNode;
    iconName: SvgAssetIconNames;
    onClick?: () => void;
    variant?: "danger" | "success" | "info" | "normal";
}

function ActionButton(props: IActionButtonProps) {
    const { children, iconName, onClick, variant = "normal" } = props;

    return (
        <button
            type="button"
            className="plugin-card-action-button"
            data-variant={variant}
            onClick={onClick}
        >
            <SvgAsset iconName={iconName} size={14}></SvgAsset>
            <span>{children}</span>
        </button>
    );
}

function renderActions(row: IPlugin.IPluginDelegate) {
    return (
        <div className="plugin-card-actions">
            <ActionButton
                iconName="trash"
                variant="danger"
                onClick={() => {
                    showModal("Reconfirm", {
                        title: t("plugin_management_page.uninstall_plugin"),
                        content: t(
                            "plugin_management_page.confirm_text_uninstall_plugin",
                            {
                                plugin: row.platform,
                            },
                        ),
                        async onConfirm() {
                            hideModal();
                            try {
                                await PluginManager.uninstallPlugin(row.hash);
                                toast.success(
                                    t(
                                        "plugin_management_page.uninstall_successfully",
                                        {
                                            plugin: row.platform,
                                        },
                                    ),
                                );
                            } catch {
                                toast.error(
                                    t("plugin_management_page.uninstall_failed"),
                                );
                            }
                        },
                    });
                }}
            >
                {t("plugin_management_page.uninstall")}
            </ActionButton>

            <Condition condition={!!row.srcUrl}>
                <ActionButton
                    iconName="sparkles"
                    variant="success"
                    onClick={async () => {
                        if (!row.srcUrl) {
                            return;
                        }

                        try {
                            await PluginManager.installPluginFromRemote(row.srcUrl);
                            toast.success(
                                t("plugin_management_page.toast_plugin_is_latest", {
                                    plugin: row.platform,
                                }),
                            );
                        } catch (error) {
                            toast.error(
                                (error as Error)?.message ??
                                t("plugin_management_page.update_failed"),
                            );
                        }
                    }}
                >
                    {t("plugin_management_page.update")}
                </ActionButton>
            </Condition>

            <Condition condition={row.supportedMethod.includes("importMusicItem")}>
                <ActionButton
                    iconName="musical-note"
                    variant="info"
                    onClick={() => {
                        showModal("SimpleInputWithState", {
                            title: t("plugin.method_import_music_item"),
                            withLoading: true,
                            loadingText: t("plugin_management_page.importing_media"),
                            placeholder: t(
                                "plugin_management_page.placeholder_import_music_item",
                                {
                                    plugin: row.platform,
                                },
                            ),
                            maxLength: 1000,
                            onOk(text) {
                                return PluginManager.callPluginDelegateMethod(
                                    row,
                                    "importMusicItem",
                                    text.trim(),
                                );
                            },
                            onPromiseResolved(result) {
                                hideModal();
                                showModal("AddMusicToSheet", {
                                    musicItems: [result as IMusic.IMusicItem],
                                });
                            },
                            onPromiseRejected() {
                                toast.error(
                                    t("plugin_management_page.import_failed"),
                                );
                            },
                            hints: row.hints?.importMusicItem,
                        });
                    }}
                >
                    {t("plugin.method_import_music_item")}
                </ActionButton>
            </Condition>

            <Condition condition={row.supportedMethod.includes("importMusicSheet")}>
                <ActionButton
                    iconName="playlist"
                    variant="info"
                    onClick={() => {
                        showModal("SimpleInputWithState", {
                            title: t("plugin.method_import_music_sheet"),
                            withLoading: true,
                            loadingText: t("plugin_management_page.importing_media"),
                            placeholder: t(
                                "plugin_management_page.placeholder_import_music_sheet",
                                {
                                    plugin: row.platform,
                                },
                            ),
                            maxLength: 1000,
                            onOk(text) {
                                return PluginManager.callPluginDelegateMethod(
                                    row,
                                    "importMusicSheet",
                                    text.trim(),
                                );
                            },
                            onPromiseResolved(result) {
                                hideModal();
                                showModal("AddMusicToSheet", {
                                    musicItems: result as IMusic.IMusicItem[],
                                });
                            },
                            onPromiseRejected() {
                                toast.error(
                                    t("plugin_management_page.import_failed"),
                                );
                            },
                            hints: row.hints?.importMusicSheet,
                        });
                    }}
                >
                    {t("plugin.method_import_music_sheet")}
                </ActionButton>
            </Condition>

            <Condition condition={!!row.userVariables?.length}>
                <ActionButton
                    iconName="cog-8-tooth"
                    variant="info"
                    onClick={() => {
                        showPanel("UserVariables", {
                            variables: row.userVariables,
                            plugin: row,
                            initValues:
                                AppConfig.getConfig("private.pluginMeta")?.[
                                    row.platform
                                ]?.userVariables,
                        });
                    }}
                >
                    {t("plugin.prop_user_variable")}
                </ActionButton>
            </Condition>
        </div>
    );
}

export default function PluginTable(props: IPluginTableProps) {
    const { plugins } = props;

    function onDrop(fromIndex: number, toIndex: number) {
        const meta = AppConfig.getConfig("private.pluginMeta") ?? {};

        const newPlugins = plugins
            .slice(0, fromIndex)
            .concat(plugins.slice(fromIndex + 1));
        newPlugins.splice(
            fromIndex < toIndex ? toIndex - 1 : toIndex,
            0,
            plugins[fromIndex],
        );

        const newMeta = produce(meta, (draft) => {
            newPlugins.forEach((plugin, index) => {
                if (!draft[plugin.platform]) {
                    draft[plugin.platform] = {};
                }
                draft[plugin.platform].order = index;
            });
        });

        AppConfig.setConfig({
            "private.pluginMeta": newMeta,
        });
    }

    return (
        <div className="plugin-table--container">
            <div className="plugin-table--toolbar">
                <div className="plugin-table--toolbar-summary">
                    <span className="plugin-table--toolbar-title">
                        {t("plugin_management_page.installed_plugins")}
                    </span>
                    <span className="plugin-table--toolbar-count">
                        {plugins.length}
                    </span>
                </div>
                <div className="plugin-table--toolbar-hint">
                    <SvgAsset iconName="list-bullet" size={14}></SvgAsset>
                    <span>{t("plugin_management_page.drag_sort_hint")}</span>
                </div>
            </div>

            <Condition
                condition={plugins.length}
                falsy={<Empty style={{ minHeight: "220px" }}></Empty>}
            >
                <div className="plugin-card-list">
                    {plugins.map((plugin, index) => {
                        return (
                            <div className="plugin-card-row" key={plugin.hash}>
                                <article
                                    className="plugin-card"
                                    draggable
                                    onDragStart={(event) => {
                                        startDrag(event, index, DRAG_TAG);
                                    }}
                                >
                                    <div className="plugin-card-head">
                                        <div className="plugin-card-order">
                                            <SvgAsset
                                                iconName="list-bullet"
                                                size={14}
                                            ></SvgAsset>
                                            <span>
                                                {String(index + 1).padStart(2, "0")}
                                            </span>
                                        </div>

                                        <div className="plugin-card-main">
                                            <div
                                                className="plugin-card-title"
                                                title={plugin.platform}
                                            >
                                                {plugin.platform}
                                            </div>
                                            <div className="plugin-card-author">
                                                {plugin.author ??
                                                    t("media.unknown_artist")}
                                            </div>
                                        </div>

                                        {renderActions(plugin)}
                                    </div>
                                </article>

                                {index === 0 ? (
                                    <DragReceiver
                                        position="top"
                                        rowIndex={0}
                                        tag={DRAG_TAG}
                                        onDrop={onDrop}
                                    ></DragReceiver>
                                ) : null}
                                <DragReceiver
                                    position="bottom"
                                    rowIndex={index + 1}
                                    tag={DRAG_TAG}
                                    onDrop={onDrop}
                                ></DragReceiver>
                            </div>
                        );
                    })}
                </div>
            </Condition>
        </div>
    );
}
