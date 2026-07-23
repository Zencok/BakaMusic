const DRAG_AUTO_SCROLL_EDGE_SIZE = 80;
const DRAG_AUTO_SCROLL_MAX_SPEED = 24;

export function getDragAutoScrollDelta(
    pointerY: number,
    viewportTop: number,
    viewportBottom: number,
) {
    const viewportHeight = viewportBottom - viewportTop;
    if (!Number.isFinite(pointerY) || viewportHeight <= 0) {
        return 0;
    }

    const edgeSize = Math.min(DRAG_AUTO_SCROLL_EDGE_SIZE, viewportHeight / 2);
    const topEdge = viewportTop + edgeSize;
    const bottomEdge = viewportBottom - edgeSize;

    if (pointerY < topEdge) {
        const intensity = Math.min(1, (topEdge - pointerY) / edgeSize);
        return -Math.max(1, Math.round(DRAG_AUTO_SCROLL_MAX_SPEED * intensity));
    }
    if (pointerY > bottomEdge) {
        const intensity = Math.min(1, (pointerY - bottomEdge) / edgeSize);
        return Math.max(1, Math.round(DRAG_AUTO_SCROLL_MAX_SPEED * intensity));
    }
    return 0;
}
