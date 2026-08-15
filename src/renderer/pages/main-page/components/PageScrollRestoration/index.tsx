import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

interface IScrollPosition {
    left: number;
    top: number;
}

const MAX_CACHED_ENTRIES = 64;
const scrollPositions = new Map<string, IScrollPosition>();

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

export default function PageScrollRestoration() {
    const location = useLocation();

    useLayoutEffect(() => {
        const pageContainer = document.querySelector<HTMLElement>("#page-container");
        if (!pageContainer) {
            return;
        }

        const cachedPosition = scrollPositions.get(location.key);
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
                rememberScrollPosition(location.key, {
                    left: pageContainer.scrollLeft,
                    top: pageContainer.scrollTop,
                });
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

            rememberScrollPosition(
                location.key,
                !restorationSettled && cachedPosition
                    ? cachedPosition
                    : {
                        left: pageContainer.scrollLeft,
                        top: pageContainer.scrollTop,
                    },
            );
        };
    }, [location.key]);

    return null;
}
