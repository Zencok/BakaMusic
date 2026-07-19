import { useLocation, useParams } from "react-router-dom";
import Header from "./components/Header";
import { useEffect, useMemo, useState } from "react";
import Body from "./components/Body";
import { initQueryResult, queryResultStore } from "./store";
import PluginManager from "@shared/plugin-manager/renderer";

function isBlankAvatar(avatar?: string | null): boolean {
    const text = (avatar ?? "").trim();
    if (!text) {
        return true;
    }
    // Netease default placeholder
    if (text.includes("5639395138885805")) {
        return true;
    }
    return false;
}

export default function ArtistView() {
    const params = useParams();
    const location = useLocation();

    const routeArtistItem = useMemo(() => {
        // Prefer React Router location.state; fall back to history.usr (RR internal).
        const fromLocation =
            location.state && typeof location.state === "object"
                ? (location.state as { artistItem?: IArtist.IArtistItem }).artistItem
                : undefined;
        const fromHistory =
            typeof history !== "undefined" && history.state && typeof history.state === "object"
                ? (history.state as { usr?: { artistItem?: IArtist.IArtistItem } }).usr
                    ?.artistItem
                : undefined;
        const artistInState = fromLocation ?? fromHistory ?? {};

        return {
            ...artistInState,
            platform: params?.platform ?? (artistInState as IArtist.IArtistItem).platform ?? "",
            id: params?.id ?? (artistInState as IArtist.IArtistItem).id ?? "",
        } as IArtist.IArtistItem;
    }, [params?.platform, params?.id, location.state]);

    const [artistItem, setArtistItem] = useState(routeArtistItem);

    // Sync route identity into local state
    useEffect(() => {
        setArtistItem(routeArtistItem);
    }, [routeArtistItem]);

    // Reset store only when leaving the page or switching artist — not every re-render
    useEffect(() => {
        queryResultStore.setValue(initQueryResult);
        return () => {
            queryResultStore.setValue(initQueryResult);
        };
    }, [routeArtistItem.platform, routeArtistItem.id]);

    // Song-context navigation often has id only; fetch avatar/description (wy/kg getArtistInfo).
    useEffect(() => {
        if (!routeArtistItem.platform || !routeArtistItem.id) {
            return;
        }
        if (!isBlankAvatar(routeArtistItem.avatar) && routeArtistItem.description) {
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const info = await PluginManager.callPluginDelegateMethod(
                    routeArtistItem,
                    "getArtistInfo",
                    routeArtistItem,
                );
                if (cancelled || !info || typeof info !== "object") {
                    return;
                }
                setArtistItem((prev) => ({
                    ...prev,
                    ...info,
                    id: prev.id,
                    platform: prev.platform,
                    name: info.name || prev.name,
                    description: info.description || prev.description,
                    avatar: !isBlankAvatar(info.avatar)
                        ? String(info.avatar).trim()
                        : !isBlankAvatar(prev.avatar)
                            ? String(prev.avatar).trim()
                            : "",
                }));
            } catch {
                // ignore — header keeps fallback cover
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [routeArtistItem]);

    return (
        <div id="page-container" className="page-container artist-view--container">
            <Header artistItem={artistItem}></Header>
            <Body artistItem={artistItem}></Body>
        </div>
    );
}
