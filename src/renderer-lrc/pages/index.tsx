import "./index.scss";
import classNames from "@/renderer/utils/classnames";
import { createFallbackAmlLyricLines, estimateLyricClockProgressMs, mapLyricLinesToAml } from "@/common/amll-lyric";
import { isPlaybackActive, PlayerState } from "@/common/constant";
import useAppConfig from "@/hooks/useAppConfig";
import SvgAsset, { type SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import AppleMusicLyricPlayer from "@renderer/components/AppleMusicLyricPlayer";
import useFramelessWindowResize, { FramelessResizeAxis } from "@/hooks/useFramelessWindowResize";
import AppConfig from "@shared/app-config/renderer";
import messageBus, { useAppStatePartial } from "@shared/message-bus/renderer/extension";
import { appWindowUtil } from "@shared/utils/renderer";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const BASE_FONT_SIZE = 24;
const MIN_DISPLAY_FONT_SIZE = 16;
const MAX_DISPLAY_FONT_SIZE = 80;
const HOVER_VISIBLE_MS = 1000;
const LINE_TIMED_INACTIVE_OPACITY = 0.62;

interface IDragState {
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    startWindowX: number;
    startWindowY: number;
    width: number;
    height: number;
}

export default function LyricWindowPage() {
    const { t } = useTranslation();
    const currentMusic = useAppStatePartial("musicItem");
    const playerState = useAppStatePartial("playerState");
    const currentFullLyric = useAppStatePartial("fullLyric");
    const progress = useAppStatePartial("progress");
    const duration = useAppStatePartial("duration");
    const lyricClock = useAppStatePartial("lyricClock");
    const lockLyric = useAppConfig("lyric.lockLyric");
    const fontDataConfig = useAppConfig("lyric.fontData");
    const fontSizeConfig = useAppConfig("lyric.fontSize");
    const fontColorConfig = useAppConfig("lyric.fontColor");
    const applyFontColorOnlyToPlayedLines = useAppConfig("lyric.applyFontColorOnlyToPlayedLines");
    const inactiveBrightnessConfig = useAppConfig("lyric.inactiveBrightness");
    const showTranslation = useAppConfig("lyric.showTranslation");
    const showRomanization = useAppConfig("lyric.showRomanization");
    const [isHovered, setIsHovered] = useState(false);
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
    const dragStateRef = useRef<IDragState | null>(null);
    const dragRafRef = useRef(0);
    const pendingBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

    const {
        startResize,
        resizeWindow,
        stopResize,
        cancelResize,
    } = useFramelessWindowResize({ disabled: !!lockLyric });

    useEffect(() => {
        if (lockLyric) {
            setIsHovered(false);
            return undefined;
        }

        let hoverTimer = 0;
        const hideHover = () => {
            setIsHovered(false);
            hoverTimer = 0;
        };
        const scheduleHide = () => {
            if (hoverTimer) {
                window.clearTimeout(hoverTimer);
            }
            hoverTimer = window.setTimeout(hideHover, HOVER_VISIBLE_MS);
        };
        const handleMouseMove = () => {
            setIsHovered(true);
            scheduleHide();
        };
        const handleMouseLeave = () => {
            if (hoverTimer) {
                window.clearTimeout(hoverTimer);
                hoverTimer = 0;
            }
            setIsHovered(false);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseleave", handleMouseLeave);

        return () => {
            if (hoverTimer) {
                window.clearTimeout(hoverTimer);
            }
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseleave", handleMouseLeave);
        };
    }, [lockLyric]);

    useEffect(() => {
        if (!lockLyric) {
            return undefined;
        }
        cancelResize();
        return undefined;
    }, [cancelResize, lockLyric]);

    useEffect(() => {
        const handleResize = () => {
            setViewportWidth(window.innerWidth);
        };
        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, []);

    const lyricLines = useMemo(() => {
        const mappedLines = mapLyricLinesToAml(currentFullLyric ?? [], {
            includeTranslation: !!showTranslation,
            includeRomanization: !!showRomanization,
        });

        if (mappedLines.length) {
            return mappedLines;
        }

        return createFallbackAmlLyricLines(currentMusic);
    }, [currentFullLyric, currentMusic, showRomanization, showTranslation]);

    const title = currentMusic?.title || "BakaMusic";
    const artist = currentMusic?.artist;
    const subtitle = [artist, currentMusic?.album]
        .filter(Boolean)
        .join(" - ") || t("desktop_lyric.subtitle");
    const songInfo = subtitle ? `${title} - ${subtitle}` : title;
    const platform = currentMusic?.platform || currentMusic?._musicSheetPlatform;
    const displayTitle = artist ? `${title} - ${artist}` : title;
    const lyricFontSize = Math.max(
        MIN_DISPLAY_FONT_SIZE,
        Math.min(fontSizeConfig || BASE_FONT_SIZE, MAX_DISPLAY_FONT_SIZE),
    );
    const lyricFontFamily = fontDataConfig?.family ? String(fontDataConfig.family) : undefined;
    const lineWidthAspect = Math.max(0.86, Math.min(viewportWidth / 900, 1.22));
    const wordTimedInactiveBrightness = inactiveBrightnessConfig ?? 0.35;
    const playbackProgress = duration && duration > 0
        ? Math.min(1, Math.max(0, (progress ?? 0) / duration))
        : 0;

    const startDrag = async (event: ReactPointerEvent<HTMLDivElement>) => {
        if (lockLyric || event.button !== 0) {
            return;
        }

        const pointerId = event.pointerId;
        const screenX = event.screenX;
        const screenY = event.screenY;
        const currentTarget = event.currentTarget;
        const target = event.target as HTMLElement | null;
        if (target?.closest("[data-no-drag='true']")) {
            return;
        }

        currentTarget.setPointerCapture(pointerId);
        dragStateRef.current = {
            pointerId,
            startScreenX: screenX,
            startScreenY: screenY,
            startWindowX: window.screenX,
            startWindowY: window.screenY,
            width: window.innerWidth,
            height: window.innerHeight,
        };
        event.preventDefault();

        const bounds = await appWindowUtil.getCurrentWindowBounds();
        const dragState = dragStateRef.current;
        if (!bounds || !dragState || dragState.pointerId !== pointerId) {
            return;
        }

        dragStateRef.current = {
            ...dragState,
            startWindowX: bounds.x,
            startWindowY: bounds.y,
            width: bounds.width,
            height: bounds.height,
        };
    };

    const dragWindow = (event: ReactPointerEvent<HTMLDivElement>) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) {
            return;
        }

        pendingBoundsRef.current = {
            x: Math.round(dragState.startWindowX + event.screenX - dragState.startScreenX),
            y: Math.round(dragState.startWindowY + event.screenY - dragState.startScreenY),
            width: dragState.width,
            height: dragState.height,
        };
        if (!dragRafRef.current) {
            dragRafRef.current = requestAnimationFrame(() => {
                dragRafRef.current = 0;
                const bounds = pendingBoundsRef.current;
                if (bounds) {
                    appWindowUtil.setCurrentWindowBounds(bounds);
                }
            });
        }
        event.preventDefault();
    };

    const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) {
            return;
        }

        if (dragRafRef.current) {
            cancelAnimationFrame(dragRafRef.current);
            dragRafRef.current = 0;
        }
        const bounds = pendingBoundsRef.current;
        if (bounds) {
            appWindowUtil.setCurrentWindowBounds(bounds);
            pendingBoundsRef.current = null;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        dragStateRef.current = null;
    };

    return (
        <div
            className={classNames({
                "desktop-lyric-page": true,
                locked: !!lockLyric,
                hovered: isHovered,
            })}
            style={{
                "--desktop-lyric-color": fontColorConfig || "#ffffff",
                "--desktop-lyric-unplayed-color": "#ffffff",
                "--desktop-lyric-font-size": `${lyricFontSize}px`,
                "--desktop-lyric-font-family": lyricFontFamily,
                "--desktop-lyric-line-inactive-opacity": LINE_TIMED_INACTIVE_OPACITY,
                fontSize: `${lyricFontSize}px`,
                fontFamily: lyricFontFamily,
            } as CSSProperties}
            data-font-color-scope={applyFontColorOnlyToPlayedLines ? "played" : "all"}
        >
            <div className="desktop-lyric-page--header" data-no-drag="true">
                <div className="desktop-lyric-page--info" title={songInfo}>
                    <SvgAsset iconName="musical-note"></SvgAsset>
                    <span>{displayTitle}</span>
                </div>

                <div className="desktop-lyric-page--controls">
                    <DesktopActionButton
                        iconName="skip-left"
                        label={t("main.previous_music")}
                        onClick={() => {
                            messageBus.sendCommand("SkipToPrevious");
                        }}
                    ></DesktopActionButton>
                    <DesktopActionButton
                        emphasis
                        iconName={isPlaybackActive(playerState) ? "pause" : "play"}
                        label={t(isPlaybackActive(playerState)
                            ? "media.music_state_pause"
                            : "media.music_state_play")}
                        progress={playbackProgress}
                        onClick={() => {
                            if (currentMusic) {
                                messageBus.sendCommand("TogglePlayerState");
                            }
                        }}
                    ></DesktopActionButton>
                    <DesktopActionButton
                        iconName="skip-right"
                        label={t("main.next_music")}
                        onClick={() => {
                            messageBus.sendCommand("SkipToNext");
                        }}
                    ></DesktopActionButton>
                    <DesktopActionButton
                        iconName={lockLyric ? "lock-open" : "lock-closed"}
                        label={t(lockLyric
                            ? "main.unlock_desktop_lyric"
                            : "main.lock_desktop_lyric")}
                        onClick={() => {
                            AppConfig.setConfig({
                                "lyric.lockLyric": !lockLyric,
                            });
                        }}
                    ></DesktopActionButton>
                    <DesktopActionButton
                        iconName="x-mark"
                        label={t("common.close")}
                        onClick={() => {
                            appWindowUtil.setLyricWindow(false);
                        }}
                    ></DesktopActionButton>
                </div>

                <div className="desktop-lyric-page--platform-container">
                    {platform ? (
                        <div className="desktop-lyric-page--platform" title={platform}>
                            {platform}
                        </div>
                    ) : null}
                </div>
            </div>

            <div
                className="desktop-lyric-page--content"
                onPointerCancel={stopDrag}
                onPointerDown={startDrag}
                onPointerMove={dragWindow}
                onPointerUp={stopDrag}
            >
                <AppleMusicLyricPlayer
                    lyricLines={lyricLines}
                    currentTimeMs={estimateLyricClockProgressMs(lyricClock)}
                    playing={playerState === PlayerState.Playing}
                    speed={lyricClock?.speed || 1}
                    fontSize="var(--desktop-lyric-font-size)"
                    textColor={fontColorConfig || "#ffffff"}
                    hoverBackgroundColor="transparent"
                    alignAnchor="center"
                    alignPosition={0.5}
                    centerInterludeDots
                    enableBlur={false}
                    enableScale={false}
                    enableSpring
                    wordFadeWidth={0.82}
                    inactiveBrightness={wordTimedInactiveBrightness}
                    // Desktop line-timed lyrics always need row state so non-current rows can dim.
                    markLinePlayState
                    style={{
                        "--amll-lp-line-width-aspect": lineWidthAspect,
                        "--amll-lp-line-padding-x": "0.08em",
                        "--amll-lp-bg-line-scale": 0.82,
                    } as CSSProperties}
                ></AppleMusicLyricPlayer>
            </div>

            <DesktopResizeHandle
                axis="x"
                onPointerCancel={stopResize}
                onPointerDown={startResize}
                onPointerMove={resizeWindow}
                onPointerUp={stopResize}
            ></DesktopResizeHandle>
            <DesktopResizeHandle
                axis="y"
                onPointerCancel={stopResize}
                onPointerDown={startResize}
                onPointerMove={resizeWindow}
                onPointerUp={stopResize}
            ></DesktopResizeHandle>
            <DesktopResizeHandle
                axis="xy"
                onPointerCancel={stopResize}
                onPointerDown={startResize}
                onPointerMove={resizeWindow}
                onPointerUp={stopResize}
            ></DesktopResizeHandle>
        </div>
    );
}

