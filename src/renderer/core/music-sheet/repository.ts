import { diffSyncRelations, equalSourceKeys } from "./sync-diff";
/**
 * Database-only music sheet operations. UI-facing state belongs in service.ts.
 */

import {
    MusicSheetSortType,
    localPluginName,
    musicRefSymbol,
    sortIndexSymbol,
    timeStampSymbol,
} from "@/common/constant";
import { getMediaPrimaryKey, isSameMedia } from "@/common/media-util";
import {
    getUserPreferenceIDB,
    setUserPreferenceIDB,
} from "@/renderer/utils/user-perference";
import optimizeArtworkDataUrl, {
    shouldOptimizeArtworkDataUrl,
} from "@/renderer/utils/optimize-artwork-data-url";
import AppConfig from "@shared/app-config/renderer";
import Dexie from "dexie";
import { nanoid } from "nanoid";
import musicSheetDB, {
    type ISheetMusicRelation,
    type IStoredMusicItem,
} from "./database";
import defaultSheet from "./default-sheet";
import {
    mergeImportSources, importSourceKey, importTrackKey, validateImportOwnership,
    planImportedSheetSync, type IImportSourceSnapshot,
} from "./import-sync";
import { normalizeMusicSheetSortType, sortMusicSheetMusicList } from "./sort";

const favoriteMusicListIds = new Set<string>();
let musicSheets: IMusic.IDBMusicSheetItem[] = [];
let starredMusicSheets: IMedia.IMediaBase[] = [];

function stripEmbeddedMusicList(
    sheet: IMusic.IMusicSheetItem | IMusic.IDBMusicSheetItem,
): IMusic.IDBMusicSheetItem {
    const metadata = { ...sheet };
    delete metadata.musicList;
    delete metadata.importOwnership;
    return metadata;
}

function getRelationKey(relation: ISheetMusicRelation) {
    return [relation.sheetId, relation.platform, relation.musicId] as [
        string,
        string,
        string,
    ];
}

function getMusicKey(media: IMedia.IMediaBase) {
    return [media.platform, media.id] as [string, string];
}

function relationToMediaBase(relation: ISheetMusicRelation): IMedia.IMediaBase {
    return {
        platform: relation.platform,
        id: relation.musicId,
        $$addedAt: relation.addedAt,
        $$batchIndex: relation.batchIndex,
    };
}

function relationOwnership(relations: ISheetMusicRelation[]): IMusic.ISheetTrackOwnership[] {
    const ownership = new Map<string, IMusic.ISheetTrackOwnership>();
    for (const relation of relations) {
        const key = importTrackKey(relationToMediaBase(relation));
        const existing = ownership.get(key);
        ownership.set(key, {
            platform: relation.platform,
            id: String(relation.musicId),
            manual: (existing?.manual ?? false) || (relation.manual ?? true),
            sourceKeys: [...new Set([...(existing?.sourceKeys ?? []), ...(relation.sourceKeys ?? [])])],
        });
    }
    return [...ownership.values()];
}

