import PluginManager from "@shared/plugin-manager/renderer";
import useCursorPage from "@renderer/utils/use-cursor-page";
import { useEffect, useMemo } from "react";
import { RequestStateCode } from "@/common/constant";

export interface RecommendTags {
    pinned?: IMusic.IMusicSheetItem[];
    data?: IMusic.IMusicSheetGroupItem[];
}
export default function useRecommendListTags(plugin: IPlugin.IPluginDelegate): RecommendTags | null {
    const supported = plugin.capabilities.includes("discovery.playlistTags");
    const [snapshot, load] = useCursorPage<IMusic.IMusicSheetGroupItem | IMusic.IMusicSheetItem>(
        JSON.stringify([plugin.id, plugin.version]),
        (cursor) => PluginManager.invoke(plugin, "discovery.playlistTags", { cursor, limit: 100 }),
        undefined, [], supported,
    );
    useEffect(() => {
        if (snapshot.status === RequestStateCode.PARTLY_DONE) void load();
    }, [load, snapshot.status]);
    return useMemo(() => {
        if (!supported) return { data: [] };
        if (!snapshot.loaded) return null;
        const groups = snapshot.items.filter((item): item is IMusic.IMusicSheetGroupItem => Array.isArray((item as IMusic.IMusicSheetGroupItem).data));
        const singles = snapshot.items.filter((item): item is IMusic.IMusicSheetItem => !Array.isArray((item as IMusic.IMusicSheetGroupItem).data));
        return { data: groups, pinned: singles };
    }, [supported, snapshot.items, snapshot.loaded]);
}
