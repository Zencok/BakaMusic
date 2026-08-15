import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const MAX_CACHED_ROUTES = 64;
const HISTORY_SCROLL_KEY = "__bakamusicScrollPositions";
const LEGACY_HISTORY_SCROLL_KEY = "__bakamusicScrollPosition";
const SESSION_SCROLL_KEY = "bakamusic:page-scroll-positions";
const scrollPositions = new Map<string, number>();

interface IHistoryScrollState {
    [routeKey: string]: number;
}

function normalizeScrollTop(value: unknown) {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, value)
        : undefined;
}

function readHistoryPosition(routeKey: string) {
    const usr = history.state?.usr;
    if (!usr || typeof usr !== "object") {
        return undefined;
    }

    const value = (usr as Record<string, unknown>)[HISTORY_SCROLL_KEY];
    if (value && typeof value === "object") {
        const positions = value as Record<string, unknown>;
        return normalizeScrollTop(positions[routeKey]);
    }

    // Keep compatibility with the earlier restoration implementation, which
    // stored one position directly in the history entry.
    if (value && typeof value === "number") {
        return normalizeScrollTop(value);
    }

    const legacyValue = (usr as Record<string, unknown>)[LEGACY_HISTORY_SCROLL_KEY];
    if (legacyValue && typeof legacyValue === "object") {
        return normalizeScrollTop((legacyValue as { top?: unknown }).top);
    }

    return undefined;
}

function writeHistoryPosition(routeKey: string, scrollTop: number) {
    const state = history.state;
    if (!state || typeof state !== "object") {
        return;
    }

    const usr = state.usr && typeof state.usr === "object" ? state.usr : {};
    const previous = (usr as Record<string, unknown>)[HISTORY_SCROLL_KEY];
    const positions: IHistoryScrollState = previous && typeof previous === "object"
        ? { ...(previous as IHistoryScrollState) }
        : {};
    positions[routeKey] = scrollTop;

    try {
        history.replaceState({
            ...state,
            usr: {
                ...usr,
                [HISTORY_SCROLL_KEY]: positions,
            },
        }, "");
    } catch {
        // A plugin can put a non-cloneable value in location.state. The
        // in-memory cache remains sufficient for the current renderer.
    }
}

function readSessionPositions() {
    try {
        const serialized = window.sessionStorage.getItem(SESSION_SCROLL_KEY);
        if (!serialized) {
            return;
        }

        const parsed = JSON.parse(serialized) as Record<string, unknown>;
        Object.entries(parsed).forEach(([routeKey, value]) => {
            const scrollTop = normalizeScrollTop(value);
            if (scrollTop !== undefined) {
                scrollPositions.set(routeKey, scrollTop);
            }
        });
    } catch {
        // Storage is best effort; the module cache is always available.
    }
}

function writeSessionPositions() {
    try {
        const positions = Object.fromEntries(scrollPositions.entries());
        window.sessionStorage.setItem(SESSION_SCROLL_KEY, JSON.stringify(positions));
    } catch {
        // Storage is best effort; the module cache is always available.
    }
}

readSessionPositions();

function rememberPosition(routeKey: string, scrollTop: number) {
    const normalizedTop = Math.max(0, scrollTop);
    scrollPositions.delete(routeKey);
    scrollPositions.set(routeKey, normalizedTop);

    if (scrollPositions.size > MAX_CACHED_ROUTES) {
        const oldestKey = scrollPositions.keys().next().value;
        if (oldestKey) {
            scrollPositions.delete(oldestKey);
        }
    }

    writeSessionPositions();
    writeHistoryPosition(routeKey, normalizedTop);
}

export default function usePageScrollPosition<T extends HTMLElement>() {
    const scrollRef = useRef<T | null>(null);
    const location = useLocation();
    const navigationType = useNavigationType();
    const routeKey = `${location.pathname}${location.search}${location.hash}`;

    useLayoutEffect(() => {
        const scrollElement = scrollRef.current;
        if (!scrollElement) {
            return;
        }

        const restoredTop = navigationType === "POP"
            ? readHistoryPosition(routeKey)
                ?? scrollPositions.get(routeKey)
            : undefined;
        let restorationSettled = restoredTop === undefined;
        let restoreFrame = 0;
        let restoreTimer: number | null = null;

        const restore = () => {
            if (restoredTop === undefined || restorationSettled) {
                return;
            }

            const maxTop = Math.max(
                0,
                scrollElement.scrollHeight - scrollElement.clientHeight,
            );
            scrollElement.scrollTop = Math.min(restoredTop, maxTop);
            restorationSettled = maxTop >= restoredTop - 1;

            if (restorationSettled && restoreTimer !== null) {
                window.clearInterval(restoreTimer);
                restoreTimer = null;
            }
        };

        const scheduleRestore = () => {
            cancelAnimationFrame(restoreFrame);
            restoreFrame = requestAnimationFrame(restore);
        };

        const rememberCurrentPosition = () => {
            if (restoredTop === undefined || restorationSettled) {
                rememberPosition(routeKey, scrollElement.scrollTop);
            }
        };

        scrollElement.addEventListener("scroll", rememberCurrentPosition, {
            passive: true,
        });

        const mutationObserver = new MutationObserver(scheduleRestore);
        mutationObserver.observe(scrollElement, {
            childList: true,
            subtree: true,
        });

        const resizeObserver = typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver(scheduleRestore);
        resizeObserver?.observe(scrollElement);

        scheduleRestore();
        if (restoredTop !== undefined) {
            restoreTimer = window.setInterval(restore, 50);
        }

        return () => {
            cancelAnimationFrame(restoreFrame);
            if (restoreTimer !== null) {
                window.clearInterval(restoreTimer);
            }
            mutationObserver.disconnect();
            resizeObserver?.disconnect();
            scrollElement.removeEventListener("scroll", rememberCurrentPosition);
            rememberPosition(
                routeKey,
                !restorationSettled && restoredTop !== undefined
                    ? restoredTop
                    : scrollElement.scrollTop,
            );
        };
    }, [location.key, navigationType, routeKey]);

    return scrollRef;
}
