import { RequestStateCode } from "@/common/constant";
import { useCallback, useEffect, useRef, useState } from "react";
import PluginManager from "@shared/plugin-manager/renderer";

function topListKey(item: IMusic.IMusicSheetItem | null, platform: string) {
    if (!item) {
        return "";
    }
    return `${platform}::${item.id}`;
}

export default function useTopListDetail(
    topListItem: IMusic.IMusicSheetItem | null,
    platform: string,
) {
    const [mergedTopListItem, setMergedTopListItem] =
        useState<ICommon.WithMusicList<IMusic.IMusicSheetItem> | null>(topListItem);
    const pageRef = useRef(1);
    const requestIdRef = useRef(0);
    const identityRef = useRef(topListKey(topListItem, platform));
    const loadingRef = useRef(false);
    const [requestState, setRequestState] = useState(RequestStateCode.IDLE);

    const loadMore = useCallback(async () => {
        if (!topListItem || !platform || loadingRef.current) {
            return;
        }

        const requestId = requestIdRef.current;
        const key = topListKey(topListItem, platform);
        const page = pageRef.current;

        loadingRef.current = true;
        try {
            setRequestState(
                page === 1
                    ? RequestStateCode.PENDING_FIRST_PAGE
                    : RequestStateCode.PENDING_REST_PAGE,
            );
            const result = await PluginManager.callPluginDelegateMethod(
                { platform },
                "getTopListDetail",
                topListItem,
                page,
            );

            if (
                requestId !== requestIdRef.current
                || identityRef.current !== key
            ) {
                return;
            }

            if (!result) {
                throw new Error();
            }

            setMergedTopListItem((prev) => ({
                ...(prev ?? topListItem),
                ...(result.topListItem),
                musicList: page === 1
                    ? (result.musicList ?? [])
                    : [...(prev?.musicList ?? []), ...(result.musicList ?? [])],
            }));

            setRequestState(
                result.isEnd
                    ? RequestStateCode.FINISHED
                    : RequestStateCode.PARTLY_DONE,
            );
            pageRef.current = page + 1;
        } catch {
            if (
                requestId === requestIdRef.current
                && identityRef.current === key
            ) {
                setRequestState(RequestStateCode.FINISHED);
            }
        } finally {
            if (requestId === requestIdRef.current) {
                loadingRef.current = false;
            }
        }
    }, [topListItem, platform]);

    useEffect(() => {
        const key = topListKey(topListItem, platform);
        identityRef.current = key;
        requestIdRef.current += 1;
        pageRef.current = 1;
        loadingRef.current = false;
        setMergedTopListItem(topListItem);
        setRequestState(RequestStateCode.IDLE);

        if (topListItem === null || !platform) {
            return;
        }

        void loadMore();
    }, [loadMore, platform, topListItem]);

    return [mergedTopListItem, requestState, loadMore] as const;
}
