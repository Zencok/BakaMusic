import "./index.scss";
import { MeshGradientRenderer } from "@amll-core/bg-render/mesh-renderer/index";
import { isPlaybackActive, RepeatMode } from "@/common/constant";
import { secondsToDuration } from "@/common/time-util";
import SvgAsset from "@/renderer/components/SvgAsset";
import { getCurrentPanel, hidePanel, showPanel } from "@/renderer/components/Panel";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import trackPlayer from "@renderer/core/track-player";
import {
    usePlayerState,
    useProgress,
    useRepeatMode,
    useVolume,
} from "@renderer/core/track-player/hooks";
import AppConfig from "@shared/app-config/renderer";
import nodeRuntime from "@shared/node-runtime/renderer";
import { appUtil, appWindowUtil } from "@shared/utils/renderer";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import Lyric from "../Lyric";
import {
    ClassicNextIcon,
    ClassicPauseIcon,
    ClassicPlayIcon,
    ClassicPreviousIcon,
    ClassicRepeatIcon,
    ClassicShuffleIcon,
    ClassicSpeakerHighIcon,
    ClassicSpeakerLowIcon,
} from "./icons";

interface IClassicAmlLDetailProps {
    active: boolean;
    playerReady: boolean;
    artwork: string;
    title: string;
    artist: string;
    album?: string;
    qualityLabel?: string | null;
    onClose: () => void;
}

const MAX_MESH_ARTWORK_CACHE_SIZE = 8;
const meshArtworkCache = new Map<string, Promise<string> | string>();

function cacheMeshArtwork(key: string, value: Promise<string> | string) {
    if (meshArtworkCache.has(key)) {
        meshArtworkCache.delete(key);
    }
    meshArtworkCache.set(key, value);
    while (meshArtworkCache.size > MAX_MESH_ARTWORK_CACHE_SIZE) {
        const oldestKey = meshArtworkCache.keys().next().value;
        if (typeof oldestKey !== "string") {
            break;
        }
        meshArtworkCache.delete(oldestKey);
    }
}

async function resolveMeshArtwork(artwork: string) {
    if (!/^https?:\/\//i.test(artwork)) {
        return artwork;
    }

    const cached = meshArtworkCache.get(artwork);
    if (typeof cached === "string") {
        cacheMeshArtwork(artwork, cached);
        return cached;
    }
    if (cached) {
        return cached;
    }

    const task = nodeRuntime.fetchCoverImage(artwork, "compatible-jpeg")
        .then(({ dataBase64, mimeType }) => `data:${mimeType};base64,${dataBase64}`)
        .catch(() => artwork);
    cacheMeshArtwork(artwork, task);
    const result = await task;
    cacheMeshArtwork(artwork, result);
    return result;
}

function loadMeshArtwork(artwork: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        if (/^https?:\/\//i.test(artwork)) {
            image.crossOrigin = "anonymous";
            image.referrerPolicy = "no-referrer";
        }
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Failed to decode mesh artwork"));
        image.src = artwork;
    });
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function formatClassicDuration(seconds: number) {
    if (seconds < 0) {
        return `-${secondsToDuration(Math.abs(seconds))}`;
    }
    return secondsToDuration(seconds);
}

