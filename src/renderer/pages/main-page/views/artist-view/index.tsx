import { useParams } from "react-router-dom";
import Header from "./components/Header";
import "./index.scss";
import { useEffect, useMemo } from "react";
import Body from "./components/Body";
import { initQueryResult, queryResultStore } from "./store";

export default function ArtistView() {
    const params = useParams();

    const artistItem = useMemo(() => {
        const artistInState = history.state.usr?.artistItem ?? {};

        return {
            ...artistInState,
            platform: params?.platform,
            id: params?.id,
        } as IArtist.IArtistItem;
    }, [params?.platform, params?.id]);

    // Reset store only when leaving the page or switching artist — not every re-render
    useEffect(() => {
        queryResultStore.setValue(initQueryResult);
        return () => {
            queryResultStore.setValue(initQueryResult);
        };
    }, [artistItem.platform, artistItem.id]);

    return (
        <div id="page-container" className="page-container artist-view--container">
            <Header artistItem={artistItem}></Header>
            <Body artistItem={artistItem}></Body>
        </div>
    );
}
