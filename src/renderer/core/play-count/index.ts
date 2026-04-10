import { getMediaPrimaryKey } from "@/common/media-util";
import { getUserPreferenceIDB, setUserPreferenceIDB } from "@/renderer/utils/user-perference";

let playCountMap: Record<string, number> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function setupPlayCount() {
    const stored = await getUserPreferenceIDB("playCountMap");
    if (stored) {
        playCountMap = stored;
    }
}

export function getPlayCount(musicItem: IMusic.IMusicItem): number {
    return playCountMap[getMediaPrimaryKey(musicItem)] ?? 0;
}

export function incrementPlayCount(musicItem: IMusic.IMusicItem) {
    const key = getMediaPrimaryKey(musicItem);
    playCountMap[key] = (playCountMap[key] ?? 0) + 1;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        void setUserPreferenceIDB("playCountMap", playCountMap);
        saveTimer = null;
    }, 2000);
}
