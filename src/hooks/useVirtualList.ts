import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import throttle from "lodash.throttle";

interface IVirtualListProps<T> {
    /** 滚动的容器 */
    getScrollElement?: () => HTMLElement | null;
    /** 滚动容器的 query */
    scrollElementQuery?: string;
    /** 固定行高估值 */
    estimateItemHeight: number;
    /** 数据 */
    data: T[];
    /** 强制渲染数目 */
    renderCount?: number;
    /** 未绑定滚动容器时的渲染数目，-1 表示全部 */
    fallbackRenderCount?: number;
    /** 列表相对滚动容器顶部的偏移 */
    offsetHeight?: number | (() => number);
    /** 可视区上下额外保留的行数 */
    overscan?: number;
}

interface IVirtualItem<T> {
    top: number;
    rowIndex: number;
    dataItem: T;
}

function resolveOffset(offsetHeight: number | (() => number)) {
    return typeof offsetHeight === "number" ? offsetHeight : offsetHeight();
}

export default function useVirtualList<T>(props: IVirtualListProps<T>) {
    const propsRef = useRef(props);
    propsRef.current = props;
    const scrollElementRef = useRef<HTMLElement | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const [virtualItems, setVirtualItems] = useState<IVirtualItem<T>[]>([]);

    const commitVirtualItems = useCallback((nextItems: IVirtualItem<T>[]) => {
        setVirtualItems((previousItems) => {
            if (
                previousItems.length === nextItems.length
                && previousItems.every((item, index) =>
                    item.rowIndex === nextItems[index]?.rowIndex
                    && item.dataItem === nextItems[index]?.dataItem)
            ) {
                return previousItems;
            }
            return nextItems;
        });
    }, []);

    const calculateVirtualItems = useCallback(() => {
        const {
            data,
            estimateItemHeight,
            fallbackRenderCount = -1,
            offsetHeight = 0,
            overscan = 4,
            renderCount,
        } = propsRef.current;
        const scrollElement = scrollElementRef.current;

        if (!data.length || estimateItemHeight <= 0) {
            commitVirtualItems([]);
            return;
        }

        if (!scrollElement) {
            const count = fallbackRenderCount < 0
                ? data.length
                : Math.min(data.length, fallbackRenderCount);
            commitVirtualItems(data.slice(0, count).map((dataItem, rowIndex) => ({
                dataItem,
                rowIndex,
                top: rowIndex * estimateItemHeight,
            })));
            return;
        }

        const listScrollTop = Math.max(
            0,
            scrollElement.scrollTop - resolveOffset(offsetHeight),
        );
        const firstVisibleIndex = Math.floor(listScrollTop / estimateItemHeight);
        const normalizedOverscan = Math.max(0, Math.floor(overscan));
        const startIndex = Math.max(0, firstVisibleIndex - normalizedOverscan);
        const visibleCount = renderCount ?? Math.max(
            1,
            Math.ceil(scrollElement.clientHeight / estimateItemHeight)
                + normalizedOverscan * 2,
        );
        const endIndex = Math.min(data.length, startIndex + visibleCount);

        commitVirtualItems(data.slice(startIndex, endIndex).map((dataItem, index) => {
            const rowIndex = startIndex + index;
            return {
                dataItem,
                rowIndex,
                top: rowIndex * estimateItemHeight,
            };
        }));
    }, [commitVirtualItems]);

    const throttledCalculate = useMemo(() => throttle(
        calculateVirtualItems,
        32,
        { leading: true, trailing: true },
    ), [calculateVirtualItems]);

    const detachScrollElement = useCallback(() => {
        scrollElementRef.current?.removeEventListener("scroll", throttledCalculate);
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = null;
    }, [throttledCalculate]);

    const setScrollElement = useCallback((scrollElement: HTMLElement | null) => {
        if (scrollElementRef.current === scrollElement) {
            calculateVirtualItems();
            return;
        }

        detachScrollElement();
        scrollElementRef.current = scrollElement;
        if (scrollElement) {
            scrollElement.addEventListener("scroll", throttledCalculate, {
                passive: true,
            });
            if (typeof ResizeObserver !== "undefined") {
                resizeObserverRef.current = new ResizeObserver(throttledCalculate);
                resizeObserverRef.current.observe(scrollElement);
            }
        }
        calculateVirtualItems();
    }, [calculateVirtualItems, detachScrollElement, throttledCalculate]);

    useEffect(() => {
        calculateVirtualItems();
    }, [
        props.data,
        props.estimateItemHeight,
        props.fallbackRenderCount,
        props.overscan,
        props.renderCount,
        calculateVirtualItems,
    ]);

    useEffect(() => {
        const { getScrollElement, scrollElementQuery } = propsRef.current;
        const discoveredElement = getScrollElement
            ? getScrollElement()
            : scrollElementQuery
                ? document.querySelector<HTMLElement>(scrollElementQuery)
                : null;
        if (discoveredElement) {
            setScrollElement(discoveredElement);
        }

        return () => {
            detachScrollElement();
            scrollElementRef.current = null;
        };
    }, [
        props.scrollElementQuery,
        detachScrollElement,
        setScrollElement,
    ]);

    useEffect(() => () => {
        throttledCalculate.cancel();
    }, [throttledCalculate]);

    const scrollToIndex = useCallback((index: number, behavior?: ScrollBehavior) => {
        const scrollElement = scrollElementRef.current;
        if (!scrollElement) {
            return;
        }
        const {
            data,
            estimateItemHeight,
            offsetHeight = 0,
        } = propsRef.current;
        const safeIndex = Math.min(Math.max(0, index), Math.max(0, data.length - 1));
        scrollElement.scrollTo({
            top: resolveOffset(offsetHeight) + estimateItemHeight * safeIndex,
            behavior,
        });
    }, []);

    return {
        virtualItems,
        totalHeight: props.data.length * props.estimateItemHeight,
        startTop: virtualItems[0]?.top ?? 0,
        setScrollElement,
        scrollToIndex,
    };
}
