import { isV2Media } from "./media-util";

export interface IUniqueMap {
    getMap: () => Record<string, Set<string>>;
    has: (mediaItem?: IMedia.IMediaBase | null) => boolean;
    add: (mediaItem?: IMedia.IMediaBase | IMedia.IMediaBase[] | null) => void;
    remove: (mediaItem?: IMedia.IMediaBase | IMedia.IMediaBase[] | null) => void;
}

function identityKey(item: IMedia.IMediaBase) {
    return isV2Media(item) ? JSON.stringify(item.id) : String(item.id);
}

export function createUniqueMap(mediaItems?: IMedia.IMediaBase[]): IUniqueMap {
    const uniqueMap: Record<string, Set<string>> = Object.create(null);

    mediaItems?.forEach((item) => {
        add(item);
    });

    function getMap() {
        return uniqueMap;
    }

    function has(mediaItem?: IMedia.IMediaBase | null) {
        if (!mediaItem) {
            return false;
        }

        return uniqueMap[`${mediaItem.platform}`]?.has(identityKey(mediaItem)) || false;
    }

    function add(mediaItem?: IMedia.IMediaBase | IMedia.IMediaBase[] | null) {
        if (!mediaItem) {
            return;
        }
        const _mediaItem = Array.isArray(mediaItem) ? mediaItem : [mediaItem];
        _mediaItem.forEach((item) => {
            if (!uniqueMap[`${item.platform}`]) {
                uniqueMap[`${item.platform}`] = new Set([identityKey(item)]);
            } else {
                uniqueMap[`${item.platform}`].add(identityKey(item));
            }
        });
    }

    function remove(mediaItem?: IMedia.IMediaBase | IMedia.IMediaBase[] | null) {
        if (!mediaItem) {
            return;
        }
        const _mediaItem = Array.isArray(mediaItem) ? mediaItem : [mediaItem];

        _mediaItem.forEach((item) => {
            if (uniqueMap[`${item.platform}`]) {
                uniqueMap[`${item.platform}`].delete(identityKey(item));
            }
        });
    }

    return {
        getMap,
        add,
        has,
        remove,
    };
}
