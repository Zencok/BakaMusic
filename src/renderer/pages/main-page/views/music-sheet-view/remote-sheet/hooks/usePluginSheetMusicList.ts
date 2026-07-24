import { RequestStateCode } from "@/common/constant";
import { useCallback, useEffect, useRef, useState } from "react";
import PluginManager from "@shared/plugin-manager/renderer";

function sheetKeyOf(platform: string, id: string) {
    return `${platform}\0${id}`;
}

function isPendingState(state: RequestStateCode) {
    return (
        state === RequestStateCode.PENDING_FIRST_PAGE ||
        state === RequestStateCode.PENDING_REST_PAGE
    );
}

export default function usePluginSheetMusicList(
    platform: string,
    id: string,
    originalSheetItem?: IMusic.IMusicSheetItem | null, // 额外的输入
) {
    // URL / API 混用 number|string 时，必须统一成 string，否则会误判为「换了歌单」整表重载
    const sheetId = id != null && id !== "" ? String(id) : "";

    const [requestState, setRequestState] = useState<RequestStateCode>(
        RequestStateCode.IDLE,
    );
    const [sheetItem, setSheetItem] = useState<IMusic.IMusicSheetItem>({
        ...(originalSheetItem ?? {}),
        platform,
        id: sheetId,
        title: originalSheetItem?.title ?? "",
    });
    const [musicList, setMusicList] = useState<IMusic.IMusicItem[]>(
        originalSheetItem?.musicList ?? [],
    );
    const originalSheetItemRef = useRef(originalSheetItem);
    const requestStateRef = useRef(RequestStateCode.IDLE);
    originalSheetItemRef.current = originalSheetItem;

    const updateRequestState = useCallback((nextState: RequestStateCode) => {
        requestStateRef.current = nextState;
        setRequestState(nextState);
    }, []);

    // 当前正在请求的歌单（以 URL platform+id 为准，不要用 isSameMedia 和 original 比对）
    const currentSheetItemRef = useRef<IMusic.IMusicSheetItem | null>(null);
    const currentSheetKeyRef = useRef<string>("");
    // 页码
    const currentPageRef = useRef(1);

    const getSheetDetail = useCallback(async () => {
        if (!platform || !sheetId) {
            return;
        }

        const sheetKey = sheetKeyOf(platform, sheetId);
        const sourceSheetItem = originalSheetItemRef.current;

        if (currentSheetKeyRef.current !== sheetKey) {
            // 切换了新歌单：恢复初始状态
            currentSheetKeyRef.current = sheetKey;
            currentSheetItemRef.current = {
                ...(sourceSheetItem ?? {}),
                platform,
                id: sheetId,
                title: sourceSheetItem?.title ?? "",
            };
            setSheetItem(currentSheetItemRef.current);
            setMusicList(sourceSheetItem?.musicList ?? []);
            currentPageRef.current = 1;
        } else if (isPendingState(requestStateRef.current)) {
            // 同歌单请求进行中，忽略重复触发
            return;
        }

        const page = currentPageRef.current;
        const requestSheetKey = sheetKey;

        try {
            updateRequestState(
                page === 1
                    ? RequestStateCode.PENDING_FIRST_PAGE
                    : RequestStateCode.PENDING_REST_PAGE,
            );

            const sheetArg = currentSheetItemRef.current;
            if (!sheetArg) {
                updateRequestState(RequestStateCode.FINISHED);
                return;
            }

            const result = await PluginManager.callPluginDelegateMethod(
                sheetArg,
                "getMusicSheetInfo",
                sheetArg,
                page,
            );

            // 竞态：期间已切到别的歌单
            if (currentSheetKeyRef.current !== requestSheetKey) {
                return;
            }
            if (result === null || result === undefined) {
                throw new Error();
            }

            // 合并插件回传的 sheetItem（如 _trackIds），并写回 ref 供下一页使用
            if (result.sheetItem) {
                currentSheetItemRef.current = {
                    ...(currentSheetItemRef.current ?? {}),
                    ...(result.sheetItem as IMusic.IMusicSheetItem),
                    platform,
                    id: sheetId,
                };
                if (page <= 1) {
                    setSheetItem(currentSheetItemRef.current);
                }
            }

            if (result.musicList) {
                setMusicList((prev) => {
                    if (page === 1) {
                        return result.musicList ?? prev;
                    }
                    return [...prev, ...(result.musicList ?? [])];
                });
            }

            updateRequestState(
                result.isEnd
                    ? RequestStateCode.FINISHED
                    : RequestStateCode.PARTLY_DONE,
            );
            currentPageRef.current = page + 1;
        } catch {
            if (currentSheetKeyRef.current !== requestSheetKey) {
                return;
            }
            // 首页失败结束；分页失败保持 PARTLY_DONE 允许手动重试，但不自动空转
            // （BottomLoadingState 在 footer 仍可见时会立刻再触发，失败时应避免死循环）
            updateRequestState(
                page === 1
                    ? RequestStateCode.FINISHED
                    : RequestStateCode.ERROR,
            );
        }
    }, [sheetId, platform, updateRequestState]);

    useEffect(() => {
        if (platform && sheetId) {
            void getSheetDetail();
        }
    }, [getSheetDetail, sheetId, platform]);

    return [requestState, sheetItem, musicList, getSheetDetail] as const;
}
