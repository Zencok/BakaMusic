import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { showModal } from "@renderer/components/Modal";
import { canPlayMusicVideo } from "@renderer/utils/music-video";
import "./index.scss";

interface IMusicVideoBadgeProps {
    musicItem: IMusic.IMusicItem;
    compact?: boolean;
}

export default function MusicVideoBadge({ musicItem, compact = false }: IMusicVideoBadgeProps) {
    const { t } = useTranslation();
    if (!canPlayMusicVideo(musicItem)) {
        return null;
    }

    const openMv = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        showModal("MvPlayer", { musicItem });
    };

    return (
        <button
            type="button"
            className={`music-video-badge${compact ? " music-video-badge--compact" : ""}`}
            title={t("music_bar.play_mv")}
            aria-label={`${t("music_bar.play_mv")}: ${musicItem.title}`}
            onClick={openMv}
            onDoubleClick={(event) => event.stopPropagation()}
        >
            <span aria-hidden="true">MV</span>
        </button>
    );
}
