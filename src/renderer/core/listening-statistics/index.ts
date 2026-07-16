import Store from "@/common/store";
import {
    getUserPreferenceIDB,
    setUserPreferenceIDB,
} from "@/renderer/utils/user-perference";
import {
    createEmptyListeningStatistics,
    getListeningStatisticsKey,
    getMostPlayedEntries,
    getRecentListeningEntries,
    IListeningStatisticsState,
    migrateLegacyListeningStatistics,
    normalizeListeningStatistics,
    recordListeningStatistics,
} from "./model";

const listeningStatisticsStore = new Store<IListeningStatisticsState>(
    createEmptyListeningStatistics(),
);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistStatistics(state: IListeningStatisticsState) {
    if (saveTimer) {
        clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
        void setUserPreferenceIDB("listeningStatistics", state);
        saveTimer = null;
    }, 500);
}

export async function setupListeningStatistics() {
    const [storedStatistics, recentlyPlayed, playCountMap] = await Promise.all([
        getUserPreferenceIDB("listeningStatistics"),
        getUserPreferenceIDB("recentlyPlayList"),
        getUserPreferenceIDB("playCountMap"),
    ]);
    const normalizedStatistics = normalizeListeningStatistics(storedStatistics);
    const statistics = normalizedStatistics ?? migrateLegacyListeningStatistics(
        recentlyPlayed ?? [],
        playCountMap ?? {},
    );

    listeningStatisticsStore.setValue(statistics);
    if (!normalizedStatistics) {
        await setUserPreferenceIDB("listeningStatistics", statistics);
    }
}

export function recordPlayback(musicItem: IMusic.IMusicItem) {
    const nextStatistics = recordListeningStatistics(
        listeningStatisticsStore.getValue(),
        musicItem,
    );
    listeningStatisticsStore.setValue(nextStatistics);
    persistStatistics(nextStatistics);
}

export function getPlayCount(musicItem: IMusic.IMusicItem) {
    const key = getListeningStatisticsKey(musicItem);
    return listeningStatisticsStore.getValue().entries[key]?.playCount ?? 0;
}

export async function clearListeningStatistics() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const emptyStatistics = createEmptyListeningStatistics();
    listeningStatisticsStore.setValue(emptyStatistics);
    await setUserPreferenceIDB("listeningStatistics", emptyStatistics);
}

export function useListeningStatistics() {
    const statistics = listeningStatisticsStore.useValue();

    return {
        statistics,
        recentEntries: getRecentListeningEntries(statistics),
        mostPlayedEntries: getMostPlayedEntries(statistics),
    };
}

export type {
    IListeningStatisticsEntry,
    IListeningStatisticsState,
} from "./model";
