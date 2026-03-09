import AppHeader from "./components/Header";
import { CSSProperties } from "react";

import "./app.scss";
import MusicBar from "./components/MusicBar";
import { Outlet } from "react-router";
import MusicDetail from "@renderer/components/MusicDetail";

const APP_CONTAINER_STYLE: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    position: "relative",
};

const BODY_CONTAINER_STYLE: CSSProperties = {
    width: "100%",
    flex: "1 1 0",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    position: "relative",
    isolation: "isolate",
    overflow: "hidden",
};

export default function App() {
    return (
        <div className="app-container" style={APP_CONTAINER_STYLE}>
            <AppHeader></AppHeader>
            <div className="body-container" style={BODY_CONTAINER_STYLE}>
                <Outlet></Outlet>
            </div>
            <MusicDetail></MusicDetail>
            <MusicBar></MusicBar>
        </div>
    );
}
