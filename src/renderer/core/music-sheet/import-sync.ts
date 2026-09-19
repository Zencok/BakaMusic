/** Pure validation/identity helpers shared by persistence, sync and backups. */
export function validateImportSources(value: unknown): IMusic.IImportedSheetSource[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.length > 100) {
        throw new Error("Invalid import sources");
    }
    return value.map((source) => {
        if (!source || typeof source !== "object"
            || ![source.pluginHash, source.platform, source.input].every(
                (field) => typeof field === "string" && field.trim().length > 0 && field.length <= 1000,
            )) {
            throw new Error("Invalid import source");
        }
        return { pluginHash: source.pluginHash, platform: source.platform, input: source.input.trim() };
    });
}

export function mergeImportSources(
    existing: unknown,
    incoming: unknown,
): IMusic.IImportedSheetSource[] {
    const sources = new Map<string, IMusic.IImportedSheetSource>();
    for (const source of [...validateImportSources(existing), ...validateImportSources(incoming)]) {
        sources.set(JSON.stringify([source.platform, source.input]), source);
    }
    return validateImportSources([...sources.values()]);
}

export function mergeImportedTracks<T extends IMedia.IMediaBase>(
    existing: T[],
    incoming: T[],
) {
    const seen = new Set<string>();
    return [...existing, ...incoming].filter((track) => {
        if (!track || typeof track.platform !== "string" || !track.platform
            || !["string", "number"].includes(typeof track.id)
            || String(track.id).length === 0
            || (typeof track.id === "number" && !Number.isFinite(track.id))) {
            throw new Error("Invalid imported track");
        }
        const key = JSON.stringify([track.platform, String(track.id)]);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

export function importedTracks(result: IPlugin.IImportMusicSheetResult | null) {
    if (result && !Array.isArray(result) && result.notModified === true) {
        throw new Error("A complete cached snapshot is required");
    }
    const tracks = Array.isArray(result) ? result : result?.musicList;
    if (!Array.isArray(tracks)) {
        throw new Error("Invalid import result");
    }
    return mergeImportedTracks([], tracks);
}

export interface IImportSourceSnapshot {
    source: IMusic.IImportedSheetSource;
    musicList: IMusic.IMusicItem[];
}

export function importSourceKey(source: IMusic.IImportedSheetSource) {
    return JSON.stringify([source.platform, source.input.trim()]);
}

export function importTrackKey(track: Pick<IMedia.IMediaBase, "platform" | "id">) {
    return JSON.stringify([track.platform, String(track.id)]);
}

export function validateImportOwnership(
    value: unknown,
    sources: unknown,
): IMusic.ISheetTrackOwnership[] {
    if (value === undefined) {
        return [];
    }
    const sourceKeys = new Set(validateImportSources(sources).map(importSourceKey));
    if (!Array.isArray(value) || value.length > 200_000) {
        throw new Error("Invalid import ownership");
    }
    const seen = new Set<string>();
    return value.map((entry) => {
        if (!entry || typeof entry !== "object"
            || typeof entry.platform !== "string" || !entry.platform || entry.platform.length > 1000
            || typeof entry.id !== "string" || !entry.id || entry.id.length > 1000
            || typeof entry.manual !== "boolean"
            || !Array.isArray(entry.sourceKeys) || entry.sourceKeys.length > 100
            || !entry.sourceKeys.every((key: unknown) => typeof key === "string" && sourceKeys.has(key))
            || (!entry.manual && !entry.sourceKeys.length)) {
            throw new Error("Invalid track ownership");
        }
        const key = importTrackKey(entry);
        if (seen.has(key)) {
            throw new Error("Duplicate track ownership");
        }
        seen.add(key);
        return { platform: entry.platform, id: entry.id, manual: entry.manual, sourceKeys: [...new Set<string>(entry.sourceKeys)] };
    });
}

/** Missing provenance is deliberately treated as manual, including old backups. */
export function planImportedSheetSync<T extends IMedia.IMediaBase>(
    existing: T[],
    ownership: IMusic.ISheetTrackOwnership[] | undefined,
    sources: IMusic.IImportedSheetSource[],
    snapshots: IImportSourceSnapshot[],
) {
    const expected = new Set(validateImportSources(sources).map(importSourceKey));
    const received = new Set(snapshots.map((snapshot) => importSourceKey(snapshot.source)));
    if (!expected.size || expected.size !== received.size || snapshots.length !== received.size
        || [...received].some((key) => !expected.has(key))) {
        throw new Error("Incomplete import snapshots");
    }
    const previous = new Map(existing.map((track) => [importTrackKey(track), track]));
    const previousOwnership = new Map(validateImportOwnership(ownership, sources).map((entry) => [importTrackKey(entry), entry]));
    const next = new Map<string, { track: T | IMusic.IMusicItem; sourceKeys: string[] }>();
    for (const snapshot of snapshots) {
        const sourceKey = importSourceKey(snapshot.source);
        const seen = new Set<string>();
        for (const track of snapshot.musicList) {
            const key = importTrackKey(track);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            const entry = next.get(key);
            if (entry) {
                entry.sourceKeys.push(sourceKey);
            } else {
                next.set(key, { track, sourceKeys: [sourceKey] });
            }
        }
    }
    let removed = 0;
    for (const [key, track] of previous) {
        if (!next.has(key)) {
            if (previousOwnership.get(key)?.manual ?? true) {
                next.set(key, { track, sourceKeys: [] });
            } else {
                removed++;
            }
        }
    }
    let added = 0;
    const musicList: (T | IMusic.IMusicItem)[] = [];
    const importOwnership: IMusic.ISheetTrackOwnership[] = [];
    for (const [key, entry] of next) {
        const existed = previous.has(key);
        if (!existed) {
            added++;
        }
        musicList.push(entry.track);
        importOwnership.push({
            platform: entry.track.platform,
            id: String(entry.track.id),
            manual: existed && (previousOwnership.get(key)?.manual ?? true),
            sourceKeys: entry.sourceKeys,
        });
    }
    return { musicList, importOwnership, added, removed, total: musicList.length };
}
