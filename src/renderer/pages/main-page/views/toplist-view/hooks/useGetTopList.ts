import { useCallback, useSyncExternalStore } from "react";
import { pluginsTopListStore } from "../store";
import PluginManager from "@shared/plugin-manager/renderer";
import { CursorSession } from "@renderer/utils/cursor-session";
import { RequestStateCode } from "@/common/constant";

const sessions = new Map<string, CursorSession<IMusic.IMusicSheetItem>>();
PluginManager.onPluginsChanged(() => {
    sessions.forEach((session) => session.invalidate()); sessions.clear(); pluginsTopListStore.setValue({});
});
export default function useGetTopList() {
    const revision = useSyncExternalStore(PluginManager.onPluginsChanged, PluginManager.getRegistryRevision);
    return useCallback(async (pluginId: string) => {
        const key = JSON.stringify([revision, pluginId]);
        let session = sessions.get(key);
        if (!session) {
            session = new CursorSession<IMusic.IMusicSheetItem>();
            const active = session;
            sessions.set(key, active);
            active.subscribe(() => {
                if (sessions.get(key) !== active) return;
                const snapshot = active.getSnapshot();
                pluginsTopListStore.setValue((previous) => ({ ...previous, [pluginId]: { state: snapshot.status, data: [{ data: snapshot.items }] } }));
            });
        }
        do {
            await session.load((cursor) => PluginManager.invoke({ id: pluginId }, "discovery.charts", { cursor, limit: 100 }));
        } while (sessions.get(key) === session && session.getSnapshot().status === RequestStateCode.PARTLY_DONE && session.getSnapshot().items.length < 10000);
    }, [revision]);
}
