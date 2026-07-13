import { produce } from "immer";
import { useCallback, useRef } from "react";
import { RequestStateCode } from "@/common/constant";
import { queryResultStore } from "../store";
import PluginManager from "@shared/plugin-manager/renderer";

const setQueryResults = queryResultStore.setValue;

export default function useQueryArtist() {
    const queryResults = queryResultStore.useValue();
    const requestIdRef = useRef(0);
    const artistKeyRef = useRef<string>("");

    const queryArtist = useCallback(
        async (
            artist: IArtist.IArtistItem,
            page?: number,
            type: IArtist.ArtistMediaType = "music",
        ) => {
            const artistKey = `${artist.platform}::${artist.id}`;
            if (artistKeyRef.current !== artistKey) {
                artistKeyRef.current = artistKey;
                requestIdRef.current += 1;
            }

            const prevResult = queryResultStore.getValue()[type];
            const nextPage = page ?? (prevResult?.page ?? 0) + 1;
            const state = prevResult?.state ?? RequestStateCode.IDLE;

            if (
                (state & RequestStateCode.LOADING) !== 0
                || state === RequestStateCode.FINISHED
                || nextPage <= (prevResult?.page ?? 0)
            ) {
                return;
            }

            const requestId = requestIdRef.current;
            const resolvedPage = nextPage;

            try {
                setQueryResults(
                    produce((draft) => {
                        draft[type].state =
                            resolvedPage === 1
                                ? RequestStateCode.PENDING_FIRST_PAGE
                                : RequestStateCode.PENDING_REST_PAGE;
                    }),
                );
                const result = await PluginManager.callPluginDelegateMethod(
                    artist,
                    "getArtistWorks",
                    artist,
                    resolvedPage,
                    type,
                );

                if (
                    requestId !== requestIdRef.current
                    || artistKeyRef.current !== artistKey
                ) {
                    return;
                }

                setQueryResults(
                    produce((draft) => {
                        draft[type].page = resolvedPage;
                        draft[type].state =
                            result?.isEnd === false
                                ? RequestStateCode.PARTLY_DONE
                                : RequestStateCode.FINISHED;
                        // Page 1 replaces; later pages append
                        draft[type].data = resolvedPage === 1
                            ? (result?.data ?? [])
                            : (draft[type].data ?? [] as any[]).concat(result?.data ?? []);
                    }),
                );
            } catch {
                if (
                    requestId !== requestIdRef.current
                    || artistKeyRef.current !== artistKey
                ) {
                    return;
                }
                setQueryResults(
                    produce((draft) => {
                        draft[type].state =
                            resolvedPage === 1
                                ? RequestStateCode.FINISHED
                                : RequestStateCode.PARTLY_DONE;
                    }),
                );
            }
        },
        // Read latest via store getters; avoid re-creating on every store change
        [],
    );

    // Keep store subscription so consumers re-render
    void queryResults;

    return queryArtist;
}
