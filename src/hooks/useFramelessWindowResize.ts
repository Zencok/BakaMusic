import { appWindowUtil } from "@shared/utils/renderer";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef } from "react";

export type FramelessResizeAxis = "x" | "y" | "xy";

interface IResizeState {
    axis: FramelessResizeAxis;
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    /** 窗口左上角屏幕坐标，缩放期间固定，仅右/下边跟随光标 */
    originX: number;
    originY: number;
    startWidth: number;
    startHeight: number;
}

interface IUseFramelessWindowResizeOptions {
    disabled?: boolean;
}

/**
 * 无边框窗口的鼠标缩放。
 *
 * 缩放走与窗口拖动相同的 setCurrentWindowBounds 通道（setBounds 在 transparent
 * 窗口上稳定可用），左上角 x/y 固定、右/下边跟随光标，requestAnimationFrame 节流。
 *
 * 事件驱动用原生 document 监听而非 React onPointerMove：React 18 在 setPointerCapture
 * 之后可能不再派发合成 pointermove；原生监听 + capture 可稳定跟踪（含窗口边界外移动）。
 */
export default function useFramelessWindowResize(options: IUseFramelessWindowResizeOptions = {}) {
    const { disabled = false } = options;
    const resizeStateRef = useRef<IResizeState | null>(null);
    const rafRef = useRef(0);
    const pendingBoundsRef = useRef<Electron.Rectangle | null>(null);
    const detachRef = useRef<() => void>(() => undefined);

    const flushBounds = useCallback(() => {
        rafRef.current = 0;
        const bounds = pendingBoundsRef.current;
        if (bounds) {
            appWindowUtil.setCurrentWindowBounds(bounds);
            pendingBoundsRef.current = null;
        }
    }, []);

    const applyResize = useCallback((screenX: number, screenY: number) => {
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

        pendingBoundsRef.current = {
            x: resizeState.originX,
            y: resizeState.originY,
            width: Math.round(nextWidth),
            height: Math.round(nextHeight),
        };
        if (!rafRef.current) {
            rafRef.current = requestAnimationFrame(flushBounds);
        }
    }, [flushBounds]);

    const endResize = useCallback(() => {
        detachRef.current();
        detachRef.current = () => undefined;

        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
        }

        // 立即落定最后一帧，避免节流丢失收尾尺寸
        const bounds = pendingBoundsRef.current;
        if (bounds) {
            appWindowUtil.setCurrentWindowBounds(bounds);
            pendingBoundsRef.current = null;
        }

        resizeStateRef.current = null;
    }, []);

    const startResize = useCallback(
        async (axis: FramelessResizeAxis, event: ReactPointerEvent<HTMLElement>) => {
            if (disabled || event.button !== 0) {
                return;
            }

            const pointerId = event.pointerId;
            const startScreenX = event.screenX;
            const startScreenY = event.screenY;
            const target = event.currentTarget;
            event.preventDefault();
            event.stopPropagation();

            resizeStateRef.current = {
                axis,
                pointerId,
                startScreenX,
                startScreenY,
                originX: window.screenX,
                originY: window.screenY,
                startWidth: window.innerWidth,
                startHeight: window.innerHeight,
            };

            const handleMove = (moveEvent: PointerEvent) => {
                const resizeState = resizeStateRef.current;
                if (!resizeState || moveEvent.pointerId !== resizeState.pointerId) {
                    return;
                }
                if (moveEvent.pointerType === "mouse" && !(moveEvent.buttons & 1)) {
                    endResize();
                    return;
                }
                applyResize(moveEvent.screenX, moveEvent.screenY);
                moveEvent.preventDefault();
            };
            const handleEnd = (endEvent: PointerEvent) => {
                const resizeState = resizeStateRef.current;
                if (resizeState && endEvent.pointerId !== resizeState.pointerId) {
                    return;
                }
                endResize();
            };

            document.addEventListener("pointermove", handleMove, true);
            document.addEventListener("pointerup", handleEnd, true);
            document.addEventListener("pointercancel", handleEnd, true);
            window.addEventListener("blur", endResize, true);
            detachRef.current = () => {
                document.removeEventListener("pointermove", handleMove, true);
                document.removeEventListener("pointerup", handleEnd, true);
                document.removeEventListener("pointercancel", handleEnd, true);
                window.removeEventListener("blur", endResize, true);
            };

            try {
                // capture 让窗口边界外的移动仍派发到本元素（缩放时光标常移出当前边界）
                target.setPointerCapture(pointerId);
            } catch {
                // 某些场景下可能抛错；document 监听仍可工作，忽略即可
                void 0;
            }

            const bounds = await appWindowUtil.getCurrentWindowBounds();
            const resizeState = resizeStateRef.current;
            if (!bounds || !resizeState || resizeState.pointerId !== pointerId) {
                return;
            }
            resizeStateRef.current = {
                ...resizeState,
                originX: bounds.x,
                originY: bounds.y,
                startWidth: bounds.width,
                startHeight: bounds.height,
            };
        },
        [applyResize, disabled, endResize],
    );

    // React 事件路径（冗余兜底）：主力为上面的 document 监听，二者幂等
    const resizeWindow = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const resizeState = resizeStateRef.current;
        if (!resizeState || resizeState.pointerId !== event.pointerId) {
            return;
        }
        applyResize(event.screenX, event.screenY);
    }, [applyResize]);

    const stopResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const resizeState = resizeStateRef.current;
        if (!resizeState || resizeState.pointerId !== event.pointerId) {
            return;
        }
        endResize();
    }, [endResize]);

    const cancelResize = useCallback(() => {
        endResize();
    }, [endResize]);

    useEffect(() => cancelResize, [cancelResize]);

    return {
        startResize,
        resizeWindow,
        stopResize,
        cancelResize,
    };
}
