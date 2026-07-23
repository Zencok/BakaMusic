/** Convert a lyric line start time (ms) into a seek target in seconds. */
export function lyricStartMsToSeekSeconds(startTimeMs: number): number | null {
    if (!Number.isFinite(startTimeMs)) {
        return null;
    }
    return Math.max(0, startTimeMs) / 1000;
}
