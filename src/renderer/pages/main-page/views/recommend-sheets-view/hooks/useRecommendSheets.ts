import { RequestStateCode } from "@/common/constant";
import { resetMediaItem } from "@/common/media-util";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import PluginManager from "@shared/plugin-manager/renderer";

interface IRecommendSheetsSnapshot {
    sheets: IMusic.IMusicSheetItem[];
    status: RequestStateCode;
    page: number;
}

const MAX_CACHED_SESSIONS = 48;
const snapshots = new Map<string, IRecommendSheetsSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const pendingRequests = new Map<string, Promise<void>>();
const EMPTY_SNAPSHOT: IRecommendSheetsSnapshot = {
    sheets: [],
    status: RequestStateCode.IDLE,
    page: 0,
};
const NOOP_UNSUBSCRIBE = () => undefined;

function sessionKey(plugin: IPlugin.IPluginDelegate, tag: IMedia.IUnique) {
    return `${plugin.hash}\0${tag.id ?? ""}`;
}

function getSnapshot(key: string) {
    return snapshots.get(key) ?? EMPTY_SNAPSHOT;
}

function notify(key: string) {
    listeners.get(key)?.forEach((listener) => listener());
}

function setSnapshot(key: string, snapshot: IRecommendSheetsSnapshot) {
    snapshots.delete(key);
    snapshots.set(key, snapshot);

    while (snapshots.size > MAX_CACHED_SESSIONS) {
        const oldestKey = snapshots.keys().next().value;
        if (!oldestKey || oldestKey === key) {
            break;
        }
        snapshots.delete(oldestKey);
    }

    notify(key);
}

function subscribe(key: string, listener: () => void) {
    let keyListeners = listeners.get(key);
    if (!keyListeners) {
        keyListeners = new Set();
        listeners.set(key, keyListeners);
    }
    keyListeners.add(listener);

    return () => {
        keyListeners?.delete(listener);
        if (keyListeners?.size === 0) {
            listeners.delete(key);
        }
    };
}

async function requestSheets(
    plugin: IPlugin.IPluginDelegate,
    tag: IMedia.IUnique,
) {
    const key = sessionKey(plugin, tag);
    const current = getSnapshot(key);
    if (
        current.status === RequestStateCode.FINISHED ||
        current.status === RequestStateCode.PENDING_FIRST_PAGE ||
        current.status === RequestStateCode.PENDING_REST_PAGE
    ) {
        return;
    }

    const pending = pendingRequests.get(key);
    if (pending) {
        await pending;
        return;
    }

    const page = current.page + 1;
    setSnapshot(key, {
        ...current,
        status: page === 1
            ? RequestStateCode.PENDING_FIRST_PAGE
            : RequestStateCode.PENDING_REST_PAGE,
    });

    const request = (async () => {
        try {
            const result = await PluginManager.callPluginDelegateMethod(
                plugin,
                "getRecommendSheetsByTag",
                tag,
                page,
            ) ?? { isEnd: true, data: [] as IMusic.IMusicSheetItem[] };
            const previous = getSnapshot(key);
            const nextSheets = Array.isArray(result.data) ? result.data : [];
            setSnapshot(key, {
                sheets: page === 1
                    ? nextSheets.map((item) => resetMediaItem(item, plugin.platform))
                    : [
                        ...previous.sheets,
                        ...nextSheets.map((item) => resetMediaItem(item, plugin.platform)),
                    ],
                status: result.isEnd
                    ? RequestStateCode.FINISHED
                    : RequestStateCode.PARTLY_DONE,
                page,
            });
        } catch {
            const previous = getSnapshot(key);
            setSnapshot(key, {
                ...previous,
                status: RequestStateCode.ERROR,
            });
        } finally {
            pendingRequests.delete(key);
        }
    })();
    pendingRequests.set(key, request);
    await request;
}

export default function useRecommendSheets(
    plugin: IPlugin.IPluginDelegate,
    tag: IMedia.IUnique | null,
) {
    const key = tag ? sessionKey(plugin, tag) : "";
    const snapshot = useSyncExternalStore(
        useCallback((listener) => key ? subscribe(key, listener) : NOOP_UNSUBSCRIBE, [key]),
        useCallback(() => key ? getSnapshot(key) : EMPTY_SNAPSHOT, [key]),
        useCallback(() => key ? getSnapshot(key) : EMPTY_SNAPSHOT, [key]),
    );
    const query = useCallback(async () => {
        if (tag) {
            await requestSheets(plugin, tag);
        }
    }, [plugin, tag]);

    useEffect(() => {
        if (
            snapshot.status === RequestStateCode.IDLE ||
            snapshot.status === RequestStateCode.ERROR
        ) {
            void query();
        }
    }, [query, snapshot.status]);

    return [query, snapshot.sheets, snapshot.status] as const;
}