function uniqueMusicItems(musicItems: IMusic.IMusicItem[]) {
    const seen = new Set<string>();
    return musicItems.filter((musicItem) => {
        if (!musicItem?.platform || musicItem.id == null || String(musicItem.id) === "") {
            return false;
        }
        const key = getMediaPrimaryKey(musicItem);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

async function getSheetRelations(sheetId: string) {
    const relations = await musicSheetDB.sheetMusic
        .where("sheetId")
        .equals(sheetId)
        .toArray();
    return relations.sort((left, right) => left.position - right.position);
}

/**
 * 取歌单内 position 最小/最大的那一行（走 [sheetId+position] 索引）。
 * position 只用于排序，不要求连续，因此插入时只需要边界值，不必读全表。
 * 复合键里 [sheetId] 比任何 [sheetId, x] 都小，配合 Dexie.maxKey 即可框住
 * 该歌单的全部行；缺少 position 的老数据不进索引，此时回退到全量读。
 */
async function getSheetBoundaryRelation(sheetId: string, edge: "first" | "last") {
    const collection = musicSheetDB.sheetMusic
        .where("[sheetId+position]")
        .between([sheetId], [sheetId, Dexie.maxKey]);
    const indexed = edge === "first"
        ? await collection.first()
        : await collection.last();
    if (indexed) {
        return indexed;
    }
    const relations = await getSheetRelations(sheetId);
    return edge === "first"
        ? relations[0]
        : relations[relations.length - 1];
}

async function incrementMusicReferences(musicItems: IMusic.IMusicItem[]) {
    if (!musicItems.length) {
        return;
    }
    const storedItems = await musicSheetDB.musicStore.bulkGet(
        musicItems.map(getMusicKey),
    );
    const nextItems = musicItems.map((musicItem, index): IStoredMusicItem => {
        const storedItem = storedItems[index];
        if (storedItem) {
            return {
                ...storedItem,
                [musicRefSymbol]: Math.max(
                    0,
                    Number(storedItem[musicRefSymbol]) || 0,
                ) + 1,
            };
        }
        return {
            ...musicItem,
            [musicRefSymbol]: 1,
        };
    });
    await musicSheetDB.musicStore.bulkPut(nextItems);
}

async function decrementMusicReferences(relations: ISheetMusicRelation[]) {
    if (!relations.length) {
        return;
    }
    const storedItems = await musicSheetDB.musicStore.bulkGet(
        relations.map((relation) => [relation.platform, relation.musicId]),
    );
    const needDelete: Array<[string, string]> = [];
    const needUpdate: IStoredMusicItem[] = [];

    storedItems.forEach((musicItem) => {
        if (!musicItem) {
            return;
        }
        const nextRef = Math.max(
            0,
            (Number(musicItem[musicRefSymbol]) || 0) - 1,
        );
        if (!nextRef) {
            needDelete.push([musicItem.platform, musicItem.id]);
        } else {
            needUpdate.push({
                ...musicItem,
                [musicRefSymbol]: nextRef,
            });
        }
    });

    if (needDelete.length) {
        await musicSheetDB.musicStore.bulkDelete(needDelete);
    }
    if (needUpdate.length) {
        await musicSheetDB.musicStore.bulkPut(needUpdate);
    }
}

async function getRelationArtwork(relation?: ISheetMusicRelation) {
    if (!relation) {
        return "";
    }
    return (
        await musicSheetDB.musicStore.get([relation.platform, relation.musicId])
    )?.artwork ?? "";
}

async function optimizeLocalArtworkItem<T extends {
    platform?: string;
    artwork?: string;
}>(item: T | null | undefined) {
    if (
        !item
        || item.platform !== localPluginName
        || !shouldOptimizeArtworkDataUrl(item.artwork)
    ) {
        return { item, changed: false };
    }

    const optimizedArtwork = await optimizeArtworkDataUrl(item.artwork);
    if (!optimizedArtwork || optimizedArtwork === item.artwork) {
        return { item, changed: false };
    }

    return {
        item: { ...item, artwork: optimizedArtwork },
        changed: true,
    };
}

function attachSheetMusicMeta<T extends IMusic.IMusicItem>(
    musicItem: T | null | undefined,
    relation?: ISheetMusicRelation,
) {
    if (!musicItem) {
        return null;
    }
    const addedAt = relation?.addedAt ?? 0;
    const batchIndex = relation?.batchIndex ?? relation?.position ?? 0;
    // Relation keys are authoritative when a stored row lost id/platform.
    const id = musicItem.id ?? relation?.musicId;
    const platform = musicItem.platform ?? relation?.platform;
    return {
        ...musicItem,
        ...(id !== undefined ? { id } : {}),
        ...(platform !== undefined ? { platform } : {}),
        [timeStampSymbol]: addedAt,
        [sortIndexSymbol]: batchIndex,
        $$addedAt: addedAt,
        $$batchIndex: batchIndex,
    };
}

function updateCachedSheet(
    sheetId: string,
    updates: Partial<IMusic.IDBMusicSheetItem>,
) {
    const index = musicSheets.findIndex((sheet) => sheet.id === sheetId);
    if (index < 0) {
        return;
    }
    const nextSheets = [...musicSheets];
    nextSheets[index] = stripEmbeddedMusicList({
        ...nextSheets[index],
        ...updates,
    });
    musicSheets = nextSheets;
}

export function getAllSheets() {
    return musicSheets;
}

export function getAllStarredSheets() {
    return starredMusicSheets;
}

export async function queryAllSheets() {
    try {
        const storedSheets = (await musicSheetDB.sheets.toArray())
            .map(stripEmbeddedMusicList);
        const defaultSheetIndex = storedSheets.findIndex(
            (item) => item.id === defaultSheet.id,
        );

        if (defaultSheetIndex < 0) {
            const normalizedDefaultSheet = stripEmbeddedMusicList(defaultSheet);
            await musicSheetDB.sheets.put(normalizedDefaultSheet);
            storedSheets.unshift(normalizedDefaultSheet);
        } else {
            if (defaultSheetIndex > 0) {
                const [storedDefaultSheet] = storedSheets.splice(defaultSheetIndex, 1);
                storedSheets.unshift(storedDefaultSheet);
            }
            // Heal legacy rows created before i18n was ready (title was undefined).
            const favoriteSheet = storedSheets[0];
            if (
                favoriteSheet?.id === defaultSheet.id
                && typeof favoriteSheet.title !== "string"
            ) {
                const healedTitle = defaultSheet.title;
                await musicSheetDB.sheets.update(defaultSheet.id, {
                    title: healedTitle,
                });
                storedSheets[0] = {
                    ...favoriteSheet,
                    title: healedTitle,
                };
            }
        }

        musicSheets = storedSheets;
        favoriteMusicListIds.clear();
        const favoriteRelations = await getSheetRelations(defaultSheet.id);
        favoriteRelations.forEach((relation) => {
            favoriteMusicListIds.add(
                getMediaPrimaryKey(relationToMediaBase(relation)),
            );
        });
        return musicSheets;
    } catch {
        return musicSheets;
    }
}

export async function queryAllStarredSheets() {
    try {
        starredMusicSheets =
            (await getUserPreferenceIDB("starredMusicSheets")) || [];
        return starredMusicSheets;
    } catch {
        return [];
    }
}

export async function addSheet(
    sheetName: string,
    options?: { sortType?: IMusic.IMusicSheetSortType | null },
) {
    const id = nanoid();
    const sortType = normalizeMusicSheetSortType(
        options && "sortType" in options
            ? options.sortType
            : AppConfig.getConfig("playMusic.newSheetDefaultSort"),
    );
    const newSheet: IMusic.IDBMusicSheetItem = {
        id,
        title: sheetName,
        createAt: Date.now(),
        platform: localPluginName,
        sortType,
        $$sortIndex:
            (musicSheets[musicSheets.length - 1]?.$$sortIndex ?? -1) + 1,
    };

    await musicSheetDB.sheets.put(newSheet);
    musicSheets = [...musicSheets, newSheet];
    return newSheet;
}

export async function updateSheet(
    sheetId: string,
    newData: Partial<IMusic.IMusicSheetItem>,
) {
    if (!newData) {
        return;
    }
    const metadata = { ...newData };
    delete metadata.musicList;
    delete metadata.importOwnership;
    if (!Object.keys(metadata).length) {
        return;
    }
    await musicSheetDB.sheets.update(sheetId, metadata);
    updateCachedSheet(sheetId, metadata);
}

export async function updateSheetMusicOrder(
    sheetId: string,
    musicList: IMusic.IMusicItem[],
) {
    await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.sheets,
        musicSheetDB.sheetMusic,
        async () => {
            const currentRelations = await getSheetRelations(sheetId);
            const relationMap = new Map(
                currentRelations.map((relation) => [
                    getMediaPrimaryKey(relationToMediaBase(relation)),
                    relation,
                ]),
            );
            const reorderedRelations: ISheetMusicRelation[] = [];
            uniqueMusicItems(musicList).forEach((musicItem) => {
                const relation = relationMap.get(getMediaPrimaryKey(musicItem));
                if (relation) {
                    reorderedRelations.push(relation);
                    relationMap.delete(getMediaPrimaryKey(musicItem));
                }
            });
            reorderedRelations.push(...relationMap.values());
            reorderedRelations.forEach((relation, position) => {
                relation.position = position;
            });
            if (reorderedRelations.length) {
                await musicSheetDB.sheetMusic.bulkPut(reorderedRelations);
            }
            await musicSheetDB.sheets.update(sheetId, {
                sortType: MusicSheetSortType.None,
            });
        },
    );
    updateCachedSheet(sheetId, { sortType: MusicSheetSortType.None });
}

export async function removeSheet(sheetId: string) {
    if (sheetId === defaultSheet.id) {
        return;
    }
    const targetSheet = musicSheets.find((item) => item.id === sheetId);
    if (!targetSheet) {
        return;
    }

    await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.sheets,
        musicSheetDB.musicStore,
        musicSheetDB.sheetMusic,
        async () => {
            const relations = await getSheetRelations(sheetId);
            await decrementMusicReferences(relations);
            await musicSheetDB.sheetMusic.where("sheetId").equals(sheetId).delete();
            await musicSheetDB.sheets.delete(sheetId);
        },
    );
    musicSheets = musicSheets.filter((item) => item.id !== sheetId);
    return musicSheets;
}

export async function clearSheet(sheetId: string) {
    const targetSheet = musicSheets.find((item) => item.id === sheetId);
    if (!targetSheet) {
        return;
    }

    await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.sheets,
        musicSheetDB.musicStore,
        musicSheetDB.sheetMusic,
        async () => {
            const relations = await getSheetRelations(sheetId);
            await decrementMusicReferences(relations);
            await musicSheetDB.sheetMusic.where("sheetId").equals(sheetId).delete();
            await musicSheetDB.sheets.update(sheetId, { artwork: "" });
        },
    );
    updateCachedSheet(sheetId, { artwork: "" });
    if (sheetId === defaultSheet.id) {
        favoriteMusicListIds.clear();
    }
    return musicSheets;
}

