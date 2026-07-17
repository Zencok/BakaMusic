import Store from "@/common/store";
import {
    getUserPreferenceIDB,
    setUserPreferenceIDB,
} from "@/renderer/utils/user-perference";
import {
    addListeningDuration,
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
let pendingListeningSeconds = 0;

function persistStatistics() {
    if (saveTimer) {
        return;
    }
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void setUserPreferenceIDB(
            "listeningStatistics",
            listeningStatisticsStore.getValue(),
        );
    }, 500);
}

export async function setupListeningStatistics() {
    pendingListeningSeconds = 0;
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
    if (!normalizedStatistics || storedStatistics?.version !== statistics.version) {
        await setUserPreferenceIDB("listeningStatistics", statistics);
    }
}

export function recordPlayback(musicItem: IMusic.IMusicItem) {
    const nextStatistics = recordListeningStatistics(
        listeningStatisticsStore.getValue(),
        musicItem,
    );
    listeningStatisticsStore.setValue(nextStatistics);
    persistStatistics();
}

export function recordListeningDuration(elapsedSeconds: number) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
        return;
    }

    pendingListeningSeconds += elapsedSeconds;
    const completedSeconds = Math.floor(pendingListeningSeconds);
    if (!completedSeconds) {
        return;
    }

    pendingListeningSeconds -= completedSeconds;
    const nextStatistics = addListeningDuration(
        listeningStatisticsStore.getValue(),
        completedSeconds,
    );
    listeningStatisticsStore.setValue(nextStatistics);
    persistStatistics();
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
    pendingListeningSeconds = 0;
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
