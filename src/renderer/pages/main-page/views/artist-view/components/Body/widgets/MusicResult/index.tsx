import MusicList from "@/renderer/components/MusicList";
import useQueryArtist from "../../../../hooks/useQueryArtist";
import Condition from "@/renderer/components/Condition";
import { RequestStateCode } from "@/common/constant";
import Loading from "@/renderer/components/Loading";

interface IBodyProps {
    artistItem: IArtist.IArtistItem;
}

export default function MusicResult(props: IBodyProps) {
    const { artistItem } = props;
    const queryResult = useQueryArtist(artistItem, "music");



    return (
        <Condition
            condition={
                queryResult.state &&
        queryResult.state !== RequestStateCode.PENDING_FIRST_PAGE
            }
            falsy={<Loading></Loading>}
        >
            <MusicList
                sortStorageKey={`artist_${artistItem.platform}_${artistItem.id}`}
                musicList={(queryResult.data ?? []) as IMusic.IMusicItem[]}
                state={queryResult.state}
                onPageChange={() => {
                    queryResult.load();
                }}
                virtualProps={{
                    getScrollElement() {
                        return document.querySelector("#page-container");
                    },
                    fallbackRenderCount: 40,
                }}
            ></MusicList>
        </Condition>
    );
}
