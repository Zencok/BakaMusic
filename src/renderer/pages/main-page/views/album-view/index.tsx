import MusicSheetlikeView from "@/renderer/components/MusicSheetlikeView";
import { useParams } from "react-router-dom";
import { useMemo } from "react";
import useAlbumDetail from "./hooks/useAlbumDetail";

export default function AlbumView() {
    const params = useParams();
    const originalAlbumItem = useMemo(() => {
        const sheetInState = history.state.usr?.albumItem ?? {};

        return {
            ...sheetInState,
            platform: params?.platform ?? "",
            id: params?.id ?? "",
            title: sheetInState.title ?? "",
        } as IAlbum.IAlbumItem;
    }, [params?.platform, params?.id]);

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
            ></MusicSheetlikeView>
        </div>
    );
}
