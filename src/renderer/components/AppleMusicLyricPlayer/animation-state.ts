export function shouldRunLyricAnimation(
    hasLyricLines: boolean,
    playing: boolean,
    documentVisible: boolean,
): boolean {
    return hasLyricLines && playing && documentVisible;
}

/**
 * AMLL springs use an analytical solver, so advancing them by the real RAF
 * interval preserves the intended duration without numerical instability.
 * Invalid or reset frame anchors intentionally produce no movement.
 */
export function getLyricFrameDelta(
    timestamp: number,
    previousTimestamp: number,
): number {
    if (!Number.isFinite(timestamp) || !Number.isFinite(previousTimestamp)) {
        return 0;
    }
    if (previousTimestamp <= 0 || timestamp <= previousTimestamp) {
        return 0;
    }
    return timestamp - previousTimestamp;
}

/**
 * Advance AMLL springs enough for in-sight lines to enter the DOM while paused.
 * LyricLineGroup only calls show() from update(); without this, startup restore
 * leaves lyrics blank until the play-state RAF loop starts.
 */
export function settlePausedLyricLayout(
    update: (delta: number) => void,
    steps = 8,
    stepDeltaMs = 32,
): void {
    for (let i = 0; i < steps; i++) {
        update(stepDeltaMs);
    }
}