function ClassicAmlLBackground({ active, artwork }: Pick<
    IClassicAmlLDetailProps,
    "active" | "artwork"
>) {
    const hostRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<MeshGradientRenderer | null>(null);
    const artworkRequestRef = useRef(0);
    const activeRef = useRef(active);
    const [rendererReady, setRendererReady] = useState(false);
    activeRef.current = active;

    useEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }

        try {
            const canvas = document.createElement("canvas");
            canvas.style.pointerEvents = "none";
            canvas.style.zIndex = "1";
            canvas.style.contain = "strict";
            const renderer = new MeshGradientRenderer(canvas);
            renderer.setRenderScale(0.5);
            renderer.setFPS(30);
            renderer.setFlowSpeed(1);
            renderer.setHasLyric(true);
            host.appendChild(canvas);
            rendererRef.current = renderer;
        } catch {
            rendererRef.current = null;
        }

        return () => {
            rendererRef.current?.dispose();
            rendererRef.current = null;
        };
    }, []);

    useEffect(() => {
        const requestId = ++artworkRequestRef.current;
        setRendererReady(false);
        void resolveMeshArtwork(artwork).then(async (meshArtworkSource) => {
            const renderer = rendererRef.current;
            if (!renderer || requestId !== artworkRequestRef.current) {
                return;
            }

            const meshArtwork = await loadMeshArtwork(meshArtworkSource);
            if (renderer !== rendererRef.current || requestId !== artworkRequestRef.current) {
                meshArtwork.src = "";
                return;
            }

            try {
                await renderer.setAlbum(meshArtwork);
            } finally {
                meshArtwork.src = "";
            }
            const shouldRun = activeRef.current;
            renderer.setStaticMode(!shouldRun);
            if (shouldRun) {
                renderer.resume();
            } else {
                renderer.pause();
            }
            if (requestId === artworkRequestRef.current) {
                setRendererReady(true);
            }
        }).catch(() => undefined);

        return () => {
            if (requestId === artworkRequestRef.current) {
                artworkRequestRef.current += 1;
            }
        };
    }, [artwork]);

    useEffect(() => {
        const renderer = rendererRef.current;
        if (!renderer) {
            return;
        }
        renderer.setStaticMode(!active);
        if (active) {
            renderer.resume();
        } else {
            renderer.pause();
        }
    }, [active]);

    return (
        <div
            ref={hostRef}
            className="classic-amll-background"
            data-renderer-ready={rendererReady ? "true" : "false"}
            aria-hidden="true"
        ></div>
    );
}

interface IClassicSliderProps {
    value: number;
    min?: number;
    max?: number;
    disabled?: boolean;
    changeOnDrag?: boolean;
    label: string;
    beforeIcon?: ReactNode;
    afterIcon?: ReactNode;
    className?: string;
    onChange: (value: number) => void;
}

function ClassicSlider({
    value,
    min = 0,
    max = 1,
    disabled = false,
    changeOnDrag = false,
    label,
    beforeIcon,
    afterIcon,
    className,
    onChange,
}: IClassicSliderProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    const [dragValue, setDragValue] = useState<number | null>(null);
    const [bounceOffset, setBounceOffset] = useState(0);

    const currentValue = dragValue ?? value;
    const percent = max > min ? clamp((currentValue - min) / (max - min), 0, 1) : 0;

    const valueFromPointer = useCallback((clientX: number) => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) {
            return { bounce: 0, value: min };
        }
        const relativePosition = (clientX - rect.left) / rect.width;
        const bounce = relativePosition < 0
            ? Math.tanh(relativePosition * 2) * 12
            : relativePosition > 1
                ? Math.tanh((relativePosition - 1) * 2) * 12
                : 0;
        return {
            bounce,
            value: min + clamp(relativePosition, 0, 1) * (max - min),
        };
    }, [max, min]);

    const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        const { bounce, value: nextValue } = valueFromPointer(event.clientX);
        setBounceOffset(bounce);
        setDragValue(nextValue);
        if (changeOnDrag) {
            onChange(nextValue);
        }
        return nextValue;
    };

    const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) {
            return;
        }
        const nextValue = updateFromPointer(event);
        draggingRef.current = false;
        setDragValue(null);
        setBounceOffset(0);
        onChange(nextValue);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    return (
        <div className={`classic-amll-slider ${className ?? ""}`}>
            {beforeIcon}
            <div
                ref={trackRef}
                className="classic-amll-slider-track"
                data-dragging={draggingRef.current ? "true" : "false"}
                style={{ transform: `translate3d(${bounceOffset}px, 0, 0)` }}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={label}
                aria-disabled={disabled}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={currentValue}
                onKeyDown={(event) => {
                    if (disabled) {
                        return;
                    }
                    const step = (max - min) / 100;
                    let nextValue: number | null = null;
                    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                        nextValue = currentValue - step * (event.shiftKey ? 5 : 1);
                    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                        nextValue = currentValue + step * (event.shiftKey ? 5 : 1);
                    } else if (event.key === "Home") {
                        nextValue = min;
                    } else if (event.key === "End") {
                        nextValue = max;
                    }
                    if (nextValue !== null) {
                        event.preventDefault();
                        onChange(clamp(nextValue, min, max));
                    }
                }}
                onPointerDown={(event) => {
                    if (disabled) {
                        return;
                    }
                    event.preventDefault();
                    draggingRef.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    updateFromPointer(event);
                }}
                onPointerMove={(event) => {
                    if (draggingRef.current) {
                        updateFromPointer(event);
                    }
                }}
                onPointerUp={finishPointer}
                onPointerCancel={(event) => {
                    draggingRef.current = false;
                    setDragValue(null);
                    setBounceOffset(0);
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                }}
            >
                <div className="classic-amll-slider-fill" style={{ transform: `scaleX(${percent})` }}></div>
            </div>
            {afterIcon}
        </div>
    );
}

