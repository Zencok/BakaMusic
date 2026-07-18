import { type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from "react";
import {
    createFallbackAmlLyricLines,
    estimateLyricClockProgressMs,
    mapLyricLinesToAml,
} from "@/common/amll-lyric";
import ThemeSafeRoundButton from "@/renderer/components/ThemeSafeRoundButton";
import AppleMusicLyricPlayer from "@/renderer/components/AppleMusicLyricPlayer";
import { isPlaybackActive, PlayerState } from "@/common/constant";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";

import "./index.scss";
import { useTranslation } from "react-i18next";
import useAppConfig from "@/hooks/useAppConfig";
import { appWindowUtil } from "@shared/utils/renderer";
import messageBus, { useAppStatePartial } from "@shared/message-bus/renderer/extension";

const DRAG_START_THRESHOLD = 3;

interface IDragState {
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    startWindowX: number;
    startWindowY: number;
    width: number;
    height: number;
    moved: boolean;
}

interface IPendingDragState {
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    lastScreenX: number;
    lastScreenY: number;
}

export default function MinimodePage() {
    const [hover, setHover] = useState(false);
    const dragStateRef = useRef<IDragState | null>(null);
    const pendingDragRef = useRef<IPendingDragState | null>(null);
    const dragRafRef = useRef(0);
    const pendingBoundsRef = useRef<Electron.Rectangle | null>(null);
    const suppressOpenRef = useRef(false);
    const currentMusicItem = useAppStatePartial("musicItem");
    const playerState = useAppStatePartial("playerState");
    const lyricItem = useAppStatePartial("parsedLrc");
    const fullLyric = useAppStatePartial("fullLyric");
    const lyricClock = useAppStatePartial("lyricClock");

    const { t } = useTranslation();
    const showTranslation = useAppConfig("lyric.showTranslation");
    const showRomanization = useAppConfig("lyric.showRomanization");

    const title = currentMusicItem?.title || t("media.unknown_title");
    const artist = currentMusicItem?.artist || t("media.unknown_artist");
    const artwork = currentMusicItem?.artwork || albumImg;
    const currentLyric = lyricItem?.lrc || title;
    const romanization = showRomanization ? lyricItem?.romanization : undefined;
    const translation = showTranslation ? lyricItem?.translation : undefined;
    const isPlaying = isPlaybackActive(playerState);
    const shouldAdvanceLyrics = playerState === PlayerState.Playing;
    const lyricLines = useMemo(() => {
        const mappedLines = mapLyricLinesToAml(fullLyric ?? [], {
            includeTranslation: !!showTranslation,
            includeRomanization: !!showRomanization,
        });

        return mappedLines.length
            ? mappedLines
            : createFallbackAmlLyricLines(currentMusicItem);
    }, [currentMusicItem, fullLyric, showRomanization, showTranslation]);
    const lyricTitle = [romanization, currentLyric, translation]
        .filter((line) => !!line)
        .join("\n");

    const fullTitle = useMemo(() => {
        return `${title} - ${artist}`;
    }, [artist, title]);

    function openMainWindow() {
        if (suppressOpenRef.current) {
            return;
        }
        appWindowUtil.showMainWindow();
    }

    function closeMinimode() {
        // Main process restores the main window when mini mode is disabled.
        appWindowUtil.setMinimodeWindow(false);
    }

    const updateDragPosition = (
        dragState: IDragState,
        screenX: number,
        screenY: number,
    ) => {
        const deltaX = screenX - dragState.startScreenX;
        const deltaY = screenY - dragState.startScreenY;
        if (!dragState.moved && Math.hypot(deltaX, deltaY) < DRAG_START_THRESHOLD) {
            return false;
        }

        dragState.moved = true;
        pendingBoundsRef.current = {
            x: Math.round(dragState.startWindowX + deltaX),
            y: Math.round(dragState.startWindowY + deltaY),
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
        return true;
    };

    const suppressNextOpen = () => {
        suppressOpenRef.current = true;
        window.setTimeout(() => {
            suppressOpenRef.current = false;
        }, 0);
    };

    const startDrag = async (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || dragStateRef.current || pendingDragRef.current) {
            return;
        }

        const target = event.target as HTMLElement | null;
        if (target?.closest("button, a, input, textarea, select, [data-no-drag='true']")) {
            return;
        }

        const pointerId = event.pointerId;
        const currentTarget = event.currentTarget;
        currentTarget.setPointerCapture(pointerId);

        const pendingDrag: IPendingDragState = {
            pointerId,
            startScreenX: event.screenX,
            startScreenY: event.screenY,
            lastScreenX: event.screenX,
            lastScreenY: event.screenY,
        };
        pendingDragRef.current = pendingDrag;

        const bounds = await appWindowUtil.getCurrentWindowBounds();
        if (!bounds || pendingDragRef.current !== pendingDrag) {
            return;
        }

        pendingDragRef.current = null;
        const dragState: IDragState = {
            startWindowX: bounds.x,
            startWindowY: bounds.y,
            width: bounds.width,
            height: bounds.height,
            pointerId: pendingDrag.pointerId,
            startScreenX: pendingDrag.startScreenX,
            startScreenY: pendingDrag.startScreenY,
            moved: false,
        };
        dragStateRef.current = dragState;
        updateDragPosition(dragState, pendingDrag.lastScreenX, pendingDrag.lastScreenY);
    };

    const dragWindow = (event: ReactPointerEvent<HTMLDivElement>) => {
        const pendingDrag = pendingDragRef.current;
        if (pendingDrag?.pointerId === event.pointerId) {
            pendingDrag.lastScreenX = event.screenX;
            pendingDrag.lastScreenY = event.screenY;
            event.preventDefault();
            return;
        }

        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) {
            return;
        }

        updateDragPosition(dragState, event.screenX, event.screenY);
        event.preventDefault();
    };

    const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const pendingDrag = pendingDragRef.current;
        if (pendingDrag?.pointerId === event.pointerId) {
            pendingDragRef.current = null;
            if (Math.hypot(
                pendingDrag.lastScreenX - pendingDrag.startScreenX,
                pendingDrag.lastScreenY - pendingDrag.startScreenY,
            ) >= DRAG_START_THRESHOLD) {
                suppressNextOpen();
            }
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
            return;
        }

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
        if (dragState.moved) {
            suppressNextOpen();
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        dragStateRef.current = null;
    };

    return (
        <div
            className="minimode-page-container"
            data-hover={hover}
            onPointerCancel={stopDrag}
            onPointerDown={startDrag}
            onPointerMove={dragWindow}
            onPointerUp={stopDrag}
            onMouseEnter={() => {
                setHover(true);
            }}
            onMouseLeave={() => {
                setHover(false);
            }}
            onDoubleClick={openMainWindow}
        >
            <div
                className="minimode-page-backdrop"
                style={{
                    backgroundImage: `url(${artwork})`,
                }}
            ></div>
            <div className="minimode-page-overlay"></div>
            <div className="minimode-page-shell">
                <div
                    className="minimode-cover-wrap"
                    title={fullTitle}
                >
                    <img
                        alt={fullTitle}
                        draggable="false"
                        className="minimode-cover"
                        src={artwork}
                        onError={setFallbackAlbum}
                    ></img>
                </div>

                <div className="minimode-content">
                    <div
                        className="minimode-meta"
                        title={fullTitle}
                    >
                        <div className="minimode-title">{title}</div>
                        <div className="minimode-artist">{artist}</div>
                    </div>
                    <div
                        className="minimode-lyric-block"
                        title={lyricTitle || currentLyric}
                    >
                        <AppleMusicLyricPlayer
                            className="minimode-lyric-player"
                            lyricLines={lyricLines}
                            currentTimeMs={estimateLyricClockProgressMs(lyricClock)}
                            playing={shouldAdvanceLyrics}
                            speed={lyricClock?.speed || 1}
                            fontSize="0.82rem"
                            textColor="#ffffff"
                            hoverBackgroundColor="transparent"
                            alignAnchor="center"
                            alignPosition={0.5}
                            enableBlur={false}
                            enableScale
                            enableSpring
                            wordFadeWidth={0.66}
                            inactiveBrightness={0.35}
                            markLinePlayState
                        ></AppleMusicLyricPlayer>
                    </div>
                </div>

                <div
                    className="minimode-actions"
                    data-no-drag="true"
                    onDoubleClick={(event) => {
                        event.stopPropagation();
                    }}
                >
                    <ThemeSafeRoundButton
                        iconName="x-mark"
                        title={t("common.close")}
                        iconSize={16}
                        size={32}
                        color="rgba(255, 255, 255, 0.74)"
                        background="rgba(255, 255, 255, 0.08)"
                        hoverBackground="rgba(255, 255, 255, 0.16)"
                        borderColor="rgba(255, 255, 255, 0.08)"
                        shadow="inset 0 1px 0 rgba(255, 255, 255, 0.12)"
                        style={{ marginRight: "4px" }}
                        onClick={closeMinimode}
                    ></ThemeSafeRoundButton>
                    <ThemeSafeRoundButton
                        iconName="skip-left"
                        title={t("main.previous_music")}
                        iconSize={18}
                        size={32}
                        color="rgba(255, 255, 255, 0.9)"
                        background="rgba(255, 255, 255, 0.08)"
                        hoverBackground="rgba(255, 255, 255, 0.16)"
                        borderColor="rgba(255, 255, 255, 0.08)"
                        shadow="inset 0 1px 0 rgba(255, 255, 255, 0.12)"
                        onClick={() => {
                            messageBus.sendCommand("SkipToPrevious");
                        }}
                    ></ThemeSafeRoundButton>
                    <ThemeSafeRoundButton
                        iconName={isPlaying ? "pause" : "play"}
                        title={t(isPlaying ? "media.music_state_pause" : "media.music_state_play")}
                        iconSize={20}
                        size={38}
                        color="#0b0b0f"
                        background="rgba(255, 255, 255, 0.96)"
                        hoverBackground="rgba(255, 255, 255, 0.9)"
                        borderColor="rgba(255, 255, 255, 0.5)"
                        shadow="0 10px 24px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.36)"
                        onClick={() => {
                            messageBus.sendCommand("TogglePlayerState");
                        }}
                    ></ThemeSafeRoundButton>
                    <ThemeSafeRoundButton
                        iconName="skip-right"
                        title={t("main.next_music")}
                        iconSize={18}
                        size={32}
                        color="rgba(255, 255, 255, 0.9)"
                        background="rgba(255, 255, 255, 0.08)"
                        hoverBackground="rgba(255, 255, 255, 0.16)"
                        borderColor="rgba(255, 255, 255, 0.08)"
                        shadow="inset 0 1px 0 rgba(255, 255, 255, 0.12)"
                        onClick={() => {
                            messageBus.sendCommand("SkipToNext");
                        }}
                    ></ThemeSafeRoundButton>
                </div>
            </div>
        </div>
    );
}
