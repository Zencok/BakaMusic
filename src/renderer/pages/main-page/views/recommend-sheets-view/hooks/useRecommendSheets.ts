import { RequestStateCode } from "@/common/constant";
import { resetMediaItem } from "@/common/media-util";
import { useCallback, useEffect, useRef, useState } from "react";
import PluginManager from "@shared/plugin-manager/renderer";

export default function (plugin: IPlugin.IPluginDelegate, tag: IMedia.IUnique | null) {
    const [sheets, setSheets] = useState<IMusic.IMusicSheetItem[]>([]);
    const [status, setStatus] = useState<RequestStateCode>(RequestStateCode.IDLE);
    const currentTagRef = useRef<string | null>(null);
    const pageRef = useRef(0);

    const query = useCallback(async () => {
        if (!tag) {
            return;
        }
        const tagId = tag.id ?? "";
        if (
            (
                status === RequestStateCode.FINISHED ||
                status === RequestStateCode.PENDING_FIRST_PAGE ||
                status === RequestStateCode.PENDING_REST_PAGE
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

            setStatus(
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
                setStatus(RequestStateCode.FINISHED);
            } else {
                setStatus(RequestStateCode.PARTLY_DONE);
            }
        } catch {
            if (tagId === currentTagRef.current) {
                setStatus(RequestStateCode.ERROR);
            }
        }
    }, [plugin.hash, plugin.platform, status, tag]);

    useEffect(() => {
        if (tag) {
            query();
        }
    }, [plugin.hash, tag?.id]);

    return [query, sheets, status] as const;
}
