const RECENT_TRACK_LIMIT = 500;
const STATISTICS_ENTRY_LIMIT = 2000;

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

type ListeningDurationUnit = "second" | "minute" | "hour" | "day" | "month" | "year";

interface IListeningDurationPart {
    unit: ListeningDurationUnit;
    value: number;
}

const LISTENING_DURATION_UNITS: Array<{
    unit: ListeningDurationUnit;
    seconds: number;
}> = [
    { unit: "year", seconds: YEAR },
    { unit: "month", seconds: MONTH },
    { unit: "day", seconds: DAY },
    { unit: "hour", seconds: HOUR },
    { unit: "minute", seconds: MINUTE },
    { unit: "second", seconds: SECOND },
];

export interface IListeningStatisticsEntry {
    musicItem: IMusic.IMusicItem;
    playCount: number;
    firstPlayedAt: number;
    lastPlayedAt: number;
}

export interface IListeningStatisticsState {
    version: 3;
    entries: Record<string, IListeningStatisticsEntry>;
    recentKeys: string[];
    totalPlays: number;
    totalListeningSeconds: number;
}

export function getListeningStatisticsKey(musicItem: IMusic.IMusicItem) {
    return `${musicItem.platform}@${musicItem.id}`;
}

export function createEmptyListeningStatistics(): IListeningStatisticsState {
    return {
        version: 3,
        entries: {},
        recentKeys: [],
        totalPlays: 0,
        totalListeningSeconds: 0,
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

function normalizeListeningSeconds(value: unknown) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
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
        version: 3,
        entries,
        recentKeys,
        totalPlays: Math.max(countedTotal, normalizeCount(candidate.totalPlays)),
        totalListeningSeconds: normalizeListeningSeconds(candidate.totalListeningSeconds),
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
        version: 3,
        entries,
        recentKeys,
        totalPlays: state.totalPlays + 1,
        totalListeningSeconds: state.totalListeningSeconds,
    });
}

export function getRecentListeningEntries(state: IListeningStatisticsState) {
    return state.recentKeys
        .map((key) => state.entries[key])
        .filter((entry): entry is IListeningStatisticsEntry => !!entry);
}

export function addListeningDuration(
    state: IListeningStatisticsState,
    elapsedSeconds: number,
) {
    const seconds = normalizeListeningSeconds(elapsedSeconds);
    if (!seconds) {
        return state;
    }

    return {
        ...state,
        totalListeningSeconds: state.totalListeningSeconds + seconds,
    };
}

export function getActualListeningSeconds(
    previousTime: number,
    currentTime: number,
    elapsedRealSeconds: number,
    playbackRate: number,
) {
    const progressSeconds = currentTime - previousTime;
    if (
        !Number.isFinite(progressSeconds)
        || progressSeconds <= 0
        || !Number.isFinite(elapsedRealSeconds)
        || elapsedRealSeconds <= 0
    ) {
        return 0;
    }

    const normalizedRate = Number.isFinite(playbackRate) && playbackRate > 0
        ? playbackRate
        : 1;
    return Math.min(progressSeconds / normalizedRate, elapsedRealSeconds);
}

export function getListeningDurationParts(totalSeconds: number) {
    let remainingSeconds = normalizeListeningSeconds(totalSeconds);
    const firstUnitIndex = LISTENING_DURATION_UNITS.findIndex(({ seconds }) =>
        remainingSeconds >= seconds,
    );
    const startIndex = firstUnitIndex === -1
        ? LISTENING_DURATION_UNITS.length - 1
        : firstUnitIndex;
    const parts: IListeningDurationPart[] = [];

    for (let index = startIndex; index < LISTENING_DURATION_UNITS.length; index++) {
        const { unit, seconds } = LISTENING_DURATION_UNITS[index];
        const value = Math.floor(remainingSeconds / seconds);
        if (value || parts.length === 0) {
            parts.push({ unit, value });
            remainingSeconds -= value * seconds;
        }
        if (parts.length === 2) {
            break;
        }
    }

    return parts;
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
