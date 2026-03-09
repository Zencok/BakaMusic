import {
    ColumnDef,
    createColumnHelper,
    getCoreRowModel,
    getSortedRowModel,
    SortingState,
    useReactTable,
} from "@tanstack/react-table";

import "./index.scss";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { localPluginName, qualityKeys, RequestStateCode } from "@/common/constant";
import { getInternalData, getMediaPrimaryKey, isSameMedia } from "@/common/media-util";
import { normalizeFileSize } from "@/common/normalize-util";
import { secondsToDuration } from "@/common/time-util";
import { CSSProperties, memo, useCallback, useEffect, useRef, useState } from "react";
import hotkeys from "hotkeys-js";
import { toast } from "react-toastify";
import useVirtualList from "@/hooks/useVirtualList";
import AppConfig from "@shared/app-config/renderer";
import { i18n } from "@/shared/i18n/renderer";
import { shellUtil } from "@shared/utils/renderer";
import BottomLoadingState from "../BottomLoadingState";
import Condition, { IfTruthy } from "../Condition";
import { IContextMenuItem, showContextMenu } from "../ContextMenu";
import DragReceiver, { startDrag } from "../DragReceiver";
import Empty from "../Empty";
import { showModal } from "../Modal";
import MusicDownloaded from "../MusicDownloaded";
import MusicFavorite from "../MusicFavorite";
import SvgAsset from "../SvgAsset";
import Tag from "../Tag";
import musicSheetDB from "@/renderer/core/db/music-sheet-db";
import Downloader from "@/renderer/core/downloader";
import MusicSheet from "@/renderer/core/music-sheet";
import trackPlayer from "@renderer/core/track-player";
import { useCurrentMusic } from "@renderer/core/track-player/hooks";
import isLocalMusic from "@/renderer/utils/is-local-music";
import normalizeArtworkDisplaySrc from "@/renderer/utils/normalize-artwork-display-src";
import { promptDownloadWithQuality } from "@/renderer/utils/download-quality";
interface IMusicListProps {
    /** 鐏炴洜銇氶惃鍕尡閺€鎯у灙鐞?*/
    musicList: IMusic.IMusicItem[];
    /** 鐎圭偤妾惃鍕尡閺€鎯у灙鐞?*/
    getAllMusicItems?: () => IMusic.IMusicItem[];
    /** 闂婂厖绠伴崚妤勩€冮幍鈧仦鐐垫畱濮濆苯宕熸穱鈩冧紖 */
    musicSheet?: IMusic.IMusicSheetItem;
    // enablePagination?: boolean; // 閸掑棝銆?閾忔碍瀚欓梹鍨灙鐞?
    state?: RequestStateCode; // 缂冩垹绮堕悩鑸碘偓?
    doubleClickBehavior?: "replace" | "normal"; // 閸欏苯鍤悰灞艰礋
    onPageChange?: (page?: number) => void; // 閸掑棝銆?
    /** 閾忔碍瀚欏姘З閸欏倹鏆?*/
    virtualProps?: {
        offsetHeight?: number | (() => number); // 鐠烘繄顬囨い鍫曞劥閻ㄥ嫰鐝惔?
        getScrollElement?: () => HTMLElement | null; // 濠婃艾濮?
        fallbackRenderCount?: number;
    };
    headerOnlySurface?: boolean;
    containerStyle?: CSSProperties;
    hideRows?: Array<
        "like" | "index" | "title" | "artist" | "album" | "duration" | "platform"
    >;
    /** 閸忎浇顔忛幏鏍ㄥ */
    enableDrag?: boolean;
    /** 閹锋牗瀚跨紒鎾存将 */
    onDragEnd?: (newMusicList: IMusic.IMusicItem[]) => void;
    /** context */
    contextMenu?: IContextMenuItem[];
}

const artworkDisplayCache = new Map<string, string>();

