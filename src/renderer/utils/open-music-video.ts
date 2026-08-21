import { i18n } from "@shared/i18n/renderer";
import mvOverlay from "@shared/mv-overlay/renderer-main";
import trackPlayer from "@renderer/core/track-player";
import { toast } from "react-toastify";

export default function openMusicVideo(musicItem: IMusic.IMusicItem) {
    void mvOverlay.open({
        musicItem,
        audio: {
            volume: trackPlayer.volume,
            muted: trackPlayer.isMute,
        },
    }).catch((error: unknown) => {
        toast.error(
            error instanceof Error ? error.message : i18n.t("mv_player.error"),
        );
    });
}
