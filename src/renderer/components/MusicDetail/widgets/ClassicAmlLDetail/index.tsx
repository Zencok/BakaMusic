import "./index.scss";
import { MeshGradientRenderer } from "@amll-core/bg-render/mesh-renderer/index";
import { isPlaybackActive, RepeatMode } from "@/common/constant";
import { secondsToDuration } from "@/common/time-util";
import SvgAsset from "@/renderer/components/SvgAsset";
import { showMusicContextMenu } from "@/renderer/components/MusicList";
import {
    getCurrentPanel,
    hidePanel,
    showPanel,
    useCurrentPanelType,
} from "@/renderer/components/Panel";
import { showQualitySelectPopover } from "@/renderer/components/QualitySelectPopover";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import {
    getQualityDisplayText,
    resolveMusicQualityChoices,
} from "@/renderer/utils/music-quality";
import MusicSheet from "@renderer/core/music-sheet";
import trackPlayer from "@renderer/core/track-player";
import {
    useCurrentMusic,
    usePlayerState,
    useProgress,
    useQuality,
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
import { toast } from "react-toastify";
import Lyric from "../Lyric";
import {
    ClassicLosslessIcon,
    ClassicLyricsIcon,
    ClassicNextIcon,
    ClassicPauseIcon,
    ClassicPlayIcon,
    ClassicPlaylistIcon,
    ClassicPreviousIcon,
    ClassicRepeatIcon,
    ClassicShuffleIcon,
    ClassicSpeakerHighIcon,
    ClassicSpeakerLowIcon,
    ClassicStarIcon,
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
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [animating, setAnimating] = useState(false);
    return (
        <button
            ref={buttonRef}
            type="button"
            className="classic-amll-media-button"
            data-active={active ? "true" : "false"}
            data-animating={animating ? "true" : "false"}
            title={label}
            aria-label={label}
            onClick={() => {
                if (animating) {
                    // 连点时把正在跑的 CSS 动画直接拨回起点，
                    // 而不是先摘掉再挂上——后者中间会空一帧
                    const icon = buttonRef.current?.querySelector("svg");
                    for (const animation of icon?.getAnimations() ?? []) {
                        if (animation instanceof CSSAnimation) {
                            animation.currentTime = 0;
                        }
                    }
                } else {
                    setAnimating(true);
                }
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
    const currentMusic = useCurrentMusic();
    const { t } = useTranslation();

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
                disabled={!currentMusic}
                title={t("music_detail.amll_more_actions")}
                aria-label={t("music_detail.amll_more_actions")}
                onClick={(event) => {
                    if (!currentMusic) {
                        return;
                    }
                    const anchor = event.currentTarget.getBoundingClientRect();
                    showMusicContextMenu(currentMusic, anchor.left, anchor.bottom);
                }}
            >
                <SvgAsset iconName="ellipsis-horizontal"></SvgAsset>
            </button>
        </div>
    );
}

/** 上游用无损波形图标标记这些音质档位 */
const losslessQualityKeys = new Set<IMusic.IQualityKey>([
    "flac",
    "flac24bit",
    "hires",
    "vinyl",
    "master",
]);

function ClassicQualityTag({ qualityLabel }: { qualityLabel: string }) {
    const currentMusic = useCurrentMusic();
    const quality = useQuality();
    const { t } = useTranslation();
    const [isResolving, setIsResolving] = useState(false);
    const lossless = quality ? losslessQualityKeys.has(quality) : false;

    return (
        <button
            type="button"
            className="classic-amll-quality-tag"
            data-lossless={lossless ? "true" : "false"}
            title={quality
                ? getQualityDisplayText(quality, t)
                : t("music_bar.choose_music_quality")}
            aria-label={t("music_bar.choose_music_quality")}
            onClick={async (event) => {
                if (!currentMusic || isResolving) {
                    return;
                }

                const musicAtClick = currentMusic;
                const anchor = event.currentTarget;
                setIsResolving(true);
                try {
                    const { choices } = await resolveMusicQualityChoices(musicAtClick, t);

                    // 解析音质期间可能已经切歌
                    if (!trackPlayer.isCurrentMusic(musicAtClick)) {
                        return;
                    }

                    if (!choices.length) {
                        toast.warn(t("music_bar.no_music_quality_available"));
                        return;
                    }

                    const currentQuality = trackPlayer.currentQuality;
                    const defaultValue = choices.some((choice) => choice.value === currentQuality)
                        ? currentQuality
                        : choices[0].value;

                    showQualitySelectPopover({
                        title: t("music_bar.choose_music_quality"),
                        defaultValue,
                        choices,
                        anchor,
                        async onSelect(value) {
                            if (!trackPlayer.isCurrentMusic(musicAtClick)) {
                                toast.warn(
                                    t("music_bar.current_quality_not_available_for_current_music"),
                                );
                                return;
                            }
                            const success = await trackPlayer.setQuality(value);
                            if (!success) {
                                toast.warn(
                                    t("music_bar.current_quality_not_available_for_current_music"),
                                );
                            }
                        },
                    });
                } catch {
                    toast.warn(t("music_bar.no_music_quality_available"));
                } finally {
                    setIsResolving(false);
                }
            }}
        >
            {lossless ? (
                <ClassicLosslessIcon className="classic-amll-quality-tag-icon"></ClassicLosslessIcon>
            ) : null}
            <span className="classic-amll-quality-tag-text">{qualityLabel}</span>
        </button>
    );
}

function ClassicProgress({ qualityLabel }: Pick<IClassicAmlLDetailProps, "qualityLabel">) {
    const { currentTime, duration } = useProgress();
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
                {/* 独立的 flex 槽位：标签自身保留内容宽度，否则 flex-basis 0 会把
                    音质标签压成一条竖线，和文字叠在一起 */}
                <div className="classic-amll-quality-slot">
                    {qualityLabel ? (
                        <ClassicQualityTag qualityLabel={qualityLabel}></ClassicQualityTag>
                    ) : null}
                </div>
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
        </div>
    );
}

function ClassicTransport() {
    const playerState = usePlayerState();
    const repeatMode = useRepeatMode();
    const { t } = useTranslation();
    const playing = isPlaybackActive(playerState);
    // 上游的循环按钮有三个视觉态：Off 用 repeat.svg（不高亮）、All 用 repeat-active.svg、
    // One 用 repeat-one-active.svg；随机按钮只有开/关两态。BakaMusic 的三种模式互斥，
    // 因此这样投影才能把上游的每个视觉态都用上：
    //   Queue   -> 随机不高亮、循环 All
    //   Loop    -> 随机不高亮、循环 One
    //   Shuffle -> 随机高亮、循环回到不高亮的 Off 外观
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

interface IClassicToggleButtonProps {
    label: string;
    active: boolean;
    disabled?: boolean;
    children: ReactNode;
    onClick: () => void;
}

function ClassicToggleButton({
    label,
    active,
    disabled = false,
    children,
    onClick,
}: IClassicToggleButtonProps) {
    return (
        <button
            type="button"
            className="classic-amll-toggle-button"
            data-active={active ? "true" : "false"}
            disabled={disabled}
            aria-pressed={active}
            title={label}
            aria-label={label}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

interface IClassicBottomControlsProps {
    lyricVisible: boolean;
    onToggleLyricVisible: () => void;
}

/** 无曲目时的占位主键，避免收藏 hook 每次渲染都拿到新的对象身份 */
const emptyFavoriteTarget = { platform: "", id: "" } as IMusic.IMusicItem;

function ClassicBottomControls({
    lyricVisible,
    onToggleLyricVisible,
}: IClassicBottomControlsProps) {
    const currentMusic = useCurrentMusic();
    const panelType = useCurrentPanelType();
    const { t } = useTranslation();
    const playlistOpened = panelType === "PlayList";

    // 队列面板独立于当前曲目存在，收藏按钮则必须有曲目才有意义
    const isFavorite = MusicSheet.frontend.useMusicIsFavorite(
        currentMusic ?? emptyFavoriteTarget,
    );
    const favorited = !!currentMusic && isFavorite;

    // DOM 顺序与视觉顺序保持一致（左侧收藏、右侧歌词与队列），
    // 让 Tab 焦点顺序不至于和布局相反
    return (
        <div className="classic-amll-bottom-controls">
            <ClassicToggleButton
                label={favorited
                    ? t("music_detail.amll_unfavorite")
                    : t("music_detail.amll_favorite")}
                active={favorited}
                disabled={!currentMusic}
                onClick={() => {
                    if (!currentMusic) {
                        return;
                    }
                    if (favorited) {
                        void MusicSheet.frontend.removeMusicFromFavorite(currentMusic);
                    } else {
                        void MusicSheet.frontend.addMusicToFavorite(currentMusic);
                    }
                }}
            >
                <ClassicStarIcon active={favorited}></ClassicStarIcon>
            </ClassicToggleButton>
            <div className="classic-amll-bottom-controls-spacer"></div>
            <ClassicToggleButton
                label={lyricVisible
                    ? t("music_detail.amll_hide_lyric")
                    : t("music_detail.amll_show_lyric")}
                active={lyricVisible}
                onClick={onToggleLyricVisible}
            >
                <ClassicLyricsIcon active={lyricVisible}></ClassicLyricsIcon>
            </ClassicToggleButton>
            <ClassicToggleButton
                label={t("media.playlist")}
                active={playlistOpened}
                onClick={() => {
                    if (getCurrentPanel()?.type === "PlayList") {
                        hidePanel();
                    } else {
                        showPanel("PlayList", { coverHeader: true });
                    }
                }}
            >
                <ClassicPlaylistIcon active={playlistOpened}></ClassicPlaylistIcon>
            </ClassicToggleButton>
        </div>
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
    const [lyricVisible, setLyricVisible] = useState(true);
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
        <div
            ref={layoutRef}
            className="classic-amll-layout"
            data-hide-lyric={lyricVisible ? "false" : "true"}
        >
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

            <div className="classic-amll-lyric" inert={!lyricVisible}>
                <Lyric
                    active={active}
                    playerReady={playerReady}
                    classicAmll
                    alignPosition={lyricAlignPosition}
                ></Lyric>
            </div>

            <ClassicBottomControls
                lyricVisible={lyricVisible}
                onToggleLyricVisible={() => setLyricVisible((visible) => !visible)}
            ></ClassicBottomControls>
        </div>
    );
}
