import MusicSheetlikeView from "@/renderer/components/MusicSheetlikeView";
import { useLocation, useParams } from "react-router-dom";
import { useMemo } from "react";
import useAlbumDetail from "./hooks/useAlbumDetail";
import MusicSheetFavoriteOption from "@/renderer/components/MusicSheetFavoriteOption";

export default function AlbumView() {
    const params = useParams();
    const location = useLocation();
    const originalAlbumItem = useMemo(() => {
        const fromLocation = location.state && typeof location.state === "object"
            ? (location.state as { albumItem?: IAlbum.IAlbumItem }).albumItem
            : undefined;
        const fromHistory = typeof history !== "undefined" && history.state && typeof history.state === "object"
            ? (history.state as { usr?: { albumItem?: IAlbum.IAlbumItem } }).usr?.albumItem
            : undefined;
        const sheetInState: Partial<IAlbum.IAlbumItem> = fromLocation ?? fromHistory ?? {};

        return {
            ...sheetInState,
            platform: params?.platform ?? "",
            id: sheetInState.id ?? params?.id ?? "",
            title: sheetInState.title ?? "",
        } as IAlbum.IAlbumItem;
    }, [params?.platform, params?.id, location.state]);

    const [requestState, albumItem, musicList, getAlbumDetail] =
        useAlbumDetail(originalAlbumItem);
    const displayAlbumItem = albumItem ?? originalAlbumItem;

    return (
        <div id="page-container" className="page-container">
            <MusicSheetlikeView
                musicSheet={displayAlbumItem}
                musicList={musicList}
                onLoadMore={getAlbumDetail}
                state={requestState}
                options={displayAlbumItem.id !== "" ? (
                    <MusicSheetFavoriteOption
                        musicSheet={displayAlbumItem}
                        type="album"
                    ></MusicSheetFavoriteOption>
                ) : null}
            ></MusicSheetlikeView>
        </div>
    );
}