interface IDesktopActionButtonProps {
    iconName: SvgAssetIconNames;
    label: string;
    onClick: () => void;
    emphasis?: boolean;
    progress?: number;
}

function DesktopActionButton({
    iconName,
    label,
    onClick,
    emphasis,
    progress,
}: IDesktopActionButtonProps) {
    const progressOffset = progress === undefined
        ? undefined
        : 100 - Math.min(1, Math.max(0, progress)) * 100;

    return (
        <button
            type="button"
            className="desktop-lyric-page--action"
            data-emphasis={emphasis}
            data-no-drag="true"
            title={label}
            aria-label={label}
            onClick={onClick}
        >
            {progressOffset === undefined ? null : (
                <svg
                    className="desktop-lyric-page--action-progress"
                    viewBox="0 0 34 34"
                    aria-hidden="true"
                    focusable="false"
                >
                    <circle
                        className="desktop-lyric-page--action-progress-track"
                        cx="17"
                        cy="17"
                        r="15.5"
                    ></circle>
                    <circle
                        className="desktop-lyric-page--action-progress-value"
                        cx="17"
                        cy="17"
                        r="15.5"
                        pathLength="100"
                        style={{ strokeDashoffset: progressOffset }}
                    ></circle>
                </svg>
            )}
            <SvgAsset iconName={iconName}></SvgAsset>
        </button>
    );
}

interface IDesktopResizeHandleProps {
    axis: FramelessResizeAxis;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerDown: (axis: FramelessResizeAxis, event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    children?: ReactNode;
}

function DesktopResizeHandle(props: IDesktopResizeHandleProps) {
    const {
        axis,
        children,
        onPointerCancel,
        onPointerDown,
        onPointerMove,
        onPointerUp,
    } = props;

    return (
        <div
            className="desktop-lyric-page--resize-handle"
            data-axis={axis}
            data-no-drag="true"
            onPointerCancel={onPointerCancel}
            onPointerDown={(event) => {
                onPointerDown(axis, event);
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            role="presentation"
        >
            {children}
        </div>
    );
}
