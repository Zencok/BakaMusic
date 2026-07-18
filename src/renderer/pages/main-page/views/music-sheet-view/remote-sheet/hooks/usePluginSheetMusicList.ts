import { RequestStateCode } from "@/common/constant";
import { isSameMedia } from "@/common/media-util";
import { useCallback, useEffect, useRef, useState } from "react";
import PluginManager from "@shared/plugin-manager/renderer";

export default function usePluginSheetMusicList(
    platform: string,
    id: string,
    originalSheetItem?: IMusic.IMusicSheetItem | null, // 额外的输入
) {
    const [requestState, setRequestState] = useState<RequestStateCode>(
        RequestStateCode.IDLE,
    );
    const [sheetItem, setSheetItem] = useState<IMusic.IMusicSheetItem>({
        ...(originalSheetItem ?? {}),
        platform,
        id,
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

    // 当前正在搜索的信息
    const currentSheetItemRef = useRef<IMusic.IMusicSheetItem | null>(null);
    // 页码
    const currentPageRef = useRef(1);

    const getSheetDetail = useCallback(async () => {
        if (!platform || !id) {
            return;
        }
        const sourceSheetItem = originalSheetItemRef.current;

        if (!isSameMedia(currentSheetItemRef.current, sourceSheetItem)) {
            // 1.1 如果是切换了新的歌单
            // 恢复初始状态 并设置当前的歌曲项
            currentSheetItemRef.current = {
                ...(sourceSheetItem ?? {}),
                platform,
                id,
                title: sourceSheetItem?.title ?? "",
            };
            setSheetItem(currentSheetItemRef.current);
            setMusicList(sourceSheetItem?.musicList ?? []);
            currentPageRef.current = 1;
        } else if (requestStateRef.current & RequestStateCode.PENDING_FIRST_PAGE) {
            // 1.2 如果是原有歌单，并且在loading中，返回
            return;
        }

        try {
            // 2. 设置初始状态
            updateRequestState(
                currentPageRef.current === 1
                    ? RequestStateCode.PENDING_FIRST_PAGE
                    : RequestStateCode.PENDING_REST_PAGE,
            );
            // 3. 调用获取音乐详情接口
            const sheetItem = currentSheetItemRef.current;
            if (!sheetItem) {
                return;
            }
            const result = await PluginManager.callPluginDelegateMethod(
                sheetItem,
                "getMusicSheetInfo",
                sheetItem,
                currentPageRef.current,
            );

            if (!isSameMedia(currentSheetItemRef.current, sheetItem)) {
                // 出现竞态 结果直接舍弃
                return;
            }
            if (result === null || result === undefined) {
                throw new Error();
            }
            // 3. 如果在页码为1的时候返回了sheetItem，重新设置下sheetItem
            if (result?.sheetItem && currentPageRef.current <= 1) {
                setSheetItem((prev) => ({
                    ...(prev ?? {}),
                    ...(result.sheetItem as IMusic.IMusicSheetItem),
                    platform,
                    id,
                }));
            }
            // 4. 如果返回了音乐列表
            if (result?.musicList) {
                setMusicList((prev) => {
                    if (currentPageRef.current === 1) {
                        return result?.musicList ?? prev;
                    } else {
                        return [...prev, ...(result.musicList ?? [])];
                    }
                });
            }
            updateRequestState(
                result.isEnd ? RequestStateCode.FINISHED : RequestStateCode.PARTLY_DONE,
            );
            currentPageRef.current += 1;
        } catch {
            updateRequestState(
                currentPageRef.current === 1
                    ? RequestStateCode.FINISHED
                    : RequestStateCode.PARTLY_DONE,
            );
        }
    }, [id, platform, updateRequestState]);

    useEffect(() => {
        if (platform && id) {
            void getSheetDetail();
        }
    }, [getSheetDetail, id, platform]);

    return [requestState, sheetItem, musicList, getSheetDetail] as const;
}
