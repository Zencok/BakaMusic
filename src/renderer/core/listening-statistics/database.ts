import Dexie, { type Table } from "dexie";
import type {
    IListeningStatisticsEntry,
    IListeningStatisticsState,
} from "./model";

interface IListeningStatisticsMeta {
    id: "summary";
    version: IListeningStatisticsState["version"];
    recentKeys: string[];
    totalPlays: number;
    totalListeningSeconds: number;
}

interface IListeningStatisticsEntryRow extends IListeningStatisticsEntry {
    key: string;
}

class ListeningStatisticsDB extends Dexie {
    meta!: Table<IListeningStatisticsMeta, "summary">;
    entries!: Table<IListeningStatisticsEntryRow, string>;

    constructor() {
        super("listeningStatisticsDB");
        this.version(1).stores({
            meta: "&id",
            entries: "&key, playCount, lastPlayedAt",
        });
    }
}

const listeningStatisticsDB = new ListeningStatisticsDB();

function toMeta(state: IListeningStatisticsState): IListeningStatisticsMeta {
    return {
        id: "summary",
        version: state.version,
        recentKeys: state.recentKeys,
        totalPlays: state.totalPlays,
        totalListeningSeconds: state.totalListeningSeconds,
    };
}

function toEntryRows(
    state: IListeningStatisticsState,
    keys: Iterable<string> = Object.keys(state.entries),
) {
    const rows: IListeningStatisticsEntryRow[] = [];
    for (const key of keys) {
        const entry = state.entries[key];
        if (entry) {
            rows.push({ key, ...entry });
        }
    }
    return rows;
}

export async function readListeningStatisticsState() {
    return listeningStatisticsDB.transaction(
        "readonly",
        listeningStatisticsDB.meta,
        listeningStatisticsDB.entries,
        async (): Promise<unknown | null> => {
            const meta = await listeningStatisticsDB.meta.get("summary");
            if (!meta) {
                return null;
            }

            const rows = await listeningStatisticsDB.entries.toArray();
            return {
                version: meta.version,
                recentKeys: meta.recentKeys,
                totalPlays: meta.totalPlays,
                totalListeningSeconds: meta.totalListeningSeconds,
                entries: Object.fromEntries(rows.map(({ key, ...entry }) => [key, entry])),
            };
        },
    );
}

export async function replaceListeningStatisticsState(
    state: IListeningStatisticsState,
) {
    await listeningStatisticsDB.transaction(
        "readwrite",
        listeningStatisticsDB.meta,
        listeningStatisticsDB.entries,
        async () => {
            await listeningStatisticsDB.entries.clear();
            const rows = toEntryRows(state);
            if (rows.length) {
                await listeningStatisticsDB.entries.bulkPut(rows);
            }
            await listeningStatisticsDB.meta.put(toMeta(state));
        },
    );
}

export async function persistListeningStatisticsChanges(
    state: IListeningStatisticsState,
    dirtyKeys: Iterable<string>,
    deletedKeys: Iterable<string>,
) {
    await listeningStatisticsDB.transaction(
        "readwrite",
        listeningStatisticsDB.meta,
        listeningStatisticsDB.entries,
        async () => {
            const removed = [...deletedKeys];
            if (removed.length) {
                await listeningStatisticsDB.entries.bulkDelete(removed);
            }
            const rows = toEntryRows(state, dirtyKeys);
            if (rows.length) {
                await listeningStatisticsDB.entries.bulkPut(rows);
            }
            await listeningStatisticsDB.meta.put(toMeta(state));
        },
    );
}

export default listeningStatisticsDB;
