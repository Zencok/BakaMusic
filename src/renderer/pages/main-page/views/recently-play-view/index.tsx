import MusicSheetlikeView from "@/renderer/components/MusicSheetlikeView";
import SvgAsset from "@/renderer/components/SvgAsset";
import {
    clearRecentlyPlaylist,
    useRecentlyPlaylistSheet,
} from "@/renderer/core/recently-playlist";
import { useTranslation } from "react-i18next";

export default function RecentlyPlayView() {
    const recentlyPlaylistSheet = useRecentlyPlaylistSheet();
    const { t } = useTranslation();

    const options = (
        <>
            <div
                role="button"
                className="clear-sheet option-button"
                data-type="dangerButton"
                data-disabled={!recentlyPlaylistSheet.playCount}
                title={t("common.clear")}
                onClick={() => {
                    clearRecentlyPlaylist();
                }}
            >
                <SvgAsset iconName={"trash"}></SvgAsset>
                <span>{t("common.clear")}</span>
            </div>
        </>
    );
    return (
        <div id="page-container" className="page-container">
            <MusicSheetlikeView
                hidePlatform
                musicSheet={recentlyPlaylistSheet}
                musicList={recentlyPlaylistSheet.musicList}
                options={options}
            ></MusicSheetlikeView>
        </div>
    );
}