function ArtworkContent(props: {
    src?: string;
    alt: string;
}) {
    const rawSrc = props.src ?? albumImg;
    const [displaySrc, setDisplaySrc] = useState(
        () => artworkDisplayCache.get(rawSrc) ?? rawSrc,
    );

    useEffect(() => {
        let canceled = false;
        const nextSrc = props.src ?? albumImg;
        const cachedSrc = artworkDisplayCache.get(nextSrc);

        if (cachedSrc) {
            setDisplaySrc(cachedSrc);
            return;
        }

        setDisplaySrc(nextSrc);
        void normalizeArtworkDisplaySrc(nextSrc).then((normalizedSrc) => {
            const resolvedSrc = normalizedSrc ?? nextSrc;
            artworkDisplayCache.set(nextSrc, resolvedSrc);

            if (!canceled) {
                setDisplaySrc(resolvedSrc);
            }
        });

        return () => {
            canceled = true;
        };
    }, [props.src]);

    return (
        <>
            <span
                className="music-list-cover-backdrop"
                aria-hidden="true"
                style={{
                    all: "unset",
                    position: "absolute",
                    inset: 0,
                    display: "block",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "center center",
                    backgroundSize: "cover",
                    backgroundImage: `url("${displaySrc}")`,
                    transform: "scale(1.08)",
                    filter: "blur(12px) saturate(118%)",
                    opacity: 0.72,
                }}
            ></span>
            <span
                className="music-list-cover-image"
                aria-hidden="true"
                title={props.alt}
                style={{
                    all: "unset",
                    position: "absolute",
                    inset: 0,
                    display: "block",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "center center",
                    backgroundSize: "cover",
                    backgroundImage: `url("${displaySrc}")`,
                }}
            ></span>
        </>
    );
}

const columnHelper = createColumnHelper<IMusic.IMusicItem>();
const columnDef: ColumnDef<IMusic.IMusicItem>[] = [
    columnHelper.display({
        id: "like",
        size: 42,
        minSize: 42,
        maxSize: 42,
        cell: (info) => (
            <div className="music-list-operations">
                <MusicFavorite musicItem={info.row.original} size={18}></MusicFavorite>
                <MusicDownloaded musicItem={info.row.original}></MusicDownloaded>
            </div>
        ),
        enableResizing: false,
        enableSorting: false,
    }),
    columnHelper.accessor((_, index) => index + 1, {
        cell: (info) => info.getValue(),
        header: "#",
        id: "index",
        minSize: 40,
        maxSize: 40,
        size: 40,
        enableResizing: false,
    }),
    columnHelper.accessor("title", {
        header: () => i18n.t("media.media_title"),
        size: 250,
        maxSize: 300,
        minSize: 100,
        cell: (info) => {
            const title = info?.getValue?.();
            return <span title={title}>{title}</span>;
        },
        // @ts-ignore
        fr: 3,
    }),

    columnHelper.accessor("artist", {
        header: () => i18n.t("media.media_type_artist"),
        size: 130,
        maxSize: 200,
        minSize: 60,
        cell: (info) => <span title={info.getValue()}>{info.getValue()}</span>,
        // @ts-ignore
        fr: 2,
    }),
    columnHelper.accessor("album", {
        header: () => i18n.t("media.media_type_album"),
        size: 120,
        maxSize: 200,
        minSize: 60,
        cell: (info) => <span title={info.getValue()}>{info.getValue()}</span>,
        // @ts-ignore
        fr: 2,
    }),
    columnHelper.accessor("duration", {
        header: () => i18n.t("media.media_duration"),
        size: 64,
        maxSize: 150,
        minSize: 48,
        cell: (info) =>
            info.getValue() ? secondsToDuration(info.getValue()) : "--:--",
        // @ts-ignore
        fr: 1,
    }),
    columnHelper.accessor("platform", {
        header: () => i18n.t("media.media_platform"),
        size: 100,
        minSize: 80,
        maxSize: 300,
        cell: (info) => <Tag fill>{info.getValue()}</Tag>,
        // @ts-ignore
        fr: 1,
    }),
];

const estimizeItemHeight = 88; // compact card row

