import MusicList from "@/renderer/components/MusicList";
import { useEffect } from "react";
import useQueryArtist from "../../../../hooks/useQueryArtist";
import { queryResultStore } from "../../../../store";
import Condition from "@/renderer/components/Condition";
import { RequestStateCode } from "@/common/constant";
import Loading from "@/renderer/components/Loading";

interface IBodyProps {
    artistItem: IArtist.IArtistItem;
}

export default function MusicResult(props: IBodyProps) {
    const { artistItem } = props;
    const queryArtist = useQueryArtist();
    const queryResult = queryResultStore.useValue().music;

    useEffect(() => {
        queryArtist(artistItem, 1, "music");
    }, []);

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
                musicList={queryResult.data ?? []}
                state={queryResult.state}
                onPageChange={() => {
                    queryArtist(artistItem, undefined, "music");
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