// Serialize preference-backed mutations so simultaneous syncs cannot lose a sheet.
let starredMutation: Promise<unknown> = Promise.resolve();
function mutateStarredSheets(update: (sheets: IMedia.IMediaBase[]) => IMedia.IMediaBase[]) {
    const operation = starredMutation.then(async () => {
        const next = update(starredMusicSheets);
        if (next === starredMusicSheets) {
            return;
        }
        await setUserPreferenceIDB("starredMusicSheets", next);
        starredMusicSheets = next;
    });
    starredMutation = operation.catch(() => undefined);
    return operation;
}

export async function starMusicSheet(sheet: IMedia.IMediaBase) {
    await mutateStarredSheets((sheets) => [
        ...sheets.filter((item) => !isSameMedia(item, sheet)),
        sheet,
    ]);
}

export async function unstarMusicSheet(sheet: IMedia.IMediaBase) {
    await mutateStarredSheets((sheets) => sheets.filter((item) => !isSameMedia(item, sheet)));
}

export async function setStarredMusicSheets(sheets: IMedia.IMediaBase[]) {
    await mutateStarredSheets(() => sheets);
}

export async function replaceStarredImportedSheet(
    sheet: IMedia.IMediaBase,
    sources: IMusic.IImportedSheetSource[],
    snapshots: IImportSourceSnapshot[],
) {
    let result = { added: 0, removed: 0, total: 0, changed: false };
    await mutateStarredSheets((sheets) => {
        const index = sheets.findIndex((item) => isSameMedia(item, sheet));
        const current = sheets[index] as IMusic.IMusicSheetItem | undefined;
        if (!current || JSON.stringify(current.importSources) !== JSON.stringify(sources)) {
            throw new Error("Sheet or import sources changed during sync");
        }
        const plan = planImportedSheetSync(current.musicList ?? [], current.importOwnership, sources, snapshots);
        const sameOwnership = current.importOwnership?.length === plan.importOwnership.length
            && current.importOwnership.every((entry, index) => {
                const next = plan.importOwnership[index];
                return importTrackKey(entry) === importTrackKey(next) && entry.manual === next.manual
                    && equalSourceKeys(entry.sourceKeys, next.sourceKeys);
            });
        const changed = !sameOwnership || current.worksNum !== plan.total
            || JSON.stringify(current.musicList) !== JSON.stringify(plan.musicList);
        result = { added: plan.added, removed: plan.removed, total: plan.total, changed };
        if (!changed) {
            return sheets;
        }
        const next = [...sheets];
        next[index] = { ...current, musicList: plan.musicList, importOwnership: plan.importOwnership, worksNum: plan.total };
        return next;
    });
    return result;
}

