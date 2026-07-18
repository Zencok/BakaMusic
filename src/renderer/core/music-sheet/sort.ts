import { MusicSheetSortType, sortIndexSymbol, timeStampSymbol } from "@/common/constant";

const validSortTypes = new Set<IMusic.IMusicSheetSortType>([
    MusicSheetSortType.None,
    MusicSheetSortType.Title,
    MusicSheetSortType.Artist,
    MusicSheetSortType.Album,
    MusicSheetSortType.Newest,
    MusicSheetSortType.Oldest,
]);

type SortableMusicItem = IMusic.IMusicItem & {
    [timeStampSymbol]?: number;
    [sortIndexSymbol]?: number;
};

function compareText(
    first?: string | null,
    second?: string | null,
) {
    return (first ?? "").localeCompare(second ?? "", "zh-Hans-CN", {
        sensitivity: "base",
        numeric: true,
    });
}

function compareTimeOldToNew(
    first: SortableMusicItem,
    second: SortableMusicItem,
) {
    const timeDiff = (first[timeStampSymbol] ?? 0) - (second[timeStampSymbol] ?? 0);
    if (timeDiff !== 0) {
        return timeDiff;
    }

    return (first[sortIndexSymbol] ?? 0) - (second[sortIndexSymbol] ?? 0);
}

function compareTimeNewToOld(
    first: SortableMusicItem,
    second: SortableMusicItem,
) {
    return compareTimeOldToNew(second, first);
}

function compareByTitle(
    first: SortableMusicItem,
    second: SortableMusicItem,
) {
    return (
        compareText(first.title, second.title) ||
        compareText(first.artist, second.artist) ||
        compareText(first.album, second.album) ||
        compareTimeOldToNew(first, second)
    );
}

function compareByArtist(
    first: SortableMusicItem,
    second: SortableMusicItem,
) {
    return (
        compareText(first.artist, second.artist) ||
        compareText(first.title, second.title) ||
        compareText(first.album, second.album) ||
        compareTimeOldToNew(first, second)
    );
}

function compareByAlbum(
    first: SortableMusicItem,
    second: SortableMusicItem,
) {
    return (
        compareText(first.album, second.album) ||
        compareText(first.title, second.title) ||
        compareText(first.artist, second.artist) ||
        compareTimeOldToNew(first, second)
    );
}

export function normalizeMusicSheetSortType(
    sortType?: IMusic.IMusicSheetSortType | null,
) {
    if (sortType && validSortTypes.has(sortType)) {
        return sortType;
    }

    return MusicSheetSortType.None;
}

export function sortMusicSheetMusicList<T extends SortableMusicItem>(
    musicList: T[],
    sortType?: IMusic.IMusicSheetSortType | null,
) {
    const normalizedSortType = normalizeMusicSheetSortType(sortType);

    switch (normalizedSortType) {
        case MusicSheetSortType.Title:
            return [...musicList].sort(compareByTitle);
        case MusicSheetSortType.Artist:
            return [...musicList].sort(compareByArtist);
        case MusicSheetSortType.Album:
            return [...musicList].sort(compareByAlbum);
        case MusicSheetSortType.Newest:
            return [...musicList].sort(compareTimeNewToOld);
        case MusicSheetSortType.Oldest:
            return [...musicList].sort(compareTimeOldToNew);
        case MusicSheetSortType.None:
        default:
            return [...musicList];
    }
}
