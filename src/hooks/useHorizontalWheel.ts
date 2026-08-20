import { useCallback, useEffect, useRef } from "react";
import type { WheelEvent } from "react";

interface IScrollAnimation {
    frame: number | null;
    rail: HTMLElement | null;
    target: number;
}

/**
 * Map vertical mouse-wheel input to horizontal scrolling for overflowing rails.
 * The event is only consumed when the rail can actually move, so page scrolling
 * remains available when the rail is at either horizontal edge.
 */
export default function useHorizontalWheel<T extends HTMLElement = HTMLElement>() {
    const animation = useRef<IScrollAnimation>({
        frame: null,
        rail: null,
        target: 0,
    });

    useEffect(() => () => {
        if (animation.current.frame !== null) {
            cancelAnimationFrame(animation.current.frame);
        }
    }, []);

    return useCallback((event: WheelEvent<T>) => {
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        const rail = event.currentTarget;
        const maxScrollLeft = rail.scrollWidth - rail.clientWidth;
        if (maxScrollLeft <= 0) {
            return;
        }

        const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY;
        if (!delta) {
            return;
        }

        const currentTarget = animation.current.rail === rail
            ? animation.current.target
            : rail.scrollLeft;
        const nextScrollLeft = Math.min(
            maxScrollLeft,
            Math.max(0, currentTarget + delta),
        );
        if (nextScrollLeft === currentTarget) {
            return;
        }

        event.preventDefault();

        if (
            animation.current.rail !== rail
            && animation.current.frame !== null
        ) {
            cancelAnimationFrame(animation.current.frame);
            animation.current.frame = null;
        }

        animation.current.rail = rail;
        animation.current.target = nextScrollLeft;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            rail.scrollLeft = nextScrollLeft;
            return;
        }

        if (animation.current.frame !== null) {
            return;
        }

        const animate = () => {
            if (animation.current.rail !== rail) {
                animation.current.frame = null;
                return;
            }

            const target = Math.min(
                rail.scrollWidth - rail.clientWidth,
                Math.max(0, animation.current.target),
            );
            const distance = target - rail.scrollLeft;
            if (Math.abs(distance) <= 0.5) {
                rail.scrollLeft = target;
                animation.current.frame = null;
                return;
            }

            // Re-read the target on every frame so rapid wheel input is merged
            // into one continuous easing motion instead of a series of jumps.
            rail.scrollLeft += distance * 0.28;
            animation.current.frame = requestAnimationFrame(animate);
        };

        animation.current.frame = requestAnimationFrame(animate);
    }, []);
}