export async function addMusicToSheet(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
    sheetId: string,
    importSources?: IMusic.IImportedSheetSource[],
    importOwnership?: IMusic.ISheetTrackOwnership[],
) {
    const targetSheet = musicSheets.find((item) => item.id === sheetId);
    if (!targetSheet) {
        return;
    }
    const candidates = uniqueMusicItems(
        Array.isArray(musicItems) ? musicItems : [musicItems],
    );
    if (!candidates.length && !importSources?.length) {
        return musicSheets;
    }

    const suppliedOwnership = new Map(validateImportOwnership(importOwnership, importSources).map((entry) => [importTrackKey(entry), entry]));
    const incomingOwnership = (track: IMusic.IMusicItem) => {
        if (!importSources?.length) {
            return { manual: true, sourceKeys: [] as string[] };
        }
        return suppliedOwnership.get(importTrackKey(track)) ?? {
            // Single-source imports are unambiguous; old multi-source copies are not.
            manual: importSources.length !== 1,
            sourceKeys: importSources.length === 1 ? [importSourceKey(importSources[0])] : [],
        };
    };
    let nextSources = targetSheet.importSources;
    let addedMusicItems: IMusic.IMusicItem[] = [];
    let nextArtwork = targetSheet.artwork ?? "";
    await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.sheets,
        musicSheetDB.musicStore,
        musicSheetDB.sheetMusic,
        async () => {
            const currentSheet = await musicSheetDB.sheets.get(sheetId);
            if (!currentSheet) {
                throw new Error("Sheet no longer exists");
            }
            nextSources = currentSheet.importSources;
            if (importSources?.length) {
                nextSources = mergeImportSources(currentSheet.importSources, importSources);
                await musicSheetDB.sheets.update(sheetId, { importSources: nextSources });
            }
            // Probe both scalar ID representations without scanning a large playlist.
            const relationKeys = candidates.flatMap((musicItem) => {
                const ids = new Set<string | number>([musicItem.id, String(musicItem.id)]);
                const numericId = Number(musicItem.id);
                if (Number.isFinite(numericId) && String(numericId) === String(musicItem.id)) {
                    ids.add(numericId);
                }
                return [...ids].map((id) => [sheetId, musicItem.platform, id] as [string, string, string]);
            });
            const existingRelations = await musicSheetDB.sheetMusic.bulkGet(relationKeys);
            const relevantRelations = existingRelations.filter((relation): relation is ISheetMusicRelation => Boolean(relation));
            const existingByKey = new Map<string, ISheetMusicRelation[]>();
            relevantRelations.forEach((relation) => {
                const key = importTrackKey(relationToMediaBase(relation));
                existingByKey.set(key, [...(existingByKey.get(key) ?? []), relation]);
            });
            const ownershipUpdates: ISheetMusicRelation[] = [];
            for (const track of candidates) {
                const incoming = incomingOwnership(track);
                for (const relation of existingByKey.get(importTrackKey(track)) ?? []) {
                    ownershipUpdates.push({
                        ...relation,
                        manual: (relation.manual ?? true) || incoming.manual,
                        sourceKeys: [...new Set([...(relation.sourceKeys ?? []), ...incoming.sourceKeys])],
                    });
                }
            }
            if (ownershipUpdates.length) {
                await musicSheetDB.sheetMusic.bulkPut(ownershipUpdates);
            }
            addedMusicItems = candidates.filter((track) => !existingByKey.has(importTrackKey(track)));
            if (!addedMusicItems.length) {
                return;
            }

            const insertAtTop = normalizeMusicSheetSortType(targetSheet.sortType)
                === MusicSheetSortType.None;
            // 置顶插入原来会把整张歌单的关系行全部 +N 再 bulkPut——收藏一首歌
            // 等于重写全表（1 万首 = 1 万次写）。position 只用于排序，允许稀疏
            // 甚至负值，所以只取边界值向外扩展即可。
            const boundaryRelation = await getSheetBoundaryRelation(
                sheetId,
                insertAtTop ? "first" : "last",
            );

            const addedAt = Date.now();
            const startPosition = boundaryRelation
                ? (insertAtTop
                    ? boundaryRelation.position - addedMusicItems.length
                    : boundaryRelation.position + 1)
                : 0;
            const newRelations = addedMusicItems.map((musicItem, index) => ({
                sheetId,
                platform: musicItem.platform,
                musicId: musicItem.id,
                position: startPosition + index,
                addedAt,
                batchIndex: index,
                manual: incomingOwnership(musicItem).manual,
                sourceKeys: incomingOwnership(musicItem).sourceKeys,
            }));

            await incrementMusicReferences(addedMusicItems);
            await musicSheetDB.sheetMusic.bulkAdd(newRelations);
            nextArtwork = addedMusicItems[addedMusicItems.length - 1]?.artwork
                ?? nextArtwork;
            await musicSheetDB.sheets.update(sheetId, { artwork: nextArtwork });
        },
    );

    updateCachedSheet(sheetId, { importSources: nextSources });
    if (!addedMusicItems.length) {
        return musicSheets;
    }
    updateCachedSheet(sheetId, { artwork: nextArtwork });
    if (sheetId === defaultSheet.id) {
        addedMusicItems.forEach((musicItem) => {
            favoriteMusicListIds.add(getMediaPrimaryKey(musicItem));
        });
    }
    return musicSheets;
}

