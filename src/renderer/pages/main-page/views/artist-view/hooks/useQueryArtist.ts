import PluginManager from "@shared/plugin-manager/renderer";
import { getMediaPrimaryKey } from "@/common/media-util";
import useCursorPage from "@renderer/utils/use-cursor-page";

export default function useQueryArtist(artist: IArtist.IArtistItem, kind: IArtist.ArtistMediaType) {
    const [snapshot, load] = useCursorPage<IMedia.SupportMediaItem[typeof kind]>(
        JSON.stringify([getMediaPrimaryKey(artist), kind]),
        async (cursor) => {
            const result = await PluginManager.invoke(artist, "collections.members", { entity: artist, kind, cursor, limit: 50 });
            return { ...result, items: result.items as IMedia.SupportMediaItem[typeof kind][] };
        }, undefined, [], Boolean(artist.platform && artist.id !== ""),
    );
    return { data: snapshot.items, state: snapshot.status, load };
}
