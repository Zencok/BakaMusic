import "./index.scss";
import classNames from "@/renderer/utils/classnames";
import { createFallbackAmlLyricLines, estimateLyricClockProgressMs, mapLyricLinesToAml } from "@/common/amll-lyric";
import { PlayerState } from "@/common/constant";
import useAppConfig from "@/hooks/useAppConfig";
import SvgAsset, { type SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import AppleMusicLyricPlayer from "@renderer/components/AppleMusicLyricPlayer";
import { useUserPreference } from "@/renderer/utils/user-perference";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import AppConfig from "@shared/app-config/renderer";
import messageBus, { useAppStatePartial } from "@shared/message-bus/renderer/extension";
import { appWindowUtil } from "@shared/utils/renderer";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type ResizeAxis = "x" | "y" | "xy";

interface IResizeState {
    axis: ResizeAxis;
    screenX: number;
    screenY: number;
    width: number;
    height: number;
}

const MIN_WIDTH = 360;
const MIN_HEIGHT = 64;

export default function LyricWindowPage() {
    const currentMusic = useAppStatePartial("musicItem");
    const playerState = useAppStatePartial("playerState");
    const currentFullLyric = useAppStatePartial("fullLyric");
    const lyricClock = useAppStatePartial("lyricClock");
    const lockLyric = useAppConfig("lyric.lockLyric");
    const fontSizeConfig = useAppConfig("lyric.fontSize");
    const fontColorConfig = useAppConfig("lyric.fontColor");
    const fontStrokeConfig = useAppConfig("lyric.strokeColor");
    const [showTranslation] = useUserPreference("showTranslation");
    const [showRomanization] = useUserPreference("showRomanization");
    const [showOperations, setShowOperations] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [resizing, setResizing] = useState(false);
    const [windowSize, setWindowSize] = useState(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
    }));
    const resizeStateRef = useRef<IResizeState | null>(null);

    useEffect(() => {
        appWindowUtil.ignoreMouseEvent(false);
        if (lockLyric) {
            AppConfig.setConfig({
                "lyric.lockLyric": false,
            });
        }
    }, [lockLyric]);

    useEffect(() => {
        const syncWindowSize = () => {
            setWindowSize({
                width: window.innerWidth,
                height: window.innerHeight,
            });
        };

        const stopInteractions = () => {
            setDragging(false);
            setResizing(false);
            resizeStateRef.current = null;
            syncWindowSize();
        };

        const handleMouseMove = (evt: MouseEvent) => {
            const resizeState = resizeStateRef.current;
            if (!resizeState) {
                return;
            }

            const deltaX = evt.screenX - resizeState.screenX;
            const deltaY = evt.screenY - resizeState.screenY;
            const nextWidth = resizeState.axis === "y"
                ? resizeState.width
                : resizeState.width + deltaX;
            const nextHeight = resizeState.axis === "x"
                ? resizeState.height
                : resizeState.height + deltaY;
            const clampedWidth = Math.max(MIN_WIDTH, Math.round(nextWidth));
            const clampedHeight = Math.max(MIN_HEIGHT, Math.round(nextHeight));

            setWindowSize({
                width: clampedWidth,
                height: clampedHeight,
            });
            appWindowUtil.setCurrentWindowSize(clampedWidth, clampedHeight);
        };

        window.addEventListener("resize", syncWindowSize);
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", stopInteractions);
        window.addEventListener("blur", stopInteractions);

        return () => {
            window.removeEventListener("resize", syncWindowSize);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", stopInteractions);
            window.removeEventListener("blur", stopInteractions);
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

    const artwork = currentMusic?.artwork;
    const title = currentMusic?.title || "BakaMusic";
    const subtitle = [currentMusic?.artist, currentMusic?.album]
        .filter(Boolean)
        .join(" · ") || "Desktop Lyrics";
    const responsiveFontSize = useMemo(() => {
        const configScale = Math.max(0.88, Math.min((fontSizeConfig || 54) / 54, 1.06));
        const sizeFromHeight = 15 + Math.max(0, windowSize.height - MIN_HEIGHT) * 0.2;
        const sizeFromWidth = 15 + Math.max(0, windowSize.width - MIN_WIDTH) * 0.022;

        return Math.max(
            15,
            Math.min((sizeFromHeight * 0.74 + sizeFromWidth * 0.26) * configScale, 34),
        );
    }, [fontSizeConfig, windowSize.height, windowSize.width]);
    const lineWidthAspect = useMemo(() => {
        return Math.max(0.94, Math.min(windowSize.width / 340, 1.22));
    }, [windowSize.width]);

    const startResize = (axis: ResizeAxis, evt: ReactMouseEvent<HTMLDivElement>) => {
        evt.preventDefault();
        evt.stopPropagation();
        setDragging(false);
        setResizing(true);
        resizeStateRef.current = {
            axis,
            screenX: evt.screenX,
            screenY: evt.screenY,
            width: window.innerWidth,
            height: window.innerHeight,
        };
    };

    return (
        <div
            className={classNames({
                "desktop-lyric-page": true,
                "show-operations": showOperations,
                dragging,
                resizing,
            })}
            style={{
                "--desktop-lyric-color": fontColorConfig || "#ffffff",
                "--desktop-lyric-shadow": fontStrokeConfig || "rgba(0,0,0,0.28)",
                "--desktop-lyric-artwork": artwork ? `url("${artwork}")` : "none",
            } as CSSProperties}
            onMouseDown={(evt) => {
                if (resizing || evt.button !== 0) {
                    return;
                }

                const target = evt.target as HTMLElement | null;
                if (target?.closest("[data-no-drag='true']")) {
                    return;
                }

                setDragging(true);
            }}
            onMouseEnter={() => {
                setShowOperations(true);
            }}
            onMouseLeave={() => {
                setShowOperations(false);
            }}
        >
            <div className="desktop-lyric-page--card">
                <div className="desktop-lyric-page--header">
                    <div className="desktop-lyric-page--track">
                        <div className="desktop-lyric-page--cover-wrap">
                            {artwork ? (
                                <img
                                    className="desktop-lyric-page--cover"
                                    src={artwork}
                                    onError={setFallbackAlbum}
                                ></img>
                            ) : (
                                <div className="desktop-lyric-page--cover desktop-lyric-page--cover-placeholder">
                                    <SvgAsset iconName="musical-note"></SvgAsset>
                                </div>
                            )}
                        </div>

                        <div className="desktop-lyric-page--copy">
                            <div className="desktop-lyric-page--title" title={title}>
                                {title}
                            </div>
                            <div className="desktop-lyric-page--meta-row">
                                <div className="desktop-lyric-page--subtitle" title={subtitle}>
                                    {subtitle}
                                </div>
                                {currentMusic?.platform ? (
                                    <div className="desktop-lyric-page--badge">
                                        {currentMusic.platform}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <div className="desktop-lyric-page--operations">
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
                            iconName="x-mark"
                            onClick={() => {
                                appWindowUtil.setLyricWindow(false);
                            }}
                        ></DesktopActionButton>
                    </div>
                </div>

                <div className="desktop-lyric-page--content">
                    <AppleMusicLyricPlayer
                        lyricLines={lyricLines}
                        currentTimeMs={estimateLyricClockProgressMs(lyricClock)}
                        playing={playerState === PlayerState.Playing}
                        speed={lyricClock?.speed || 1}
                        fontSize={responsiveFontSize}
                        textColor={fontColorConfig || "#ffffff"}
                        hoverBackgroundColor="rgba(255,255,255,0.02)"
                        alignAnchor="center"
                        alignPosition={0.5}
                        enableBlur={!dragging && !resizing}
                        enableScale={false}
                        enableSpring={!dragging && !resizing}
                        wordFadeWidth={0.84}
                        style={{
                            "--amll-lp-line-width-aspect": lineWidthAspect,
                            "--amll-lp-line-padding-x": "0.08em",
                            "--amll-lp-bg-line-scale": 0.9,
                        } as CSSProperties}
                    ></AppleMusicLyricPlayer>
                </div>

                <div className="desktop-lyric-page--footer">
                    <div
                        className="desktop-lyric-page--resize-handle desktop-lyric-page--resize-handle-x"
                        data-no-drag="true"
                        onMouseDown={(evt) => {
                            startResize("x", evt);
                        }}
                    ></div>
                    <div
                        className="desktop-lyric-page--resize-handle desktop-lyric-page--resize-handle-y"
                        data-no-drag="true"
                        onMouseDown={(evt) => {
                            startResize("y", evt);
                        }}
                    ></div>
                    <div
                        className="desktop-lyric-page--grabber"
                        data-no-drag="true"
                        onMouseDown={(evt) => {
                            startResize("xy", evt);
                        }}
                    ></div>
                </div>
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
