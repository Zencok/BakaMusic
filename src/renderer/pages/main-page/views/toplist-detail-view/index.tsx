import useTopListDetail from "./hooks/useTopListDetail";
import { useParams } from "react-router-dom";
import MusicSheetlikeView from "@/renderer/components/MusicSheetlikeView";

export default function TopListDetailView() {
    const params = useParams();
    const [topListDetail, state, loadMore] = useTopListDetail(
        history.state?.usr?.toplist,
        params?.platform ?? "",
    );
    const musicSheet = topListDetail ?? {
        platform: params?.platform ?? "",
        id: "",
        title: "",
        musicList: [],
    };

    return (
        <div id="page-container" className="page-container">
            <MusicSheetlikeView
                musicSheet={musicSheet}
                musicList={topListDetail?.musicList ?? []}
                state={state}
                onLoadMore={loadMore}
            />
        </div>
    );
}
