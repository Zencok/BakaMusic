import PluginManager from "@shared/plugin-manager/renderer";
import useCursorPage from "@renderer/utils/use-cursor-page";

export default function useRecommendSheets(plugin: IPlugin.IPluginDelegate, tag: IMedia.IUnique | null) {
    const [snapshot, load] = useCursorPage<IMusic.IMusicSheetItem>(
        JSON.stringify([plugin.id, plugin.version, tag?.id]),
        (cursor) => PluginManager.invoke(plugin, "discovery.playlists", { tag, cursor, limit: 50 }),
        undefined, [], tag !== null,
    );
    return [load, snapshot.items, snapshot.status] as const;
}
