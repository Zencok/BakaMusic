import { getMediaPrimaryKey } from "./media-util";

export interface IIndexMap {
    indexOf: (mediaItem?: IMedia.IMediaBase | null) => number;
    has: (mediaItem?: IMedia.IMediaBase | null) => boolean;
    update: (mediaItems?: IMedia.IMediaBase[]) => void;
}

/** Share typed V2 identity and established local/legacy compatibility with all queues. */
export function createIndexMap(mediaItems?: IMedia.IMediaBase[]): IIndexMap {
    const indexMap = new Map<string, number>();
    update(mediaItems);
    function update(items?: IMedia.IMediaBase[]) {
        indexMap.clear();
        items?.forEach((item, index) => {
            if (item) indexMap.set(getMediaPrimaryKey(item), index);
        });
    }
    function indexOf(item?: IMedia.IMediaBase | null) {
        return item ? indexMap.get(getMediaPrimaryKey(item)) ?? -1 : -1;
    }
    function has(item?: IMedia.IMediaBase | null) {
        return item ? indexMap.has(getMediaPrimaryKey(item)) : false;
    }
    return { update, indexOf, has };
}
