import { appWindowUtil } from "@shared/utils/renderer";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef } from "react";

export type FramelessResizeAxis = "x" | "y" | "xy";

interface IResizeState {
    axis: FramelessResizeAxis;
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    startWidth: number;
    startHeight: number;
}

interface IUseFramelessWindowResizeOptions {
    disabled?: boolean;
}

export default function useFramelessWindowResize(options: IUseFramelessWindowResizeOptions = {}) {
    const { disabled = false } = options;
    const resizeStateRef = useRef<IResizeState | null>(null);

    const resizeWindowByScreenPoint = useCallback((screenX: number, screenY: number) => {
        const resizeState = resizeStateRef.current;
        if (!resizeState) {
            return;
        }

        const deltaX = screenX - resizeState.startScreenX;
        const deltaY = screenY - resizeState.startScreenY;

        let nextWidth = resizeState.startWidth;
        let nextHeight = resizeState.startHeight;

        if (resizeState.axis === "x" || resizeState.axis === "xy") {
            nextWidth = resizeState.startWidth + deltaX;
        }

        if (resizeState.axis === "y" || resizeState.axis === "xy") {
            nextHeight = resizeState.startHeight + deltaY;
        }

        appWindowUtil.setCurrentWindowSize(
            Math.round(nextWidth),
            Math.round(nextHeight),
        );
    }, []);

    const removeWindowListenersRef = useRef<() => void>(() => undefined);

    const clearWindowListeners = useCallback(() => {
        removeWindowListenersRef.current();
        removeWindowListenersRef.current = () => undefined;
    }, []);

    const stopResizeByPointerId = useCallback((pointerId?: number) => {
        const resizeState = resizeStateRef.current;
        if (typeof pointerId === "number" && resizeState && resizeState.pointerId !== pointerId) {
            return;
        }

        resizeStateRef.current = null;
        clearWindowListeners();
    }, [clearWindowListeners]);

    const handleWindowPointerMove = useCallback((event: PointerEvent) => {
        const resizeState = resizeStateRef.current;
        if (!resizeState || resizeState.pointerId !== event.pointerId) {
            return;
        }

        if (event.pointerType === "mouse" && !(event.buttons & 1)) {
            appWindowUtil.stopCurrentWindowResize();
            stopResizeByPointerId(event.pointerId);
            return;
        }

        resizeWindowByScreenPoint(event.screenX, event.screenY);
        event.preventDefault();
        event.stopPropagation();
    }, [resizeWindowByScreenPoint, stopResizeByPointerId]);

    const handleWindowPointerEnd = useCallback((event: PointerEvent) => {
        appWindowUtil.stopCurrentWindowResize();
        stopResizeByPointerId(event.pointerId);
    }, [stopResizeByPointerId]);

    const handleWindowBlur = useCallback(() => {
        appWindowUtil.stopCurrentWindowResize();
        stopResizeByPointerId();
    }, [stopResizeByPointerId]);

    const bindWindowListeners = useCallback(() => {
        clearWindowListeners();
        window.addEventListener("pointermove", handleWindowPointerMove, true);
        window.addEventListener("pointerup", handleWindowPointerEnd, true);
        window.addEventListener("pointercancel", handleWindowPointerEnd, true);
        window.addEventListener("blur", handleWindowBlur, true);

        removeWindowListenersRef.current = () => {
            window.removeEventListener("pointermove", handleWindowPointerMove, true);
            window.removeEventListener("pointerup", handleWindowPointerEnd, true);
            window.removeEventListener("pointercancel", handleWindowPointerEnd, true);
            window.removeEventListener("blur", handleWindowBlur, true);
        };
    }, [clearWindowListeners, handleWindowBlur, handleWindowPointerEnd, handleWindowPointerMove]);

    const startResize = useCallback(
        async (axis: FramelessResizeAxis, event: ReactPointerEvent<HTMLElement>) => {
            if (disabled || event.button !== 0) {
                return;
            }

            const pointerId = event.pointerId;
            const screenX = event.screenX;
            const screenY = event.screenY;
            const currentTarget = event.currentTarget;

            currentTarget.setPointerCapture(pointerId);
            resizeStateRef.current = {
                axis,
                pointerId,
                startScreenX: screenX,
                startScreenY: screenY,
                startWidth: window.innerWidth,
                startHeight: window.innerHeight,
            };
            appWindowUtil.startCurrentWindowResize({
                axis,
                startScreenX: screenX,
                startScreenY: screenY,
                startWidth: window.innerWidth,
                startHeight: window.innerHeight,
            });
            bindWindowListeners();
            event.preventDefault();
            event.stopPropagation();
        },
        [bindWindowListeners, disabled],
    );

    const resizeWindow = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const resizeState = resizeStateRef.current;
        if (!resizeState || resizeState.pointerId !== event.pointerId) {
            return;
        }

        resizeWindowByScreenPoint(event.screenX, event.screenY);

        event.preventDefault();
        event.stopPropagation();
    }, [resizeWindowByScreenPoint]);

    const stopResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const resizeState = resizeStateRef.current;
        if (!resizeState || resizeState.pointerId !== event.pointerId) {
            return;
        }

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        appWindowUtil.stopCurrentWindowResize();
        stopResizeByPointerId(event.pointerId);
    }, [stopResizeByPointerId]);

    const cancelResize = useCallback(() => {
        appWindowUtil.stopCurrentWindowResize();
        stopResizeByPointerId();
    }, [stopResizeByPointerId]);

    useEffect(() => cancelResize, [cancelResize]);

    return {
        startResize,
        resizeWindow,
        stopResize,
        cancelResize,
    };
}
