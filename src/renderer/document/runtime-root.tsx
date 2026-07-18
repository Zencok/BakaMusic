import App from "../app";
import "animate.css";
import ModalComponent from "../components/Modal";
import PanelComponent from "../components/Panel";
import QualitySelectPopover from "../components/QualitySelectPopover";
import { HashRouter, Route, Routes } from "react-router-dom";
import MainPage from "../pages/main-page";
import { ContextMenuComponent } from "../components/ContextMenu";
import { Bounce, ToastContainer } from "react-toastify";

import "rc-slider/assets/index.css";
import "react-toastify/dist/ReactToastify.css";
import "./styles/index.scss";
import { toastDuration } from "@/common/constant";
import useBootstrap from "./useBootstrap";
import logger from "@shared/logger/renderer";
import { ErrorBoundary } from "react-error-boundary";
import Fallback from "@renderer/document/fallback";
import AppConfig from "@shared/app-config/renderer";
import trackPlayer from "../core/track-player";

logger.logPerf("Create Bundle");

export function markBootstrapReady() {
    logger.logPerf("Bundle Bootstrap Ready");
}

export default function RuntimeRoot() {
    return (
        <ErrorBoundary
            FallbackComponent={Fallback}
            onReset={() => {
                AppConfig.reset();
                trackPlayer.reset();
            }}
        >
            <Root></Root>
        </ErrorBoundary>
    );
}

function Root() {
    return (
        <>
            <HashRouter>
                <BootstrapComponent></BootstrapComponent>
                <Routes>
                    <Route path="/" element={<App></App>}>
                        <Route path="main/*" element={<MainPage></MainPage>}></Route>
                        <Route path="*" element={<MainPage></MainPage>}></Route>
                    </Route>
                </Routes>
                <PanelComponent></PanelComponent>
                <ModalComponent></ModalComponent>
            </HashRouter>
            <ContextMenuComponent></ContextMenuComponent>
            <QualitySelectPopover></QualitySelectPopover>
            <ToastContainer
                draggable={false}
                closeOnClick={false}
                limit={5}
                pauseOnFocusLoss={false}
                hideProgressBar
                autoClose={toastDuration.short}
                newestOnTop
                transition={Bounce}
            ></ToastContainer>
        </>
    );
}

function BootstrapComponent(): null {
    useBootstrap();

    return null;
}
