import { useCallback, useSyncExternalStore } from "react";
import { searchResultsStore } from "../store/search-result";
import PluginManager, { useSortedPlugins } from "@shared/plugin-manager/renderer";
import { CursorSession } from "@renderer/utils/cursor-session";

type SearchSession = { query: string; loader: CursorSession<IMedia.IMediaBase> };
const sessions = new Map<string, SearchSession>();
PluginManager.onPluginsChanged(() => {
    sessions.forEach(({ loader }) => loader.invalidate());
    sessions.clear();
});

export default function useSearch() {
    const registry = useSortedPlugins();
    const revision = useSyncExternalStore(PluginManager.onPluginsChanged, PluginManager.getRegistryRevision);
    return useCallback(async (query?: string, type: IMedia.SupportMediaType = "music", pluginId?: string, options: { force?: boolean } = {}) => {
        const selected = registry.find((plugin) => plugin.id === pluginId);
        const plugins = PluginManager.getSortedSearchablePlugins(type).filter((plugin) => !pluginId || plugin.id === selected?.id);
        await Promise.all(plugins.map(async (plugin) => {
            const key = JSON.stringify([revision, plugin.id, type]);
            let session = sessions.get(key);
            const text = query ?? session?.query ?? "";
            if (!text) return;
            if (!session || session.query !== text || options.force) {
                session?.loader.invalidate();
                session = { query: text, loader: new CursorSession<IMedia.IMediaBase>() };
                sessions.set(key, session);
                const active = session;
                active.loader.subscribe(() => {
                    if (sessions.get(key) !== active) return;
                    const snapshot = active.loader.getSnapshot();
                    searchResultsStore.setValue((previous) => ({ ...previous, [type]: { ...previous[type], [plugin.id]: { query: text, state: snapshot.status, data: snapshot.items, nextCursor: snapshot.nextCursor } } }));
                });
                while (sessions.size > 100) {
                    const oldest = sessions.keys().next().value;
                    if (oldest === undefined) break;
                    sessions.get(oldest)?.loader.invalidate();
                    sessions.delete(oldest);
                }
            } else if (query !== undefined && session.loader.getSnapshot().loaded) {
                return;
            }
            await session.loader.load((cursor) => PluginManager.invoke(plugin, "search", { query: text, kind: type, cursor, limit: 50 }));
        }));
    }, [registry, revision]);
}
