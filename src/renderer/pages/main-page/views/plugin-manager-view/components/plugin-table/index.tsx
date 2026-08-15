import AppConfig from "@shared/app-config/renderer";
import "./index.scss";
import {
    type MouseEvent,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import Condition from "@/renderer/components/Condition";
import {
    showContextMenu,
    type IContextMenuItem,
} from "@/renderer/components/ContextMenu";
import { hideModal, showModal } from "@/renderer/components/Modal";
import Empty from "@/renderer/components/Empty";
import { toast } from "react-toastify";
import { showPanel } from "@/renderer/components/Panel";
import { produce } from "immer";
import { i18n } from "@/shared/i18n/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import SvgAsset from "@/renderer/components/SvgAsset";
import useAppConfig from "@/hooks/useAppConfig";

const t = i18n.t;

interface IPluginTableProps {
    plugins: IPlugin.IPluginDelegate[];
}

const DRAG_AUTO_SCROLL_EDGE_DISTANCE = 86;
const DRAG_AUTO_SCROLL_MAX_SPEED = 18;
const PLUGIN_CARD_ANIMATION_DURATION = 180;

interface IPluginToggleProps {
    plugin: IPlugin.IPluginDelegate;
    meta: Record<string, IPlugin.IPluginMeta>;
}

function PluginToggle({ plugin, meta }: IPluginToggleProps) {
    const disabled = meta[plugin.platform]?.disabled ?? false;

    function toggle(e: React.MouseEvent) {
        e.stopPropagation();
        AppConfig.setConfig({
            "private.pluginMeta": produce(meta, (draft) => {
                const pluginMeta = draft[plugin.platform] ?? {};
                pluginMeta.disabled = !disabled;
                draft[plugin.platform] = pluginMeta;
            }),
        });
    }
    return (
        <button
            type="button"
            className="plugin-card-toggle"
            data-enabled={String(!disabled)}
            role="switch"
            aria-checked={!disabled}
            aria-label={t(disabled
                ? "plugin_management_page.enable_plugin"
                : "plugin_management_page.disable_plugin", {
                plugin: plugin.platform,
            })}
            title={t(disabled
                ? "plugin_management_page.enable_plugin"
                : "plugin_management_page.disable_plugin", {
                plugin: plugin.platform,
            })}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={toggle}
        >
            <span className="plugin-card-toggle-thumb" />
        </button>
    );
}

function openPluginActions(
    event: MouseEvent<HTMLButtonElement>,
    row: IPlugin.IPluginDelegate,
) {
    event.stopPropagation();
    const menuItems: IContextMenuItem[] = [];

    if (row.srcUrl) {
        menuItems.push({
            title: t("plugin_management_page.update"),
            icon: "arrow-path",
            async onClick() {
                if (!row.srcUrl) return;
                try {
                    await PluginManager.installPluginFromRemote(row.srcUrl);
                    toast.success(t("plugin_management_page.toast_plugin_is_latest", {
                        plugin: row.platform,
                    }));
                } catch (error) {
                    toast.error(
                        (error as Error)?.message ??
                        t("plugin_management_page.update_failed"),
                    );
                }
            },
        });
    }

    if (row.supportedMethod.includes("importMusicItem")) {
        menuItems.push({
            title: t("plugin.method_import_music_item"),
            icon: "musical-note",
            onClick() {
                showModal("SimpleInputWithState", {
                    title: t("plugin.method_import_music_item"),
                    withLoading: true,
                    loadingText: t("plugin_management_page.importing_media"),
                    placeholder: String(t(
                        "plugin_management_page.placeholder_import_music_item",
                        { plugin: row.platform },
                    )),
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
                        toast.error(t("plugin_management_page.import_failed"));
                    },
                    hints: row.hints?.importMusicItem,
                });
            },
        });
    }

    if (row.supportedMethod.includes("importMusicSheet")) {
        menuItems.push({
            title: t("plugin.method_import_music_sheet"),
            icon: "playlist",
            onClick() {
                showModal("ImportMusicSheet", {
                    plugins: [row],
                });
            },
        });
    }

    if (row.userVariables?.length) {
        menuItems.push({
            title: t("plugin.prop_user_variable"),
            icon: "cog-8-tooth",
            onClick() {
                showPanel("UserVariables", {
                    variables: row.userVariables,
                    plugin: row,
                    initValues: AppConfig.getConfig("private.pluginMeta")
                        ?.[row.platform]?.userVariables,
                });
            },
        });
    }

    if (menuItems.length) {
        menuItems.push({ divider: true });
    }
    menuItems.push({
        title: t("plugin_management_page.uninstall"),
        icon: "trash",
        onClick() {
            showModal("Reconfirm", {
                title: t("plugin_management_page.uninstall_plugin"),
                content: t("plugin_management_page.confirm_text_uninstall_plugin", {
                    plugin: row.platform,
                }),
                async onConfirm() {
                    hideModal();
                    try {
                        await PluginManager.uninstallPlugin(row.hash);
                        toast.success(t("plugin_management_page.uninstall_successfully", {
                            plugin: row.platform,
                        }));
                    } catch {
                        toast.error(t("plugin_management_page.uninstall_failed"));
                    }
                },
            });
        },
    });

    const rect = event.currentTarget.getBoundingClientRect();
    showContextMenu({
        x: rect.right,
        y: rect.bottom,
        placement: "bottom-end",
        menuItems,
    });
}

