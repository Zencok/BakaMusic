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
import { nanoid } from "nanoid";
import musicSheetDB, {
    type ISheetMusicRelation,
    type IStoredMusicItem,
} from "./database";
import defaultSheet from "./default-sheet";
import { normalizeMusicSheetSortType, sortMusicSheetMusicList } from "./sort";

const favoriteMusicListIds = new Set<string>();
let musicSheets: IMusic.IDBMusicSheetItem[] = [];
let starredMusicSheets: IMedia.IMediaBase[] = [];

function stripEmbeddedMusicList(
    sheet: IMusic.IMusicSheetItem | IMusic.IDBMusicSheetItem,
): IMusic.IDBMusicSheetItem {
    const metadata = { ...sheet };
    delete metadata.musicList;
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

function uniqueMusicItems(musicItems: IMusic.IMusicItem[]) {
    const seen = new Set<string>();
    return musicItems.filter((musicItem) => {
        if (!musicItem?.platform || !musicItem.id) {
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

export async function starMusicSheet(sheet: IMedia.IMediaBase) {
    const newSheets = [...starredMusicSheets, sheet];
    await setUserPreferenceIDB("starredMusicSheets", newSheets);
    starredMusicSheets = newSheets;
}

export async function unstarMusicSheet(sheet: IMedia.IMediaBase) {
    const newSheets = starredMusicSheets.filter(
        (item) => !isSameMedia(item, sheet),
    );
    await setUserPreferenceIDB("starredMusicSheets", newSheets);
    starredMusicSheets = newSheets;
}

export async function setStarredMusicSheets(sheets: IMedia.IMediaBase[]) {
    await setUserPreferenceIDB("starredMusicSheets", sheets);
    starredMusicSheets = sheets;
}

export async function addMusicToSheet(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
    sheetId: string,
) {
    const targetSheet = musicSheets.find((item) => item.id === sheetId);
    if (!targetSheet) {
        return;
    }
    const candidates = uniqueMusicItems(
        Array.isArray(musicItems) ? musicItems : [musicItems],
    );
    if (!candidates.length) {
        return musicSheets;
    }

    let addedMusicItems: IMusic.IMusicItem[] = [];
    let nextArtwork = targetSheet.artwork ?? "";
    await musicSheetDB.transaction(
        "readwrite",
        musicSheetDB.sheets,
        musicSheetDB.musicStore,
        musicSheetDB.sheetMusic,
        async () => {
            const relationKeys = candidates.map((musicItem) => [
                sheetId,
                musicItem.platform,
                musicItem.id,
            ] as [string, string, string]);
            const existingRelations = await musicSheetDB.sheetMusic.bulkGet(
                relationKeys,
            );
            addedMusicItems = candidates.filter(
                (_musicItem, index) => !existingRelations[index],
            );
            if (!addedMusicItems.length) {
                return;
            }

            const currentRelations = await getSheetRelations(sheetId);
            const insertAtTop = normalizeMusicSheetSortType(targetSheet.sortType)
                === MusicSheetSortType.None;
            if (insertAtTop && currentRelations.length) {
                currentRelations.forEach((relation) => {
                    relation.position += addedMusicItems.length;
                });
                await musicSheetDB.sheetMusic.bulkPut(currentRelations);
            }

            const addedAt = Date.now();
            const startPosition = insertAtTop ? 0 : currentRelations.length;
            const newRelations = addedMusicItems.map((musicItem, index) => ({
                sheetId,
                platform: musicItem.platform,
                musicId: musicItem.id,
                position: startPosition + index,
                addedAt,
                batchIndex: index,
            }));

            await incrementMusicReferences(addedMusicItems);
            await musicSheetDB.sheetMusic.bulkAdd(newRelations);
            nextArtwork = addedMusicItems[addedMusicItems.length - 1]?.artwork
                ?? nextArtwork;
            await musicSheetDB.sheets.update(sheetId, { artwork: nextArtwork });
        },
    );

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
                    relation.position = retainedRelations.length;
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
            if (retainedRelations.length) {
                await musicSheetDB.sheetMusic.bulkPut(retainedRelations);
            }
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