export function showMusicContextMenu(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
    x: number,
    y: number,
    sheetType?: string,
) {
    const menuItems: IContextMenuItem[] = [];
    const isArray = Array.isArray(musicItems);
    if (!isArray) {
        menuItems.push(
            {
                title: `ID: ${getMediaPrimaryKey(musicItems)}`,
                icon: "identification",
            },
            {
                title: `${i18n.t("media.media_type_artist")}: ${
                    musicItems.artist ?? i18n.t("media.unknown_artist")
                }`,
                icon: "user",
            },
            {
                title: `${i18n.t("media.media_type_album")}: ${
                    musicItems.album ?? i18n.t("media.unknown_album")
                }`,
                icon: "album",
                show: !!musicItems.album,
            },
            {
                divider: true,
            },
        );
    }
    menuItems.push(
        {
            title: i18n.t("music_list_context_menu.next_play"),
            icon: "motion-play",
            onClick() {
                trackPlayer.addNext(musicItems);
            },
        },
        {
            title: i18n.t("music_list_context_menu.add_to_my_sheets"),
            icon: "document-plus",
            onClick() {
                showModal("AddMusicToSheet", {
                    musicItems: musicItems,
                });
            },
        },
        {
            title: i18n.t("music_list_context_menu.remove_from_sheet"),
            icon: "trash",
            show: !!sheetType && sheetType !== "play-list",
            onClick() {
                MusicSheet.frontend.removeMusicFromSheet(musicItems, sheetType);
            },
        },
        {
            title: i18n.t("common.remove"),
            icon: "trash",
            show: sheetType === "play-list",
            onClick() {
                trackPlayer.removeMusic(musicItems);
            },
        },
    );

    menuItems.push(
        {
            title: i18n.t("common.download"),
            icon: "array-download-tray",
            show: isArray
                ? !musicItems.every(
                    (item) => isLocalMusic(item) || Downloader.isDownloaded(item),
                )
                : !isLocalMusic(musicItems) && !Downloader.isDownloaded(musicItems),
            onClick() {
                promptDownloadWithQuality(musicItems);
            },
        },
        {
            title: i18n.t("music_list_context_menu.delete_local_download"),
            icon: "trash",
            show:
                (isArray && musicItems.every((it) => Downloader.isDownloaded(it))) ||
                (!isArray && Downloader.isDownloaded(musicItems)),
            async onClick() {
                const [isSuccess, info] = await Downloader.removeDownloadedMusic(
                    musicItems,
                    true,
                );
                if (isSuccess) {
                    if (isArray) {
                        toast.success(
                            i18n.t(
                                "music_list_context_menu.delete_local_downloaded_songs_success",
                                {
                                    musicNums: musicItems.length,
                                },
                            ),
                        );
                    } else {
                        toast.success(
                            i18n.t(
                                "music_list_context_menu.delete_local_downloaded_song_success",
                                {
                                    songName: (musicItems as IMusic.IMusicItem).title,
                                },
                            ),
                        );
                    }
                } else if (info?.msg) {
                    toast.error(info.msg);
                }
            },
        },
        {
            title: i18n.t(
                "music_list_context_menu.reveal_local_music_in_file_explorer",
            ),
            icon: "folder-open",
            show:
                !isArray &&
                (Downloader.isDownloaded(musicItems) ||
                    musicItems?.platform === localPluginName),
            async onClick() {
                try {
                    if (!isArray) {
                        let realTimeMusicItem = musicItems;
                        if (musicItems.platform !== localPluginName) {
                            realTimeMusicItem = await musicSheetDB.musicStore.get([
                                musicItems.platform,
                                musicItems.id,
                            ]);
                        }

                        const downloadPath = getInternalData<IMusic.IMusicItemInternalData>(
                            realTimeMusicItem,
                            "downloadData",
                        )?.path;

                        const result = await shellUtil.showItemInFolder(downloadPath);
                        if (!result) {
                            throw new Error();
                        }
                    }
                } catch (e) {
                    toast.error(
                        `${i18n.t(
                            "music_list_context_menu.reveal_local_music_in_file_explorer_fail",
                        )} ${e?.message ?? ""}`,
                    );
                }
            },
        },
    );

    showContextMenu({
        x,
        y,
        menuItems,
    });
}

