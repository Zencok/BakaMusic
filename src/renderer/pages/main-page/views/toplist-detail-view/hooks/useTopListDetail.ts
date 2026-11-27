import PluginManager from "@shared/plugin-manager/renderer";
import { getMediaPrimaryKey } from "@/common/media-util";
import useCursorPage from "@renderer/utils/use-cursor-page";

export default function useTopListDetail(toplist: IMusic.IMusicSheetItem | null, platform: string) {
    const entity = toplist ? { ...toplist, platform } : undefined;
    const [snapshot, load] = useCursorPage<IMusic.IMusicItem, IMusic.IMusicSheetItem>(
        entity ? getMediaPrimaryKey(entity) : "",
        async (cursor) => {
            if (!entity) return { items: [], nextCursor: null };
            const page = await PluginManager.invoke({ platform }, "collections.members", { entity: entity, kind: "music", cursor, limit: 50 });
            return { ...page, items: page.items as IMusic.IMusicItem[] };
        }, entity, entity?.musicList ?? [], Boolean(entity && platform),
    );
    return [snapshot.entity ? { ...snapshot.entity, musicList: snapshot.items } : null, snapshot.status, load] as const;
}
