import { Listbox } from "@headlessui/react";
import "./index.scss";
import Condition, { IfTruthy } from "@/renderer/components/Condition";
import Loading from "@/renderer/components/Loading";
import { isBasicType } from "@/common/normalize-util";
import useVirtualList from "@/hooks/useVirtualList";
import { rem } from "@/common/constant";
import { ReactNode, useLayoutEffect, useRef } from "react";
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
                    <ListBoxOptions
                        width={width}
                        options={options}
                        renderItem={renderItem}
                    ></ListBoxOptions>
                </div>
            </Listbox>
        </div>
    );
}

interface IListBoxOptionsProps<T extends keyof IAppConfig> {
    options: Array<IAppConfig[T]> | null;
    renderItem?: (item: IAppConfig[T]) => ReactNode;
    width?: number | string;
}

function ListBoxOptions<T extends keyof IAppConfig>(
    props: IListBoxOptionsProps<T>,
) {
    const { options, renderItem, width } = props;
    const containerRef = useRef<HTMLDivElement>(null);

    const virtualController = useVirtualList({
        data: options ?? [],
        estimateItemHeight: 2.5 * rem,
        getScrollElement: () => containerRef.current,
        renderCount: 40,
        fallbackRenderCount: 20,
    });
    const { setScrollElement } = virtualController;

    useLayoutEffect(() => {
        setScrollElement(containerRef.current);
        return () => {
            setScrollElement(null);
        };
    }, [setScrollElement, options]);

    // Headless UI v2: anchor + portal positions against the trigger with Floating UI.
    // Avoid manual getBoundingClientRect/portal math — it drifts when ancestors create
    // fixed containing blocks (filter / backdrop-filter / transform).
    return (
        <Listbox.Options
            ref={containerRef}
            as="div"
            anchor={{
                to: "bottom start",
                gap: 8,
                padding: 8,
            }}
            className="setting-listbox-options shadow backdrop-color"
            style={{ width: width ?? 240 }}
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
        </Listbox.Options>
    );
}
