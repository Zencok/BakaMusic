import "./index.scss";
import { memo, useEffect, useRef, useState } from "react";
import trackPlayer from "@renderer/core/track-player";
import Condition, { IfTruthy } from "@/renderer/components/Condition";
import Empty from "@/renderer/components/Empty";
import { getMediaPrimaryKey, isSameMedia } from "@/common/media-util";
import MusicFavorite from "@/renderer/components/MusicFavorite";
import Tag from "@/renderer/components/Tag";
import SvgAsset from "@/renderer/components/SvgAsset";
import useVirtualList from "@/hooks/useVirtualList";
import { rem } from "@/common/constant";
import { showMusicContextMenu } from "@/renderer/components/MusicList";
import MusicDownloaded from "@/renderer/components/MusicDownloaded";
import Base from "../Base";
import hotkeys from "hotkeys-js";
import { Trans, useTranslation } from "react-i18next";
import DragReceiver, { startDrag } from "@/renderer/components/DragReceiver";
import { useCurrentMusic, useMusicQueue } from "@renderer/core/track-player/hooks";

const estimateItemHeight = 5.4 * rem;
const DRAG_TAG = "Playlist";

interface IProps {
    coverHeader?: boolean;
}

export default function PlayList(props: IProps) {
    const { coverHeader } = props;
    const musicQueue = useMusicQueue();
    const currentMusic = useCurrentMusic();
    const scrollElementRef = useRef<HTMLDivElement>();
    const [activeItems, setActiveItems] = useState<Set<number>>(new Set());
    const lastActiveIndexRef = useRef(0);

    const { t } = useTranslation();

    const virtualController = useVirtualList({
        estimateItemHeight,
        data: musicQueue,
        getScrollElement() {
            return scrollElementRef.current;
        },
        fallbackRenderCount: 0,
    });

    const scrollToCurrentMusic = (behavior: ScrollBehavior = "smooth") => {
        if (!currentMusic) {
            return;
        }
        const index = musicQueue.findIndex((it) => isSameMedia(it, currentMusic));
        if (index < 0) {
            return;
        }
        lastActiveIndexRef.current = index;
        setActiveItems(new Set([index]));
        virtualController.scrollToIndex(Math.max(index - 2, 0), behavior);
    };

    useEffect(() => {
        virtualController.setScrollElement(scrollElementRef.current);
        const currentQueueMusic = trackPlayer.currentMusic;
        if (currentQueueMusic) {
            const index = trackPlayer.musicQueue.findIndex((it) =>
                isSameMedia(it, currentQueueMusic),
            );
            if (index >= 0) {
                virtualController.scrollToIndex(Math.max(index - 2, 0));
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
    }, []);

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
        <Base width={"520px"} scrollable={false} coverHeader={coverHeader} withBlur>
            <Base.Header>
                <div className="playlist--header-copy">
                    <div className="playlist--eyebrow">{t("media.playlist")}</div>
                    <div className="playlist--title">
                        <Trans
                            i18nKey={"panel.play_list_song_num"}
                            values={{
                                number: musicQueue.length,
                            }}
                        ></Trans>
                    </div>
                </div>
            </Base.Header>
            <div className="playlist--toolbar">
                <div className="playlist--now-playing" title={currentMusic?.title}>
                    {currentMusic ? (
                        <>
                            <SvgAsset iconName="speaker-wave" size={14}></SvgAsset>
                            <span className="playlist--now-playing-text">{currentMusic.title}</span>
                        </>
                    ) : null}
                </div>
                <div className="playlist--toolbar-actions">
                    <div
                        role="button"
                        className="playlist--locate-button"
                        data-disabled={!currentMusic}
                        onClick={() => {
                            scrollToCurrentMusic();
                        }}
                    >
                        <SvgAsset iconName="speaker-wave" size={14}></SvgAsset>
                        <span>{t("panel.locate_current_music")}</span>
                    </div>
                    <div
                        role="button"
                        className="playlist--clear-button"
                        onClick={() => {
                            trackPlayer.reset();
                        }}
                    >
                        {t("common.clear")}
                    </div>
                </div>
            </div>
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
                                    key={virtualItem.rowIndex}
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
                                                    Array.from({ length: end - start + 1 }, (_, i) => start + i),
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
                                        key={getMediaPrimaryKey(musicItem)}
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
        </Base>
    );
}

interface IPlayListMusicItemProps {
    rowIndex: number;
    isPlaying: boolean;
    musicItem: IMusic.IMusicItem;
    isActive?: boolean;
}

function _PlayListMusicItem(props: IPlayListMusicItemProps) {
    const { rowIndex, isPlaying, musicItem, isActive } = props;

    if (!musicItem) {
        return null;
    }

    return (
        <div
            className="play-list--music-item-container"
            data-active={isActive}
            data-playing={isPlaying}
        >
            <div className="playlist--leading">
                {isPlaying ? (
                    <SvgAsset iconName="speaker-wave" size={14}></SvgAsset>
                ) : (
                    <span>{String(rowIndex + 1).padStart(2, "0")}</span>
                )}
            </div>
            <div className="playlist--main">
                <div className="playlist--title-row">
                    <div className="playlist--title" title={musicItem.title}>
                        {musicItem.title ?? "-"}
                    </div>
                    <div className="playlist--options">
                        <MusicFavorite musicItem={musicItem} size={16}></MusicFavorite>
                        <MusicDownloaded musicItem={musicItem} size={16}></MusicDownloaded>
                    </div>
                </div>
                <div className="playlist--meta-row">
                    <div className="playlist--artist" title={musicItem.artist}>
                        {musicItem.artist ?? "-"}
                    </div>
                    <div className="playlist--platform">
                        <Tag style={{ width: "initial" }}>{musicItem.platform}</Tag>
                    </div>
                </div>
            </div>
            <div
                className="playlist--remove"
                role="button"
                onClick={(e) => {
                    e.stopPropagation();
                    trackPlayer.removeMusic(musicItem);
                }}
            >
                <SvgAsset iconName="x-mark" size={14}></SvgAsset>
            </div>
        </div>
    );
}

const PlayListMusicItem = memo(
    _PlayListMusicItem,
    (prev, curr) =>
        prev.rowIndex === curr.rowIndex &&
        prev.isPlaying === curr.isPlaying &&
        prev.musicItem === curr.musicItem &&
        prev.isActive === curr.isActive,
);

