import Store from "@/common/store";
import {
    getUserPreferenceIDB,
    removeUserPreferenceIDB,
} from "@/renderer/utils/user-perference";
import { useMemo } from "react";
import {
    persistListeningStatisticsChanges,
    readListeningStatisticsState,
    replaceListeningStatisticsState,
} from "./database";
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

const SAVE_DELAY_MS = 15_000;

const listeningStatisticsStore = new Store<IListeningStatisticsState>(
    createEmptyListeningStatistics(),
);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingListeningSeconds = 0;
let persistenceGeneration = 0;
let persistenceQueue: Promise<void> = Promise.resolve();
let metaDirty = false;
let lifecycleListenersInstalled = false;
const dirtyEntryKeys = new Set<string>();
const deletedEntryKeys = new Set<string>();

function cancelScheduledSave() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
}

function enqueuePersistence(
    generation: number,
    operation: () => Promise<void>,
) {
    const execution = persistenceQueue.then(async () => {
        if (generation !== persistenceGeneration) {
            return false;
        }
        await operation();
        return generation === persistenceGeneration;
    });
    persistenceQueue = execution.then(() => undefined, () => undefined);
    return execution;
}

function schedulePersistence() {
    if (saveTimer) {
        return;
    }
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void flushListeningStatistics();
    }, SAVE_DELAY_MS);
}

function markEntryChanges(
    previousState: IListeningStatisticsState,
    nextState: IListeningStatisticsState,
    changedKey: string,
) {
    dirtyEntryKeys.add(changedKey);
    deletedEntryKeys.delete(changedKey);

    if (
        previousState.entries[changedKey]
        || Object.keys(nextState.entries).length > Object.keys(previousState.entries).length
    ) {
        return;
    }

    Object.keys(previousState.entries).forEach((key) => {
        if (!nextState.entries[key]) {
            dirtyEntryKeys.delete(key);
            deletedEntryKeys.add(key);
        }
    });
}

function installLifecycleFlush() {
    if (lifecycleListenersInstalled || typeof window === "undefined") {
        return;
    }
    lifecycleListenersInstalled = true;
    const flush = () => {
        void flushListeningStatistics();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            flush();
        }
    });
}

export async function setupListeningStatistics() {
    const generation = ++persistenceGeneration;
    cancelScheduledSave();
    pendingListeningSeconds = 0;
    metaDirty = false;
    dirtyEntryKeys.clear();
    deletedEntryKeys.clear();
    installLifecycleFlush();

    await persistenceQueue;

    const [databaseState, storedStatistics, recentlyPlayed, playCountMap] =
        await Promise.all([
            readListeningStatisticsState().catch(() => null),
            getUserPreferenceIDB("listeningStatistics"),
            getUserPreferenceIDB("recentlyPlayList"),
            getUserPreferenceIDB("playCountMap"),
        ]);
    if (generation !== persistenceGeneration) {
        return;
    }

    const normalizedDatabaseState = normalizeListeningStatistics(databaseState);
    const normalizedLegacyState = normalizeListeningStatistics(storedStatistics);
    const statistics = normalizedDatabaseState
        ?? normalizedLegacyState
        ?? migrateLegacyListeningStatistics(recentlyPlayed ?? [], playCountMap ?? {});

    listeningStatisticsStore.setValue(statistics);

    const persistedVersion = (databaseState as { version?: unknown } | null)?.version;
    if (!normalizedDatabaseState || persistedVersion !== statistics.version) {
        await enqueuePersistence(generation, () =>
            replaceListeningStatisticsState(statistics));
    }

    if (generation === persistenceGeneration) {
        await Promise.all([
            removeUserPreferenceIDB("listeningStatistics"),
            removeUserPreferenceIDB("recentlyPlayList"),
            removeUserPreferenceIDB("playCountMap"),
        ]);
    }
}

export function recordPlayback(musicItem: IMusic.IMusicItem) {
    const previousState = listeningStatisticsStore.getValue();
    const nextState = recordListeningStatistics(previousState, musicItem);
    if (nextState === previousState) {
        return;
    }

    const key = getListeningStatisticsKey(musicItem);
    markEntryChanges(previousState, nextState, key);
    metaDirty = true;
    listeningStatisticsStore.setValue(nextState);
    schedulePersistence();
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
    metaDirty = true;
    schedulePersistence();
}

export function getPlayCount(musicItem: IMusic.IMusicItem) {
    const key = getListeningStatisticsKey(musicItem);
    return listeningStatisticsStore.getValue().entries[key]?.playCount ?? 0;
}

export async function flushListeningStatistics() {
    cancelScheduledSave();
    if (!metaDirty && !dirtyEntryKeys.size && !deletedEntryKeys.size) {
        return;
    }

    const generation = persistenceGeneration;
    const state = listeningStatisticsStore.getValue();
    const dirtyKeys = new Set(dirtyEntryKeys);
    const deletedKeys = new Set(deletedEntryKeys);
    metaDirty = false;
    dirtyEntryKeys.clear();
    deletedEntryKeys.clear();

    try {
        await enqueuePersistence(generation, () =>
            persistListeningStatisticsChanges(state, dirtyKeys, deletedKeys));
    } catch {
        if (generation === persistenceGeneration) {
            metaDirty = true;
            dirtyKeys.forEach((key) => dirtyEntryKeys.add(key));
            deletedKeys.forEach((key) => deletedEntryKeys.add(key));
            schedulePersistence();
        }
    }
}

export async function clearListeningStatistics() {
    const generation = ++persistenceGeneration;
    cancelScheduledSave();
    pendingListeningSeconds = 0;
    metaDirty = false;
    dirtyEntryKeys.clear();
    deletedEntryKeys.clear();

    const emptyStatistics = createEmptyListeningStatistics();
    listeningStatisticsStore.setValue(emptyStatistics);
    await enqueuePersistence(generation, () =>
        replaceListeningStatisticsState(emptyStatistics));
}

export function useListeningStatistics() {
    const statistics = listeningStatisticsStore.useValue();
    const recentEntries = useMemo(
        () => getRecentListeningEntries(statistics),
        [statistics],
    );
    const mostPlayedEntries = useMemo(
        () => getMostPlayedEntries(statistics),
        [statistics],
    );

    return {
        statistics,
        recentEntries,
        mostPlayedEntries,
    };
}

export type { IListeningStatisticsEntry } from "./model";