/** Compare identities/ownership only; commit just the changed rows and entity references. */
export async function replaceImportedSheetMusic(
    sheetId: string,
    sources: IMusic.IImportedSheetSource[],
    snapshots: IImportSourceSnapshot[],
) {
    let result = { added: 0, removed: 0, total: 0, changed: false };
    const metrics = { readMs: 0, planMs: 0, writeMs: 0, relationsWritten: 0 };
    let addedTracks: IMusic.IMusicItem[] = [];
    let removedRelations: ISheetMusicRelation[] = [];
    let retainedFavoriteKeys = new Set<string>();
    await musicSheetDB.transaction(
        "readwrite", musicSheetDB.sheets, musicSheetDB.musicStore, musicSheetDB.sheetMusic,
        async () => {
            const readStarted = performance.now();
            const sheet = await musicSheetDB.sheets.get(sheetId);
            if (!sheet || JSON.stringify(sheet.importSources) !== JSON.stringify(sources)) {
                throw new Error("Sheet or import sources changed during sync");
            }
            const previous = await getSheetRelations(sheetId);
            metrics.readMs = performance.now() - readStarted;
            const planStarted = performance.now();
            const plan = planImportedSheetSync(previous.map(relationToMediaBase), relationOwnership(previous), sources, snapshots);
            const diff = diffSyncRelations(sheetId, previous, plan.musicList, plan.importOwnership);
            if (sheetId === defaultSheet.id) {
                retainedFavoriteKeys = new Set(plan.musicList.map(getMediaPrimaryKey));
            }
            const addedKeys = new Set(diff.inserted.map((row) => importTrackKey(relationToMediaBase(row))));
            // New identities always come from a fetched snapshot, not from lightweight existing rows.
            addedTracks = plan.musicList.filter((track): track is IMusic.IMusicItem => addedKeys.has(importTrackKey(track)));
            removedRelations = diff.deleted;
            metrics.relationsWritten = diff.inserted.length + diff.updated.length + diff.deleted.length;
            metrics.planMs = performance.now() - planStarted;
            result = { added: plan.added, removed: plan.removed, total: plan.total, changed: metrics.relationsWritten > 0 };
            const writeStarted = performance.now();
            await decrementMusicReferences(diff.deleted);
            await incrementMusicReferences(addedTracks);
            if (diff.deleted.length) {
                await musicSheetDB.sheetMusic.bulkDelete(diff.deleted.map(getRelationKey));
            }
            if (diff.inserted.length) {
                await musicSheetDB.sheetMusic.bulkAdd(diff.inserted);
            }
            if (diff.updated.length) {
                await musicSheetDB.sheetMusic.bulkPut(diff.updated);
            }
            metrics.writeMs = performance.now() - writeStarted;
        },
    );
    if (sheetId === defaultSheet.id) {
        removedRelations.forEach((row) => {
            const key = getMediaPrimaryKey(relationToMediaBase(row));
            if (!retainedFavoriteKeys.has(key)) {
                favoriteMusicListIds.delete(key);
            }
        });
        addedTracks.forEach((track) => favoriteMusicListIds.add(getMediaPrimaryKey(track)));
    }
    return { ...result, metrics };
}

