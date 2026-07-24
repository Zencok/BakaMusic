import AnimatedDiv from "../AnimatedDiv";
import "./index.scss";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { PlayerState, qualityText } from "@/common/constant";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import { useUserPreference } from "@/renderer/utils/user-perference";
import AppConfig from "@shared/app-config/renderer";
import { appUtil, appWindowUtil } from "@shared/utils/renderer";
import SvgAsset, { type SvgAssetIconNames } from "../SvgAsset";
import Lyric from "./widgets/Lyric";
import { useTranslation } from "react-i18next";
import {
    useCurrentMusic,
    usePlayerState,
    useQuality,
} from "@renderer/core/track-player/hooks";
import { useEffect, useRef, useState } from "react";
import { musicDetailShownStore } from "@renderer/components/MusicDetail/store";
import { isModalOpen } from "@/renderer/components/Modal";
import { isContextMenuOpen } from "@/renderer/components/ContextMenu";
import { isQualitySelectPopoverOpen } from "@/renderer/components/QualitySelectPopover";
import { getCurrentPanel } from "@/renderer/components/Panel";

export const isMusicDetailShown = musicDetailShownStore.getValue;
export const useMusicDetailShown = musicDetailShownStore.useValue;
const FULLSCREEN_CURSOR_IDLE_MS = 1600;

