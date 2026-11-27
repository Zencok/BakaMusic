import PluginManager from "@shared/plugin-manager/renderer";
import useCursorPage from "@renderer/utils/use-cursor-page";
import { getMediaPrimaryKey } from "@/common/media-util";

export default function useAlbumDetail(album: IAlbum.IAlbumItem | null) {
    const [snapshot, load] = useCursorPage<IMusic.IMusicItem, IAlbum.IAlbumItem>(
        album ? getMediaPrimaryKey(album) : "",
        async (cursor) => {
            if (!album) return { items: [], nextCursor: null };
            const metadata = cursor === null && PluginManager.isSupportFeatureMethod(album.platform, "collections.get") ? await PluginManager.invoke(album, "collections.get", { entity: album }) : null;
            const page = await PluginManager.invoke(album, "collections.members", { entity: album, kind: "music", cursor, limit: 50 });
            return { ...page, items: page.items as IMusic.IMusicItem[], entity: metadata ?? page.entity };
        }, album ?? undefined, album?.musicList ?? [], Boolean(album?.platform && album.id !== ""),
    );
    return [snapshot.status, snapshot.entity ?? album, snapshot.items, load] as const;
}
