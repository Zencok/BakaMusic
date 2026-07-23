export function getLyricLineSeekTimeSeconds(startTimeMs: number): number | null {
    if (!Number.isFinite(startTimeMs)) {
        return null;
    }
    return Math.max(0, startTimeMs) / 1000;
}
