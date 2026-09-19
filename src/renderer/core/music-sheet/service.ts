import Store from "@/common/store";
import * as backend from "./repository";
import defaultSheet from "./default-sheet";
import { useEffect, useRef, useState } from "react";
import { RequestStateCode, localPluginName } from "@/common/constant";
import PluginManager from "@shared/plugin-manager/renderer";
import { validateImportSources } from "./import-sync";
import { ImportSyncFetcher } from "./sync-fetcher";
import AppConfig from "@shared/app-config/renderer";

const musicSheetsStore = new Store<IMusic.IDBMusicSheetItem[]>([]);
const starredSheetsStore = new Store<IMedia.IMediaBase[]>([]);

export const useAllSheets = musicSheetsStore.useValue;
export const useAllStarredSheets = starredSheetsStore.useValue;

export const getAllSheets = musicSheetsStore.getValue;

const syncingSheets = new Set<string>();
const syncFetcher = new ImportSyncFetcher((plugin, input, options) =>
    PluginManager.callPluginDelegateMethod(plugin, "importMusicSheet", input, options),
);
PluginManager.onPluginsChanged(() => syncFetcher.invalidate());
AppConfig.onConfigUpdate((patch) => {
    if (Object.keys(patch).some((key) => key === "private.pluginMeta" || key === "normal.language" || key.startsWith("network.proxy."))) {
        syncFetcher.invalidate();
    }
});
let lastImportSyncMetrics: Record<string, number> = {};
/** Timings contain no source URLs, playlist contents, credentials or version tokens. */
export function getLastImportSyncMetrics() {
    return { ...lastImportSyncMetrics };
}

/** Fetch all sources before touching persistence; one failed source aborts the sync. */
export async function syncImportedSheet(sheet: IMedia.IMediaBase, starred = false) {
    const key = JSON.stringify([starred, sheet.platform, sheet.id]);
    if (syncingSheets.has(key)) {
        throw new Error("sync_sheet_busy");
    }
    syncingSheets.add(key);
    const started = performance.now();
    try {
        const current = starred
            ? starredSheetsStore.getValue().find((item) => item.platform === sheet.platform && item.id === sheet.id) as IMusic.IMusicSheetItem | undefined
            : musicSheetsStore.getValue().find((item) => item.id === sheet.id);
        const sources = validateImportSources(current?.importSources);
        if (!current || !sources.length) {
            throw new Error("sync_sheet_missing_source");
        }
        const plugins = PluginManager.getSortedSupportedPlugin("importMusicSheet");
        // Resolve every plugin before scheduling any network work.
        const jobs = sources.map((source) => {
            const candidates = plugins.filter((item) => item.platform === source.platform);
            const plugin = candidates.find((item) => item.hash === source.pluginHash)
                ?? (candidates.length === 1 ? candidates[0] : undefined);
            if (!plugin) {
                throw new Error("sync_sheet_missing_plugin");
            }
            return { source, plugin };
        });
        const revision = syncFetcher.getRevision();
        const fetchStarted = performance.now();
        const responses = await Promise.allSettled(jobs.map(({ source, plugin }) => syncFetcher.fetch(source, plugin)));
        const snapshots = responses.map((response) => {
            if (response.status === "rejected") {
                throw response.reason;
            }
            return response.value;
        });
        if (revision !== syncFetcher.getRevision()) {
            throw new Error("Sync context changed");
        }
        const fetchMs = performance.now() - fetchStarted;
        const applyStarted = performance.now();
        if (starred) {
            const result = await backend.replaceStarredImportedSheet(sheet, sources, snapshots);
            if (result.changed) {
                starredSheetsStore.setValue(backend.getAllStarredSheets());
            }
            lastImportSyncMetrics = { fetchMs, applyMs: performance.now() - applyStarted, totalMs: performance.now() - started };
            return result;
        }
        const result = await backend.replaceImportedSheetMusic(sheet.id, sources, snapshots);
        const applyMs = performance.now() - applyStarted;
        const refreshStarted = performance.now();
        if (result.changed) {
            if (sheet.id === defaultSheet.id && (result.added || result.removed)) {
                refreshFavoriteState();
            }
            await refetchSheetDetail(sheet.id);
        }
        lastImportSyncMetrics = {
            ...result.metrics, fetchMs, applyMs, refreshMs: performance.now() - refreshStarted,
            totalMs: performance.now() - started,
        };
        return result;
    } finally {
        syncingSheets.delete(key);
    }
}

