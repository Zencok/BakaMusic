import { RequestStateCode } from "@/common/constant";
import { useCallback, useEffect, useRef, useState } from "react";
import PluginManager from "@shared/plugin-manager/renderer";

const idleCode = [
    RequestStateCode.IDLE,
    RequestStateCode.FINISHED,
    RequestStateCode.PARTLY_DONE,
];

function albumKey(item: IAlbum.IAlbumItem | null) {
    if (!item) {
        return "";
    }
    return `${item.platform}::${item.id}`;
}

export default function useAlbumDetail(
    originalAlbumItem: IAlbum.IAlbumItem | null,
) {
    const currentPageRef = useRef(1);
    const requestIdRef = useRef(0);
    const albumKeyRef = useRef(albumKey(originalAlbumItem));
    const requestStateRef = useRef(RequestStateCode.IDLE);
    const [requestState, setRequestState] = useState<RequestStateCode>(
        RequestStateCode.IDLE,
    );
    const [albumItem, setAlbumItem] = useState<IAlbum.IAlbumItem | null>(
        originalAlbumItem,
    );
    const [musicList, setMusicList] = useState<IMusic.IMusicItem[]>(
        originalAlbumItem?.musicList ?? [],
    );

    const setState = useCallback((next: RequestStateCode) => {
        requestStateRef.current = next;
        setRequestState(next);
    }, []);

    const getAlbumDetail = useCallback(async () => {
        if (originalAlbumItem === null || !idleCode.includes(requestStateRef.current)) {
            return;
        }

        const requestId = requestIdRef.current;
        const key = albumKey(originalAlbumItem);
        const page = currentPageRef.current;

        try {
            setState(
                page === 1
                    ? RequestStateCode.PENDING_FIRST_PAGE
                    : RequestStateCode.PENDING_REST_PAGE,
            );
            const result = await PluginManager.callPluginDelegateMethod(
                originalAlbumItem,
                "getAlbumInfo",
                originalAlbumItem,
                page,
            );

            if (requestId !== requestIdRef.current || albumKeyRef.current !== key) {
                return;
            }

            if (result === null || result === undefined) {
                throw new Error();
            }
            if (result?.albumItem) {
                setAlbumItem((prev) => ({
                    ...(prev ?? {}),
                    ...(result.albumItem as IAlbum.IAlbumItem),
                    platform: originalAlbumItem.platform,
                    id: originalAlbumItem.id,
                }));
            }
            if (result?.musicList) {
                setMusicList((prev) => (
                    page === 1
                        ? (result.musicList ?? prev)
                        : [...prev, ...(result.musicList ?? [])]
                ));
            }
            setState(
                result.isEnd
                    ? RequestStateCode.FINISHED
                    : RequestStateCode.PARTLY_DONE,
            );
            currentPageRef.current = page + 1;
        } catch {
            if (requestId === requestIdRef.current && albumKeyRef.current === key) {
                setState(RequestStateCode.IDLE);
            }
        }
    }, [originalAlbumItem, setState]);

    useEffect(() => {
        const key = albumKey(originalAlbumItem);
        albumKeyRef.current = key;
        requestIdRef.current += 1;
        currentPageRef.current = 1;
        setAlbumItem(originalAlbumItem);
        setMusicList(originalAlbumItem?.musicList ?? []);
        setState(RequestStateCode.IDLE);

        if (!originalAlbumItem) {
            return;
        }

        // Initial load for this album identity
        void getAlbumDetail();
    }, [getAlbumDetail, originalAlbumItem, setState]);

    return [requestState, albumItem, musicList, getAlbumDetail] as const;
}
