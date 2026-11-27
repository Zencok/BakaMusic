import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import PluginManager from "@shared/plugin-manager/renderer";
import { CursorSession } from "./cursor-session";

export default function useCursorPage<T, E = IMedia.IMediaBase>(
    identity: string,
    fetch: (cursor: string | null) => Promise<IPlugin.Page<T>>,
    entity?: E,
    items: T[] = [],
    enabled = true,
) {
    const [registryRevision, setRegistryRevision] = useState(0);
    useEffect(() => PluginManager.onPluginsChanged(() => setRegistryRevision((value) => value + 1)), []);
    const fetchRef = useRef(fetch);
    fetchRef.current = fetch;
    // Identity, rather than metadata object reference, owns continuation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const session = useMemo(() => new CursorSession<T, E>(entity, items), [identity, registryRevision]);
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
    const load = useCallback(() => enabled ? session.load((cursor) => fetchRef.current(cursor)) : Promise.resolve(), [enabled, session]);
    useEffect(() => {
        if (enabled) void load();
        return () => {
            session.invalidate();
        };
    }, [enabled, load, session]);
    return [snapshot, load] as const;
}