function ClassicTextMarquee({
    children,
    className,
    title,
}: {
    children: ReactNode;
    className: string;
    title: string;
}) {
    const outerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const animationsRef = useRef(new Set<Animation>());

    const finishAnimations = useCallback(() => {
        for (const animation of animationsRef.current) {
            animation.finish();
        }
        animationsRef.current.clear();
        outerRef.current?.classList.remove("classic-amll-marquee--animating");
    }, []);

    useEffect(() => finishAnimations, [finishAnimations]);

    return (
        <div
            ref={outerRef}
            className={`classic-amll-marquee ${className}`}
            title={title}
            onMouseEnter={() => {
                const outer = outerRef.current;
                const inner = innerRef.current;
                if (!outer || !inner || inner.clientWidth <= outer.clientWidth * 0.95) {
                    return;
                }

                const distance = inner.clientWidth - outer.clientWidth * 0.95;
                outer.classList.add("classic-amll-marquee--animating");
                const animation = inner.animate(
                    [
                        { transform: "translateX(0px)" },
                        { transform: `translateX(${-distance}px)` },
                    ],
                    {
                        iterations: 2,
                        direction: "alternate",
                        easing: "linear",
                        duration: Math.max(1, distance / 32 * 1000),
                    },
                );
                animationsRef.current.add(animation);
                void animation.finished.finally(() => {
                    animationsRef.current.delete(animation);
                    if (animationsRef.current.size === 0) {
                        outerRef.current?.classList.remove(
                            "classic-amll-marquee--animating",
                        );
                    }
                });
            }}
            onMouseLeave={finishAnimations}
        >
            <div ref={innerRef}>{children}</div>
        </div>
    );
}

interface IClassicMediaButtonProps {
    label: string;
    children: ReactNode;
    active?: boolean;
    onClick: () => void;
}

function ClassicMediaButton({
    label,
    children,
    active,
    onClick,
}: IClassicMediaButtonProps) {
    const [animating, setAnimating] = useState(false);
    return (
        <button
            type="button"
            className="classic-amll-media-button"
            data-active={active ? "true" : "false"}
            data-animating={animating ? "true" : "false"}
            title={label}
            aria-label={label}
            onClick={() => {
                setAnimating(false);
                requestAnimationFrame(() => setAnimating(true));
                onClick();
            }}
            onAnimationEnd={() => setAnimating(false)}
        >
            {children}
        </button>
    );
}

function ClassicMusicInfo({ album, artist, title }: Pick<
    IClassicAmlLDetailProps,
    "album" | "artist" | "title"
>) {
    const { t } = useTranslation();

    const toggleQueue = () => {
        if (getCurrentPanel()?.type === "PlayList") {
            hidePanel();
        } else {
            showPanel("PlayList", { coverHeader: true });
        }
    };

    return (
        <div className="classic-amll-music-info">
            <div className="classic-amll-music-copy">
                <ClassicTextMarquee className="classic-amll-music-title" title={title}>
                    {title}
                </ClassicTextMarquee>
                <ClassicTextMarquee className="classic-amll-music-artist" title={artist}>
                    {artist}
                </ClassicTextMarquee>
                {album ? (
                    <ClassicTextMarquee className="classic-amll-music-album" title={album}>
                        {album}
                    </ClassicTextMarquee>
                ) : null}
            </div>
            <button
                type="button"
                className="classic-amll-menu-button"
                title={t("media.playlist")}
                aria-label={t("media.playlist")}
                onClick={toggleQueue}
            >
                <SvgAsset iconName="ellipsis-horizontal"></SvgAsset>
            </button>
        </div>
    );
}

