import { isSameMedia } from "@/common/media-util";
import MusicSheet from "@/renderer/core/music-sheet";
import SvgAsset from "@/renderer/components/SvgAsset";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface IMusicSheetFavoriteOptionProps {
    musicSheet: IMedia.IMediaBase;
    type: "sheet" | "album" | "toplist";
}

export default function MusicSheetFavoriteOption(
    props: IMusicSheetFavoriteOptionProps,
) {
    const { musicSheet, type } = props;
    const starredMusicSheets = MusicSheet.frontend.useAllStarredSheets();
    const { t } = useTranslation();
    const starredItem = starredMusicSheets.find((item) =>
        isSameMedia(musicSheet, item),
    );
    const isStarred = starredItem !== undefined;

    useEffect(() => {
        if (!starredItem || type === "sheet" || starredItem.$$favoriteType) {
            return;
        }

        void MusicSheet.frontend.starMusicSheet({
            ...starredItem,
            ...musicSheet,
            $$favoriteType: type,
        });
    }, [musicSheet, starredItem, type]);

    return (
        <div
            role="button"
            className="option-button"
            data-type="normalButton"
            onClick={() => {
                if (isStarred) {
                    void MusicSheet.frontend.unstarMusicSheet(starredItem);
                } else {
                    void MusicSheet.frontend.starMusicSheet({
                        ...musicSheet,
                        $$favoriteType: type,
                    });
                }
            }}
        >
            <SvgAsset
                iconName={isStarred ? "heart" : "heart-outline"}
                color={isStarred ? "red" : undefined}
            ></SvgAsset>
            <span>{t("music_sheet_like_view.star")}</span>
        </div>
    );
}
