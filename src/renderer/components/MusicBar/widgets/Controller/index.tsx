import ThemeSafeRoundButton from "@/renderer/components/ThemeSafeRoundButton";
import "./index.scss";
import trackPlayer from "@renderer/core/track-player";
import { useTranslation } from "react-i18next";
import { isPlaybackActive } from "@/common/constant";
import { usePlayerState } from "@renderer/core/track-player/hooks";
import { musicDetailShownStore } from "@renderer/components/MusicDetail/store";
import { useEffect, useState } from "react";

function isFlatUiStyleActive() {
    return typeof document !== "undefined"
        && document.documentElement.getAttribute("data-ui-style") === "flat";
}

/** Read theme tokens from <html> so bar-local --textColor remaps can't wash out icons */
function readRootThemeColors() {
    if (typeof document === "undefined") {
        return {
            text: "#333333",
            background: "#fdfdfd",
            primary: "#f17d34",
        };
    }
    const root = getComputedStyle(document.documentElement);
    return {
        text: root.getPropertyValue("--textColor").trim() || "#333333",
        background: root.getPropertyValue("--backgroundColor").trim() || "#fdfdfd",
        primary: root.getPropertyValue("--primaryColor").trim() || "#f17d34",
    };
}

export default function Controller() {
    const playerState = usePlayerState();
    const { t } = useTranslation();
    const isPlaying = isPlaybackActive(playerState);
    const musicDetailShown = musicDetailShownStore.useValue();
    const [isFlat, setIsFlat] = useState(isFlatUiStyleActive);
    const [, setThemeTick] = useState(0);

    useEffect(() => {
        const root = document.documentElement;
        const sync = () => {
            setIsFlat(isFlatUiStyleActive());
            setThemeTick((value) => value + 1);
        };
        sync();
        const observer = new MutationObserver(sync);
        // Themepack may rewrite style attribute / class on root
        observer.observe(root, {
            attributes: true,
            attributeFilter: ["data-ui-style", "style", "class"],
        });
        return () => observer.disconnect();
    }, []);

    // Flat + detail remaps --textColor / --musicBarText to white on the bar shell.
    // Resolve dock colors from documentElement so prev/next stay identical to collapsed.
    const matchDockButtons = isFlat && musicDetailShown;
    const rootTheme = readRootThemeColors();

    const skipColor = matchDockButtons ? rootTheme.text : "var(--musicBarText)";
    const skipBackground = matchDockButtons
        ? `color-mix(in srgb, ${rootTheme.text} 9%, ${rootTheme.background})`
        : "color-mix(in srgb, var(--musicBarText) 9%, var(--musicBarSurface))";
    const skipHoverBackground = matchDockButtons
        ? `color-mix(in srgb, ${rootTheme.text} 16%, ${rootTheme.background})`
        : "color-mix(in srgb, var(--musicBarText) 16%, var(--musicBarSurface))";
    const skipBorder = matchDockButtons
        ? `color-mix(in srgb, ${rootTheme.text} 12%, transparent)`
        : "color-mix(in srgb, var(--musicBarText) 12%, transparent)";
    const skipShadow = "inset 0 1px 0 color-mix(in srgb, white 10%, transparent)";

    const primaryColor = matchDockButtons ? "#ffffff" : "var(--musicBarPrimaryText)";
    const primaryBackground = matchDockButtons ? rootTheme.primary : "var(--musicBarAccent)";
    const primaryHoverBackground = matchDockButtons
        ? `color-mix(in srgb, ${rootTheme.primary} 88%, white)`
        : "color-mix(in srgb, var(--musicBarAccent) 88%, white)";
    const primaryBorder = matchDockButtons
        ? `color-mix(in srgb, ${rootTheme.primary} 68%, white)`
        : "color-mix(in srgb, var(--musicBarAccent) 68%, white)";
    const primaryShadow =
        "0 10px 24px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.38)";

    return (
        <div className="music-controller">
            <ThemeSafeRoundButton
                title={t("music_bar.previous_music")}
                iconName="skip-left"
                size={42}
                iconSize={22}
                color={skipColor}
                background={skipBackground}
                hoverBackground={skipHoverBackground}
                borderColor={skipBorder}
                shadow={skipShadow}
                onClick={() => {
                    trackPlayer.skipToPrev();
                }}
            ></ThemeSafeRoundButton>
            <ThemeSafeRoundButton
                iconName={!isPlaying ? "play" : "pause"}
                size={54}
                iconSize={26}
                color={primaryColor}
                background={primaryBackground}
                hoverBackground={primaryHoverBackground}
                borderColor={primaryBorder}
                shadow={primaryShadow}
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
                color={skipColor}
                background={skipBackground}
                hoverBackground={skipHoverBackground}
                borderColor={skipBorder}
                shadow={skipShadow}
                onClick={() => {
                    trackPlayer.skipToNext();
                }}
            ></ThemeSafeRoundButton>
        </div>
    );
}