function ClassicProgress({ qualityLabel }: Pick<IClassicAmlLDetailProps, "qualityLabel">) {
    const { currentTime, duration } = useProgress();
    const playerState = usePlayerState();
    const [showRemaining, setShowRemaining] = useState(false);
    const { t } = useTranslation();
    const canSeek = Number.isFinite(duration) && duration > 0;
    const progress = canSeek ? clamp(currentTime / duration, 0, 1) : 0;

    return (
        <div className="classic-amll-progress">
            <ClassicSlider
                value={progress}
                disabled={!canSeek}
                label={t("music_bar.seek")}
                onChange={(nextProgress) => {
                    if (canSeek) {
                        trackPlayer.seekTo(duration * nextProgress);
                    }
                }}
            ></ClassicSlider>
            <div className="classic-amll-progress-labels">
                <span>{secondsToDuration(Math.max(0, currentTime || 0))}</span>
                <span className="classic-amll-quality-tag">{qualityLabel ?? ""}</span>
                <button
                    type="button"
                    className="classic-amll-duration-toggle"
                    onClick={() => setShowRemaining((value) => !value)}
                >
                    {canSeek
                        ? formatClassicDuration(
                            showRemaining ? currentTime - duration : duration,
                        )
                        : "--:--"}
                </button>
            </div>
            <span className="classic-amll-playing-state" data-playing={isPlaybackActive(playerState)}></span>
        </div>
    );
}

function ClassicTransport() {
    const playerState = usePlayerState();
    const repeatMode = useRepeatMode();
    const { t } = useTranslation();
    const playing = isPlaybackActive(playerState);
    const shuffleActive = repeatMode === RepeatMode.Shuffle;
    const repeatActive = repeatMode !== RepeatMode.Shuffle;
    const repeatOne = repeatMode === RepeatMode.Loop;

    return (
        <div className="classic-amll-transport">
            <ClassicMediaButton
                label={t("media.music_repeat_mode_shuffle")}
                active={shuffleActive}
                onClick={() => {
                    trackPlayer.setRepeatMode(
                        shuffleActive ? RepeatMode.Queue : RepeatMode.Shuffle,
                    );
                }}
            >
                <ClassicShuffleIcon active={shuffleActive}></ClassicShuffleIcon>
            </ClassicMediaButton>
            <ClassicMediaButton
                label={t("music_bar.previous_music")}
                onClick={() => trackPlayer.skipToPrev()}
            >
                <ClassicPreviousIcon></ClassicPreviousIcon>
            </ClassicMediaButton>
            <ClassicMediaButton
                label={playing ? t("music_bar.pause") : t("music_bar.play")}
                onClick={() => {
                    if (playing) {
                        trackPlayer.pause();
                    } else {
                        trackPlayer.resume();
                    }
                }}
            >
                {playing ? <ClassicPauseIcon></ClassicPauseIcon> : <ClassicPlayIcon></ClassicPlayIcon>}
            </ClassicMediaButton>
            <ClassicMediaButton
                label={t("music_bar.next_music")}
                onClick={() => trackPlayer.skipToNext()}
            >
                <ClassicNextIcon></ClassicNextIcon>
            </ClassicMediaButton>
            <ClassicMediaButton
                label={repeatOne
                    ? t("media.music_repeat_mode_loop")
                    : t("media.music_repeat_mode_queue")}
                active={repeatActive}
                onClick={() => {
                    trackPlayer.setRepeatMode(
                        repeatOne ? RepeatMode.Queue : RepeatMode.Loop,
                    );
                }}
            >
                <ClassicRepeatIcon active={repeatActive} one={repeatOne}></ClassicRepeatIcon>
            </ClassicMediaButton>
        </div>
    );
}

function ClassicVolume() {
    const volume = useVolume();
    const { t } = useTranslation();

    return (
        <ClassicSlider
            className="classic-amll-volume"
            value={volume}
            changeOnDrag
            label={t("music_bar.volume")}
            beforeIcon={<ClassicSpeakerLowIcon className="classic-amll-volume-low"></ClassicSpeakerLowIcon>}
            afterIcon={<ClassicSpeakerHighIcon className="classic-amll-volume-high"></ClassicSpeakerHighIcon>}
            onChange={(nextVolume) => trackPlayer.setVolume(nextVolume)}
        ></ClassicSlider>
    );
}