const qualityAbbr: Record<IMusic.IQualityKey, string> = {
    "mgg": "MG",
    "128k": "LQ",
    "192k": "MQ",
    "320k": "HQ",
    "flac": "SQ",
    "flac24bit": "HR",
    "hires": "HR",
    "dolby": "DB",
    "atmos": "AT",
    "atmos_plus": "A+",
    "master": "MS",
};

const compactTagStyle: CSSProperties = {
    fontSize: "0.72rem",
    lineHeight: 1.2,
    padding: "2px 8px",
    borderRadius: 999,
    maxWidth: "none",
};

const sortColumns = ["title", "artist", "album", "duration", "platform"] as const;

type SortColumnId = typeof sortColumns[number];

function formatSizeText(size?: string | number) {
    if (size === undefined || size === null || size === "") {
        return "";
    }

    if (typeof size === "number") {
        return normalizeFileSize(size);
    }

    const normalizedNumber = Number(size);
    if (!isNaN(normalizedNumber) && isFinite(normalizedNumber)) {
        return normalizeFileSize(normalizedNumber);
    }

    return `${size}`;
}

function getBestQualityInfo(musicItem: IMusic.IMusicItem) {
    const qualities = musicItem?.qualities as IMusic.IQuality | undefined;
    const source =
        musicItem?.source && typeof musicItem.source === "object"
            ? musicItem.source as Partial<Record<IMusic.IQualityKey, { size?: string | number; url?: string }>>
            : undefined;

    const quality = [...qualityKeys].reverse().find((item) => {
        if (qualities?.[item] !== undefined) {
            return true;
        }

        const sourceItem = source?.[item];
        return !!sourceItem && (
            sourceItem.url !== undefined ||
            sourceItem.size !== undefined
        );
    });

    if (!quality) {
        return null;
    }

    const sizeText = formatSizeText(
        qualities?.[quality]?.size ?? source?.[quality]?.size,
    );

    return {
        quality,
        label: qualityAbbr[quality] || quality.toUpperCase(),
        sizeText,
    };
}

function getSortLabel(columnId: SortColumnId) {
    switch (columnId) {
        case "title":
            return i18n.t("media.media_title");
        case "artist":
            return i18n.t("media.media_type_artist");
        case "album":
            return i18n.t("media.media_type_album");
        case "duration":
            return i18n.t("media.media_duration");
        case "platform":
            return i18n.t("media.media_platform");
        default:
            return columnId;
    }
}

function playMusicFromList(
    musicItem: IMusic.IMusicItem,
    allRows: IMusic.IMusicItem[],
    doubleClickBehavior?: "replace" | "normal",
) {
    const config =
        doubleClickBehavior ??
        AppConfig.getConfig("playMusic.clickMusicList");

    if (config === "replace") {
        trackPlayer.playMusicWithReplaceQueue(allRows, musicItem);
    } else {
        trackPlayer.playMusic(musicItem);
    }
}


