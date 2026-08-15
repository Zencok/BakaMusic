import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

interface IScrollPosition {
    left: number;
    top: number;
}

const MAX_CACHED_ENTRIES = 64;
const HISTORY_SCROLL_KEY = "__bakamusicScrollPosition";
const scrollPositions = new Map<string, IScrollPosition>();
const scrollPositionsByRoute = new Map<string, IScrollPosition>();

function readHistoryScrollPosition(): IScrollPosition | undefined {
    const value = history.state?.usr?.[HISTORY_SCROLL_KEY];
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const position = value as { left?: unknown; top?: unknown };
    if (typeof position.left !== "number" || typeof position.top !== "number") {
        return undefined;
    }
    if (!Number.isFinite(position.left) || !Number.isFinite(position.top)) {
        return undefined;
    }
    return {
        left: Math.max(0, position.left),
        top: Math.max(0, position.top),
    };
}

function writeHistoryScrollPosition(position: IScrollPosition) {
    const state = history.state;
    if (!state || typeof state !== "object") {
        return;
    }
    const usr = state.usr && typeof state.usr === "object" ? state.usr : {};
    history.replaceState({
        ...state,
        usr: {
            ...usr,
            [HISTORY_SCROLL_KEY]: position,
        },
    }, "");
}

function rememberScrollPosition(key: string, position: IScrollPosition) {
    scrollPositions.delete(key);
    scrollPositions.set(key, position);

    if (scrollPositions.size <= MAX_CACHED_ENTRIES) {
        return;
    }

    const oldestKey = scrollPositions.keys().next().value;
    if (oldestKey) {
        scrollPositions.delete(oldestKey);
    }
}

function rememberRoutePosition(routeKey: string, position: IScrollPosition) {
    scrollPositionsByRoute.delete(routeKey);
    scrollPositionsByRoute.set(routeKey, position);
    if (scrollPositionsByRoute.size <= MAX_CACHED_ENTRIES) {
        return;
    }

    const oldestKey = scrollPositionsByRoute.keys().next().value;
    if (oldestKey) {
        scrollPositionsByRoute.delete(oldestKey);
    }
}

export default function PageScrollRestoration() {
    const location = useLocation();
    const navigationType = useNavigationType();
    const routeKey = `${location.pathname}${location.search}${location.hash}`;

    useLayoutEffect(() => {
        const pageContainer = document.querySelector<HTMLElement>("#page-container");
        if (!pageContainer) {
            return;
        }

        const cachedPosition = (navigationType === "POP" ? readHistoryScrollPosition() : undefined)
            ?? scrollPositions.get(location.key)
            ?? (navigationType === "POP" ? scrollPositionsByRoute.get(routeKey) : undefined);
        let restoreFrame = 0;
        let restoreTimer: number | null = null;
        let restorationSettled = cachedPosition === undefined;

        const restore = () => {
            if (!cachedPosition || restorationSettled) {
                return;
            }

            const maxTop = Math.max(
                0,
                pageContainer.scrollHeight - pageContainer.clientHeight,
            );
            const maxLeft = Math.max(
                0,
                pageContainer.scrollWidth - pageContainer.clientWidth,
            );

            pageContainer.scrollLeft = Math.min(cachedPosition.left, maxLeft);
            pageContainer.scrollTop = Math.min(cachedPosition.top, maxTop);

            restorationSettled =
                maxTop >= cachedPosition.top - 1 &&
                maxLeft >= cachedPosition.left - 1;

            if (restorationSettled && restoreTimer !== null) {
                window.clearInterval(restoreTimer);
                restoreTimer = null;
            }
        };

        const scheduleRestore = () => {
            cancelAnimationFrame(restoreFrame);
            restoreFrame = requestAnimationFrame(restore);
        };

        scheduleRestore();
        if (cachedPosition) {
            // Data pages can finish after their DOM shape is stable. Keep trying
            // briefly so a late response cannot leave the restored entry at 0.
            restoreTimer = window.setInterval(restore, 50);
        }

        const rememberCurrentPosition = () => {
            // Do not replace a pending target with the temporary 0/max scroll
            // value while the page is still loading its list.
            if (!cachedPosition || restorationSettled) {
                const position = {
                    left: pageContainer.scrollLeft,
                    top: pageContainer.scrollTop,
                };
                rememberScrollPosition(location.key, position);
                rememberRoutePosition(routeKey, position);
                writeHistoryScrollPosition(position);
            }
        };
        pageContainer.addEventListener("scroll", rememberCurrentPosition, {
            passive: true,
        });

        const mutationObserver = new MutationObserver(scheduleRestore);
        mutationObserver.observe(pageContainer, {
            childList: true,
            subtree: true,
        });

        const resizeObserver = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(scheduleRestore)
            : null;
        resizeObserver?.observe(pageContainer);
        window.addEventListener("resize", scheduleRestore);

        return () => {
            cancelAnimationFrame(restoreFrame);
            if (restoreTimer !== null) {
                window.clearInterval(restoreTimer);
            }
            mutationObserver.disconnect();
            resizeObserver?.disconnect();
            window.removeEventListener("resize", scheduleRestore);
            pageContainer.removeEventListener("scroll", rememberCurrentPosition);

            const position = !restorationSettled && cachedPosition
                ? cachedPosition
                : {
                    left: pageContainer.scrollLeft,
                    top: pageContainer.scrollTop,
                };
            rememberScrollPosition(location.key, position);
            rememberRoutePosition(routeKey, position);
            writeHistoryScrollPosition(position);
        };
    }, [location.key, navigationType, routeKey]);

    return null;
}
