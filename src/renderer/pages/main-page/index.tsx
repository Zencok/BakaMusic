import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type CSSProperties } from "react";
import SideBar from "./components/SideBar";
import Empty from "@/renderer/components/Empty";

import "./index.scss";

const PluginManagerView = lazy(() => import("./views/plugin-manager-view"));
const MusicSheetView = lazy(() => import("./views/music-sheet-view"));
const SearchView = lazy(() => import("./views/search-view"));
const AlbumView = lazy(() => import("./views/album-view"));
const ArtistView = lazy(() => import("./views/artist-view"));
const ToplistView = lazy(() => import("./views/toplist-view"));
const TopListDetailView = lazy(() => import("./views/toplist-detail-view"));
const RecommendSheetsView = lazy(() => import("./views/recommend-sheets-view"));
const SettingView = lazy(() => import("./views/setting-view"));
const LocalMusicView = lazy(() => import("./views/local-music-view"));
const DownloadView = lazy(() => import("./views/download-view"));
const ThemeView = lazy(() => import("./views/theme-view"));
const StatisticsView = lazy(() => import("./views/statistics-view"));

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

const ROUTE_FALLBACK_STYLE: CSSProperties = {
    alignItems: "center",
    display: "flex",
    flex: "1 1 auto",
    justifyContent: "center",
};

export default function MainPage() {
    return (
        <div style={MAIN_PAGE_SHELL_STYLE}>
            <SideBar></SideBar>
            <div style={MAIN_PAGE_ROUTE_CONTAINER_STYLE}>
                <Suspense
                    fallback={(
                        <div style={ROUTE_FALLBACK_STYLE} aria-busy="true"></div>
                    )}
                >
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
                            path="statistics"
                            element={<StatisticsView></StatisticsView>}
                        ></Route>
                        <Route
                            path="recently_play"
                            element={<Navigate to="/main/statistics" replace></Navigate>}
                        ></Route>
                        <Route path="*" element={<Empty></Empty>}></Route>
                    </Routes>
                </Suspense>
            </div>
        </div>
    );
}
