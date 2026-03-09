import { Route, Routes } from "react-router-dom";
import { CSSProperties } from "react";
import SideBar from "./components/SideBar";
import PluginManagerView from "./views/plugin-manager-view";
import MusicSheetView from "./views/music-sheet-view";
import SearchView from "./views/search-view";
import AlbumView from "./views/album-view";
import ArtistView from "./views/artist-view";
import ToplistView from "./views/toplist-view";
import TopListDetailView from "./views/toplist-detail-view";
import RecommendSheetsView from "./views/recommend-sheets-view";
import SettingView from "./views/setting-view";
import LocalMusicView from "./views/local-music-view";
import Empty from "@/renderer/components/Empty";
import DownloadView from "./views/download-view";
import ThemeView from "./views/theme-view";
import RecentlyPlayView from "./views/recently-play-view";

import "./index.scss";

const MAIN_PAGE_SHELL_STYLE: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    flex: "1 1 0",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
};

const MAIN_PAGE_ROUTE_CONTAINER_STYLE: CSSProperties = {
    display: "flex",
    flex: "1 1 auto",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
};

export default function MainPage() {
    return (
        <div style={MAIN_PAGE_SHELL_STYLE}>
            <SideBar></SideBar>
            <div style={MAIN_PAGE_ROUTE_CONTAINER_STYLE}>
                <Routes>
                    <Route path="search/:query" element={<SearchView></SearchView>}></Route>
                    <Route
                        path="plugin-manager-view"
                        element={<PluginManagerView></PluginManagerView>}
                    ></Route>
                    <Route
                        path="musicsheet/:platform/:id"
                        element={<MusicSheetView></MusicSheetView>}
                    ></Route>
                    <Route
                        path="album/:platform/:id"
                        element={<AlbumView></AlbumView>}
                    ></Route>
                    <Route
                        path="artist/:platform/:id"
                        element={<ArtistView></ArtistView>}
                    ></Route>
                    <Route path="toplist" element={<ToplistView></ToplistView>}></Route>
                    <Route
                        path="toplist-detail/:platform"
                        element={<TopListDetailView></TopListDetailView>}
                    ></Route>
                    <Route
                        path="recommend-sheets"
                        element={<RecommendSheetsView></RecommendSheetsView>}
                    ></Route>
                    <Route
                        path="local-music"
                        element={<LocalMusicView></LocalMusicView>}
                    ></Route>
                    <Route path="download" element={<DownloadView></DownloadView>}></Route>
                    <Route path="setting" element={<SettingView></SettingView>}></Route>
                    <Route path="theme" element={<ThemeView></ThemeView>}></Route>
                    <Route
                        path="recently_play"
                        element={<RecentlyPlayView></RecentlyPlayView>}
                    ></Route>
                    <Route path="*" element={<Empty></Empty>}></Route>
                </Routes>
            </div>
        </div>
    );
}
