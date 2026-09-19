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

export function mergeImportedTracks(
    existing: IMusic.IMusicItem[],
    incoming: IMusic.IMusicItem[],
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
export function planImportedSheetSync(
    existing: IMusic.IMusicItem[],
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
    const previous = mergeImportedTracks([], existing);
    const previousKeys = new Set(previous.map(importTrackKey));
    const previousOwnership = new Map(validateImportOwnership(ownership, sources).map((entry) => [importTrackKey(entry), entry]));
    const sourceMembership = new Map<string, string[]>();
    const incoming: IMusic.IMusicItem[] = [];
    for (const snapshot of snapshots) {
        const sourceKey = importSourceKey(snapshot.source);
        for (const track of mergeImportedTracks([], snapshot.musicList)) {
            const key = importTrackKey(track);
            const membership = sourceMembership.get(key);
            if (membership) {
                membership.push(sourceKey);
            } else {
                incoming.push(track);
                sourceMembership.set(key, [sourceKey]);
            }
        }
    }
    const isManual = (track: IMusic.IMusicItem) => previousOwnership.get(importTrackKey(track))?.manual ?? true;
    const musicList = mergeImportedTracks(incoming, previous.filter(isManual));
    const nextKeys = new Set(musicList.map(importTrackKey));
    const importOwnership = musicList.map((track): IMusic.ISheetTrackOwnership => ({
        platform: track.platform,
        id: String(track.id),
        manual: previousKeys.has(importTrackKey(track)) && isManual(track),
        sourceKeys: sourceMembership.get(importTrackKey(track)) ?? [],
    }));
    return {
        musicList,
        importOwnership,
        added: musicList.filter((track) => !previousKeys.has(importTrackKey(track))).length,
        removed: previous.filter((track) => !nextKeys.has(importTrackKey(track))).length,
        total: musicList.length,
    };
}
