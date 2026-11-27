import { RequestStateCode } from "@/common/constant";
import { getMediaPrimaryKey } from "@/common/media-util";
import PluginManager from "@shared/plugin-manager/renderer";
import useCursorPage from "@renderer/utils/use-cursor-page";

export default function usePluginSheetMusicList(platform: string, id: string | number, original?: IMusic.IMusicSheetItem | null) {
    // Route text must not overwrite the original JSON scalar ID carried by navigation.
    const entity: IMusic.IMusicSheetItem = { ...original, platform, id: original?.id ?? id, title: original?.title ?? "" };
    const [snapshot, load] = useCursorPage<IMusic.IMusicItem, IMusic.IMusicSheetItem>(
        JSON.stringify([getMediaPrimaryKey(entity), Boolean(original?.isImported)]),
        async (cursor) => {
            const metadata = cursor === null && PluginManager.isSupportFeatureMethod(entity.platform, "collections.get") ? await PluginManager.invoke(entity, "collections.get", { entity }) : null;
            const page = await PluginManager.invoke(entity, "collections.members", { entity, kind: "music", cursor, limit: 50 });
            return { ...page, items: page.items as IMusic.IMusicItem[], entity: metadata ?? page.entity };
        }, entity, original?.musicList ?? [], Boolean(platform && id !== "" && !original?.isImported),
    );
    return [original?.isImported ? RequestStateCode.FINISHED : snapshot.status, snapshot.entity ?? entity, snapshot.items, load] as const;
}
