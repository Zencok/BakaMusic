import { useCallback, useEffect, useRef, useState } from "react";
import { RequestStateCode } from "@/common/constant";
import PluginManager from "@shared/plugin-manager/renderer";

export default function useComment(musicItem?: IMusic.IMusicItem) {
    const [comments, setComments] = useState<IComment.IComment[]>([]);
    const [requestStateCode, setRequestStateCode] = useState(RequestStateCode.IDLE);
    const pageRef = useRef(1);
    const loadingRef = useRef(false);
    const requestIdRef = useRef(0);
    const musicItemRef = useRef(musicItem);
    musicItemRef.current = musicItem;

    const loadMore = useCallback(async () => {
        const targetMusic = musicItemRef.current;
        if (
            !targetMusic?.platform
            || !PluginManager.isSupportFeatureMethod(targetMusic.platform, "getMusicComments")
        ) {
            setRequestStateCode(RequestStateCode.FINISHED);
            return;
        }

        if (loadingRef.current) {
            return;
        }

        const requestId = requestIdRef.current;
        const isFirstPage = pageRef.current <= 1;

        loadingRef.current = true;
        setRequestStateCode(
            isFirstPage
                ? RequestStateCode.PENDING_FIRST_PAGE
                : RequestStateCode.PENDING_REST_PAGE,
        );

        try {
            const response =
                await PluginManager.callPluginDelegateMethod(
                    targetMusic,
                    "getMusicComments",
                    targetMusic,
                    pageRef.current,
                )
                ?? { isEnd: true, data: [] as IComment.IComment[] };

            // Stale response after track switch / remount
            if (requestId !== requestIdRef.current) {
                return;
            }

            const responseData = Array.isArray(response.data)
                ? response.data
                : [];
            const nextComments = responseData.filter(Boolean);

            setComments((prev) => (isFirstPage ? nextComments : prev.concat(nextComments)));
            if (response?.isEnd === false) {
                setRequestStateCode(RequestStateCode.PARTLY_DONE);
                pageRef.current = pageRef.current + 1;
            } else {
                setRequestStateCode(RequestStateCode.FINISHED);
            }
        } catch {
            if (requestId === requestIdRef.current) {
                setRequestStateCode(RequestStateCode.ERROR);
            }
        } finally {
            if (requestId === requestIdRef.current) {
                loadingRef.current = false;
            }
        }
    }, []);

    useEffect(() => {
        requestIdRef.current += 1;
        pageRef.current = 1;
        loadingRef.current = false;
        setComments([]);
        setRequestStateCode(RequestStateCode.IDLE);

        // Kick off first page for the new track (avoid stale LOADING gate from prior song)
        void loadMore();
    }, [musicItem?.platform, musicItem?.id, loadMore]);

    return [comments, requestStateCode, loadMore] as const;
}