export async function removeMusicFromSheet(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
    sheetId: string,
) {
    const targetSheet = musicSheets.find((item) => item.id === sheetId);
    if (!targetSheet) {
        return;
    }
    const removeKeys = new Set(
        (Array.isArray(musicItems) ? musicItems : [musicItems])
            .map(getMediaPrimaryKey),
    );
    if (!removeKeys.size) {
        return;
    }

    const removedRelations: ISheetMusicRelation[] = [];
    let nextArtwork = "";
    await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.sheets,
        musicSheetDB.musicStore,
        musicSheetDB.sheetMusic,
        async () => {
            const currentRelations = await getSheetRelations(sheetId);
            const retainedRelations: ISheetMusicRelation[] = [];
            currentRelations.forEach((relation) => {
                if (removeKeys.has(getMediaPrimaryKey(relationToMediaBase(relation)))) {
                    removedRelations.push(relation);
                } else {
                    retainedRelations.push(relation);
                }
            });
            if (!removedRelations.length) {
                return;
            }

            await decrementMusicReferences(removedRelations);
            await musicSheetDB.sheetMusic.bulkDelete(
                removedRelations.map(getRelationKey),
            );
            // 不再把保留下来的行重新密集编号：position 只需保持相对顺序，
            // 留空隙即可，省下每次删除一首歌就重写全表的开销。
            nextArtwork = await getRelationArtwork(
                retainedRelations[retainedRelations.length - 1],
            );
            await musicSheetDB.sheets.update(sheetId, { artwork: nextArtwork });
        },
    );

    if (!removedRelations.length) {
        return;
    }
    updateCachedSheet(sheetId, { artwork: nextArtwork });
    if (sheetId === defaultSheet.id) {
        removedRelations.forEach((relation) => {
            favoriteMusicListIds.delete(
                getMediaPrimaryKey(relationToMediaBase(relation)),
            );
        });
    }
}

