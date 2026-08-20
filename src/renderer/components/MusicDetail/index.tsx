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
import { useCallback, useEffect, useRef, useState } from "react";
import { musicDetailShownStore } from "@renderer/components/MusicDetail/store";
import { isModalOpen } from "@/renderer/components/Modal";
import { isContextMenuOpen } from "@/renderer/components/ContextMenu";
import { isQualitySelectPopoverOpen } from "@/renderer/components/QualitySelectPopover";
import { getCurrentPanel } from "@/renderer/components/Panel";
import normalizeArtworkDisplaySrc from "@/renderer/utils/normalize-artwork-display-src";
import useAppConfig from "@/hooks/useAppConfig";
import ClassicAmlLDetail from "./widgets/ClassicAmlLDetail";

export const isMusicDetailShown = musicDetailShownStore.getValue;
export const useMusicDetailShown = musicDetailShownStore.useValue;
const FULLSCREEN_CURSOR_IDLE_MS = 1600;
// The OS fullscreen snap is un-animatable: the veil keyframes duck content to
// opacity 0, hold while native bounds change, then rise. OS delays land the
// snap inside the hold; phase timers outlive the longest (trail) keyframe.
const IMMERSIVE_OS_ENTER_DELAY_MS = 120;
const IMMERSIVE_OS_EXIT_DELAY_MS = 160;
const IMMERSIVE_BUSY_MS = 950;
// 400ms (not 360) so a reversal can never land inside the previous veil's
// opacity-0 trail hold (enter hold ends 392ms, exit 388ms) — a mid-hold
// animation restart would flash the lyric column from invisible to opaque.
// Must stay equal to the bootstrap global F11 debounce.
const IMMERSIVE_TOGGLE_DEBOUNCE_MS = 400;
const IMMERSIVE_PHASE_ENTER_MS = 880;
const IMMERSIVE_PHASE_EXIT_MS = 750;

