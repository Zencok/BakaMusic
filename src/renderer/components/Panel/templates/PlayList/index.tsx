import "./index.scss";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { rem } from "@/common/constant";
import { getMediaPrimaryKey, isSameMedia } from "@/common/media-util";
import { secondsToDuration } from "@/common/time-util";
import Condition, { IfTruthy } from "@/renderer/components/Condition";
import CurrentMusicLocator from "@/renderer/components/CurrentMusicLocator";
import DragReceiver, { startDrag } from "@/renderer/components/DragReceiver";
import Empty from "@/renderer/components/Empty";
import LazyImage from "@/renderer/components/LazyImage";
import MusicDownloaded from "@/renderer/components/MusicDownloaded";
import MusicFavorite from "@/renderer/components/MusicFavorite";
import { showMusicContextMenu } from "@/renderer/components/MusicList";
import SvgAsset from "@/renderer/components/SvgAsset";
import trackPlayer from "@renderer/core/track-player";
import {
    useCurrentMusic,
    useMusicQueue,
    useProgress,
} from "@renderer/core/track-player/hooks";
import getCompactArtworkSrc from "@renderer/utils/get-compact-artwork-src";
import normalizeArtworkDisplaySrc from "@renderer/utils/normalize-artwork-display-src";
import useVirtualList from "@/hooks/useVirtualList";
import hotkeys from "hotkeys-js";
import { useTranslation } from "react-i18next";
import Base from "../Base";

const estimateItemHeight = 5.7 * rem;
const DRAG_TAG = "Playlist";

interface IProps {
    coverHeader?: boolean;
}

function PlaylistArtwork(props: {
    musicItem: IMusic.IMusicItem;
    className: string;
}) {
    const artworkSrc = getCompactArtworkSrc(props.musicItem, 160) ?? albumImg;
    const [displaySrc, setDisplaySrc] = useState(artworkSrc);

    useEffect(() => {
        let canceled = false;

        setDisplaySrc(artworkSrc);
        if (
            artworkSrc.startsWith("data:image/") &&
            !artworkSrc.startsWith("data:image/svg+xml")
        ) {
            void normalizeArtworkDisplaySrc(artworkSrc).then((normalizedSrc) => {
                if (!canceled) {
                    setDisplaySrc(normalizedSrc ?? artworkSrc);
                }
            });
        }

        return () => {
            canceled = true;
        };
    }, [artworkSrc]);

    return (
        <LazyImage
            className={props.className}
            src={displaySrc}
            fallbackSrc={albumImg}
            root={null}
            releaseWhenHidden={false}
            alt={props.musicItem.title}
            draggable={false}
        ></LazyImage>
    );
}

function PlayingIndicator() {
    return (
        <span className="playlist--playing-indicator" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
        </span>
    );
}

function NowPlayingStage(props: {
    currentMusic: IMusic.IMusicItem;
    queueLength: number;
}) {
    const { currentMusic, queueLength } = props;
    const progress = useProgress();
    const { t } = useTranslation();
    const duration = Number.isFinite(progress.duration) && progress.duration > 0
        ? progress.duration
        : currentMusic.duration ?? 0;
    const currentTime = Number.isFinite(progress.currentTime)
        ? Math.max(progress.currentTime, 0)
        : 0;
    const progressRatio = duration > 0
        ? Math.min(currentTime / duration, 1)
        : 0;

    return (
        <section className="playlist--now-playing-stage">
            <div className="playlist--stage-orbit" aria-hidden="true"></div>
            <div className="playlist--stage-artwork">
                <PlaylistArtwork
                    musicItem={currentMusic}
                    className="playlist--stage-artwork-image"
                ></PlaylistArtwork>
                <PlayingIndicator></PlayingIndicator>
            </div>
            <div className="playlist--stage-copy">
                <div className="playlist--stage-label">
                    <span className="playlist--stage-signal"></span>
                    {t("panel.now_playing")}
                </div>
                <div className="playlist--stage-title" title={currentMusic.title}>
                    {currentMusic.title ?? "-"}
                </div>
                <div className="playlist--stage-meta">
                    <span title={currentMusic.artist}>{currentMusic.artist ?? "-"}</span>
                    {currentMusic.platform ? (
                        <>
                            <i aria-hidden="true"></i>
                            <span>{currentMusic.platform}</span>
                        </>
                    ) : null}
                </div>
            </div>
            <button
                type="button"
                className="playlist--clear-button"
                disabled={queueLength === 0}
                title={t("common.clear")}
                onClick={() => {
                    trackPlayer.reset();
                }}
            >
                <SvgAsset iconName="trash" size={15}></SvgAsset>
                <span>{t("common.clear")}</span>
            </button>
            <div className="playlist--stage-progress" aria-hidden="true">
                <span style={{ width: `${progressRatio * 100}%` }}></span>
            </div>
            <div className="playlist--stage-time" aria-hidden="true">
                <span>{secondsToDuration(currentTime)}</span>
                <span>{secondsToDuration(duration)}</span>
            </div>
        </section>
    );
}