function _MusicList(props: IMusicListProps) {
    const {
        musicList,
        state = RequestStateCode.FINISHED,
        onPageChange,
        musicSheet,
        virtualProps,
        headerOnlySurface,
        doubleClickBehavior,
        containerStyle,
        hideRows,
        enableDrag,
        onDragEnd,
    } = props;

    const currentMusic = useCurrentMusic();
    const hiddenRows = new Set(hideRows ?? []);
    const [sorting, setSorting] = useState<SortingState>([]);

    const musicListRef = useRef(musicList);
    const columnShownRef = useRef(
        AppConfig.getConfig("normal.musicListColumnsShown").reduce(
            (prev, curr) => ({
                ...prev,
                [curr]: false,
            }),
            {},
        ),
    );

    const table = useReactTable({
        debugAll: false,
        data: musicList,
        columns: columnDef,
        state: {
            sorting,
            columnVisibility: hideRows
                ? hideRows.reduce((prev, curr) => ({ ...prev, [curr]: false }), {
                    ...columnShownRef.current,
                })
                : columnShownRef.current,
        },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    const tableContainerRef = useRef<HTMLDivElement>(null);
    const virtualController = useVirtualList({
        data: table.getRowModel().rows,
        getScrollElement: virtualProps?.getScrollElement,
        offsetHeight:
            virtualProps?.offsetHeight ??
            (() => tableContainerRef.current?.offsetTop ?? 0),
        estimateItemHeight: estimizeItemHeight,
        fallbackRenderCount: !virtualProps?.getScrollElement
            ? -1
            : virtualProps?.fallbackRenderCount ?? 50,
    });

    const [activeItems, setActiveItems] = useState<Set<number>>(new Set());
    const lastActiveIndexRef = useRef(0);
    const localSheetType = musicSheet?.platform === localPluginName
        ? musicSheet.id
        : undefined;

    useEffect(() => {
        setActiveItems(new Set());
        lastActiveIndexRef.current = 0;
        musicListRef.current = musicList;
    }, [musicList]);

    useEffect(() => {
        const ctrlAHandler = (evt: Event) => {
            evt.preventDefault();
            setActiveItems(new Set(Array.from({ length: musicListRef.current.length }, (_, i) => i)));
        };
        hotkeys("Ctrl+A", "music-list", ctrlAHandler);

        return () => {
            hotkeys.unbind("Ctrl+A", ctrlAHandler);
        };
    }, []);

    const onDrop = useCallback(
        (fromIndex: number, toIndex: number) => {
            if (!onDragEnd || fromIndex === toIndex) {
                return;
            }
            const newData = musicList
                .slice(0, fromIndex)
                .concat(musicList.slice(fromIndex + 1));
            newData.splice(
                fromIndex > toIndex ? toIndex : toIndex - 1,
                0,
                musicList[fromIndex],
            );
            onDragEnd?.(newData);
        },
        [onDragEnd, musicList],
    );

    const getSelectedItems = useCallback((selected: Set<number>) => {
        const rows = table.getRowModel().rows;
        return Array.from(selected)
            .sort((a, b) => a - b)
            .map((index) => rows[index]?.original)
            .filter(Boolean);
    }, [table]);

    const playMusicItem = useCallback((musicItem: IMusic.IMusicItem) => {
        playMusicFromList(
            musicItem,
            table.getRowModel().rows.map((it) => it.original),
            doubleClickBehavior,
        );
    }, [doubleClickBehavior, table]);

    const currentSortId = sorting[0]?.id as SortColumnId | undefined;
    const currentSortDesc = !!sorting[0]?.desc;

    return (
        <div
            className="music-list-container"
            data-surface-mode={headerOnlySurface ? "header-only" : "default"}
            style={containerStyle}
            ref={tableContainerRef}
            tabIndex={-1}
            onFocus={() => {
                hotkeys.setScope("music-list");
            }}
            onBlur={() => {
                hotkeys.setScope("all");
            }}
        >
            <div className="music-list-toolbar">
                <div className="music-list-toolbar-summary">
                    <span className="music-list-toolbar-title">
                        {i18n.t("media.media_type_music")}
                    </span>
                    <span className="music-list-toolbar-count">
                        {table.getRowModel().rows.length}
                    </span>
                </div>
                <div className="music-list-sorters">
                    {sortColumns
                        .filter((columnId) => !hiddenRows.has(columnId))
                        .map((columnId) => {
                            const isActive = currentSortId === columnId;
                            const iconName = !isActive
                                ? "sort"
                                : currentSortDesc
                                    ? "sort-desc"
                                    : "sort-asc";

                            return (
                                <button
                                    type="button"
                                    key={columnId}
                                    className="music-list-sorter"
                                    data-active={isActive}
                                    onClick={() => {
                                        if (!isActive) {
                                            setSorting([{ id: columnId, desc: false }]);
                                        } else if (!currentSortDesc) {
                                            setSorting([{ id: columnId, desc: true }]);
                                        } else {
                                            setSorting([]);
                                        }
                                    }}
                                >
                                    <span>{getSortLabel(columnId)}</span>
                                    <SvgAsset iconName={iconName} size={14}></SvgAsset>
                                </button>
                            );
                        })}
                </div>
            </div>
            {musicList.length ? (
                <div
                    className="music-list-virtual-spacer"
                    style={{
                        height: virtualController.totalHeight,
                    }}
                >
                    <div
                        className="music-list-virtual-content"
                        style={{
                            transform: `translateY(${virtualController.startTop}px)`,
                        }}
                    >
                        {virtualController.virtualItems.map((virtualItem, index) => {
                            const row = virtualItem.dataItem;
                            const musicItem = row.original;

                            if (!musicItem) {
                                return null;
                            }

                            const subtitleParts: string[] = [];
                            if (!hiddenRows.has("artist") && musicItem.artist) {
                                subtitleParts.push(musicItem.artist);
                            }
                            if (!hiddenRows.has("album") && musicItem.album) {
                                subtitleParts.push(musicItem.album);
                            }

                            const qualityInfo = getBestQualityInfo(musicItem);
                            const isActive = activeItems.has(virtualItem.rowIndex);
                            const isPlaying = !!currentMusic && isSameMedia(currentMusic, musicItem);
                            const artworkSrc =
                                musicItem.artwork ??
                                musicItem.coverImg ??
                                albumImg;
                            const selectedItems =
                                activeItems.size > 1 && isActive
                                    ? getSelectedItems(activeItems)
                                    : null;

                            return (
                                <div
                                    className="music-list-row-wrapper"
                                    key={`${musicItem.platform}-${musicItem.id}-${virtualItem.rowIndex}`}
                                >
                                    <div
                                        className="music-list-card"
                                        data-active={isActive}
                                        data-playing={isPlaying}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            if (selectedItems?.length) {
                                                showMusicContextMenu(
                                                    selectedItems,
                                                    e.clientX,
                                                    e.clientY,
                                                    localSheetType,
                                                );
                                                return;
                                            }

                                            lastActiveIndexRef.current = virtualItem.rowIndex;
                                            setActiveItems(new Set([virtualItem.rowIndex]));
                                            showMusicContextMenu(
                                                musicItem,
                                                e.clientX,
                                                e.clientY,
                                                localSheetType,
                                            );
                                        }}
                                        onClick={() => {
                                            if (hotkeys.shift) {
                                                let start = lastActiveIndexRef.current;
                                                let end = virtualItem.rowIndex;

                                                if (start >= end) {
                                                    [start, end] = [end, start];
                                                }

                                                if (end > musicListRef.current.length) {
                                                    end = musicListRef.current.length - 1;
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
                                        onDoubleClick={() => {
                                            playMusicItem(musicItem);
                                        }}
                                        draggable={enableDrag}
                                        onDragStart={(e) => {
                                            startDrag(e, virtualItem.rowIndex, "musiclist");
                                        }}
                                    >
                                        <div className="music-list-leading">
                                            <IfTruthy condition={!hiddenRows.has("index")}>
                                                <span className="music-list-index">
                                                    {String(virtualItem.rowIndex + 1).padStart(2, "0")}
                                                </span>
                                            </IfTruthy>
                                            <button
                                                type="button"
                                                className="music-list-cover"
                                                title={musicItem.title}
                                                style={{
                                                    all: "unset",
                                                    position: "relative",
                                                    width: "52px",
                                                    height: "52px",
                                                    display: "block",
                                                    overflow: "hidden",
                                                    borderRadius: "14px",
                                                    flexShrink: 0,
                                                    cursor: "pointer",
                                                    background: "var(--appImageFallback)",
                                                    boxShadow:
                                                        "0 10px 24px rgba(15, 23, 42, 0.14)",
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    playMusicItem(musicItem);
                                                }}
                                            >
                                                <ArtworkContent
                                                    src={artworkSrc}
                                                    alt={musicItem.title}
                                                ></ArtworkContent>
                                                <span
                                                    className="music-list-cover-overlay"
                                                    style={{
                                                        position: "absolute",
                                                        inset: 0,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                    }}
                                                >
                                                    <span
                                                        className="music-list-cover-overlay-icon"
                                                        style={{
                                                            width: "28px",
                                                            height: "28px",
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            lineHeight: 0,
                                                        }}
                                                    >
                                                        <SvgAsset
                                                            iconName={isPlaying ? "pause" : "play"}
                                                            size={16}
                                                        ></SvgAsset>
                                                    </span>
                                                </span>
                                            </button>
                                        </div>
                                        <div className="music-list-main">
                                            <div className="music-list-title-row">
                                                <div className="music-list-title" title={musicItem.title}>
                                                    {musicItem.title}
                                                </div>
                                                <IfTruthy condition={isPlaying}>
                                                    <span className="music-list-playing-indicator">
                                                        <SvgAsset iconName="motion-play" size={14}></SvgAsset>
                                                    </span>
                                                </IfTruthy>
                                            </div>
                                            <div
                                                className="music-list-subtitle"
                                                title={subtitleParts.join(" · ") || musicItem.platform}
                                            >
                                                {subtitleParts.join(" · ") || musicItem.platform}
                                            </div>
                                            <div className="music-list-meta-row">
                                                <IfTruthy condition={!hiddenRows.has("duration")}>
                                                    <Tag style={compactTagStyle}>
                                                        {musicItem.duration
                                                            ? secondsToDuration(musicItem.duration)
                                                            : "--:--"}
                                                    </Tag>
                                                </IfTruthy>
                                                <IfTruthy condition={!!qualityInfo}>
                                                    <Tag style={compactTagStyle}>
                                                        {qualityInfo?.label}
                                                        {qualityInfo?.sizeText
                                                            ? ` · ${qualityInfo.sizeText}`
                                                            : ""}
                                                    </Tag>
                                                </IfTruthy>
                                                <IfTruthy condition={!hiddenRows.has("platform") && !!musicItem.platform}>
                                                    <Tag fill style={compactTagStyle}>
                                                        {musicItem.platform}
                                                    </Tag>
                                                </IfTruthy>
                                            </div>
                                        </div>
                                        <div className="music-list-side">
                                            <div className="music-list-actions">
                                                <IfTruthy condition={!hiddenRows.has("like")}>
                                                    <div
                                                        className="music-list-action-button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                        }}
                                                        onDoubleClick={(e) => {
                                                            e.stopPropagation();
                                                        }}
                                                    >
                                                        <MusicFavorite musicItem={musicItem} size={18}></MusicFavorite>
                                                    </div>
                                                    <div
                                                        className="music-list-action-button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                        }}
                                                        onDoubleClick={(e) => {
                                                            e.stopPropagation();
                                                        }}
                                                    >
                                                        <MusicDownloaded musicItem={musicItem} size={18}></MusicDownloaded>
                                                    </div>
                                                </IfTruthy>
                                                <button
                                                    type="button"
                                                    className="music-list-action-button"
                                                    title="menu"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        showMusicContextMenu(
                                                            selectedItems?.length ? selectedItems : musicItem,
                                                            rect.left,
                                                            rect.bottom,
                                                            localSheetType,
                                                        );
                                                    }}
                                                >
                                                    <SvgAsset iconName="list-bullet" size={18}></SvgAsset>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <IfTruthy condition={enableDrag}>
                                        <IfTruthy condition={index === 0}>
                                            <DragReceiver
                                                position="top"
                                                rowIndex={virtualItem.rowIndex}
                                                onDrop={onDrop}
                                                tag="musiclist"
                                            ></DragReceiver>
                                        </IfTruthy>
                                        <DragReceiver
                                            position="bottom"
                                            rowIndex={virtualItem.rowIndex + 1}
                                            onDrop={onDrop}
                                            tag="musiclist"
                                        ></DragReceiver>
                                    </IfTruthy>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}
            <Condition
                condition={musicList.length === 0}
                falsy={
                    <BottomLoadingState
                        state={state}
                        onLoadMore={onPageChange}
                    ></BottomLoadingState>
                }
            >
                <Empty></Empty>
            </Condition>
        </div>
    );
}

export default memo(
    _MusicList,
    (prev, curr) =>
        prev.state === curr.state &&
        prev.enableDrag === curr.enableDrag &&
        prev.musicList === curr.musicList &&
        prev.onPageChange === curr.onPageChange &&
        prev.onDragEnd === curr.onDragEnd &&
        prev.musicSheet &&
        curr.musicSheet &&
        isSameMedia(prev.musicSheet, curr.musicSheet),
);






