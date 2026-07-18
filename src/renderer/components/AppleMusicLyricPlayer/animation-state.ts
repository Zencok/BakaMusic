export function shouldRunLyricAnimation(
    hasLyricLines: boolean,
    playing: boolean,
    documentVisible: boolean,
): boolean {
    return hasLyricLines && playing && documentVisible;
}