export default function PluginTable({ plugins }: IPluginTableProps) {
    const meta = useAppConfig("private.pluginMeta") ?? {};
    const [localPlugins, setLocalPlugins] = useState(plugins);
    const [draggingHash, setDraggingHash] = useState<string | null>(null);
    const dragIndexRef = useRef<number | null>(null);
    const currentOrderRef = useRef(plugins);
    const ghostRef = useRef<HTMLDivElement | null>(null);
    const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
    const pendingAnimationRectsRef = useRef<Map<string, DOMRect> | null>(null);
    const autoScrollFrameRef = useRef<number | null>(null);
    const autoScrollSpeedRef = useRef(0);
    const lastDragClientYRef = useRef(0);
    const scrollContainerRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (draggingHash === null) {
            setLocalPlugins(plugins);
            currentOrderRef.current = plugins;
        }
    }, [plugins, draggingHash]);

    useLayoutEffect(() => {
        const previousRects = pendingAnimationRectsRef.current;
        if (!previousRects) {
            return;
        }

        pendingAnimationRectsRef.current = null;

        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
        }

        cardRefs.current.forEach((node, hash) => {
            const previousRect = previousRects.get(hash);
            if (!previousRect) {
                return;
            }

            const currentRect = node.getBoundingClientRect();
            const translateY = previousRect.top - currentRect.top;
            if (Math.abs(translateY) < 1) {
                return;
            }

            node.getAnimations().forEach((animation) => animation.cancel());
            node.animate(
                [
                    { transform: `translateY(${translateY}px)` },
                    { transform: "translateY(0)" },
                ],
                {
                    duration: PLUGIN_CARD_ANIMATION_DURATION,
                    easing: "cubic-bezier(0.2, 0, 0, 1)",
                },
            );
        });
    }, [localPlugins]);

    useEffect(() => {
        return () => {
            stopAutoScroll();
            if (ghostRef.current?.isConnected) {
                ghostRef.current.remove();
            }
        };
    }, []);

    function setCardRef(hash: string, node: HTMLElement | null) {
        if (node) {
            cardRefs.current.set(hash, node);
            return;
        }
        cardRefs.current.delete(hash);
    }

    function captureCardRects() {
        const rects = new Map<string, DOMRect>();
        cardRefs.current.forEach((node, hash) => {
            rects.set(hash, node.getBoundingClientRect());
        });
        pendingAnimationRectsRef.current = rects;
    }

    function getScrollContainer() {
        if (scrollContainerRef.current?.isConnected) {
            return scrollContainerRef.current;
        }

        scrollContainerRef.current = document.getElementById("page-container");
        return scrollContainerRef.current;
    }

    function stopAutoScroll() {
        autoScrollSpeedRef.current = 0;
        if (autoScrollFrameRef.current !== null) {
            window.cancelAnimationFrame(autoScrollFrameRef.current);
            autoScrollFrameRef.current = null;
        }
    }

    function updateAutoScroll(clientY: number) {
        const scrollContainer = getScrollContainer();
        if (!scrollContainer) {
            stopAutoScroll();
            return;
        }

        const scrollRect = scrollContainer.getBoundingClientRect();
        let nextSpeed = 0;
        if (clientY < scrollRect.top + DRAG_AUTO_SCROLL_EDGE_DISTANCE) {
            const distance = scrollRect.top + DRAG_AUTO_SCROLL_EDGE_DISTANCE - clientY;
            nextSpeed = -Math.ceil(
                DRAG_AUTO_SCROLL_MAX_SPEED *
                Math.min(distance / DRAG_AUTO_SCROLL_EDGE_DISTANCE, 1),
            );
        } else if (clientY > scrollRect.bottom - DRAG_AUTO_SCROLL_EDGE_DISTANCE) {
            const distance = clientY - (scrollRect.bottom - DRAG_AUTO_SCROLL_EDGE_DISTANCE);
            nextSpeed = Math.ceil(
                DRAG_AUTO_SCROLL_MAX_SPEED *
                Math.min(distance / DRAG_AUTO_SCROLL_EDGE_DISTANCE, 1),
            );
        }

        const atTop = scrollContainer.scrollTop <= 0;
        const atBottom =
            scrollContainer.scrollTop + scrollContainer.clientHeight >=
            scrollContainer.scrollHeight - 1;
        if ((nextSpeed < 0 && atTop) || (nextSpeed > 0 && atBottom)) {
            nextSpeed = 0;
        }

        autoScrollSpeedRef.current = nextSpeed;
        if (!nextSpeed) {
            stopAutoScroll();
            return;
        }

        if (autoScrollFrameRef.current === null) {
            autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
        }
    }

    function runAutoScroll() {
        const scrollContainer = getScrollContainer();
        const scrollSpeed = autoScrollSpeedRef.current;
        if (!scrollContainer || !scrollSpeed) {
            autoScrollFrameRef.current = null;
            return;
        }

        const previousScrollTop = scrollContainer.scrollTop;
        scrollContainer.scrollTop += scrollSpeed;
        if (scrollContainer.scrollTop === previousScrollTop) {
            stopAutoScroll();
            return;
        }

        moveDraggingPluginByPoint(lastDragClientYRef.current);
        autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
    }

    function getInsertionIndex(clientY: number) {
        const ordered = currentOrderRef.current;
        for (let index = 0; index < ordered.length; index += 1) {
            const node = cardRefs.current.get(ordered[index].hash);
            if (!node) {
                continue;
            }

            const rect = node.getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) {
                return index;
            }
        }
        return ordered.length;
    }

    function moveDraggingPluginByPoint(clientY: number) {
        const fromIndex = dragIndexRef.current;
        const ordered = currentOrderRef.current;
        if (fromIndex === null || !ordered.length) {
            return;
        }

        const insertionIndex = getInsertionIndex(clientY);
        const targetIndex = fromIndex < insertionIndex
            ? insertionIndex - 1
            : insertionIndex;
        const boundedTargetIndex = Math.max(
            0,
            Math.min(ordered.length - 1, targetIndex),
        );

        if (boundedTargetIndex === fromIndex) {
            return;
        }

        captureCardRects();

        const next = [...ordered];
        const [draggingPlugin] = next.splice(fromIndex, 1);
        next.splice(boundedTargetIndex, 0, draggingPlugin);

        dragIndexRef.current = boundedTargetIndex;
        currentOrderRef.current = next;
        setLocalPlugins(next);
    }

    function persistPluginOrder(ordered: IPlugin.IPluginDelegate[]) {
        const currentMeta = AppConfig.getConfig("private.pluginMeta") ?? {};
        const nextMeta = produce(currentMeta, (draft) => {
            ordered.forEach((plugin, index) => {
                const pluginMeta = draft[plugin.platform] ?? {};
                pluginMeta.order = index;
                draft[plugin.platform] = pluginMeta;
            });
        });

        if (nextMeta !== currentMeta) {
            AppConfig.setConfig({
                "private.pluginMeta": nextMeta,
            });
        }
    }

    function movePluginByKeyboard(
        event: React.KeyboardEvent<HTMLButtonElement>,
        index: number,
    ) {
        const direction = event.key === "ArrowUp"
            ? -1
            : event.key === "ArrowDown"
                ? 1
                : 0;
        if (!direction) {
            return;
        }

        event.preventDefault();
        const targetIndex = Math.max(
            0,
            Math.min(localPlugins.length - 1, index + direction),
        );
        if (targetIndex === index) {
            return;
        }

        captureCardRects();
        const next = [...localPlugins];
        const [plugin] = next.splice(index, 1);
        next.splice(targetIndex, 0, plugin);
        currentOrderRef.current = next;
        setLocalPlugins(next);
        persistPluginOrder(next);
    }

    function onDragStart(e: React.DragEvent, index: number, hash: string) {
        dragIndexRef.current = index;
        currentOrderRef.current = localPlugins;
        setDraggingHash(hash);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", hash);
        const ghost = document.createElement("div");
        ghost.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;";
        document.body.appendChild(ghost);
        ghostRef.current = ghost;
        e.dataTransfer.setDragImage(ghost, 0, 0);
    }

    function onDragOver(e: React.DragEvent) {
        if (dragIndexRef.current === null) {
            return;
        }

        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        lastDragClientYRef.current = e.clientY;
        updateAutoScroll(e.clientY);
        moveDraggingPluginByPoint(e.clientY);
    }

    function onDrop(e: React.DragEvent) {
        if (dragIndexRef.current !== null) {
            e.preventDefault();
        }
    }

    function onDragEnd() {
        stopAutoScroll();
        setDraggingHash(null);
        dragIndexRef.current = null;
        lastDragClientYRef.current = 0;
        if (ghostRef.current) {
            ghostRef.current.remove();
            ghostRef.current = null;
        }
        const ordered = currentOrderRef.current;
        persistPluginOrder(ordered);
    }

    return (
        <section
            className="plugin-table--container plugin-manager-section"
            aria-labelledby="installed-plugin-section-title"
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            <div className="plugin-manager-section-header">
                <div>
                    <div className="plugin-manager-section-title-row">
                        <h2
                            id="installed-plugin-section-title"
                            className="plugin-manager-section-title"
                        >
                            {t("plugin_management_page.installed_plugins")}
                        </h2>
                        <span className="plugin-manager-section-count">
                            {localPlugins.length}
                        </span>
                    </div>
                    <p className="plugin-manager-section-description">
                        {t("plugin_management_page.installed_plugins_description")}
                    </p>
                </div>
            </div>

            <div className="plugin-manager-list-surface">
                <Condition
                    condition={localPlugins.length}
                    falsy={<Empty style={{ minHeight: "148px" }}></Empty>}
                >
                    <div className="plugin-card-columns" aria-hidden="true">
                        <span>{t("plugin_management_page.priority")}</span>
                        <span>{t("plugin_management_page.plugin")}</span>
                        <span>{t("plugin_management_page.source")}</span>
                        <span>{t("plugin_management_page.status")}</span>
                        <span></span>
                    </div>
                    <div className="plugin-card-list" data-dragging={String(
                        draggingHash !== null,
                    )}>
                        {localPlugins.map((plugin, index) => {
                            const disabled = meta[plugin.platform]?.disabled ?? false;
                            const isDragging = plugin.hash === draggingHash;
                            return (
                                <article
                                    ref={(node) => setCardRef(plugin.hash, node)}
                                    key={plugin.hash}
                                    className="plugin-card"
                                    data-disabled={String(disabled)}
                                    data-dragging={String(isDragging)}
                                >
                                    <div className="plugin-card-head">
                                        <button
                                            type="button"
                                            className="plugin-card-order"
                                            title={t("plugin_management_page.drag_sort_hint")}
                                            aria-label={t(
                                                "plugin_management_page.reorder_plugin",
                                                {
                                                    plugin: plugin.platform,
                                                    position: index + 1,
                                                },
                                            )}
                                            draggable
                                            onDragStart={(event) => onDragStart(
                                                event,
                                                index,
                                                plugin.hash,
                                            )}
                                            onDragEnd={onDragEnd}
                                            onKeyDown={(event) =>
                                                movePluginByKeyboard(event, index)}
                                        >
                                            <SvgAsset
                                                iconName="grip-vertical"
                                                size={15}
                                            ></SvgAsset>
                                            <span>
                                                {String(index + 1).padStart(2, "0")}
                                            </span>
                                        </button>
                                        <div className="plugin-card-main">
                                            <div
                                                className="plugin-card-title"
                                                title={plugin.platform}
                                            >
                                                {plugin.platform}
                                            </div>
                                            <div className="plugin-card-meta">
                                                <span>
                                                    {plugin.version
                                                        ? `v${plugin.version}`
                                                        : "v-"}
                                                </span>
                                                <span aria-hidden="true">·</span>
                                                <span
                                                    className="plugin-card-author"
                                                    title={plugin.author ??
                                                        t("media.unknown_artist")}
                                                >
                                                    {plugin.author ??
                                                        t("media.unknown_artist")}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="plugin-card-origin">
                                            <span
                                                className="plugin-card-source"
                                                data-source={plugin.srcUrl
                                                    ? "subscription"
                                                    : "local"}
                                            >
                                                {plugin.srcUrl
                                                    ? t("plugin_management_page.subscription_plugin")
                                                    : t("plugin_management_page.local_plugin")}
                                            </span>
                                            <span className="plugin-card-capabilities">
                                                {t("plugin_management_page.capability_count", {
                                                    count: plugin.supportedMethod.length,
                                                })}
                                            </span>
                                        </div>
                                        <div className="plugin-card-state">
                                            <PluginToggle plugin={plugin} meta={meta} />
                                            <span>
                                                {t(disabled
                                                    ? "plugin_management_page.disabled"
                                                    : "plugin_management_page.enabled")}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            className="plugin-manager-row-menu-button"
                                            aria-label={t(
                                                "plugin_management_page.plugin_actions",
                                                { plugin: plugin.platform },
                                            )}
                                            title={t(
                                                "plugin_management_page.plugin_actions",
                                                { plugin: plugin.platform },
                                            )}
                                            aria-haspopup="menu"
                                            onMouseDown={(event) =>
                                                event.stopPropagation()}
                                            onClick={(event) =>
                                                openPluginActions(event, plugin)}
                                        >
                                            <SvgAsset
                                                iconName="ellipsis-horizontal"
                                                size={18}
                                            ></SvgAsset>
                                        </button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </Condition>
            </div>
        </section>
    );
}