/** 更新默认歌单变化 */
const refreshFavCbs = new Set<() => void>();
function refreshFavoriteState() {
    refreshFavCbs.forEach((cb) => cb?.());
}

/**
 * 初始化
 */
export async function setupMusicSheets() {
    const [musicSheets, starredSheets] = await Promise.all([
        backend.queryAllSheets(),
        backend.queryAllStarredSheets(),
    ]);
    musicSheetsStore.setValue(musicSheets);
    starredSheetsStore.setValue(starredSheets);
}

/**
 * 新建歌单
 * @param sheetName 歌单名
 * @returns 新建的歌单信息
 */
export async function addSheet(
    sheetName: string,
    options?: {
        sortType?: IMusic.IMusicSheetSortType | null;
    },
) {
    try {
        const newSheetDetail = await backend.addSheet(sheetName, options);
        musicSheetsStore.setValue(backend.getAllSheets());
        return newSheetDetail;
    } catch {
        return;
    }
}

/**
 * 更新歌单信息
 * @param sheetId 歌单ID
 * @param newData 最新的歌单信息
 * @returns
 */
export async function updateSheet(
    sheetId: string,
    newData: Partial<IMusic.IMusicSheetItem>,
) {
    try {
        await backend.updateSheet(sheetId, newData);
        musicSheetsStore.setValue(backend.getAllSheets());
    } catch {
        return;
    }
}

/**
 * 更新歌单中的歌曲顺序
 * @param sheetId
 * @param musicList
 */
export async function updateSheetMusicOrder(
    sheetId: string,
    musicList: IMusic.IMusicItem[],
) {
    try {
        const targetSheet = musicSheetsStore
            .getValue()
            .find((it) => it.id === sheetId);
        if (!targetSheet) {
            return;
        }
        updateSheetDetail({
            ...targetSheet,
            sortType: "None",
            musicList,
        });
        await backend.updateSheetMusicOrder(sheetId, musicList);
        musicSheetsStore.setValue(backend.getAllSheets());
    } catch {
        return;
    }
}

/**
 * 移除歌单
 * @param sheetId 歌单ID
 * @returns 删除后的ID
 */
export async function removeSheet(sheetId: string) {
    try {
        await backend.removeSheet(sheetId);
        musicSheetsStore.setValue(backend.getAllSheets());
    } catch {
        return;
    }
}

/**
 * 清空所有音乐
 * @param sheetId 歌单ID
 * @returns 删除后的ID
 */
export async function clearSheet(sheetId: string) {
    try {
        await backend.clearSheet(sheetId);
        musicSheetsStore.setValue(backend.getAllSheets());
        refetchSheetDetail(sheetId);
    } catch {
        return;
    }
}

/**
 * 收藏歌单
 * @param sheet
 */
export async function starMusicSheet(sheet: IMedia.IMediaBase) {
    await backend.starMusicSheet(sheet);
    starredSheetsStore.setValue(backend.getAllStarredSheets());
}

/**
 * 取消收藏歌单
 * @param sheet
 */
export async function unstarMusicSheet(sheet: IMedia.IMediaBase) {
    await backend.unstarMusicSheet(sheet);
    starredSheetsStore.setValue(backend.getAllStarredSheets());
}

/**
 * 收藏歌单排序
 */
export async function setStarredMusicSheets(sheets: IMedia.IMediaBase[]) {
    await backend.setStarredMusicSheets(sheets);
    starredSheetsStore.setValue(backend.getAllStarredSheets());
}

/**************************** 歌曲相关方法 ************************/

/**
 * 添加歌曲到歌单
 * @param musicItems
 * @param sheetId
 * @returns
 */
export async function addMusicToSheet(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
    sheetId: string,
    importSources?: IMusic.IImportedSheetSource[],
    importOwnership?: IMusic.ISheetTrackOwnership[],
) {
    await backend.addMusicToSheet(musicItems, sheetId, importSources, importOwnership);

    musicSheetsStore.setValue(backend.getAllSheets());
    if (sheetId === defaultSheet.id) {
    // 更新默认列表的状态
        refreshFavoriteState();
    }
    refetchSheetDetail(sheetId);
}

/** 添加到默认歌单 */
export async function addMusicToFavorite(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
) {
    return addMusicToSheet(musicItems, defaultSheet.id);
}