function ClassicWindowControls({ active }: Pick<IClassicAmlLDetailProps, "active">) {
    const { t } = useTranslation();
    const [hidden, setHidden] = useState(false);
    const graceOverRef = useRef(false);

    useEffect(() => {
        graceOverRef.current = false;
        setHidden(false);
        if (!active) {
            return;
        }
        const timer = setTimeout(() => {
            graceOverRef.current = true;
            setHidden(true);
        }, 5000);
        return () => clearTimeout(timer);
    }, [active]);

    return (
        <div
            className="classic-amll-window-controls"
            data-hidden={hidden ? "true" : "false"}
            onMouseEnter={() => setHidden(false)}
            onMouseLeave={() => {
                if (graceOverRef.current) {
                    setHidden(true);
                }
            }}
        >
            <button
                type="button"
                title={t("app_header.minimize")}
                onClick={() => appWindowUtil.minMainWindow()}
            >
                <SvgAsset iconName="minus"></SvgAsset>
            </button>
            <button
                type="button"
                title={t("app_header.maximize")}
                onClick={() => appWindowUtil.toggleMainWindowMaximize()}
            >
                <SvgAsset iconName="square"></SvgAsset>
            </button>
            <button
                type="button"
                title={t("app_header.exit")}
                onClick={() => {
                    if (AppConfig.getConfig("normal.closeBehavior") === "minimize") {
                        appWindowUtil.minMainWindow(true);
                    } else {
                        appUtil.exitApp();
                    }
                }}
            >
                <SvgAsset iconName="x-mark"></SvgAsset>
            </button>
        </div>
    );
}

export default function ClassicAmlLDetail({
    active,
    playerReady,
    artwork,
    title,
    artist,
    album,
    qualityLabel,
    onClose,
}: IClassicAmlLDetailProps) {
    const layoutRef = useRef<HTMLDivElement>(null);
    const coverRef = useRef<HTMLDivElement>(null);
    const [lyricAlignPosition, setLyricAlignPosition] = useState(0.25);
    const { t } = useTranslation();

    useEffect(() => {
        const layout = layoutRef.current;
        const cover = coverRef.current;
        if (!layout || !cover) {
            return;
        }

        const sync = () => {
            const coverBounds = cover.getBoundingClientRect();
            const layoutBounds = layout.getBoundingClientRect();
            if (layoutBounds.height <= 0) {
                return;
            }
            setLyricAlignPosition(clamp(
                (coverBounds.top + coverBounds.height / 2 - layoutBounds.top)
                    / layoutBounds.height,
                0.1,
                0.9,
            ));
        };

        const observer = new ResizeObserver(sync);
        observer.observe(layout);
        observer.observe(cover);
        sync();
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={layoutRef} className="classic-amll-layout">
            <ClassicAmlLBackground active={active} artwork={artwork}></ClassicAmlLBackground>
            <ClassicWindowControls active={active}></ClassicWindowControls>

            <div className="classic-amll-drag-area">
                <button
                    type="button"
                    className="classic-amll-control-thumb"
                    title={t("music_bar.close_music_detail_page")}
                    aria-label={t("music_bar.close_music_detail_page")}
                    onClick={onClose}
                >
                    <span></span>
                    <span></span>
                </button>
            </div>

            <div ref={coverRef} className="classic-amll-cover-frame">
                <img
                    className="classic-amll-cover"
                    src={artwork}
                    alt={title}
                    onError={setFallbackAlbum}
                    referrerPolicy="no-referrer"
                ></img>
            </div>

            <div className="classic-amll-controls">
                <ClassicMusicInfo album={album} artist={artist} title={title}></ClassicMusicInfo>
                <ClassicProgress qualityLabel={qualityLabel}></ClassicProgress>
                <ClassicTransport></ClassicTransport>
                <ClassicVolume></ClassicVolume>
            </div>

            <div className="classic-amll-lyric">
                <Lyric
                    active={active}
                    playerReady={playerReady}
                    classicAmll
                    alignPosition={lyricAlignPosition}
                ></Lyric>
            </div>
        </div>
    );
}
