import { RequestStateCode } from "@/common/constant";
import { resetMediaItem } from "@/common/media-util";
import { useCallback, useEffect, useRef, useState } from "react";
import PluginManager from "@shared/plugin-manager/renderer";

export default function (plugin: IPlugin.IPluginDelegate, tag: IMedia.IUnique | null) {
    const [sheets, setSheets] = useState<IMusic.IMusicSheetItem[]>([]);
    const [status, setStatus] = useState<RequestStateCode>(RequestStateCode.IDLE);
    const currentTagRef = useRef<string | null>(null);
    const pageRef = useRef(0);
    const statusRef = useRef(RequestStateCode.IDLE);

    const setRequestStatus = useCallback((nextStatus: RequestStateCode) => {
        statusRef.current = nextStatus;
        setStatus(nextStatus);
    }, []);

    const query = useCallback(async () => {
        if (!tag) {
            return;
        }
        const tagId = tag.id ?? "";
        if (
            (
                statusRef.current === RequestStateCode.FINISHED ||
                statusRef.current === RequestStateCode.PENDING_FIRST_PAGE ||
                statusRef.current === RequestStateCode.PENDING_REST_PAGE
            ) &&
            currentTagRef.current === tagId
        ) {
            return;
        }
        try {
            if (currentTagRef.current !== tagId) {
                setSheets([]);
                pageRef.current = 0;
            }
            pageRef.current++;
            currentTagRef.current = tagId;

            setRequestStatus(
                pageRef.current === 1
                    ? RequestStateCode.PENDING_FIRST_PAGE
                    : RequestStateCode.PENDING_REST_PAGE,
            );

            const res = await PluginManager.callPluginDelegateMethod(
                plugin,
                "getRecommendSheetsByTag",
                tag,
                pageRef.current,
            ) ?? { isEnd: true, data: [] as IMusic.IMusicSheetItem[] };
            const nextSheets = Array.isArray(res.data) ? res.data : [];

            // Drop stale responses after tag switch
            if (tagId !== currentTagRef.current) {
                return;
            }

            setSheets((prev) => [
                ...prev,
                ...nextSheets.map((item) => resetMediaItem(item, plugin.platform)),
            ]);

            if (res.isEnd) {
                setRequestStatus(RequestStateCode.FINISHED);
            } else {
                setRequestStatus(RequestStateCode.PARTLY_DONE);
            }
        } catch {
            if (tagId === currentTagRef.current) {
                setRequestStatus(RequestStateCode.ERROR);
            }
        }
    }, [plugin, setRequestStatus, tag]);

    useEffect(() => {
        if (tag) {
            query();
        }
    }, [query, tag]);

    return [query, sheets, status] as const;
}
