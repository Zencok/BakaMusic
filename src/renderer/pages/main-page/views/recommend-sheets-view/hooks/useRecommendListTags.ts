import { useCallback, useEffect, useRef, useState } from "react";
import PluginManager from "@shared/plugin-manager/renderer";

const tagsCache = new Map<string, IPlugin.IGetRecommendSheetTagsResult>();
const pendingRequests = new Map<
    string,
    Promise<IPlugin.IGetRecommendSheetTagsResult>
>();

export default function (plugin: IPlugin.IPluginDelegate) {
    const mountedRef = useRef(true);
    const pluginHashRef = useRef(plugin.hash);
    pluginHashRef.current = plugin.hash;
    const [tags, setTags] = useState<IPlugin.IGetRecommendSheetTagsResult | null>(
        () => tagsCache.get(plugin.hash) ?? null,
    );

    const query = useCallback(async () => {
        const cachedTags = tagsCache.get(plugin.hash);
        if (cachedTags) {
            if (mountedRef.current && pluginHashRef.current === plugin.hash) {
                setTags(cachedTags);
            }
            return;
        }

        const pendingRequest = pendingRequests.get(plugin.hash);
        if (pendingRequest) {
            const result = await pendingRequest;
            if (mountedRef.current && pluginHashRef.current === plugin.hash) {
                setTags(result);
            }
            return;
        }

        const request = (async () => {
            try {
                const result = await PluginManager.callPluginDelegateMethod(
                    plugin,
                    "getRecommendSheetTags",
                );
                if (!result) {
                    throw new Error();
                }
                return result;
            } catch {
                return {
                    pinned: [],
                    data: [],
                };
            }
        })();
        pendingRequests.set(plugin.hash, request);

        try {
            const result = await request;
            tagsCache.set(plugin.hash, result);
            if (mountedRef.current && pluginHashRef.current === plugin.hash) {
                setTags(result);
            }
        } finally {
            if (pendingRequests.get(plugin.hash) === request) {
                pendingRequests.delete(plugin.hash);
            }
        }
    }, [plugin]);

    useEffect(() => {
        mountedRef.current = true;
        void query();
        return () => {
            mountedRef.current = false;
        };
    }, [query]);

    return tags;
}
