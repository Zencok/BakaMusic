export function shouldPersistPlaybackProgress(
    lastPersistedAt: number,
    currentTime: number,
    force: boolean,
    intervalMs = 3_000,
): boolean {
    return force || currentTime - lastPersistedAt >= intervalMs;
}
