import Base from "@renderer/components/Panel/templates/Base";
import "./index.scss";
import { useTranslation } from "react-i18next";
import SvgAsset from "@renderer/components/SvgAsset";
import dayjs from "dayjs";
import useComment from "@renderer/components/Panel/templates/MusicComment/useComment";
import { RequestStateCode } from "@/common/constant";
import Loading from "@renderer/components/Loading";
import BottomLoadingState from "@renderer/components/BottomLoadingState";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";

interface IProps {
    coverHeader?: boolean;
    musicItem?: IMusic.IMusicItem;
}

export default function MusicComment(props: IProps) {
    const { coverHeader, musicItem } = props;
    const { t } = useTranslation();
    const [comments, reqState, loadMore] = useComment(musicItem);

    const musicTitle = musicItem?.title || t("media.unknown_title");
    const musicArtist = musicItem?.artist || t("media.unknown_artist");

    return (
        <Base coverHeader={coverHeader} width={560} scrollable={false} withBlur>
            <Base.Header>
                <div className="music-comment-panel--header-copy">
                    <div className="music-comment-panel--eyebrow">{t("media.media_type_comment")}</div>
                    <div className="music-comment-panel--header-title">{musicTitle}</div>
                </div>
            </Base.Header>
            <div className="music-comment-panel--hero">
                <img
                    className="music-comment-panel--hero-cover"
                    src={musicItem?.artwork ?? albumImg}
                    onError={setFallbackAlbum}
                ></img>
                <div className="music-comment-panel--hero-copy">
                    <div className="music-comment-panel--hero-title">{musicTitle}</div>
                    <div className="music-comment-panel--hero-subtitle">{musicArtist}</div>
                </div>
            </div>
            <div className="music-comment-panel--body-container">
                {comments.length === 0 && (reqState & RequestStateCode.LOADING) ? (
                    <div className="music-comment-panel--loading"><Loading></Loading></div>
                ) : (
                    <>
                        {comments.map((comment, index) => (
                            <MusicCommentItem
                                key={comment.id ?? `${comment.nickName}-${comment.createAt ?? index}-${index}`}
                                comment={comment}
                            ></MusicCommentItem>
                        ))}
                        <BottomLoadingState state={reqState} onLoadMore={loadMore}></BottomLoadingState>
                    </>
                )}
            </div>
        </Base>
    );
}

interface IMusicCommentItemProps {
    comment: IComment.IComment;
}

function MusicCommentItem(props: IMusicCommentItemProps) {
    const { comment } = props;

    return (
        <div className="music-comment-panel--comment-item-container">
            <div className="comment-title-container">
                {comment.avatar ? (
                    <img className="avatar" src={comment.avatar}></img>
                ) : (
                    <div className="avatar avatar-placeholder">
                        <SvgAsset iconName="user"></SvgAsset>
                    </div>
                )}
                <div className="comment-author-copy">
                    <span className="comment-author">{comment.nickName}</span>
                    {comment.location ? <span className="comment-location">{comment.location}</span> : null}
                </div>
            </div>
            <div className="comment-body-container">
                <span>{comment.comment}</span>
            </div>
            <div className="comment-operations-container">
                {comment.createAt ? <span>{dayjs(comment.createAt).format("YYYY-MM-DD")}</span> : <span></span>}
                <div className="thumb-up">
                    <SvgAsset iconName="hand-thumb-up"></SvgAsset>
                    <span>{comment.like ?? "-"}</span>
                </div>
            </div>
        </div>
    );
}
