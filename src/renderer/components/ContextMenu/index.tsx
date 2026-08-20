import Store from "@/common/store";
import SvgAsset, { SvgAssetIconNames } from "../SvgAsset";
import "./index.scss";
import { If, IfTruthy } from "../Condition";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

export interface IContextMenuItem {
    /** 左侧图标 */
    icon?: SvgAssetIconNames;
    /** 列表标题 */
    title?: string;
    /** 是否是分割线 */
    divider?: boolean;
    /** 是否展示 */
    show?: boolean;
    /** 左键点击 */
    onClick?: (value?: IContextMenuItem) => void;
    /** 右键点击（如复制 id） */
    onContextMenu?: (value?: IContextMenuItem) => void;
    /** 子菜单 */
    subMenu?: IContextMenuItem[];
}

type ContextMenuPlacement = "auto" | "bottom-end" | "bottom-start";

interface IContextMenuBoundary {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface IContextMenuData {
    /** 菜单 */
    menuItems?: IContextMenuItem[];
    /** 出现位置 x */
    x: number;
    /** 出现位置 y */
    y: number;
    /** 相对锚点的展开方向 */
    placement?: ContextMenuPlacement;
    /** 菜单需要保持在内的视口区域 */
    boundary?: IContextMenuBoundary;
    /** 设置子目录 */
    setSubMenu?: (
        subMenu?: Omit<IContextMenuData, "setSubMenu">,
        menuItem?: IContextMenuItem,
    ) => void;
    onItemClick?: (value: any) => void;

    /** 自定义的菜单 */
    width?: number;
    height?: number;
    maxHeight?: number;
    component?: ReactNode;
}

const contextMenuDataStore = new Store<IContextMenuData | null>(null);

export function showContextMenu(
    contextMenuData: Pick<
        IContextMenuData,
        "menuItems" | "placement" | "x" | "y"
    >,
) {
    contextMenuDataStore.setValue(contextMenuData);
}

export function showCustomContextMenu(
    contextMenuData: Pick<
        IContextMenuData,
        "boundary" | "component" | "height" | "placement" | "width" | "x" | "y"
    >,
) {
    contextMenuDataStore.setValue(contextMenuData);
}

function hideContextMenu() {
    contextMenuDataStore.setValue(null);
}

export function isContextMenuOpen() {
    return contextMenuDataStore.getValue() != null;
}

const menuItemWidth = 260;
const menuItemHeight = 32;
const menuContainerMaxHeight = menuItemHeight * 14;

function SingleColumnContextMenuComponent(props: IContextMenuData) {
    const {
        menuItems = [],
        maxHeight = menuContainerMaxHeight,
        x,
        y,
        setSubMenu,
        onItemClick,
    } = props;
    const menuContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        menuContainerRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    }, []);

    const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const items = [...event.currentTarget.parentElement
            ?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []];
        const currentIndex = items.indexOf(event.currentTarget);
        let nextIndex = currentIndex;
        if (event.key === "ArrowDown") {
            nextIndex = (currentIndex + 1) % items.length;
        } else if (event.key === "ArrowUp") {
            nextIndex = (currentIndex - 1 + items.length) % items.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = items.length - 1;
        } else {
            return;
        }
        event.preventDefault();
        items[nextIndex]?.focus();
    };

    return (
        <div
            className="context-menu--single-column-container shadow backdrop-color"
            style={{
                width: menuItemWidth,
                paddingTop: menuItemHeight / 4,
                paddingBottom: menuItemHeight / 4,
                top: y,
                left: x,
                maxHeight,
            }}
            ref={menuContainerRef}
            role="menu"
        >
            {menuItems.map((item, index) => (
                <IfTruthy condition={item.show !== false} key={index}>
                    <If condition={!item.divider}>
                        <If.Falsy>
                            <div className="divider" role="separator"></div>
                        </If.Falsy>
                        <If.Truthy>
                            <button
                                type="button"
                                className="menu-item"
                                role="menuitem"
                                aria-haspopup={item.subMenu ? "menu" : undefined}
                                onKeyDown={moveFocus}
                                onClick={() => {
                                    item.onClick?.();
                                    onItemClick?.(item);
                                }}
                                onContextMenu={(e) => {
                                    if (!item.onContextMenu) {
                                        return;
                                    }
                                    e.preventDefault();
                                    e.stopPropagation();
                                    item.onContextMenu(item);
                                    hideContextMenu();
                                }}
                                onMouseEnter={(e) => {
                                    const subMenu = item.subMenu;
                                    if (!subMenu) {
                                        setSubMenu?.(undefined, item);
                                        return;
                                    }

                                    const menuContainer = menuContainerRef.current;
                                    if (!menuContainer) {
                                        return;
                                    }

                                    const realPos =
                                        y +
                    (e.target as HTMLDivElement).offsetTop -
                    menuContainer.scrollTop;
                                    const realHeight = Math.min(
                                        subMenu.length * menuItemHeight,
                                        menuContainerMaxHeight,
                                    );
                                    let [subX, subY] = [
                                        x - menuItemWidth - offset,
                                        realPos - realHeight / 2,
                                    ];
                                    if (x < window.innerWidth - x - offset - menuItemWidth) {
                                        subX = x + menuItemWidth + offset;
                                    }
                                    if (subY < 54) {
                                        subY = 54;
                                    }
                                    if (subY + realHeight > window.innerHeight - 64 - offset) {
                                        subY = window.innerHeight - 64 - realHeight - offset;
                                    }
                                    setSubMenu?.(
                                        {
                                            menuItems: subMenu,
                                            x: subX,
                                            y: subY,
                                        },
                                        item,
                                    );
                                }}
                                style={{
                                    height: menuItemHeight,
                                }}
                            >
                                <IfTruthy condition={item.icon}>
                                    <div className="menu-item-icon">
                                        {item.icon ? (
                                            <SvgAsset iconName={item.icon}></SvgAsset>
                                        ) : null}
                                    </div>
                                </IfTruthy>
                                <span>{item.title}</span>
                                <IfTruthy condition={item.subMenu}>
                                    <div className="menu-item-expand"></div>
                                </IfTruthy>
                            </button>
                        </If.Truthy>
                    </If>
                </IfTruthy>
            ))}
        </div>
    );
}