function MusicDetail() {
    const musicItem = useCurrentMusic();
    const playerState = usePlayerState();
    const quality = useQuality();
    const musicDetailShown = musicDetailShownStore.useValue();
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isImmersiveBusy, setIsImmersiveBusy] = useState(false);
    const [immersivePhase, setImmersivePhase] = useState<"idle" | "enter" | "exit">("idle");
    const [isFullscreenCursorHidden, setIsFullscreenCursorHidden] = useState(false);
    const [storedCoverStyle] = useUserPreference("musicDetailCoverStyle");
    const [storedVinylTonearm] = useUserPreference("musicDetailVinylTonearm");
    const [storedTonearmReach] = useUserPreference("musicDetailVinylTonearmReach");
    const classicAmllPlaybackDetail = useAppConfig("normal.classicAmllPlaybackDetail") === true;
    const [lyricPlayerReady, setLyricPlayerReady] = useState(false);
    const { t } = useTranslation();
    const isFullscreenRef = useRef(false);
    const lastF11ToggleAtRef = useRef(0);
    const immersiveOsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const immersiveBusyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const immersivePhaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const immersiveOsFrameRef = useRef<number | null>(null);
    const pendingImmersiveRef = useRef<boolean | null>(null);
    const cursorHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        isFullscreenRef.current = isFullscreen;
    }, [isFullscreen]);

    const clearImmersiveSchedulers = useCallback(() => {
        if (immersiveOsTimerRef.current !== null) {
            clearTimeout(immersiveOsTimerRef.current);
            immersiveOsTimerRef.current = null;
        }
        if (immersiveBusyTimerRef.current !== null) {
            clearTimeout(immersiveBusyTimerRef.current);
            immersiveBusyTimerRef.current = null;
        }
        if (immersiveOsFrameRef.current !== null) {
            cancelAnimationFrame(immersiveOsFrameRef.current);
            immersiveOsFrameRef.current = null;
        }
        if (immersivePhaseTimerRef.current !== null) {
            clearTimeout(immersivePhaseTimerRef.current);
            immersivePhaseTimerRef.current = null;
        }
        if (pendingReconcileTimerRef.current !== null) {
            clearTimeout(pendingReconcileTimerRef.current);
            pendingReconcileTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        return () => {
            clearImmersiveSchedulers();
            pendingImmersiveRef.current = null;
        };
    }, [clearImmersiveSchedulers]);

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

    const markImmersiveBusy = useCallback(() => {
        setIsImmersiveBusy(true);
        if (immersiveBusyTimerRef.current !== null) {
            clearTimeout(immersiveBusyTimerRef.current);
        }
        immersiveBusyTimerRef.current = setTimeout(() => {
            immersiveBusyTimerRef.current = null;
            setIsImmersiveBusy(false);
        }, IMMERSIVE_BUSY_MS);
    }, []);

    // Veil lifecycle: the phase attribute must return to "idle" on every path,
    // or animation fill-mode would strand the columns at their keyframe state.
    const markImmersivePhase = useCallback((next: boolean) => {
        if (immersivePhaseTimerRef.current !== null) {
            clearTimeout(immersivePhaseTimerRef.current);
        }
        setImmersivePhase(next ? "enter" : "exit");
        immersivePhaseTimerRef.current = setTimeout(() => {
            immersivePhaseTimerRef.current = null;
            setImmersivePhase("idle");
        }, next ? IMMERSIVE_PHASE_ENTER_MS : IMMERSIVE_PHASE_EXIT_MS);
    }, []);

    // A led toggle that never yields a fullscreen-changed event (the OS side was
    // debounced away, or the window was already in the target state) would leave
    // pendingImmersiveRef walling off every later event forever, with chrome and
    // OS inverted. After the veil settles, reconcile chrome against reality.
    const schedulePendingReconcile = useCallback(() => {
        if (pendingReconcileTimerRef.current !== null) {
            clearTimeout(pendingReconcileTimerRef.current);
        }
        pendingReconcileTimerRef.current = setTimeout(() => {
            pendingReconcileTimerRef.current = null;
            if (pendingImmersiveRef.current === null) {
                return;
            }
            void appWindowUtil.isMainWindowFullScreen?.().then((enabled) => {
                if (
                    pendingImmersiveRef.current === null
                    || !musicDetailShownStore.getValue()
                ) {
                    return;
                }
                pendingImmersiveRef.current = null;
                const actual = Boolean(enabled);
                if (actual !== isFullscreenRef.current) {
                    markImmersiveBusy();
                    markImmersivePhase(actual);
                }
                setIsFullscreen(actual);
                isFullscreenRef.current = actual;
            });
        }, IMMERSIVE_BUSY_MS);
    }, [markImmersiveBusy, markImmersivePhase]);

    const applyImmersiveFullScreen = useCallback((
        next: boolean,
        options?: { osDelayMs?: number },
    ) => {
        // Drive chrome CSS first; delay OS fullscreen so enter/exit motion can lead.
        clearImmersiveSchedulers();

        pendingImmersiveRef.current = next;
        setIsFullscreen(next);
        isFullscreenRef.current = next;
        markImmersiveBusy();
        markImmersivePhase(next);
        schedulePendingReconcile();

        // The OS delay lands the native snap inside the veil's opacity-0 hold.
        const delayMs = options?.osDelayMs
            ?? (next ? IMMERSIVE_OS_ENTER_DELAY_MS : IMMERSIVE_OS_EXIT_DELAY_MS);
        const applyOs = () => {
            immersiveOsTimerRef.current = null;
            immersiveOsFrameRef.current = null;
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
                    isFullscreenRef.current = Boolean(actual);
                })
                .catch(() => {
                    pendingImmersiveRef.current = null;
                    setIsFullscreen(!next);
                    isFullscreenRef.current = !next;
                });
        };

        if (delayMs <= 0) {
            applyOs();
            return;
        }

        // Enter: wait one paint so data-fullscreen styles apply before native bounds change.
        if (next && options?.osDelayMs === undefined) {
            immersiveOsFrameRef.current = requestAnimationFrame(() => {
                immersiveOsFrameRef.current = requestAnimationFrame(() => {
                    immersiveOsTimerRef.current = setTimeout(applyOs, Math.max(0, delayMs - 32));
                });
            });
            return;
        }

        immersiveOsTimerRef.current = setTimeout(applyOs, delayMs);
    }, [
        clearImmersiveSchedulers,
        markImmersiveBusy,
        markImmersivePhase,
        schedulePendingReconcile,
    ]);

    const toggleImmersiveFullScreen = useCallback(() => {
        // Main-process F11 + renderer backup can both fire; debounce to avoid no-op double toggle.
        const now = Date.now();
        if (now - lastF11ToggleAtRef.current < IMMERSIVE_TOGGLE_DEBOUNCE_MS) {
            return;
        }
        lastF11ToggleAtRef.current = now;
        applyImmersiveFullScreen(!isFullscreenRef.current);
    }, [applyImmersiveFullScreen]);

    // Keep immersive chrome in sync with OS fullscreen while detail is open.
    useEffect(() => {
        const unsubscribe = appWindowUtil.onMainWindowFullScreenChanged?.((next) => {
            if (!musicDetailShownStore.getValue()) {
                pendingImmersiveRef.current = null;
                setIsFullscreen(false);
                isFullscreenRef.current = false;
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
            // OS-driven flip with no chrome lead (external toggle, or an F11 that
            // only bootstrap's debounce accepted): the snap already landed, so the
            // veil can only settle content afterwards — still better than a jump.
            if (
                pendingImmersiveRef.current === null
                && enabled !== isFullscreenRef.current
            ) {
                markImmersiveBusy();
                markImmersivePhase(enabled);
            }
            pendingImmersiveRef.current = null;
            setIsFullscreen(enabled);
            isFullscreenRef.current = enabled;
        });
        return () => {
            unsubscribe?.();
        };
    }, [markImmersiveBusy, markImmersivePhase]);

    // F11 OS toggle is global (bootstrap). Here only lead immersive chrome when open.
    useEffect(() => {
        const unsubscribe = appWindowUtil.onMainWindowF11?.(() => {
            // Keep this debounce clock in lockstep with bootstrap's global F11
            // handler: record every accepted press even while the detail page is
            // hidden, so both sides always agree on which press wins.
            const now = Date.now();
            if (now - lastF11ToggleAtRef.current < IMMERSIVE_TOGGLE_DEBOUNCE_MS) {
                return;
            }
            lastF11ToggleAtRef.current = now;
            if (!musicDetailShownStore.getValue()) {
                return;
            }
            const next = !isFullscreenRef.current;
            pendingImmersiveRef.current = next;
            setIsFullscreen(next);
            isFullscreenRef.current = next;
            markImmersiveBusy();
            markImmersivePhase(next);
            schedulePendingReconcile();
        });
        return () => {
            unsubscribe?.();
        };
    }, [markImmersiveBusy, markImmersivePhase, schedulePendingReconcile]);

    // Opening: adopt current OS fullscreen as immersive chrome.
    // Closing: clear chrome only — keep the main window fullscreen if it was.
    useEffect(() => {
        if (musicDetailShown) {
            void appWindowUtil.isMainWindowFullScreen?.().then((enabled) => {
                if (!musicDetailShownStore.getValue()) {
                    return;
                }
                const next = Boolean(enabled);
                pendingImmersiveRef.current = null;
                setIsFullscreen(next);
                isFullscreenRef.current = next;
                if (next) {
                    markImmersiveBusy();
                }
            });
            return;
        }

        // A pending delayed OS apply (e.g. Escape scheduled a fullscreen exit,
        // then a second Escape closed the page) must be flushed, not cancelled —
        // cancelling would strand the window fullscreen with no chrome leading.
        if (
            immersiveOsTimerRef.current !== null
            && pendingImmersiveRef.current !== null
            && typeof appWindowUtil.setMainWindowFullScreen === "function"
        ) {
            appWindowUtil.setMainWindowFullScreen(pendingImmersiveRef.current);
        }
        clearImmersiveSchedulers();
        pendingImmersiveRef.current = null;
        setIsFullscreen(false);
        isFullscreenRef.current = false;
        setIsImmersiveBusy(false);
        setImmersivePhase("idle");
    }, [clearImmersiveSchedulers, markImmersiveBusy, musicDetailShown]);

    useEffect(() => {
        // Escape only while detail is open. F11 is owned globally + chrome lead above.
        if (!musicDetailShown) {
            return;
        }

        const keyHandler = (event: KeyboardEvent) => {
            const isF11 = event.code === "F11" || event.key === "F11";
            if (isF11) {
                // Main process usually owns F11; keep a backup toggle if IPC is missing.
                event.preventDefault();
                event.stopPropagation();
                if (typeof appWindowUtil.onMainWindowF11 !== "function") {
                    toggleImmersiveFullScreen();
                }
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

            // Exit immersive chrome/OS first; second Escape closes the detail page.
            // Closing detail itself does not leave OS fullscreen.
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
    }, [applyImmersiveFullScreen, musicDetailShown, toggleImmersiveFullScreen]);

    const rawArtwork = musicItem?.coverImg || musicItem?.artwork || albumImg;
    const [artwork, setArtwork] = useState(rawArtwork);
    useEffect(() => {
        let canceled = false;
        setArtwork(rawArtwork);
        void normalizeArtworkDisplaySrc(rawArtwork).then((nextArtwork) => {
            if (!canceled) {
                setArtwork(nextArtwork ?? rawArtwork);
            }
        });
        return () => {
            canceled = true;
        };
    }, [rawArtwork]);
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
            inert={!musicDetailShown}
            data-fullscreen={isFullscreen ? "true" : "false"}
            data-immersive-busy={isImmersiveBusy ? "true" : "false"}
            data-immersive-phase={immersivePhase}
            data-cursor-hidden={isFullscreenCursorHidden ? "true" : "false"}
            data-playback-detail={classicAmllPlaybackDetail ? "classic-amll" : "default"}
            style={
                {
                    // Component-owned artwork input, inherited by the backdrop
                    // frost and the stage's ambient glow alike.
                    ["--music-detail-artwork" as string]: `url(${artwork})`,
                }
            }
            mountClassName="music-detail--enter"
            unmountClassName="music-detail--exit"
            onMountAnimationEnd={() => {
                // Let the lightweight stage finish its first paint before AMLL
                // creates and measures the word-by-word lyric DOM.
                setLyricPlayerReady(true);
            }}
        >
            {classicAmllPlaybackDetail ? (
                <ClassicAmlLDetail
                    active={musicDetailShown}
                    playerReady={lyricPlayerReady}
                    artwork={artwork}
                    title={title}
                    artist={musicItem?.artist || t("media.unknown_artist")}
                    album={musicItem?.album}
                    qualityLabel={qualityLabel}
                    onClose={() => musicDetailShownStore.setValue(false)}
                ></ClassicAmlLDetail>
            ) : (
                <>
                    <div className="music-detail-background"></div>
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
                                            referrerPolicy="no-referrer"
                                        ></img>
                                        <div className="music-detail-info-copy">
                                            <div className="music-detail-info-title" title={title}>
                                                {title}
                                            </div>
                                            <div className="music-detail-info-meta-row">
                                                <div
                                                    className="music-detail-info-subtitle"
                                                    title={subtitle}
                                                >
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
                                            const closeBehavior = AppConfig.getConfig(
                                                "normal.closeBehavior",
                                            );
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
                                                <GlassVinylTonearm
                                                    reach={tonearmReach}
                                                ></GlassVinylTonearm>
                                            ) : null}
                                            {vinylTonearm === "classic" ? (
                                                <ClassicVinylTonearm
                                                    reach={tonearmReach}
                                                ></ClassicVinylTonearm>
                                            ) : null}
                                            <div className="music-detail-vinyl-cover">
                                                <div className="music-detail-vinyl-record"></div>
                                                <div className="music-detail-vinyl-label">
                                                    <img
                                                        alt={title}
                                                        className="music-detail-vinyl-artwork"
                                                        onError={setFallbackAlbum}
                                                        src={artwork}
                                                        referrerPolicy="no-referrer"
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
                                            referrerPolicy="no-referrer"
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
                </>
            )}
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
