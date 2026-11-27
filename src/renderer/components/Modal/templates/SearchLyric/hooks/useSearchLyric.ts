import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import searchResultStore from "./searchResultStore";
import PluginManager from "@shared/plugin-manager/renderer";
import { lyricSearchContext } from "@shared/plugin-manager/lyric-search";
import { CursorSession } from "@renderer/utils/cursor-session";

export default function useSearchLyric(musicItem?: IMusic.IMusicItem) {
    const sessions = useRef(new Map<string, { query: string; loader: CursorSession<ILyric.ILyricItem> }>());
    const revision = useSyncExternalStore(PluginManager.onPluginsChanged, PluginManager.getRegistryRevision);
    const targetKey = JSON.stringify([revision, musicItem?.platform, musicItem?.id, musicItem?.title, musicItem?.artist, musicItem?.duration]);
    const targetRef = useRef(musicItem);
    targetRef.current = musicItem;
    useEffect(() => {
        const current = sessions.current;
        const clear = () => {
            current.forEach(({ loader }) => loader.invalidate()); current.clear(); searchResultStore.setValue({ data: {} });
        };
        clear();
        const unsubscribe = PluginManager.onPluginsChanged(clear);
        return () => {
            unsubscribe(); clear();
        };
    }, [targetKey]);
    return useCallback(async (query?: string, pluginId?: string, force = false) => {
        const plugins = PluginManager.getSortedSearchablePlugins("lyric").filter((plugin) => !pluginId || plugin.id === pluginId);
        await Promise.all(plugins.map(async (plugin) => {
            const sessionKey = JSON.stringify([targetKey, plugin.id]);
            let session = sessions.current.get(sessionKey);
            const text = query ?? session?.query ?? "";
            if (!text) return;
            if (!session || session.query !== text || force) {
                session?.loader.invalidate();
                session = { query: text, loader: new CursorSession<ILyric.ILyricItem>() };
                const active = session;
                sessions.current.set(sessionKey, active);
                active.loader.subscribe(() => {
                    if (sessions.current.get(sessionKey) !== active) return;
                    const snapshot = active.loader.getSnapshot();
                    searchResultStore.setValue((previous) => ({ query: text, data: { ...previous.data, [plugin.id]: { data: snapshot.items, state: snapshot.status, nextCursor: snapshot.nextCursor } } }));
                });
            } else if (query !== undefined && session.loader.getSnapshot().loaded) return;
            const context = targetRef.current ? lyricSearchContext(targetRef.current, plugin.id) : undefined;
            await session.loader.load(async (cursor) => {
                const result = await PluginManager.invoke(plugin, "search", { query: text, kind: "lyric", cursor, limit: 50, context });
                return { ...result, items: result.items as ILyric.ILyricItem[] };
            });
        }));
    }, [targetKey]);
}
