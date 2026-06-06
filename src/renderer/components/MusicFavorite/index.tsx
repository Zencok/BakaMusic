import SvgAsset from "../SvgAsset";
import MusicSheet from "@/renderer/core/music-sheet";

interface IMusicFavoriteProps {
    musicItem: IMusic.IMusicItem;
    size: number;
    /** 点击热区撑满父容器，使整个按钮外壳都成为可点击范围 */
    fillContainer?: boolean;
}

export default function MusicFavorite(props: IMusicFavoriteProps) {
    const { musicItem, size, fillContainer } = props;
    const isFav = MusicSheet.frontend.useMusicIsFavorite(musicItem);

    return (
        <div
            role="button"
            onClick={(e) => {
                e.stopPropagation();
                if (isFav) {
                    MusicSheet.frontend.removeMusicFromFavorite(musicItem);
                } else {
                    MusicSheet.frontend.addMusicToFavorite(musicItem);
                }
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
            }}
            style={{
                color: isFav ? "red" : "var(--textColor)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: fillContainer ? "100%" : size,
                height: fillContainer ? "100%" : size,
            }}
        >
            <SvgAsset
                iconName={isFav ? "heart" : "heart-outline"}
                size={size}
            ></SvgAsset>
        </div>
    );
}