export async function getSheetItemDetail(
    sheetId: string,
): Promise<IMusic.IMusicSheetItem | null> {
    const targetSheet = musicSheets.find((item) => item.id === sheetId);
    if (!targetSheet) {
        return null;
    }

    const { relations, storedMusicItems } = await musicSheetDB.transaction(
        "readonly",
        musicSheetDB.sheetMusic,
        musicSheetDB.musicStore,
        async () => {
            const sheetRelations = await getSheetRelations(sheetId);
            const musicItems: Array<IStoredMusicItem | undefined> = [];
            const groupSize = 800;
            for (let offset = 0; offset < sheetRelations.length; offset += groupSize) {
                const relationGroup = sheetRelations.slice(offset, offset + groupSize);
                musicItems.push(...await musicSheetDB.musicStore.bulkGet(
                    relationGroup.map((relation) => [
                        relation.platform,
                        relation.musicId,
                    ]),
                ));
            }
            return { relations: sheetRelations, storedMusicItems: musicItems };
        },
    );

    const changedMusicItems: IStoredMusicItem[] = [];
    const detailedMusicItemsWithEmpty = await Promise.all(
        storedMusicItems.map(async (musicItem, index) => {
            const optimized = await optimizeLocalArtworkItem(musicItem);
            if (optimized.changed && optimized.item) {
                changedMusicItems.push(optimized.item);
            }
            return attachSheetMusicMeta(optimized.item, relations[index]);
        }),
    );
    const detailedMusicItems = detailedMusicItemsWithEmpty.filter(
        Boolean,
    ) as IMusic.IMusicItem[];

    if (changedMusicItems.length) {
        await musicSheetDB.musicStore.bulkPut(changedMusicItems);
    }

    const optimizedSheet = await optimizeLocalArtworkItem(targetSheet);
    if (optimizedSheet.changed && optimizedSheet.item) {
        await musicSheetDB.sheets.update(sheetId, {
            artwork: optimizedSheet.item.artwork,
        });
        updateCachedSheet(sheetId, { artwork: optimizedSheet.item.artwork });
    }

    return {
        ...(optimizedSheet.item ?? targetSheet),
        importOwnership: relationOwnership(relations),
        musicList: sortMusicSheetMusicList(
            detailedMusicItems,
            targetSheet.sortType,
        ),
    };
}