function MusicDetail() {
    const musicItem = useCurrentMusic();
    const playerState = usePlayerState();
    const quality = useQuality();
    const musicDetailShown = musicDetailShownStore.useValue();
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isFullscreenCursorHidden, setIsFullscreenCursorHidden] = useState(false);
    const [storedCoverStyle] = useUserPreference("musicDetailCoverStyle");
    const [storedVinylTonearm] = useUserPreference("musicDetailVinylTonearm");
    const [storedTonearmReach] = useUserPreference("musicDetailVinylTonearmReach");
    const [lyricPlayerReady, setLyricPlayerReady] = useState(false);
    const { t } = useTranslation();
    const isFullscreenRef = useRef(false);
    const lastF11ToggleAtRef = useRef(0);
    const immersiveOsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingImmersiveRef = useRef<boolean | null>(null);
    const cursorHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        isFullscreenRef.current = isFullscreen;
    }, [isFullscreen]);

    useEffect(() => {
        return () => {
            if (immersiveOsTimerRef.current !== null) {
                clearTimeout(immersiveOsTimerRef.current);
                immersiveOsTimerRef.current = null;
            }
            pendingImmersiveRef.current = null;
        };
    }, []);

    useEffect(() => {
        const clearCursorHideTimer = () => {
            if (cursorHideTimerRef.current !== null) {
                clearTimeout(cursorHideTimerRef.current);
                cursorHideTimerRef.current = null;
            }
        };

        if (!isFullscreen) {
            clearCursorHideTimer();
            setIsFullscreenCursorHidden(false);
            return;
        }

        const revealAndScheduleCursor = () => {
            setIsFullscreenCursorHidden(false);
            clearCursorHideTimer();
            cursorHideTimerRef.current = setTimeout(() => {
                cursorHideTimerRef.current = null;
                setIsFullscreenCursorHidden(true);
            }, FULLSCREEN_CURSOR_IDLE_MS);
        };

        revealAndScheduleCursor();
        window.addEventListener("pointermove", revealAndScheduleCursor, { passive: true });
        window.addEventListener("pointerdown", revealAndScheduleCursor, { passive: true });
        return () => {
            window.removeEventListener("pointermove", revealAndScheduleCursor);
            window.removeEventListener("pointerdown", revealAndScheduleCursor);
            clearCursorHideTimer();
        };
    }, [isFullscreen]);

    const applyImmersiveFullScreen = (next: boolean, options?: { osDelayMs?: number }) => {
        // Drive chrome CSS first; delay OS fullscreen so enter/exit motion can lead.
        if (immersiveOsTimerRef.current !== null) {
            clearTimeout(immersiveOsTimerRef.current);
            immersiveOsTimerRef.current = null;
        }

        pendingImmersiveRef.current = next;
        setIsFullscreen(next);
        isFullscreenRef.current = next;

        // Exit leads chrome longer so the topbar can ease back before the window shrinks.
        const delayMs = options?.osDelayMs ?? (next ? 48 : 240);
        const applyOs = () => {
            immersiveOsTimerRef.current = null;
            const setFs = appWindowUtil.setMainWindowFullScreen;
            if (typeof setFs === "function") {
                setFs(next);
                return;
            }
            // Fallback: toggle path returns the resulting state.
            const toggle = appWindowUtil.toggleMainWindowFullScreen;
            if (typeof toggle !== "function") {
                pendingImmersiveRef.current = null;
                return;
            }
            void toggle()
                .then((actual) => {
                    pendingImmersiveRef.current = null;
                    setIsFullscreen(Boolean(actual));
                })
                .catch(() => {
                    pendingImmersiveRef.current = null;
                    setIsFullscreen(!next);
                });
        };

        if (delayMs <= 0) {
            applyOs();
            return;
        }
        immersiveOsTimerRef.current = setTimeout(applyOs, delayMs);
    };

    const toggleImmersiveFullScreen = () => {
        // Main-process F11 + renderer backup can both fire; debounce to avoid no-op double toggle.
        const now = Date.now();
        if (now - lastF11ToggleAtRef.current < 420) {
            return;
        }
        lastF11ToggleAtRef.current = now;
        applyImmersiveFullScreen(!isFullscreenRef.current);
    };

    // Keep UI chrome in sync if the OS leaves fullscreen externally.
    useEffect(() => {
        const unsubscribe = appWindowUtil.onMainWindowFullScreenChanged?.((next) => {
            // Only track fullscreen while detail is open; never re-enter from other pages.
            if (!musicDetailShownStore.getValue()) {
                pendingImmersiveRef.current = null;
                setIsFullscreen(false);
                return;
            }
            const enabled = Boolean(next);
            // While chrome is intentionally leading OS, ignore opposite stale events.
            if (
                pendingImmersiveRef.current !== null
                && pendingImmersiveRef.current !== enabled
            ) {
                return;
            }
            pendingImmersiveRef.current = null;
            setIsFullscreen(enabled);
        });
        return () => {
            unsubscribe?.();
        };
    }, []);

    // Main-process F11 capture (before-input-event). Only act on the detail page.
    useEffect(() => {
        const unsubscribe = appWindowUtil.onMainWindowF11?.(() => {
            if (!musicDetailShownStore.getValue()) {
                return;
            }
            toggleImmersiveFullScreen();
        });
        return () => {
            unsubscribe?.();
        };
    }, []);

    // Leave OS fullscreen whenever the detail page is closed.
    useEffect(() => {
        if (musicDetailShown) {
            return;
        }
        if (!isFullscreenRef.current) {
            setIsFullscreen(false);
            return;
        }
        // Detail is closing — leave OS fullscreen immediately (no chrome exit lead).
        applyImmersiveFullScreen(false, { osDelayMs: 0 });
    }, [musicDetailShown]);

    useEffect(() => {
        // Escape only while detail is open. F11 is handled via main-process IPC above.
        if (!musicDetailShown) {
            return;
        }

        const keyHandler = (event: KeyboardEvent) => {
            const isF11 = event.code === "F11" || event.key === "F11";
            if (isF11) {
                // Backup path if main-process capture is unavailable.
                event.preventDefault();
                event.stopPropagation();
                toggleImmersiveFullScreen();
                return;
            }

            if (event.code !== "Escape" && event.key !== "Escape") {
                return;
            }

            // Higher layers own Escape first
            if (
                isQualitySelectPopoverOpen()
                || isModalOpen()
                || isContextMenuOpen()
                || getCurrentPanel()?.type
            ) {
                return;
            }

            event.preventDefault();

            // Exit fullscreen first; second Escape closes the detail page.
            if (isFullscreenRef.current) {
                applyImmersiveFullScreen(false);
                return;
            }

            musicDetailShownStore.setValue(false);
        };

        // Capture phase so focused inputs / webviews cannot swallow Escape / F11 first.
        window.addEventListener("keydown", keyHandler, true);
        return () => {
            window.removeEventListener("keydown", keyHandler, true);
        };
    }, [musicDetailShown]);

    const artwork = musicItem?.coverImg || musicItem?.artwork || albumImg;
    const qualityLabel = quality ? (qualityText[quality] || quality).replace(/^.*?\s/, "") : null;
    const title = musicItem?.title || t("media.unknown_title");
    const subtitle = [musicItem?.artist || t("media.unknown_artist"), musicItem?.album]
        .filter(Boolean)
        .join(" · ");
    const coverStyle = storedCoverStyle === "cover" ? "cover" : "vinyl";
    const vinylTonearm =
        storedVinylTonearm === "glass" || storedVinylTonearm === "classic"
            ? storedVinylTonearm
            : "none";
    const tonearmReach = storedTonearmReach === "inner" ? "inner" : "outer";

    return (
        <AnimatedDiv
            showIf={musicDetailShown}
            keepMounted
            className="music-detail--container"
            aria-hidden={!musicDetailShown}
            inert={!musicDetailShown}
            data-fullscreen={isFullscreen ? "true" : "false"}
            data-cursor-hidden={isFullscreenCursorHidden ? "true" : "false"}
            mountClassName="music-detail--enter"
            unmountClassName="music-detail--exit"
            onMountAnimationEnd={() => {
                // Let the lightweight stage finish its first paint before AMLL
                // creates and measures the word-by-word lyric DOM.
                setLyricPlayerReady(true);
            }}
        >
            <div
                className="music-detail-background"
                style={
                    {
                        // Component-owned artwork input; theme controls the surrounding stage.
                        ["--music-detail-artwork" as string]: `url(${artwork})`,
                    }
                }
            ></div>
            <div className="music-detail-overlay"></div>

            <div className="music-detail-shell">
                <div className="music-detail-topbar-slot">
                    <div className="music-detail-topbar">
                        <div className="music-detail-topbar-left">
                            <RoundButton
                                iconName="chevron-double-down"
                                title={t("music_bar.close_music_detail_page")}
                                onClick={() => {
                                    musicDetailShownStore.setValue(false);
                                }}
                            ></RoundButton>

                            <div className="music-detail-info-bar">
                                <img
                                    alt={title}
                                    className="music-detail-info-artwork"
                                    onError={setFallbackAlbum}
                                    src={artwork}
                                ></img>
                                <div className="music-detail-info-copy">
                                    <div className="music-detail-info-title" title={title}>
                                        {title}
                                    </div>
                                    <div className="music-detail-info-meta-row">
                                        <div className="music-detail-info-subtitle" title={subtitle}>
                                            {subtitle}
                                        </div>
                                        {musicItem?.platform ? (
                                            <div className="music-detail-info-badge">
                                                {musicItem.platform}
                                            </div>
                                        ) : null}
                                        {qualityLabel ? (
                                            <div className="music-detail-info-badge music-detail-info-badge--strong">
                                                {qualityLabel}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="music-detail-topbar-right">
                            <RoundButton
                                iconName="minus"
                                title={t("app_header.minimize")}
                                onClick={() => {
                                    appWindowUtil.minMainWindow();
                                }}
                            ></RoundButton>
                            <RoundButton
                                iconName="square"
                                title=""
                                onClick={() => {
                                    appWindowUtil.toggleMainWindowMaximize();
                                }}
                            ></RoundButton>
                            <RoundButton
                                iconName="x-mark"
                                title={t("app_header.exit")}
                                onClick={() => {
                                    const closeBehavior = AppConfig.getConfig("normal.closeBehavior");
                                    if (closeBehavior === "minimize") {
                                        appWindowUtil.minMainWindow(true);
                                    } else {
                                        appUtil.exitApp();
                                    }
                                }}
                            ></RoundButton>
                        </div>
                    </div>
                </div>

                <div className="music-detail-content">
                    <div className="music-detail-primary-column">
                        <div
                            className="music-detail-primary-stage"
                            data-cover-style={coverStyle}
                        >
                            {coverStyle === "vinyl" ? (
                                <div
                                    className="music-detail-vinyl-player"
                                    data-playing={playerState === PlayerState.Playing}
                                >
                                    {vinylTonearm === "glass" ? (
                                        <GlassVinylTonearm reach={tonearmReach}></GlassVinylTonearm>
                                    ) : null}
                                    {vinylTonearm === "classic" ? (
                                        <ClassicVinylTonearm reach={tonearmReach}></ClassicVinylTonearm>
                                    ) : null}
                                    <div className="music-detail-vinyl-cover">
                                        <div className="music-detail-vinyl-record"></div>
                                        <div className="music-detail-vinyl-label">
                                            <img
                                                alt={title}
                                                className="music-detail-vinyl-artwork"
                                                onError={setFallbackAlbum}
                                                src={artwork}
                                            ></img>
                                            <div className="music-detail-vinyl-label-shine"></div>
                                        </div>
                                        <div className="music-detail-vinyl-center-hole"></div>
                                    </div>
                                </div>
                            ) : (
                                <img
                                    alt={title}
                                    className="music-detail-artwork"
                                    onError={setFallbackAlbum}
                                    src={artwork}
                                ></img>
                            )}
                        </div>
                    </div>

                    <div className="music-detail-lyric-column">
                        <Lyric
                            active={musicDetailShown}
                            playerReady={lyricPlayerReady}
                        ></Lyric>
                    </div>
                </div>
            </div>
        </AnimatedDiv>
    );
}

interface IButtonProps {
    iconName: SvgAssetIconNames;
    title?: string;
    onClick: () => void;
}

function RoundButton({ iconName, onClick, title }: IButtonProps) {
    return (
        <div
            className="music-detail-round-button"
            title={title}
            role="button"
            onClick={onClick}
        >
            <SvgAsset iconName={iconName}></SvgAsset>
        </div>
    );
}

interface ITonearmProps {
    reach: "outer" | "inner";
}

function GlassVinylTonearm({ reach }: ITonearmProps) {
    return (
        <div
            className="music-detail-vinyl-tonearm"
            data-reach={reach}
            aria-hidden="true"
        >
            <div className="music-detail-vinyl-tonearm-assembly">
                <svg
                    className="music-detail-vinyl-tonearm-svg"
                    viewBox="0 0 300 640"
                    focusable="false"
                >
                    <defs>
                        <linearGradient
                            id="musicDetailTonearmTubeGradient"
                            x1="0"
                            y1="0"
                            x2="1"
                            y2="1"
                        >
                            <stop offset="0" stopColor="#ffffff" stopOpacity="0.5"></stop>
                            <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.2"></stop>
                            <stop offset="1" stopColor="#ffffff" stopOpacity="0.36"></stop>
                        </linearGradient>
                        <linearGradient
                            id="musicDetailTonearmShellGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                        >
                            <stop offset="0" stopColor="#ffffff" stopOpacity="0.44"></stop>
                            <stop offset="1" stopColor="#ffffff" stopOpacity="0.16"></stop>
                        </linearGradient>
                    </defs>
                    <rect
                        className="music-detail-vinyl-tonearm-counterweight"
                        x="210"
                        y="-58"
                        width="60"
                        height="58"
                        rx="28"
                    ></rect>
                    <path
                        className="music-detail-vinyl-tonearm-tube-border"
                        d="M240 40 C258 250 217 476 144 584"
                    ></path>
                    <path
                        className="music-detail-vinyl-tonearm-tube"
                        d="M240 40 C258 250 217 476 144 584"
                    ></path>
                    <path
                        className="music-detail-vinyl-tonearm-tube-core"
                        d="M234 46 C251 250 211 470 139 577"
                    ></path>
                    <g transform="translate(144 584) rotate(34)">
                        <rect
                            className="music-detail-vinyl-tonearm-headshell"
                            x="-26"
                            y="-10"
                            width="52"
                            height="78"
                            rx="16"
                        ></rect>
                        <circle
                            className="music-detail-vinyl-tonearm-stylus-glow"
                            cx="0"
                            cy="52"
                            r="20"
                        ></circle>
                        <circle
                            className="music-detail-vinyl-tonearm-stylus"
                            cx="0"
                            cy="52"
                            r="9"
                        ></circle>
                    </g>
                </svg>
            </div>
            <div className="music-detail-vinyl-tonearm-base">
                <div className="music-detail-vinyl-tonearm-base-cap"></div>
            </div>
        </div>
    );
}

function ClassicVinylTonearm({ reach }: ITonearmProps) {
    return (
        <div
            className="music-detail-vinyl-tonearm-classic"
            data-reach={reach}
            aria-hidden="true"
        >
            <div className="music-detail-vinyl-tonearm-classic-assembly">
                <svg
                    className="music-detail-vinyl-tonearm-classic-svg"
                    viewBox="0 0 230 410"
                    focusable="false"
                >
                    <path
                        className="music-detail-vinyl-tonearm-classic-arm"
                        d="M179 46 L174.3 -3.8"
                    ></path>
                    <rect
                        className="music-detail-vinyl-tonearm-classic-counterweight"
                        x="162"
                        y="-10.8"
                        width="26"
                        height="30"
                        rx="9"
                        transform="rotate(-5.4 175 4.2)"
                    ></rect>
                    <path
                        className="music-detail-vinyl-tonearm-classic-arm"
                        d="M179 46 C190.3 177.3 164.6 318.5 119 386"
                    ></path>
                    <path
                        className="music-detail-vinyl-tonearm-classic-arm-shade"
                        d="M182.5 47.4 C193.8 178.7 168.1 319.9 122.5 387.4"
                    ></path>
                    <g transform="rotate(34 119 386)">
                        <rect
                            className="music-detail-vinyl-tonearm-classic-cartridge"
                            x="109"
                            y="379"
                            width="20"
                            height="14"
                            rx="4"
                        ></rect>
                        <rect
                            className="music-detail-vinyl-tonearm-classic-head"
                            x="106"
                            y="393"
                            width="26"
                            height="30"
                            rx="5"
                        ></rect>
                        <line
                            className="music-detail-vinyl-tonearm-classic-groove"
                            x1="114"
                            y1="413"
                            x2="114"
                            y2="420"
                        ></line>
                        <line
                            className="music-detail-vinyl-tonearm-classic-groove"
                            x1="124"
                            y1="413"
                            x2="124"
                            y2="420"
                        ></line>
                    </g>
                </svg>
            </div>
            <div className="music-detail-vinyl-tonearm-classic-base">
                <div className="music-detail-vinyl-tonearm-classic-base-cap"></div>
            </div>
        </div>
    );
}

MusicDetail.show = () => {
    musicDetailShownStore.setValue(true);
};

MusicDetail.hide = () => {
    musicDetailShownStore.setValue(false);
};

export default MusicDetail;
