import { useLocation, useParams } from "react-router-dom";
import usePluginSheetMusicList from "./hooks/usePluginSheetMusicList";
import MusicSheetlikeView from "@/renderer/components/MusicSheetlikeView";
import MusicSheetFavoriteOption from "@/renderer/components/MusicSheetFavoriteOption";

export default function RemoteSheet() {
    const { platform, id } = useParams() ?? {};
    const location = useLocation();
    const routeState = location.state as {
        sheetItem?: IMusic.IMusicSheetItem;
    } | null;

    const [state, sheetItem, musicList, getSheetDetail] = usePluginSheetMusicList(
        platform ?? "",
        id ?? "",
        routeState?.sheetItem,
    );
    return (
        <MusicSheetlikeView
            musicSheet={sheetItem}
            musicList={musicList}
            state={state}
            onLoadMore={() => {
                getSheetDetail();
            }}
            options={sheetItem ? (
                <MusicSheetFavoriteOption
                    musicSheet={sheetItem}
                    type="sheet"
                ></MusicSheetFavoriteOption>
            ) : null}
        />
    );
}