const offset = 6;

export function ContextMenuComponent() {
    const contextMenuData = contextMenuDataStore.useValue();
    const {
        menuItems,
        x,
        y,
        width,
        height,
        component,
        placement = "auto",
        boundary,
    } = contextMenuData ?? {};
    const [subMenuData, setSubMenuData] = useState<IContextMenuData | null>(null);

    const [actualX, actualY, actualMaxHeight, actualWidth] = useMemo(() => {
        if (x === undefined || y === undefined) {
            return [-1000, -1000, menuContainerMaxHeight, menuItemWidth] as [
                number,
                number,
                number,
                number,
            ];
        }
        const visibleMenuItems = menuItems ?? [];

        const containerHeight = Math.min(
            component
                ? height ?? menuItemHeight
                : visibleMenuItems.reduce(
                    (prev, curr) =>
                        prev +
              (curr.show !== false ? (curr.divider ? 1 : menuItemHeight) : 0),
                    menuItemHeight / 2,
                ),
            menuContainerMaxHeight,
        );

        const containerWidth = width ?? menuItemWidth;
        const bounds = {
            top: Math.max(offset, boundary?.top ?? offset),
            right: Math.min(
                window.innerWidth - offset,
                boundary?.right ?? window.innerWidth - offset,
            ),
            bottom: Math.min(
                window.innerHeight - offset,
                boundary?.bottom ?? window.innerHeight - offset,
            ),
            left: Math.max(offset, boundary?.left ?? offset),
        };
        const availableWidth = Math.max(0, bounds.right - bounds.left);
        const availableHeight = Math.max(
            menuItemHeight + menuItemHeight / 2,
            bounds.bottom - bounds.top,
        );
        const renderedWidth = Math.min(containerWidth, availableWidth);
        const renderedHeight = Math.min(containerHeight, availableHeight);
        const clampX = (value: number) => Math.max(
            bounds.left,
            Math.min(bounds.right - renderedWidth, value),
        );
        const clampY = (value: number) => Math.max(
            bounds.top,
            Math.min(bounds.bottom - renderedHeight, value),
        );

        if (placement !== "auto") {
            const desiredX = placement === "bottom-end"
                ? x - containerWidth
                : x;

            return [
                clampX(desiredX),
                clampY(y + offset),
                renderedHeight,
                renderedWidth,
            ] as [number, number, number, number];
        }

        const desiredX = x + offset + renderedWidth <= bounds.right
            ? x + offset
            : x - offset - renderedWidth;
        const desiredY = y + offset + renderedHeight <= bounds.bottom
            ? y + offset
            : y - offset - renderedHeight;
        return [
            clampX(desiredX),
            clampY(desiredY),
            renderedHeight,
            renderedWidth,
        ] as [number, number, number, number];
    }, [boundary, component, height, menuItems, placement, width, x, y]);

    useEffect(() => {
        const contextClickListener = () => {
            if (contextMenuDataStore.getValue()) {
                hideContextMenu();
            }
        };

        window.addEventListener("click", contextClickListener);
        return () => {
            window.removeEventListener("click", contextClickListener);
        };
    }, []);

    useEffect(() => {
        if (!contextMenuData) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Escape") {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            hideContextMenu();
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [contextMenuData]);

    useEffect(() => {
        setSubMenuData(null);
    }, [contextMenuData]);


    return (
        <>
            {contextMenuData ? (
                <div
                    className="global-menu-dismiss-layer"
                    aria-hidden="true"
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        hideContextMenu();
                    }}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        hideContextMenu();
                    }}
                ></div>
            ) : null}
            <If condition={contextMenuData !== null && !component}>
                <If.Truthy>
                    {contextMenuData ? (
                        <SingleColumnContextMenuComponent
                            menuItems={menuItems ?? []}
                            maxHeight={actualMaxHeight}
                            x={actualX}
                            y={actualY}
                            setSubMenu={(data, menuItem) => {
                                setSubMenuData(
                                    data
                                        ? {
                                            ...data,
                                            onItemClick(value) {
                                                menuItem?.onClick?.(value);
                                            },
                                        }
                                        : null,
                                );
                            }}
                        ></SingleColumnContextMenuComponent>
                    ) : null}
                    {subMenuData ? (
                        <SingleColumnContextMenuComponent
                            menuItems={subMenuData.menuItems ?? []}
                            x={subMenuData.x}
                            y={subMenuData.y}
                            onItemClick={subMenuData.onItemClick}
                        ></SingleColumnContextMenuComponent>
                    ) : null}
                </If.Truthy>
                <If.Falsy>
                    <div
                        className="context-menu--single-column-container shadow backdrop-color"
                        style={{
                            width: actualWidth,
                            top: actualY,
                            left: actualX,
                            maxHeight: actualMaxHeight,
                        }}
                        role="menu"
                    >
                        {component}
                    </div>
                </If.Falsy>
            </If>
        </>
    );
}
