export function shouldRunLyricAnimation(
    hasLyricLines: boolean,
    playing: boolean,
    documentVisible: boolean,
): boolean {
    return hasLyricLines && playing && documentVisible;
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