export default function PlayList(props: IProps) {
    const { coverHeader } = props;
    const musicQueue = useMusicQueue();
    const currentMusic = useCurrentMusic();
    const scrollElementRef = useRef<HTMLDivElement>(null);
    const getScrollElement = useCallback(() => scrollElementRef.current, []);
    const [activeItems, setActiveItems] = useState<Set<number>>(new Set());
    const lastActiveIndexRef = useRef(0);
    const { t } = useTranslation();

    const virtualController = useVirtualList({
        estimateItemHeight,
        data: musicQueue,
        getScrollElement,
        fallbackRenderCount: 0,
    });
    const { scrollToIndex, setScrollElement } = virtualController;

    useEffect(() => {
        setScrollElement(scrollElementRef.current);
        const currentQueueMusic = trackPlayer.currentMusic;
        if (currentQueueMusic) {
            const index = trackPlayer.musicQueue.findIndex((it) =>
                isSameMedia(it, currentQueueMusic),
            );
            if (index >= 0) {
                scrollToIndex(Math.max(index - 2, 0));
            }
        }

        const ctrlAHandler = (evt: Event) => {
            evt.preventDefault();
            const queue = trackPlayer.musicQueue;
            setActiveItems(new Set(Array.from({ length: queue.length }, (_, i) => i)));
        };
        hotkeys("Ctrl+A", "play-list", ctrlAHandler);

        return () => {
            hotkeys.unbind("Ctrl+A", ctrlAHandler);
        };
    }, [scrollToIndex, setScrollElement]);

    const onDrop = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) {
            return;
        }
        const newData = musicQueue
            .slice(0, fromIndex)
            .concat(musicQueue.slice(fromIndex + 1));
        newData.splice(
            fromIndex > toIndex ? toIndex : toIndex - 1,
            0,
            musicQueue[fromIndex],
        );
        trackPlayer.setMusicQueue(newData);
    };

    useEffect(() => {
        setActiveItems(new Set());
    }, [musicQueue]);

    return (
        <Base
            className="playlist--panel"
            width="560px"
            scrollable={false}
            coverHeader={coverHeader}
            withBlur
        >
            <Base.Header>
                <div className="playlist--header-copy">
                    <div className="playlist--header-mark" aria-hidden="true">
                        <SvgAsset iconName="playlist" size={20}></SvgAsset>
                    </div>
                    <div className="playlist--header-text">
                        <div className="playlist--eyebrow">{t("media.playlist")}</div>
                        <div className="playlist--header-title-row">
                            <div className="playlist--header-title">{t("panel.play_queue")}</div>
                            <div className="playlist--track-count">
                                {t("panel.queue_track_count", {
                                    number: musicQueue.length,
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </Base.Header>
            {currentMusic ? (
                <NowPlayingStage
                    currentMusic={currentMusic}
                    queueLength={musicQueue.length}
                ></NowPlayingStage>
            ) : null}
            <div className="playlist--music-list-shell">
                <CurrentMusicLocator
                    musicList={musicQueue}
                    getScrollElement={getScrollElement}
                    scrollToIndex={scrollToIndex}
                    placement="container"
                ></CurrentMusicLocator>
                <div className="playlist--music-list-container" ref={scrollElementRef}>
                    <Condition
                        condition={musicQueue.length !== 0}
                        falsy={<div className="playlist--empty-state"><Empty></Empty></div>}
                    >
                        <div
                            className="playlist--music-list-scroll"
                            style={{
                                height: virtualController.totalHeight,
                            }}
                            tabIndex={-1}
                            onFocus={() => {
                                hotkeys.setScope("play-list");
                            }}
                            onBlur={() => {
                                hotkeys.setScope("all");
                            }}
                        >
                            {virtualController.virtualItems.map((virtualItem) => {
                                const musicItem = virtualItem.dataItem;
                                const rowIndex = virtualItem.rowIndex;
                                return (
                                    <div
                                        key={`${getMediaPrimaryKey(musicItem)}-${rowIndex}`}
                                        className="playlist--virtual-row"
                                        style={{
                                            position: "absolute",
                                            left: 0,
                                            top: virtualItem.top,
                                            width: "100%",
                                        }}
                                        draggable
                                        onDragStart={(e) => {
                                            startDrag(e, rowIndex, DRAG_TAG);
                                        }}
                                        onDoubleClick={() => {
                                            trackPlayer.playMusic(musicItem);
                                        }}
                                        onContextMenu={(e) => {
                                            if (activeItems.size > 1) {
                                                const selectedItems: IMusic.IMusicItem[] = [];

                                                activeItems.forEach((item) => {
                                                    selectedItems.push(musicQueue[item]);
                                                });

                                                showMusicContextMenu(
                                                    selectedItems,
                                                    e.clientX,
                                                    e.clientY,
                                                    "play-list",
                                                );
                                            } else {
                                                lastActiveIndexRef.current = virtualItem.rowIndex;
                                                setActiveItems(new Set([virtualItem.rowIndex]));
                                                showMusicContextMenu(
                                                    musicItem,
                                                    e.clientX,
                                                    e.clientY,
                                                    "play-list",
                                                );
                                            }
                                        }}
                                        onClick={() => {
                                            if (hotkeys.shift) {
                                                let start = lastActiveIndexRef.current;
                                                let end = virtualItem.rowIndex;

                                                if (start >= end) {
                                                    [start, end] = [end, start];
                                                }

                                                if (end > musicQueue.length) {
                                                    end = musicQueue.length - 1;
                                                }
                                                setActiveItems(
                                                    new Set(
                                                        Array.from(
                                                            { length: end - start + 1 },
                                                            (_, i) => start + i,
                                                        ),
                                                    ),
                                                );
                                            } else if (hotkeys.ctrl) {
                                                const newSet = new Set(activeItems);

                                                if (newSet.has(virtualItem.rowIndex)) {
                                                    newSet.delete(virtualItem.rowIndex);
                                                } else {
                                                    newSet.add(virtualItem.rowIndex);
                                                }
                                                setActiveItems(newSet);
                                            } else {
                                                setActiveItems(new Set([virtualItem.rowIndex]));
                                                lastActiveIndexRef.current = virtualItem.rowIndex;
                                            }
                                        }}
                                    >
                                        <PlayListMusicItem
                                            rowIndex={rowIndex}
                                            isPlaying={isSameMedia(currentMusic, musicItem)}
                                            isActive={activeItems.has(virtualItem.rowIndex)}
                                            musicItem={musicItem}
                                        ></PlayListMusicItem>

                                        <IfTruthy condition={rowIndex === 0}>
                                            <DragReceiver
                                                position="top"
                                                rowIndex={0}
                                                tag={DRAG_TAG}
                                                onDrop={onDrop}
                                            ></DragReceiver>
                                        </IfTruthy>
                                        <DragReceiver
                                            position="bottom"
                                            rowIndex={rowIndex + 1}
                                            tag={DRAG_TAG}
                                            onDrop={onDrop}
                                        ></DragReceiver>
                                    </div>
                                );
                            })}
                        </div>
                    </Condition>
                </div>
            </div>
        </Base>
    );
}

interface IPlayListMusicItemProps {
    rowIndex: number;
    isPlaying: boolean;
    musicItem: IMusic.IMusicItem;
    isActive?: boolean;
}

function PlayListMusicItemView(props: IPlayListMusicItemProps) {
    const { rowIndex, isPlaying, musicItem, isActive } = props;
    const { t } = useTranslation();

    if (!musicItem) {
        return null;
    }

    return (
        <div
            className="play-list--music-item-container"
            data-active={isActive}
            data-playing={isPlaying}
        >
            <div className="playlist--rail-index" aria-hidden="true">
                {isPlaying ? (
                    <PlayingIndicator></PlayingIndicator>
                ) : (
                    <span>{String(rowIndex + 1).padStart(2, "0")}</span>
                )}
            </div>
            <div className="playlist--row-artwork">
                <PlaylistArtwork
                    musicItem={musicItem}
                    className="playlist--row-artwork-image"
                ></PlaylistArtwork>
            </div>
            <div className="playlist--track-main">
                <div className="playlist--track-title" title={musicItem.title}>
                    {musicItem.title ?? "-"}
                </div>
                <div className="playlist--track-meta">
                    <span className="playlist--artist" title={musicItem.artist}>
                        {musicItem.artist ?? "-"}
                    </span>
                    {musicItem.platform ? (
                        <>
                            <i aria-hidden="true"></i>
                            <span className="playlist--platform">{musicItem.platform}</span>
                        </>
                    ) : null}
                    {musicItem.duration ? (
                        <span className="playlist--duration">
                            {secondsToDuration(musicItem.duration)}
                        </span>
                    ) : null}
                </div>
            </div>
            <div className="playlist--row-actions">
                <div className="playlist--option-button">
                    <MusicFavorite
                        musicItem={musicItem}
                        size={15}
                        fillContainer
                    ></MusicFavorite>
                </div>
                <div className="playlist--option-button">
                    <MusicDownloaded
                        musicItem={musicItem}
                        size={15}
                        fillContainer
                    ></MusicDownloaded>
                </div>
                <button
                    type="button"
                    className="playlist--remove"
                    title={t("panel.remove_from_queue")}
                    aria-label={t("panel.remove_from_queue")}
                    onClick={(e) => {
                        e.stopPropagation();
                        trackPlayer.removeMusic(musicItem);
                    }}
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                    }}
                >
                    <SvgAsset iconName="x-mark" size={13}></SvgAsset>
                </button>
            </div>
        </div>
    );
}

const PlayListMusicItem = memo(
    PlayListMusicItemView,
    (prev, curr) =>
        prev.rowIndex === curr.rowIndex &&
        prev.isPlaying === curr.isPlaying &&
        prev.musicItem === curr.musicItem &&
        prev.isActive === curr.isActive,
);
