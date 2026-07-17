export interface IScreenRectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface IForegroundWindowBounds {
    bounds: IScreenRectangle;
    contentBounds: IScreenRectangle;
}

const fullscreenBoundsTolerance = 2;

function isValidRectangle(rectangle: IScreenRectangle) {
    return [
        rectangle.x,
        rectangle.y,
        rectangle.width,
        rectangle.height,
    ].every(Number.isFinite) && rectangle.width > 0 && rectangle.height > 0;
}

function rectangleMatchesDisplay(
    rectangle: IScreenRectangle,
    displayBounds: IScreenRectangle,
) {
    if (!isValidRectangle(rectangle) || !isValidRectangle(displayBounds)) {
        return false;
    }

    return Math.abs(rectangle.x - displayBounds.x) <= fullscreenBoundsTolerance
        && Math.abs(rectangle.y - displayBounds.y) <= fullscreenBoundsTolerance
        && Math.abs(
            rectangle.x + rectangle.width - displayBounds.x - displayBounds.width,
        ) <= fullscreenBoundsTolerance
        && Math.abs(
            rectangle.y + rectangle.height - displayBounds.y - displayBounds.height,
        ) <= fullscreenBoundsTolerance;
}

export function isFullscreenWindowBounds(
    foregroundWindow: IForegroundWindowBounds,
    displays: IScreenRectangle[],
) {
    return displays.some((displayBounds) =>
        rectangleMatchesDisplay(foregroundWindow.bounds, displayBounds)
        && rectangleMatchesDisplay(foregroundWindow.contentBounds, displayBounds),
    );
}