export function isFavoriteMusic(musicItem: IMusic.IMusicItem) {
    return favoriteMusicListIds.has(getMediaPrimaryKey(musicItem));
}

export async function exportAllSheetDetails() {
    const details = await Promise.all(
        musicSheets.map((sheet) => getSheetItemDetail(sheet.id)),
    );
    return details.filter(
        (sheet): sheet is IMusic.IMusicSheetItem => Boolean(sheet),
    );
}

async function writeImportedSheet(
    sourceSheet: IMusic.IMusicSheetItem,
    sheetId: string,
    sortIndex: number,
) {
    const musicItems = uniqueMusicItems(sourceSheet.musicList ?? []);
    const ownership = new Map(validateImportOwnership(sourceSheet.importOwnership, sourceSheet.importSources).map((entry) => [importTrackKey(entry), entry]));
    const metadata = stripEmbeddedMusicList({
        ...sourceSheet,
        id: sheetId,
        platform: localPluginName,
        createAt: sourceSheet.createAt ?? Date.now(),
        sortType: normalizeMusicSheetSortType(sourceSheet.sortType),
        $$sortIndex: sortIndex,
        artwork: sourceSheet.artwork ?? musicItems[musicItems.length - 1]?.artwork,
    });
    await musicSheetDB.sheets.put(metadata);
    if (!musicItems.length) {
        return;
    }

    await incrementMusicReferences(musicItems);
    const fallbackAddedAt = Date.now();
    await musicSheetDB.sheetMusic.bulkAdd(
        musicItems.map((musicItem, position) => ({
            sheetId,
            platform: musicItem.platform,
            musicId: musicItem.id,
            position,
            addedAt: Number(musicItem.$$addedAt ?? fallbackAddedAt),
            batchIndex: Number(musicItem.$$batchIndex ?? position),
            manual: ownership.get(importTrackKey(musicItem))?.manual ?? true,
            sourceKeys: ownership.get(importTrackKey(musicItem))?.sourceKeys ?? [],
        })),
    );
}

/** Restore a validated backup as one all-or-nothing database transaction. */
export async function restoreSheetDetails(
    importedSheets: IMusic.IMusicSheetItem[],
    overwrite: boolean,
) {
    const importedDefaultSheet = importedSheets.find(
        (sheet) => sheet.id === defaultSheet.id,
    );
    const importedUserSheets = overwrite
        ? importedSheets.filter((sheet) => sheet.id !== defaultSheet.id)
        : importedSheets;
    const generatedSheetIds = importedUserSheets.map(() => nanoid());

    await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.sheets,
        musicSheetDB.musicStore,
        musicSheetDB.sheetMusic,
        async () => {
            if (overwrite) {
                const userSheetIds = musicSheets
                    .filter((sheet) => sheet.id !== defaultSheet.id)
                    .map((sheet) => sheet.id);
                const replacedSheetIds = importedDefaultSheet
                    ? [...userSheetIds, defaultSheet.id]
                    : userSheetIds;

                if (replacedSheetIds.length) {
                    const removedRelations = await musicSheetDB.sheetMusic
                        .where("sheetId")
                        .anyOf(replacedSheetIds)
                        .toArray();
                    await decrementMusicReferences(removedRelations);
                    await musicSheetDB.sheetMusic
                        .where("sheetId")
                        .anyOf(replacedSheetIds)
                        .delete();
                }
                if (userSheetIds.length) {
                    await musicSheetDB.sheets.bulkDelete(userSheetIds);
                }
                if (importedDefaultSheet) {
                    await writeImportedSheet(importedDefaultSheet, defaultSheet.id, -1);
                }
            }

            const firstSortIndex = overwrite
                ? 0
                : (musicSheets[musicSheets.length - 1]?.$$sortIndex ?? -1) + 1;
            for (let index = 0; index < importedUserSheets.length; index++) {
                await writeImportedSheet(
                    importedUserSheets[index],
                    generatedSheetIds[index],
                    firstSortIndex + index,
                );
            }
        },
    );

    return queryAllSheets();
}
