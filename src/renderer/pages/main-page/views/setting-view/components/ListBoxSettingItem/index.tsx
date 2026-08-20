import { Listbox } from "@headlessui/react";
import "./index.scss";
import Condition, { IfTruthy } from "@/renderer/components/Condition";
import Loading from "@/renderer/components/Loading";
import { isBasicType } from "@/common/normalize-util";
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
                onChange={(newVal) => {
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
                }}
            >
                {({ open }) => (
                    <>
                        <div className="label-container">
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
                                className="listbox-button"
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
                            {open ? (
                                <ListBoxOptions
                                    buttonRef={buttonRef}
                                    width={width}
                                    options={options}
                                    renderItem={renderItem}
                                ></ListBoxOptions>
                            ) : null}
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
    position: "absolute" | "fixed";
}

const LISTBOX_PANEL_MAX_HEIGHT = 280;
const LISTBOX_PANEL_GAP = 8;
const LISTBOX_PANEL_MARGIN = 8;

function resolvePanelWidth(width: number | string | undefined, button: HTMLElement) {
    if (typeof width === "number" && Number.isFinite(width)) {
        return Math.max(button.getBoundingClientRect().width, width);
    }
    if (typeof width === "string") {
        const parsedWidth = Number.parseFloat(width);
        if (Number.isFinite(parsedWidth)) {
            return Math.max(button.getBoundingClientRect().width, parsedWidth);
        }
    }
    return button.getBoundingClientRect().width;
}

function computeListBoxPanelPosition(
    button: HTMLElement,
    portalTarget: HTMLElement,
    width: number | string | undefined,
): IListBoxPanelPosition {
    const rect = button.getBoundingClientRect();
    const panelWidth = resolvePanelWidth(width, button);
    const availableRight = window.innerWidth - LISTBOX_PANEL_MARGIN;
    const availableBottom = window.innerHeight - LISTBOX_PANEL_MARGIN;

    let top = rect.bottom + LISTBOX_PANEL_GAP;
    if (top + LISTBOX_PANEL_MAX_HEIGHT > availableBottom) {
        const flippedTop = rect.top - LISTBOX_PANEL_MAX_HEIGHT - LISTBOX_PANEL_GAP;
        top = flippedTop >= LISTBOX_PANEL_MARGIN
            ? flippedTop
            : Math.max(
                LISTBOX_PANEL_MARGIN,
                window.innerHeight - LISTBOX_PANEL_MAX_HEIGHT - LISTBOX_PANEL_MARGIN,
            );
    }

    const left = Math.min(
        Math.max(LISTBOX_PANEL_MARGIN, rect.left),
        Math.max(LISTBOX_PANEL_MARGIN, availableRight - panelWidth),
    );

    const useAbsolute = portalTarget !== document.body
        && getComputedStyle(portalTarget).position !== "static";
    if (useAbsolute) {
        const targetRect = portalTarget.getBoundingClientRect();
        return {
            top: top - targetRect.top + portalTarget.scrollTop,
            left: left - targetRect.left + portalTarget.scrollLeft,
            position: "absolute",
        };
    }

    return { top, left, position: "fixed" };
}

function ListBoxOptions<T extends keyof IAppConfig>(
    props: IListBoxOptionsProps<T>,
) {
    const { buttonRef, options, renderItem, width } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
    const [panelPosition, setPanelPosition] = useState<IListBoxPanelPosition | null>(null);

    useLayoutEffect(() => {
        const button = buttonRef.current;
        if (!button) {
            return;
        }
        const target = button.closest<HTMLElement>(".setting-view--container") ?? document.body;
        setPortalTarget(target);

        const updatePosition = () => {
            if (!button.isConnected || !target.isConnected) {
                return;
            }
            setPanelPosition(computeListBoxPanelPosition(button, target, width));
        };

        updatePosition();
        window.addEventListener("scroll", updatePosition, true);
        window.addEventListener("resize", updatePosition);

        const resizeObserver = typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver(updatePosition);
        resizeObserver?.observe(button);

        return () => {
            window.removeEventListener("scroll", updatePosition, true);
            window.removeEventListener("resize", updatePosition);
            resizeObserver?.disconnect();
        };
    }, [buttonRef, width]);

    if (!portalTarget || !panelPosition) {
        return null;
    }

    const panelStyle: CSSProperties = {
        width: width ?? 240,
        top: panelPosition.top,
        left: panelPosition.left,
        position: panelPosition.position,
    };

    return createPortal(
        <Listbox.Options
            ref={containerRef}
            as="div"
            static
            className="setting-listbox-options shadow backdrop-color"
            style={panelStyle}
        >
            <Condition condition={options !== null} falsy={<Loading></Loading>}>
                {options?.map((option, index) => (
                    <Listbox.Option
                        className="listbox-option"
                        key={index}
                        value={option}
                        as="div"
                    >
                        <div>
                            {renderItem
                                ? renderItem(option)
                                : isBasicType(option)
                                    ? (option as string)
                                    : ""}
                        </div>
                    </Listbox.Option>
                ))}
            </Condition>
        </Listbox.Options>,
        portalTarget,
    );
}
