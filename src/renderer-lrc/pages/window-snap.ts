export interface IWindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface IWindowWorkArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Distance in screen pixels within which a dragged lyric window is magnetized
 * to the horizontal center of its current display.
 */
export const DESKTOP_LYRIC_HORIZONTAL_SNAP_DISTANCE = 16;

function isValidWorkArea(area: IWindowWorkArea | null | undefined): area is IWindowWorkArea {
    return Boolean(
        area
        && Number.isFinite(area.x)
        && Number.isFinite(area.y)
        && Number.isFinite(area.width)
        && Number.isFinite(area.height)
        && area.width > 0
        && area.height > 0,
    );
}

function distanceToWorkArea(
    pointX: number,
    pointY: number,
    area: IWindowWorkArea,
): number {
    const right = area.x + area.width;
    const bottom = area.y + area.height;
    const distanceX = pointX < area.x
        ? area.x - pointX
        : (pointX > right ? pointX - right : 0);
    const distanceY = pointY < area.y
        ? area.y - pointY
        : (pointY > bottom ? pointY - bottom : 0);
    return distanceX * distanceX + distanceY * distanceY;
}

/**
 * Snap a window to the horizontal center of the display it is currently on.
 *
 * The original bounds are returned outside the small snap distance, so users
 * can still place the lyric window at any custom position by dragging farther
 * away from the center.
 */
export function snapWindowBoundsToWorkAreaCenter(
    bounds: IWindowBounds,
    workAreas: readonly IWindowWorkArea[],
    snapDistance = DESKTOP_LYRIC_HORIZONTAL_SNAP_DISTANCE,
): IWindowBounds {
    if (
        !Number.isFinite(bounds.x)
        || !Number.isFinite(bounds.y)
        || !Number.isFinite(bounds.width)
        || !Number.isFinite(bounds.height)
        || bounds.width <= 0
        || bounds.height <= 0
        || !Number.isFinite(snapDistance)
        || snapDistance < 0
    ) {
        return bounds;
    }

    if (!Array.isArray(workAreas) || !workAreas.length) {
        return bounds;
    }

    const validWorkAreas = workAreas.filter(isValidWorkArea);
    if (!validWorkAreas.length) {
        return bounds;
    }

    const windowCenterX = bounds.x + bounds.width / 2;
    const windowCenterY = bounds.y + bounds.height / 2;
    const workArea = validWorkAreas.reduce((nearest, area) => {
        if (!nearest) {
            return area;
        }
        return distanceToWorkArea(windowCenterX, windowCenterY, area)
            < distanceToWorkArea(windowCenterX, windowCenterY, nearest)
            ? area
            : nearest;
    }, validWorkAreas[0]);
    const centeredX = Math.round(workArea.x + (workArea.width - bounds.width) / 2);

    if (Math.abs(bounds.x - centeredX) > snapDistance) {
        return bounds;
    }

    return {
        ...bounds,
        x: centeredX,
    };
}
