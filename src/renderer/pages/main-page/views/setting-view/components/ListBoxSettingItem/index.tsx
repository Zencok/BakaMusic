import { Listbox } from "@headlessui/react";
import "./index.scss";
import Condition, { IfTruthy } from "@/renderer/components/Condition";
import Loading from "@/renderer/components/Loading";
import { isBasicType } from "@/common/normalize-util";
import useVirtualList from "@/hooks/useVirtualList";
import { rem } from "@/common/constant";
import { CSSProperties, ReactNode, RefObject, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SvgAsset from "@/renderer/components/SvgAsset";
import { Tooltip } from "react-tooltip";
import { IAppConfig } from "@/types/app-config";
import useAppConfig from "@/hooks/useAppConfig";
import AppConfig from "@shared/app-config/renderer";

interface ListBoxSettingItemProps<T extends keyof IAppConfig> {
    keyPath: T;
    label?: string;
    options: Array<IAppConfig[T]> | null;
    onChange?: (event: Event, newConfig: IAppConfig[T]) => void;
    renderItem?: (item: IAppConfig[T]) => ReactNode;
    width?: number | string;
    toolTip?: string;
}

export default function ListBoxSettingItem<T extends keyof IAppConfig>(
    props: ListBoxSettingItemProps<T>,
) {

    const {
        keyPath,
        label,
        options,
        onChange,
        renderItem,
        width,
        toolTip,
    } = props;

    const value = useAppConfig(keyPath);
    const buttonRef = useRef<HTMLButtonElement>(null);

    return (
        <div className="setting-view--list-box-setting-item-container setting-row">
            <IfTruthy condition={toolTip}>
                <Tooltip id={`tt-${keyPath}`}></Tooltip>
            </IfTruthy>
            <Listbox
                value={value}
                onChange={
                    (newVal) => {
                        const event = new Event("ConfigChanged", {
                            cancelable: true,
                        });
                        if (onChange) {
                            onChange(event, newVal);
                        }
                        if (!event.defaultPrevented) {
                            AppConfig.setConfig({
                                [keyPath]: newVal,
                            });
                        }
                    }
                }
            >
                {({ open }) => (
                    <>
                        <div className={"label-container"}>
                            {label}
                            <IfTruthy condition={toolTip}>
                                <div
                                    className="question-mark-container"
                                    data-tooltip-id={`tt-${keyPath}`}
                                    data-tooltip-content={toolTip}
                                >
                                    <SvgAsset iconName="question-mark-circle"></SvgAsset>
                                </div>
                            </IfTruthy>
                        </div>
                        <div className="options-container">
                            <Listbox.Button
                                ref={buttonRef}
                                as="div"
                                className={"listbox-button"}
                                style={{ width }}
                            >
                                <span>
                                    {renderItem
                                        ? renderItem(value)
                                        : isBasicType(value)
                                            ? (value as string)
                                            : ""}
                                </span>
                            </Listbox.Button>
                            <IfTruthy condition={open}>
                                <ListBoxOptions
                                    buttonRef={buttonRef}
                                    width={width}
                                    options={options}
                                    renderItem={renderItem}
                                ></ListBoxOptions>
                            </IfTruthy>
                        </div>
                    </>
                )}
            </Listbox>
        </div>
    );
}

interface IListBoxOptionsProps<T extends keyof IAppConfig> {
    buttonRef: RefObject<HTMLElement | null>;
    options: Array<IAppConfig[T]> | null;
    renderItem?: (item: IAppConfig[T]) => ReactNode;
    width?: number | string;
}

interface IListBoxPanelPosition {
    top: number;
    left: number;
}

const LISTBOX_PANEL_MAX_HEIGHT = 280;
const LISTBOX_PANEL_GAP = 10;
const LISTBOX_PANEL_MARGIN = 8;

function computeListBoxPanelPosition(button: HTMLElement): IListBoxPanelPosition {
    const rect = button.getBoundingClientRect();
    let top = rect.bottom + LISTBOX_PANEL_GAP;

    if (top + LISTBOX_PANEL_MAX_HEIGHT > window.innerHeight - LISTBOX_PANEL_MARGIN) {
        const flippedTop = rect.top - LISTBOX_PANEL_MAX_HEIGHT - LISTBOX_PANEL_GAP;
        top = flippedTop >= LISTBOX_PANEL_MARGIN
            ? flippedTop
            : Math.max(LISTBOX_PANEL_MARGIN, window.innerHeight - LISTBOX_PANEL_MAX_HEIGHT - LISTBOX_PANEL_MARGIN);
    }

    let left = rect.left;
    if (left + rect.width > window.innerWidth - LISTBOX_PANEL_MARGIN) {
        left = Math.max(LISTBOX_PANEL_MARGIN, window.innerWidth - rect.width - LISTBOX_PANEL_MARGIN);
    }

    return { top, left };
}

function ListBoxOptions<T extends keyof IAppConfig>(
    props: IListBoxOptionsProps<T>,
) {
    const { buttonRef, options, renderItem, width } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
    const [panelPosition, setPanelPosition] = useState<IListBoxPanelPosition | null>(null);

    const virtualController = useVirtualList({
        data: options ?? [],
        estimateItemHeight: 2.5 * rem,
        getScrollElement: () => containerRef.current,
        renderCount: 40,
        fallbackRenderCount: 20,
    });
    const { setScrollElement } = virtualController;

    useLayoutEffect(() => {
        const button = buttonRef.current;
        const target = (button?.closest(".setting-view--container") as HTMLElement | null) ?? document.body;
        setPortalTarget(target);

        const updatePosition = () => {
            const anchor = buttonRef.current;
            if (!anchor?.isConnected) {
                return;
            }
            setPanelPosition(computeListBoxPanelPosition(anchor));
        };

        updatePosition();
        window.addEventListener("scroll", updatePosition, true);
        window.addEventListener("resize", updatePosition);
        return () => {
            window.removeEventListener("scroll", updatePosition, true);
            window.removeEventListener("resize", updatePosition);
        };
    }, [buttonRef]);

    useLayoutEffect(() => {
        if (!portalTarget) {
            return;
        }

        setScrollElement(containerRef.current);
        return () => {
            setScrollElement(null);
        };
    }, [portalTarget, setScrollElement]);

    if (!portalTarget) {
        return null;
    }

    const panelStyle: CSSProperties = panelPosition
        ? { width, top: panelPosition.top, left: panelPosition.left }
        : { width, visibility: "hidden" };

    return createPortal(
        <Listbox.Options
            ref={containerRef}
            as={"div"}
            static
            className={"setting-listbox-options shadow backdrop-color"}
            style={panelStyle}
        >
            <Condition condition={options !== null} falsy={<Loading></Loading>}>
                <div
                    style={{
                        position: "relative",
                        height: virtualController.totalHeight,
                    }}
                >
                    {virtualController.virtualItems?.map?.((virtualItem) => (
                        <Listbox.Option
                            className={"listbox-option"}
                            key={virtualItem.rowIndex}
                            value={virtualItem.dataItem}
                            style={{
                                position: "absolute",
                                top: virtualItem.top,
                                width: "100%",
                            }}
                            as="div"
                        >
                            <div>
                                {renderItem
                                    ? renderItem(virtualItem.dataItem)
                                    : isBasicType(virtualItem.dataItem)
                                        ? (virtualItem.dataItem as string)
                                        : ""}
                            </div>
                        </Listbox.Option>
                    ))}
                </div>
            </Condition>
        </Listbox.Options>,
        portalTarget,
    );
}
