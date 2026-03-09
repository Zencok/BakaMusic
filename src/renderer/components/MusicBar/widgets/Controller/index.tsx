import ThemeSafeRoundButton from "@/renderer/components/ThemeSafeRoundButton";
import "./index.scss";
import trackPlayer from "@renderer/core/track-player";
import { useTranslation } from "react-i18next";
import { PlayerState } from "@/common/constant";
import { usePlayerState } from "@renderer/core/track-player/hooks";

export default function Controller() {
    const playerState = usePlayerState();
    const { t } = useTranslation();
    const isPlaying = playerState === PlayerState.Playing;

    return (
        <div className="music-controller">
            <ThemeSafeRoundButton
                title={t("music_bar.previous_music")}
                iconName="skip-left"
                size={42}
                iconSize={22}
                color="var(--musicBarText)"
                background="color-mix(in srgb, var(--musicBarText) 9%, var(--musicBarSurface))"
                hoverBackground="color-mix(in srgb, var(--musicBarText) 16%, var(--musicBarSurface))"
                borderColor="color-mix(in srgb, var(--musicBarText) 12%, transparent)"
                shadow="inset 0 1px 0 color-mix(in srgb, white 10%, transparent)"
                onClick={() => {
                    trackPlayer.skipToPrev();
                }}
            ></ThemeSafeRoundButton>
            <ThemeSafeRoundButton
                iconName={!isPlaying ? "play" : "pause"}
                size={54}
                iconSize={26}
                color="var(--musicBarPrimaryText)"
                background="var(--musicBarAccent)"
                hoverBackground="color-mix(in srgb, var(--musicBarAccent) 88%, white)"
                borderColor="color-mix(in srgb, var(--musicBarAccent) 68%, white)"
                shadow="0 10px 24px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.38)"
                onClick={() => {
                    if (isPlaying) {
                        trackPlayer.pause();
                    } else {
                        trackPlayer.resume();
                    }
                }}
            ></ThemeSafeRoundButton>
            <ThemeSafeRoundButton
                title={t("music_bar.next_music")}
                iconName="skip-right"
                size={42}
                iconSize={22}
                color="var(--musicBarText)"
                background="color-mix(in srgb, var(--musicBarText) 9%, var(--musicBarSurface))"
                hoverBackground="color-mix(in srgb, var(--musicBarText) 16%, var(--musicBarSurface))"
                borderColor="color-mix(in srgb, var(--musicBarText) 12%, transparent)"
                shadow="inset 0 1px 0 color-mix(in srgb, white 10%, transparent)"
                onClick={() => {
                    trackPlayer.skipToNext();
                }}
            ></ThemeSafeRoundButton>
        </div>
    );
}
