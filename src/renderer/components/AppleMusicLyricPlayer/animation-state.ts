export function shouldRunLyricAnimation(
    hasLyricLines: boolean,
    playing: boolean,
    documentVisible: boolean,
): boolean {
    return hasLyricLines && playing && documentVisible;
}

export const MAX_LYRIC_FRAME_DELTA_MS = 48;

/**
 * Keep spring integration stable after a long main-thread frame. The lyric
 * clock still advances to the real playback position; only the visual spring
 * catches up over subsequent frames instead of jumping by the whole stall.
 */
export function getLyricFrameDelta(
    timestamp: number,
    previousTimestamp: number,
    maxDeltaMs = MAX_LYRIC_FRAME_DELTA_MS,
): number {
    if (!Number.isFinite(timestamp) || !Number.isFinite(previousTimestamp)) {
        return 0;
    }
    if (previousTimestamp <= 0 || timestamp <= previousTimestamp) {
        return 0;
    }
    return Math.min(timestamp - previousTimestamp, Math.max(0, maxDeltaMs));
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
