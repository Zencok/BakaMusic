import {
    ColumnDef,
    createColumnHelper,
    getCoreRowModel,
    useReactTable,
} from "@tanstack/react-table";

import "./index.scss";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { localPluginName, qualityKeys, RequestStateCode, sortIndexSymbol, timeStampSymbol } from "@/common/constant";
import { toError } from "@/common/error-util";
import { getInternalData, isSameMedia } from "@/common/media-util";
import {
    buildAlbumItemFromMusic,
    buildMusicAlbumCopyPayload,
    buildMusicArtistCopyPayload,
    buildMusicSongCopyPayload,
    copyTextToClipboard,
    formatMusicAlbumTitle,
    formatMusicArtistTitle,
    formatMusicSharePayload,
    formatMusicSongIdTitle,
    getNavigableArtists,
    type IMusicArtistEntry,
} from "@/common/music-identity";
import { appNavigate } from "@renderer/utils/app-navigate";
import MusicDetail, { isMusicDetailShown } from "@/renderer/components/MusicDetail";
import { secondsToDuration } from "@/common/time-util";
import { CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import hotkeys from "hotkeys-js";
import { toast } from "react-toastify";
import useVirtualList from "@/hooks/useVirtualList";
import AppConfig from "@shared/app-config/renderer";
import { i18n } from "@/shared/i18n/renderer";
import { shellUtil } from "@shared/utils/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import BottomLoadingState from "../BottomLoadingState";
import Condition, { IfTruthy } from "../Condition";
import { IContextMenuItem, showContextMenu } from "../ContextMenu";
import DragReceiver, { startDrag } from "../DragReceiver";
import Empty from "../Empty";
import { hideModal, showModal } from "../Modal";
import MusicDownloaded from "../MusicDownloaded";
import MusicFavorite from "../MusicFavorite";
import SvgAsset from "../SvgAsset";
import Tag from "../Tag";
import musicSheetDB from "@/renderer/core/music-sheet/database";
import Downloader from "@/renderer/core/downloader";
import MusicSheet from "@/renderer/core/music-sheet";
import trackPlayer from "@renderer/core/track-player";
import { getMediaPluginDelegate } from "@renderer/core/track-player/plugin-media";
import { useCurrentMusic } from "@renderer/core/track-player/hooks";
import isLocalMusic from "@/renderer/utils/is-local-music";
import normalizeArtworkDisplaySrc from "@/renderer/utils/normalize-artwork-display-src";
import { promptDownloadWithQuality } from "@/renderer/utils/download-quality";
import { getBestMusicQualityInfo } from "@/renderer/utils/music-quality-metadata";
import LazyImage from "../LazyImage";
import getCompactArtworkSrc from "@/renderer/utils/get-compact-artwork-src";
import { getPlayCount } from "@/renderer/core/listening-statistics";
import CurrentMusicLocator from "../CurrentMusicLocator";
import { trashLocalMusicFiles } from "@/renderer/core/local-music";
interface IMusicListProps {
    /** 音乐列表 */
    musicList: IMusic.IMusicItem[];
    /** 获取完整音乐列表 */
    getAllMusicItems?: () => IMusic.IMusicItem[];
    /** 所在歌单 */
    musicSheet?: IMusic.IMusicSheetItem;
    // enablePagination?: boolean; // 是否启用分页
    state?: RequestStateCode; // 请求状态
    doubleClickBehavior?: "replace" | "normal"; // 双击行为
    onPageChange?: (page?: number) => void; // 分页加载
    /** 虚拟列表属性 */
    virtualProps?: {
        offsetHeight?: number | (() => number); // 额外偏移高度
        getScrollElement?: () => HTMLElement | null; // 获取滚动元素
        fallbackRenderCount?: number;
    };
    headerOnlySurface?: boolean;
    containerStyle?: CSSProperties;
    hideRows?: Array<
        "like" | "index" | "title" | "artist" | "album" | "duration" | "platform"
    >;
    /** 是否启用拖拽 */
    enableDrag?: boolean;
    /** 拖拽结束回调 */
    onDragEnd?: (newMusicList: IMusic.IMusicItem[]) => void;
    /** context */
    contextMenu?: IContextMenuItem[];
    /** 排序配置存储标识；相同标识共享排序配置 */
    sortStorageKey?: string;
    /** 是否使用搜索结果默认排序（自定义排序） */
    useSearchDefaultSort?: boolean;
}

function ArtworkContent(props: {
    src?: string;
    alt: string;
}) {
    const rawSrc = props.src ?? albumImg;
    const [displaySrc, setDisplaySrc] = useState(
        rawSrc,
    );

    useEffect(() => {
        let canceled = false;
        const nextSrc = props.src ?? albumImg;

        setDisplaySrc(nextSrc);
        if (nextSrc.startsWith("data:image/") && !nextSrc.startsWith("data:image/svg+xml")) {
            void normalizeArtworkDisplaySrc(nextSrc).then((normalizedSrc) => {
                const resolvedSrc = normalizedSrc ?? nextSrc;

                if (!canceled) {
                    setDisplaySrc(resolvedSrc);
                }
            });
        }

        return () => {
            canceled = true;
        };
    }, [props.src]);

    return (
        <LazyImage
            className="music-list-cover-image"
            src={displaySrc}
            fallbackSrc={albumImg}
            releaseWhenHidden={false}
            alt={props.alt}
            draggable={false}
        ></LazyImage>
    );
}

const columnHelper = createColumnHelper<IMusic.IMusicItem>();
const columnDef: ColumnDef<IMusic.IMusicItem, any>[] = [
    columnHelper.display({
        id: "like",
        size: 42,
        minSize: 42,
        maxSize: 42,
        cell: (info) => (
            <div className="music-list-operations">
                <div className="music-list-operation-button">
                    <MusicFavorite musicItem={info.row.original} size={18} fillContainer></MusicFavorite>
                </div>
                <div className="music-list-operation-button">
                    <MusicDownloaded musicItem={info.row.original} fillContainer></MusicDownloaded>
                </div>
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
            info.getValue() ? secondsToDuration(info.getValue() ?? 0) : "--:--",
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

const estimizeItemHeight = 84; // flat list row with cover shadow room

async function copyWithToast(text: string) {
    const ok = await copyTextToClipboard(text);
    if (ok) {
        toast.success(i18n.t("common.copied_to_clipboard"));
    } else {
        toast.warn(i18n.t("common.copy_to_clipboard_failed"));
    }
}

function formatArtistEntryLabel(entry: IMusicArtistEntry, unknownLabel: string): string {
    const name = entry.name || unknownLabel;
    const parts: string[] = [];
    if (entry.artistId) {
        parts.push(`id: ${entry.artistId}`);
    }
    if (entry.artistMid && entry.artistMid !== entry.artistId) {
        parts.push(`mid: ${entry.artistMid}`);
    }
    return parts.length ? `${name} (${parts.join(", ")})` : name;
}

function navigateToArtistPage(artistItem: IArtist.IArtistItem) {
    if (isMusicDetailShown()) {
        MusicDetail.hide();
    }
    const ok = appNavigate(
        `/main/artist/${encodeURIComponent(artistItem.platform)}/${encodeURIComponent(artistItem.id)}`,
        { state: { artistItem } },
    );
    if (!ok) {
        toast.warn(i18n.t("music_list_context_menu.open_artist_failed"));
    }
}

function navigateToAlbumPage(albumItem: IAlbum.IAlbumItem) {
    if (isMusicDetailShown()) {
        MusicDetail.hide();
    }
    const ok = appNavigate(
        `/main/album/${encodeURIComponent(albumItem.platform)}/${encodeURIComponent(albumItem.id)}`,
        { state: { albumItem } },
    );
    if (!ok) {
        toast.warn(i18n.t("music_list_context_menu.open_album_failed"));
    }
}

function buildArtistContextMenuItem(musicItem: IMusic.IMusicItem): IContextMenuItem {
    const unknownArtist = i18n.t("media.unknown_artist");
    const title = `${i18n.t("media.media_type_artist")}: ${
        formatMusicArtistTitle(musicItem, unknownArtist)
    }`;
    const local = isLocalMusic(musicItem);
    const navigable = local ? [] : getNavigableArtists(musicItem);
    const copyArtist = () => {
        void copyWithToast(buildMusicArtistCopyPayload(musicItem));
    };

    // Local / no artist id → left/right both copy.
    if (!navigable.length) {
        return {
            title,
            icon: "user",
            onClick: copyArtist,
            onContextMenu: copyArtist,
        };
    }

    // Multi-artist: hover submenu — L open that artist, R copy that artist;
    // parent R copies full artist payload.
    if (navigable.length > 1) {
        return {
            title,
            icon: "user",
            onContextMenu: copyArtist,
            subMenu: navigable.map(({ entry, artistItem }) => ({
                title: formatArtistEntryLabel(entry, unknownArtist),
                icon: "user" as const,
                onClick() {
                    navigateToArtistPage(artistItem);
                },
                onContextMenu() {
                    void copyWithToast(
                        JSON.stringify({
                            platform: musicItem.platform,
                            name: entry.name || "",
                            ...(entry.artistId ? { artistId: entry.artistId } : {}),
                            ...(entry.artistMid && entry.artistMid !== entry.artistId
                                ? { artistMid: entry.artistMid }
                                : {}),
                        }),
                    );
                },
            })),
        };
    }

    // Single artist: L open page, R copy ids.
    return {
        title,
        icon: "user",
        onClick() {
            navigateToArtistPage(navigable[0].artistItem);
        },
        onContextMenu: copyArtist,
    };
}

function buildAlbumContextMenuItem(musicItem: IMusic.IMusicItem): IContextMenuItem {
    const title = `${i18n.t("media.media_type_album")}: ${
        formatMusicAlbumTitle(musicItem, i18n.t("media.unknown_album"))
    }`;
    const albumItem = !isLocalMusic(musicItem) ? buildAlbumItemFromMusic(musicItem) : null;
    const copyAlbum = () => {
        void copyWithToast(buildMusicAlbumCopyPayload(musicItem));
    };

    // No navigable album → left/right both copy.
    if (!albumItem) {
        return {
            title,
            icon: "album",
            show: !!musicItem.album,
            onClick: copyAlbum,
            onContextMenu: copyAlbum,
        };
    }

    // L open album page, R copy ids.
    return {
        title,
        icon: "album",
        show: !!musicItem.album,
        onClick() {
            navigateToAlbumPage(albumItem);
        },
        onContextMenu: copyAlbum,
    };
}

export function showMusicContextMenu(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
    x: number,
    y: number,
    sheetType?: string,
) {
    const menuItems: IContextMenuItem[] = [];
    const isArray = Array.isArray(musicItems);
    const selectedMusicItems = isArray ? musicItems : [musicItems];
    const isLocalMusicSelection = selectedMusicItems.length > 0
        && selectedMusicItems.every(isLocalMusic);
    if (!isArray) {
        const musicItem = musicItems;
        menuItems.push(
            {
                title: formatMusicSongIdTitle(musicItem),
                icon: "identification",
                onClick() {
                    void copyWithToast(buildMusicSongCopyPayload(musicItem));
                },
            },
            buildArtistContextMenuItem(musicItem),
            buildAlbumContextMenuItem(musicItem),
            {
                title: i18n.t("music_list_context_menu.share_music"),
                icon: "share",
                show: !isLocalMusic(musicItem),
                onClick() {
                    void (async () => {
                        try {
                            const { message, url } = await formatMusicSharePayload(
                                musicItem,
                                async (item) => {
                                    const result = await PluginManager.callPluginDelegateMethod(
                                        getMediaPluginDelegate(item as IMusic.IMusicItem),
                                        "getMusicDetailPageUrl",
                                        item,
                                    );
                                    return typeof result === "string" ? result : null;
                                },
                            );
                            if (!message) {
                                toast.warn(i18n.t("music_list_context_menu.share_music_failed"));
                                return;
                            }

                            // Prefer system share when available; always fall back to clipboard.
                            if (typeof navigator.share === "function") {
                                try {
                                    await navigator.share({
                                        title: musicItem.title,
                                        text: message,
                                        url,
                                    });
                                    return;
                                } catch (error) {
                                    const msg = String((error as Error)?.message ?? error ?? "");
                                    if (/cancel|dismiss|AbortError/i.test(msg)) {
                                        return;
                                    }
                                }
                            }

                            const ok = await copyTextToClipboard(message);
                            if (ok) {
                                toast.success(i18n.t("music_list_context_menu.share_music_copied"));
                            } else {
                                toast.warn(i18n.t("music_list_context_menu.share_music_failed"));
                            }
                        } catch {
                            toast.warn(i18n.t("music_list_context_menu.share_music_failed"));
                        }
                    })();
                },
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
                if (sheetType) {
                    MusicSheet.frontend.removeMusicFromSheet(musicItems, sheetType);
                }
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
            title: i18n.t("music_list_context_menu.delete_local_file"),
            icon: "trash",
            show: isLocalMusicSelection,
            onClick() {
                showModal("Reconfirm", {
                    title: i18n.t("music_list_context_menu.delete_local_file"),
                    content: i18n.t(
                        "music_list_context_menu.delete_local_file_confirm",
                        { count: selectedMusicItems.length },
                    ),
                    async onConfirm() {
                        hideModal();
                        const result = await trashLocalMusicFiles(
                            selectedMusicItems,
                        );
                        if (!result.failedCount) {
                            toast.success(i18n.t(
                                "music_list_context_menu.delete_local_file_success",
                                { count: result.deletedCount },
                            ));
                        } else if (result.deletedCount) {
                            toast.warn(i18n.t(
                                "music_list_context_menu.delete_local_file_partial",
                                {
                                    count: result.deletedCount,
                                    failedCount: result.failedCount,
                                },
                            ));
                        } else {
                            toast.error(i18n.t(
                                "music_list_context_menu.delete_local_file_failed",
                            ));
                        }
                    },
                });
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
                            const storedMusicItem = await musicSheetDB.musicStore.get([
                                musicItems.platform,
                                musicItems.id,
                            ]);
                            if (!storedMusicItem) {
                                throw new Error("Music item not found");
                            }
                            realTimeMusicItem = storedMusicItem;
                        }

                        const downloadPath = getInternalData<IMusic.IMusicItemInternalData>(
                            realTimeMusicItem,
                            "downloadData",
                        )?.path;

                        if (!downloadPath) {
                            throw new Error("Download path not found");
                        }

                        const result = await shellUtil.showItemInFolder(downloadPath);
                        if (!result) {
                            throw new Error();
                        }
                    }
                } catch (e) {
                    toast.error(
                        `${i18n.t(
                            "music_list_context_menu.reveal_local_music_in_file_explorer_fail",
                        )} ${toError(e).message}`,
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

const compactTagStyle: CSSProperties = {
    fontSize: "0.72rem",
    lineHeight: 1.2,
    padding: "2px 8px",
    borderRadius: 999,
    maxWidth: "none",
};

type SortField = "custom" | "title" | "album" | "artist" | "size" | "folder" | "playCount" | "duration" | "addedTime";
type SortDirection = "asc" | "desc";

const sortFieldOptions: { id: SortField; labelKey: string }[] = [
    { id: "custom", labelKey: "media.sort_custom" },
    { id: "title", labelKey: "media.media_filename" },
    { id: "album", labelKey: "media.media_type_album" },
    { id: "artist", labelKey: "media.media_type_artist" },
    { id: "size", labelKey: "media.media_size" },
    { id: "folder", labelKey: "media.media_folder" },
    { id: "playCount", labelKey: "media.media_play_count" },
    { id: "duration", labelKey: "media.media_duration" },
    { id: "addedTime", labelKey: "media.media_added_time" },
];

function getSortValue(musicItem: IMusic.IMusicItem, field: SortField): string | number {
    switch (field) {
        case "title": return (musicItem.title ?? "").toLocaleLowerCase();
        case "album": return (musicItem.album ?? "").toLocaleLowerCase();
        case "artist": return (musicItem.artist ?? "").toLocaleLowerCase();
        case "duration": return musicItem.duration ?? 0;
        case "playCount": return getPlayCount(musicItem);
        case "size": {
            const qualities = musicItem?.qualities as IMusic.IQuality | undefined;
            const source = musicItem?.source && typeof musicItem.source === "object"
                ? musicItem.source as Partial<Record<IMusic.IQualityKey, { size?: string | number }>>
                : undefined;
            const downloadedData = getInternalData<IMusic.IMusicItemInternalData>(
                musicItem,
                "downloadData",
            );
            const quality = [...qualityKeys].reverse().find(q =>
                qualities?.[q] !== undefined ||
                source?.[q]?.size !== undefined ||
                downloadedData?.quality === q,
            );
            if (!quality) return 0;
            const sz = qualities?.[quality]?.size ?? source?.[quality]?.size ?? (musicItem as { size?: string | number }).size;
            if (typeof sz === "number") return sz;
            const n = parseFloat(String(sz));
            return isNaN(n) ? 0 : n;
        }
        case "folder": {
            const localPath: string | undefined = (musicItem as any).$$localPath ?? (musicItem as any).localPath;
            if (!localPath) return "";
            const sep = localPath.includes("/") ? "/" : "\\";
            const parts = localPath.split(sep);
            parts.pop();
            return parts.join(sep).toLocaleLowerCase();
        }
        case "addedTime": {
            const downloadCompletedAt = getInternalData<IMusic.IMusicItemInternalData>(
                musicItem,
                "downloadData",
            )?.completedAt;
            // $$addedAt is persisted for sheets; downloaded items use their completion time.
            const ts: number = downloadCompletedAt
                ?? (musicItem as any).$$addedAt
                ?? (musicItem as any)[timeStampSymbol]
                ?? 0;
            const idx: number = (musicItem as any).$$batchIndex ?? (musicItem as any)[sortIndexSymbol] ?? 0;
            return ts * 100000 + idx;
        }
        default: return "";
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


function MusicListComponent(props: IMusicListProps) {
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
        sortStorageKey,
        useSearchDefaultSort = false,
    } = props;

    const currentMusic = useCurrentMusic();
    const hiddenRows = new Set(hideRows ?? []);

    const listKey = useMemo(() => {
        if (sortStorageKey) {
            return sortStorageKey;
        }
        if (musicSheet) {
            return `sheet_${musicSheet.platform}_${musicSheet.id}`;
        }
        return "default";
    }, [sortStorageKey, musicSheet]);

    const getDefaultSort = useCallback((): { field: SortField; direction: SortDirection } => {
        if (useSearchDefaultSort) {
            return { field: "custom", direction: "desc" };
        }
        return { field: "addedTime", direction: "desc" };
    }, [useSearchDefaultSort]);

    const [sortField, setSortFieldRaw] = useState<SortField>(() => {
        const stored = localStorage.getItem(`musicListSortField_${listKey}`) as SortField;
        return stored ?? getDefaultSort().field;
    });
    const [sortDirection, setSortDirectionRaw] = useState<SortDirection>(() => {
        const stored = localStorage.getItem(`musicListSortDirection_${listKey}`) as SortDirection;
        return stored ?? getDefaultSort().direction;
    });
    const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
    const sortDropdownRef = useRef<HTMLDivElement>(null);

    const setSortField = (f: SortField) => {
        setSortFieldRaw(f);
        localStorage.setItem(`musicListSortField_${listKey}`, f);
    };
    const setSortDirection = (d: SortDirection) => {
        setSortDirectionRaw(d);
        localStorage.setItem(`musicListSortDirection_${listKey}`, d);
    };

    useEffect(() => {
        const stored = localStorage.getItem(`musicListSortField_${listKey}`) as SortField;
        const storedDirection = localStorage.getItem(`musicListSortDirection_${listKey}`) as SortDirection;
        const defaults = getDefaultSort();
        setSortFieldRaw(stored ?? defaults.field);
        setSortDirectionRaw(storedDirection ?? defaults.direction);
    }, [listKey, getDefaultSort]);

    const sortedMusicList = useMemo(() => {
        if (sortField === "custom") {
            return musicList;
        }
        return musicList.map((item, i) => ({ item, i }))
            .sort((a, b) => {
                const av = getSortValue(a.item, sortField);
                const bv = getSortValue(b.item, sortField);
                let cmp: number;
                if (typeof av === "string") {
                    cmp = av.localeCompare(bv as string);
                } else {
                    cmp = (av as number) - (bv as number);
                }
                if (cmp !== 0) {
                    return sortDirection === "asc" ? cmp : -cmp;
                }
                return a.i - b.i;
            })
            .map(({ item }) => item);
    }, [musicList, sortField, sortDirection]);

    useEffect(() => {
        if (!sortDropdownOpen) return;
        const handler = (e: MouseEvent) => {
            if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
                setSortDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [sortDropdownOpen]);

    const musicListRef = useRef(musicList);
    const columnShownRef = useRef(
        (AppConfig.getConfig("normal.musicListColumnsShown") ?? []).reduce(
            (prev, curr) => ({
                ...prev,
                [curr]: false,
            }),
            {} as Record<string, boolean>,
        ),
    );

    const table = useReactTable({
        debugAll: false,
        data: sortedMusicList,
        columns: columnDef,
        state: {
            columnVisibility: hideRows
                ? hideRows.reduce((prev, curr) => ({ ...prev, [curr]: false }), {
                    ...columnShownRef.current,
                })
                : columnShownRef.current,
        },
        getCoreRowModel: getCoreRowModel(),
    });

    const tableContainerRef = useRef<HTMLDivElement>(null);
    const virtualGetScrollElement = virtualProps?.getScrollElement;
    const getScrollElement = useCallback(
        () => virtualGetScrollElement?.() ??
            tableContainerRef.current?.closest<HTMLElement>(".page-container") ?? null,
        [virtualGetScrollElement],
    );
    const virtualController = useVirtualList({
        data: table.getRowModel().rows,
        getScrollElement,
        offsetHeight:
            virtualProps?.offsetHeight ??
            (() => tableContainerRef.current?.offsetTop ?? 0),
        estimateItemHeight: estimizeItemHeight,
        fallbackRenderCount: !virtualProps?.getScrollElement
            ? -1
            : virtualProps?.fallbackRenderCount ?? 50,
    });

    useEffect(() => {
        const container = tableContainerRef.current;
        const scrollElement = getScrollElement();
        if (!container || !scrollElement) {
            return;
        }

        let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
        const handleScroll = () => {
            container.dataset.scrolling = "true";
            if (scrollEndTimer) {
                clearTimeout(scrollEndTimer);
            }
            scrollEndTimer = setTimeout(() => {
                delete container.dataset.scrolling;
                scrollEndTimer = null;
            }, 60);
        };

        scrollElement.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            scrollElement.removeEventListener("scroll", handleScroll);
            if (scrollEndTimer) {
                clearTimeout(scrollEndTimer);
            }
            delete container.dataset.scrolling;
        };
    }, [getScrollElement]);

    const [activeItems, setActiveItems] = useState<Set<number>>(new Set());
    const lastActiveIndexRef = useRef(0);
    const localSheetType = musicSheet?.platform === localPluginName
        ? musicSheet.id
        : undefined;

    useEffect(() => {
        setActiveItems(new Set());
        lastActiveIndexRef.current = 0;
        musicListRef.current = sortedMusicList;
    }, [sortedMusicList]);

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
            const draggedMusicItem = musicList[fromIndex];
            if (!draggedMusicItem) {
                return;
            }
            const newData = musicList
                .slice(0, fromIndex)
                .concat(musicList.slice(fromIndex + 1));
            newData.splice(
                fromIndex > toIndex ? toIndex : toIndex - 1,
                0,
                draggedMusicItem,
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
            .filter((item): item is IMusic.IMusicItem => !!item);
    }, [table]);

    const playMusicItem = useCallback((musicItem: IMusic.IMusicItem) => {
        playMusicFromList(
            musicItem,
            table.getRowModel().rows.map((it) => it.original),
            doubleClickBehavior,
        );
    }, [doubleClickBehavior, table]);

    const defaultSort = getDefaultSort();
    const currentSortIsDefault = sortField === defaultSort.field && sortDirection === defaultSort.direction;
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
                <div className="music-list-sort-wrapper" ref={sortDropdownRef}>
                    <button
                        type="button"
                        className="music-list-sort-btn"
                        data-active={!currentSortIsDefault || sortDropdownOpen}
                        title={i18n.t("media.sort_by")}
                        onClick={() => setSortDropdownOpen(v => !v)}
                    >
                        <SvgAsset iconName={sortDirection === "desc" ? "sort-desc" : "sort-asc"} size={18}></SvgAsset>
                    </button>
                    {sortDropdownOpen && (
                        <div className="music-list-sort-dropdown">
                            {sortFieldOptions.map(opt => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    className="music-list-sort-option"
                                    data-active={sortField === opt.id}
                                    onClick={() => setSortField(opt.id)}
                                >
                                    {i18n.t(opt.labelKey)}
                                </button>
                            ))}
                            <div className="music-list-sort-divider" />
                            {sortField !== "custom" && (<>
                                <button
                                    type="button"
                                    className="music-list-sort-option"
                                    data-active={sortDirection === "asc"}
                                    onClick={() => setSortDirection("asc")}
                                >
                                    {i18n.t("media.sort_asc")}
                                </button>
                                <button
                                    type="button"
                                    className="music-list-sort-option"
                                    data-active={sortDirection === "desc"}
                                    onClick={() => setSortDirection("desc")}
                                >
                                    {i18n.t("media.sort_desc")}
                                </button>
                            </>)}
                        </div>
                    )}
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

                            const qualityInfo = getBestMusicQualityInfo(musicItem);
                            const isActive = activeItems.has(virtualItem.rowIndex);
                            const isPlaying = !!currentMusic && isSameMedia(currentMusic, musicItem);
                            const artworkSrc = getCompactArtworkSrc(musicItem, 160) ?? albumImg;
                            const selectedItems =
                                activeItems.size > 1 && isActive
                                    ? getSelectedItems(activeItems)
                                    : null;

                            return (
                                <div
                                    className="music-list-row-wrapper"
                                    key={`${musicItem.platform}-${musicItem.id}-${virtualItem.rowIndex}`}
                                    style={{
                                        top: virtualItem.top,
                                    }}
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
                                        draggable={enableDrag && sortField === "custom"}
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
                                                        <MusicFavorite musicItem={musicItem} size={18} fillContainer></MusicFavorite>
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
                                                        <MusicDownloaded musicItem={musicItem} size={18} fillContainer></MusicDownloaded>
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
                                    <IfTruthy condition={enableDrag && sortField === "custom"}>
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
            <CurrentMusicLocator
                musicList={sortedMusicList}
                getScrollElement={getScrollElement}
                scrollToIndex={virtualController.scrollToIndex}
            ></CurrentMusicLocator>
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
    MusicListComponent,
    (prev, curr) =>
        !!(
            prev.state === curr.state &&
            prev.enableDrag === curr.enableDrag &&
            prev.musicList === curr.musicList &&
            prev.onPageChange === curr.onPageChange &&
            prev.onDragEnd === curr.onDragEnd &&
            prev.sortStorageKey === curr.sortStorageKey &&
            prev.useSearchDefaultSort === curr.useSearchDefaultSort &&
            prev.musicSheet &&
            curr.musicSheet &&
            isSameMedia(prev.musicSheet, curr.musicSheet)
        ),
);
