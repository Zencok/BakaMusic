import normalizeComment from "@renderer/utils/normalize-comment";
import { getMediaPrimaryKey } from "@/common/media-util";
import PluginManager from "@shared/plugin-manager/renderer";
import useCursorPage from "@renderer/utils/use-cursor-page";

export default function useComment(musicItem?: IMusic.IMusicItem) {
    const [snapshot, load] = useCursorPage<IComment.IComment>(
        musicItem ? getMediaPrimaryKey(musicItem) : "",
        async (cursor) => {
            if (!musicItem) return { items: [], nextCursor: null };
            const page = await PluginManager.invoke(musicItem, "comments.list", { entity: musicItem, cursor, limit: 50 });
            return { ...page, items: page.items.map((item) => normalizeComment(item)) };
        },
        undefined, [], Boolean(musicItem && PluginManager.isSupportFeatureMethod(musicItem.platform, "comments.list")),
    );
    return [snapshot.items, snapshot.status, load] as const;
}
