import useQueryArtist from "../../../../hooks/useQueryArtist";
import Condition from "@/renderer/components/Condition";
import { RequestStateCode } from "@/common/constant";
import Loading from "@/renderer/components/Loading";
import MusicSheetlikeList from "@/renderer/components/MusicSheetlikeList";
import "./index.scss";
import { useNavigate } from "react-router-dom";

interface IBodyProps {
    artistItem: IArtist.IArtistItem;
}

export default function AlbumResult(props: IBodyProps) {
    const { artistItem } = props;
    const queryResult = useQueryArtist(artistItem, "album");

    const navigate = useNavigate();



    return (
        <div className="artist-view--album-result-container">
            <Condition
                condition={
                    queryResult.state &&
          queryResult.state !== RequestStateCode.PENDING_FIRST_PAGE
                }
                falsy={<Loading></Loading>}
            >
                <MusicSheetlikeList
                    data={(queryResult.data ?? []) as IAlbum.IAlbumItem[]}
                    state={queryResult.state ?? RequestStateCode.IDLE}
                    onClick={(mediaItem) => {
                        navigate(`/main/album/${encodeURIComponent(mediaItem.platform)}/${encodeURIComponent(mediaItem.id)}`, {
                            state: {
                                albumItem: mediaItem,
                            },
                        });
                    }}
                    onLoadMore={() => {
                        queryResult.load();
                    }}
                ></MusicSheetlikeList>
            </Condition>
        </div>
    );
}
