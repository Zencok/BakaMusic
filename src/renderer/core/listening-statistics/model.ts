export const RECENT_TRACK_LIMIT = 500;
export const STATISTICS_ENTRY_LIMIT = 2000;

export interface IListeningStatisticsEntry {
    musicItem: IMusic.IMusicItem;
    playCount: number;
    firstPlayedAt: number;
    lastPlayedAt: number;
}

export interface IListeningStatisticsState {
    version: 1;
    entries: Record<string, IListeningStatisticsEntry>;
    recentKeys: string[];
    totalPlays: number;
}

export function getListeningStatisticsKey(musicItem: IMusic.IMusicItem) {
    return `${musicItem.platform}@${musicItem.id}`;
}

export function createEmptyListeningStatistics(): IListeningStatisticsState {
    return {
        version: 1,
        entries: {},
        recentKeys: [],
        totalPlays: 0,
    };
}

function isValidMusicItem(musicItem?: IMusic.IMusicItem | null) {
    return !!musicItem?.platform && musicItem.id !== null && musicItem.id !== undefined;
}

function normalizeCount(value: unknown, fallback = 0) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : fallback;
}

function normalizeTimestamp(value: unknown, fallback: number) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

export function normalizeListeningStatistics(
    value: unknown,
    now = Date.now(),
): IListeningStatisticsState | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const candidate = value as Partial<IListeningStatisticsState>;
    if (!candidate.entries || typeof candidate.entries !== "object") {
        return null;
    }

    const entries: Record<string, IListeningStatisticsEntry> = {};
    Object.values(candidate.entries).forEach((entry) => {
        if (!entry || !isValidMusicItem(entry.musicItem)) {
            return;
        }

        const key = getListeningStatisticsKey(entry.musicItem);
        const lastPlayedAt = normalizeTimestamp(entry.lastPlayedAt, now);
        entries[key] = {
            musicItem: entry.musicItem,
            playCount: Math.max(1, normalizeCount(entry.playCount, 1)),
            firstPlayedAt: normalizeTimestamp(entry.firstPlayedAt, lastPlayedAt),
            lastPlayedAt,
        };
    });

    const recentKeys = Array.from(new Set(candidate.recentKeys ?? []))
        .filter((key) => !!entries[key])
        .sort((left, right) => entries[right].lastPlayedAt - entries[left].lastPlayedAt)
        .slice(0, RECENT_TRACK_LIMIT);
    const countedTotal = Object.values(entries)
        .reduce((total, entry) => total + entry.playCount, 0);

    return pruneListeningStatistics({
        version: 1,
        entries,
        recentKeys,
        totalPlays: Math.max(countedTotal, normalizeCount(candidate.totalPlays)),
    });
}

export function migrateLegacyListeningStatistics(
    recentlyPlayed: IMusic.IMusicItem[] = [],
    playCountMap: Record<string, number> = {},
    now = Date.now(),
): IListeningStatisticsState {
    const state = createEmptyListeningStatistics();

    recentlyPlayed.forEach((musicItem, index) => {
        if (!isValidMusicItem(musicItem)) {
            return;
        }

        const key = getListeningStatisticsKey(musicItem);
        if (state.entries[key]) {
            return;
        }

        const timestamp = now - index * 1000;
        const playCount = Math.max(1, normalizeCount(playCountMap[key], 1));
        state.entries[key] = {
            musicItem,
            playCount,
            firstPlayedAt: timestamp,
            lastPlayedAt: timestamp,
        };
        state.recentKeys.push(key);
        state.totalPlays += playCount;
    });

    return pruneListeningStatistics(state);
}

export function recordListeningStatistics(
    state: IListeningStatisticsState,
    musicItem: IMusic.IMusicItem,
    now = Date.now(),
): IListeningStatisticsState {
    if (!isValidMusicItem(musicItem)) {
        return state;
    }

    const key = getListeningStatisticsKey(musicItem);
    const previousEntry = state.entries[key];
    const entries = {
        ...state.entries,
        [key]: {
            musicItem: previousEntry
                ? { ...previousEntry.musicItem, ...musicItem }
                : musicItem,
            playCount: (previousEntry?.playCount ?? 0) + 1,
            firstPlayedAt: previousEntry?.firstPlayedAt ?? now,
            lastPlayedAt: now,
        },
    };
    const recentKeys = [
        key,
        ...state.recentKeys.filter((recentKey) => recentKey !== key),
    ].slice(0, RECENT_TRACK_LIMIT);

    return pruneListeningStatistics({
        version: 1,
        entries,
        recentKeys,
        totalPlays: state.totalPlays + 1,
    });
}

export function getRecentListeningEntries(state: IListeningStatisticsState) {
    return state.recentKeys
        .map((key) => state.entries[key])
        .filter((entry): entry is IListeningStatisticsEntry => !!entry);
}

export function getMostPlayedEntries(state: IListeningStatisticsState) {
    return Object.values(state.entries).sort((left, right) =>
        right.playCount - left.playCount || right.lastPlayedAt - left.lastPlayedAt,
    );
}

function pruneListeningStatistics(
    state: IListeningStatisticsState,
): IListeningStatisticsState {
    const allEntries = Object.entries(state.entries);
    if (allEntries.length <= STATISTICS_ENTRY_LIMIT) {
        return state;
    }

    const recentKeys = state.recentKeys.slice(0, RECENT_TRACK_LIMIT);
    const keepKeys = new Set(recentKeys);
    allEntries
        .filter(([key]) => !keepKeys.has(key))
        .sort(([, left], [, right]) =>
            right.playCount - left.playCount || right.lastPlayedAt - left.lastPlayedAt,
        )
        .slice(0, STATISTICS_ENTRY_LIMIT - keepKeys.size)
        .forEach(([key]) => keepKeys.add(key));

    const entries = Object.fromEntries(
        allEntries.filter(([key]) => keepKeys.has(key)),
    );

    return {
        ...state,
        entries,
        recentKeys: recentKeys.filter((key) => !!entries[key]),
    };
}