/**
 * 从歌单内移除歌曲
 * @param musicItems 要移除的歌曲
 * @param sheetId 歌单ID
 * @returns
 */
export async function removeMusicFromSheet(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
    sheetId: string,
) {
    await backend.removeMusicFromSheet(musicItems, sheetId);

    musicSheetsStore.setValue(backend.getAllSheets());
    if (sheetId === defaultSheet.id) {
    // 更新默认列表的状态
        refreshFavoriteState();
    }
    refetchSheetDetail(sheetId);
}

/** 从默认歌单中移除 */
export async function removeMusicFromFavorite(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
) {
    return removeMusicFromSheet(musicItems, defaultSheet.id);
}

/** 是否是我喜欢的歌单 */
export function isFavoriteMusic(musicItem: IMusic.IMusicItem) {
    return backend.isFavoriteMusic(musicItem);
}

/** hook 某首歌曲是否被标记成喜欢 */
export function useMusicIsFavorite(musicItem: IMusic.IMusicItem) {
    const [isFav, setIsFav] = useState(backend.isFavoriteMusic(musicItem));

    useEffect(() => {
        const cb = () => {
            setIsFav(backend.isFavoriteMusic(musicItem));
        };
        cb();
        refreshFavCbs.add(cb);
        return () => {
            refreshFavCbs.delete(cb);
        };
    }, [musicItem]);

    return isFav;
}

const updateSheetDetailCallbacks: Map<
    string,
    Set<(newSheet: IMusic.IMusicSheetItem) => void>
> = new Map();

function updateSheetDetail(newSheet: IMusic.IMusicSheetItem) {
    updateSheetDetailCallbacks.get(newSheet?.id)?.forEach((cb) => cb?.(newSheet));
}

/**
 * 重新取歌单状态
 * @param sheetId
 */
async function refetchSheetDetail(sheetId: string) {
    if (!updateSheetDetailCallbacks.get(sheetId)?.size) {
        return;
    }
    let sheetDetail = await backend.getSheetItemDetail(sheetId);
    if (!sheetDetail) {
    // 可能已经被删除了
        sheetDetail = {
            id: sheetId,
            title: "已删除歌单",
            artist: "未知作者",
            platform: localPluginName,
        };
    }

    updateSheetDetail(sheetDetail);
}

/**
 * 监听当前某个歌单
 * @param sheetId 歌单ID
 * @param initQuery 是否重新查询
 */
export function useMusicSheet(sheetId: string) {
    const [pendingState, setPendingState] = useState(
        RequestStateCode.PENDING_FIRST_PAGE,
    );
    const [sheetItem, setSheetItem] = useState<IMusic.IMusicSheetItem | null>(
        null,
    );

    // 实时的sheetId
    const realTimeSheetIdRef = useRef(sheetId);
    realTimeSheetIdRef.current = sheetId;

    useEffect(() => {
        const updateSheet = async (newSheet: IMusic.IMusicSheetItem) => {
            // 如果更新的是当前歌单，则设置
            if (realTimeSheetIdRef.current === newSheet.id) {
                setSheetItem(newSheet);
                setPendingState(RequestStateCode.FINISHED);
            }
        };

        const cbs = updateSheetDetailCallbacks.get(sheetId) ?? new Set();
        cbs.add(updateSheet);
        updateSheetDetailCallbacks.set(sheetId, cbs);

        const targetSheet = musicSheetsStore
            .getValue()
            .find((item) => item.id === sheetId);

        if (targetSheet) {
            setSheetItem({
                ...targetSheet,
                musicList: [],
            });
        }

        setPendingState(RequestStateCode.PENDING_FIRST_PAGE);
        refetchSheetDetail(sheetId);

        return () => {
            cbs?.delete(updateSheet);
            if (!cbs.size) {
                updateSheetDetailCallbacks.delete(sheetId);
            }
        };
    }, [sheetId]);

    return [sheetItem, pendingState] as const;
}

export async function exportAllSheetDetails() {
    return await backend.exportAllSheetDetails();
}

export async function restoreSheetDetails(
    sheets: IMusic.IMusicSheetItem[],
    overwrite: boolean,
) {
    await backend.restoreSheetDetails(sheets, overwrite);
    musicSheetsStore.setValue(backend.getAllSheets());
    refreshFavoriteState();
}
