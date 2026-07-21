import ThemeSafeRoundButton from "@/renderer/components/ThemeSafeRoundButton";
import "./index.scss";
import trackPlayer from "@renderer/core/track-player";
import { useTranslation } from "react-i18next";
import { isPlaybackActive, RepeatMode } from "@/common/constant";
import { usePlayerState, useRepeatMode } from "@renderer/core/track-player/hooks";
import { musicDetailShownStore } from "@renderer/components/MusicDetail/store";
import { useEffect, useState, type CSSProperties } from "react";
import SvgAsset from "@/renderer/components/SvgAsset";
import useAppConfig from "@/hooks/useAppConfig";
import { appWindowUtil } from "@shared/utils/renderer";
import { isCN } from "@/shared/i18n/renderer";

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
    const repeatMode = useRepeatMode();
    const enableDesktopLyric = useAppConfig("lyric.enableDesktopLyric");
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
    const controllerStyle = matchDockButtons
        ? {
            "--flatDockButtonColor": skipColor,
            "--flatDockButtonBackground": skipBackground,
            "--flatDockButtonHoverBackground": skipHoverBackground,
            "--flatDockButtonBorder": skipBorder,
            "--flatDockButtonShadow": skipShadow,
        } as CSSProperties
        : undefined;

    const primaryColor = matchDockButtons
        ? "#ffffff"
        : isFlat
            ? "var(--musicBarPrimaryText)"
            : "var(--musicBarText)";
    const primaryBackground = matchDockButtons
        ? rootTheme.primary
        : isFlat
            ? "var(--musicBarAccent)"
            : "color-mix(in srgb, var(--musicBarText) 10%, transparent)";
    const primaryHoverBackground = matchDockButtons
        ? `color-mix(in srgb, ${rootTheme.primary} 88%, white)`
        : isFlat
            ? "color-mix(in srgb, var(--musicBarAccent) 88%, white)"
            : "color-mix(in srgb, var(--musicBarText) 16%, transparent)";
    const primaryBorder = matchDockButtons
        ? `color-mix(in srgb, ${rootTheme.primary} 68%, white)`
        : isFlat
            ? "color-mix(in srgb, var(--musicBarAccent) 68%, white)"
            : "color-mix(in srgb, var(--musicBarText) 18%, transparent)";
    const primaryShadow = isFlat
        ? "0 10px 24px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.38)"
        : "inset 0 1px 0 color-mix(in srgb, white 22%, transparent), 0 4px 14px color-mix(in srgb, black 12%, transparent)";

    const repeatTitle = repeatMode === RepeatMode.Loop
        ? t("media.music_repeat_mode_loop")
        : repeatMode === RepeatMode.Queue
            ? t("media.music_repeat_mode_queue")
            : t("media.music_repeat_mode_shuffle");
    const repeatIcon = repeatMode === RepeatMode.Loop
        ? "repeat-song"
        : repeatMode === RepeatMode.Queue
            ? "repeat-song-1"
            : "shuffle";

    return (
        <div className="music-controller" style={controllerStyle}>
            <button
                type="button"
                className="liquid-controller-button liquid-controller-edge liquid-controller-repeat"
                data-repeat-mode={repeatMode}
                title={repeatTitle}
                aria-label={repeatTitle}
                onClick={() => {
                    trackPlayer.toggleRepeatMode();
                }}
            >
                <SvgAsset iconName={repeatIcon} size={19}></SvgAsset>
            </button>
            <div className="music-controller-transport">
                <ThemeSafeRoundButton
                    className="liquid-controller-button liquid-controller-skip"
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
                    className="liquid-controller-button liquid-controller-primary"
                    title={isPlaying ? t("music_bar.pause") : t("music_bar.play")}
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
                    className="liquid-controller-button liquid-controller-skip"
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
            <button
                type="button"
                className="liquid-controller-button liquid-controller-edge liquid-controller-lyric"
                data-active={enableDesktopLyric ? "true" : "false"}
                title={t("music_bar.desktop_lyric")}
                aria-label={t("music_bar.desktop_lyric")}
                aria-pressed={!!enableDesktopLyric}
                onClick={async () => {
                    appWindowUtil.setLyricWindow(!enableDesktopLyric);
                }}
            >
                <SvgAsset iconName={isCN() ? "lyric" : "lyric-en"} size={19}></SvgAsset>
            </button>
        </div>
    );
}
