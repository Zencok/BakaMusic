import "./index.scss";
import classNames from "@/renderer/utils/classnames";
import { createFallbackAmlLyricLines, estimateLyricClockProgressMs, mapLyricLinesToAml } from "@/common/amll-lyric";
import { PlayerState } from "@/common/constant";
import useAppConfig from "@/hooks/useAppConfig";
import SvgAsset, { type SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import AppleMusicLyricPlayer from "@renderer/components/AppleMusicLyricPlayer";
import { useUserPreference } from "@/renderer/utils/user-perference";
import AppConfig from "@shared/app-config/renderer";
import messageBus, { useAppStatePartial } from "@shared/message-bus/renderer/extension";
import { appWindowUtil } from "@shared/utils/renderer";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

const BASE_FONT_SIZE = 24;
const MIN_DISPLAY_FONT_SIZE = 16;
const MAX_DISPLAY_FONT_SIZE = 80;
const HOVER_VISIBLE_MS = 1000;

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
    const currentMusic = useAppStatePartial("musicItem");
    const playerState = useAppStatePartial("playerState");
    const currentFullLyric = useAppStatePartial("fullLyric");
    const lyricClock = useAppStatePartial("lyricClock");
    const lockLyric = useAppConfig("lyric.lockLyric");
    const fontDataConfig = useAppConfig("lyric.fontData");
    const fontSizeConfig = useAppConfig("lyric.fontSize");
    const fontColorConfig = useAppConfig("lyric.fontColor");
    const fontStrokeConfig = useAppConfig("lyric.strokeColor");
    const [showTranslation] = useUserPreference("showTranslation");
    const [showRomanization] = useUserPreference("showRomanization");
    const [isHovered, setIsHovered] = useState(false);
    const dragStateRef = useRef<IDragState | null>(null);

    useEffect(() => {
        appWindowUtil.ignoreMouseEvent(!!lockLyric);

        return () => {
            appWindowUtil.ignoreMouseEvent(false);
        };
    }, [lockLyric]);

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
        .join(" - ") || "Desktop Lyrics";
    const songInfo = subtitle ? `${title} - ${subtitle}` : title;
    const platform = currentMusic?.platform || currentMusic?._musicSheetPlatform;
    const displayTitle = artist ? `${title} - ${artist}` : title;
    const lyricFontSize = Math.max(
        MIN_DISPLAY_FONT_SIZE,
        Math.min(fontSizeConfig || BASE_FONT_SIZE, MAX_DISPLAY_FONT_SIZE),
    );
    const lyricFontFamily = fontDataConfig?.family ? String(fontDataConfig.family) : undefined;
    const lineWidthAspect = Math.max(0.86, Math.min(window.innerWidth / 900, 1.22));

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
            startWindowX: 0,
            startWindowY: 0,
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

        appWindowUtil.setCurrentWindowBounds({
            x: Math.round(dragState.startWindowX + event.screenX - dragState.startScreenX),
            y: Math.round(dragState.startWindowY + event.screenY - dragState.startScreenY),
            width: dragState.width,
            height: dragState.height,
        });
        event.preventDefault();
    };

    const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) {
            return;
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
                "--desktop-lyric-stroke-color": fontStrokeConfig || "rgba(0,0,0,0.78)",
                "--desktop-lyric-font-size": `${lyricFontSize}px`,
                "--desktop-lyric-font-family": lyricFontFamily,
                fontSize: `${lyricFontSize}px`,
                fontFamily: lyricFontFamily,
            } as CSSProperties}
        >
            <div className="desktop-lyric-page--header" data-no-drag="true">
                <div className="desktop-lyric-page--info" title={songInfo}>
                    <SvgAsset iconName="musical-note"></SvgAsset>
                    <span>{displayTitle}</span>
                </div>

                <div className="desktop-lyric-page--controls">
                    <DesktopActionButton
                        iconName="skip-left"
                        onClick={() => {
                            messageBus.sendCommand("SkipToPrevious");
                        }}
                    ></DesktopActionButton>
                    <DesktopActionButton
                        emphasis
                        iconName={playerState === PlayerState.Playing ? "pause" : "play"}
                        onClick={() => {
                            if (currentMusic) {
                                messageBus.sendCommand("TogglePlayerState");
                            }
                        }}
                    ></DesktopActionButton>
                    <DesktopActionButton
                        iconName="skip-right"
                        onClick={() => {
                            messageBus.sendCommand("SkipToNext");
                        }}
                    ></DesktopActionButton>
                    <DesktopActionButton
                        iconName={lockLyric ? "lock-open" : "lock-closed"}
                        onClick={() => {
                            AppConfig.setConfig({
                                "lyric.lockLyric": !lockLyric,
                            });
                        }}
                    ></DesktopActionButton>
                    <DesktopActionButton
                        iconName="x-mark"
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
                    enableBlur={false}
                    enableScale={false}
                    enableSpring
                    wordFadeWidth={0.82}
                    style={{
                        "--amll-lp-line-width-aspect": lineWidthAspect,
                        "--amll-lp-line-padding-x": "0.08em",
                        "--amll-lp-bg-line-scale": 0.82,
                    } as CSSProperties}
                ></AppleMusicLyricPlayer>
            </div>
        </div>
    );
}

interface IDesktopActionButtonProps {
    iconName: SvgAssetIconNames;
    onClick: () => void;
    emphasis?: boolean;
}

function DesktopActionButton({ iconName, onClick, emphasis }: IDesktopActionButtonProps) {
    return (
        <div
            className="desktop-lyric-page--action"
            data-emphasis={emphasis}
            data-no-drag="true"
            role="button"
            onClick={onClick}
        >
            <SvgAsset iconName={iconName}></SvgAsset>
        </div>
    );
}
