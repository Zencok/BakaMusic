import { useEffect, useLayoutEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import checkUpdate from "../utils/check-update";
import Themepack from "@/shared/themepack/renderer";
import logger from "@shared/logger/renderer";
import AppConfig from "@shared/app-config/renderer";
import messageBus from "@shared/message-bus/renderer/main";
import { applyUiStyle } from "@renderer/utils/ui-style";
import { setAppNavigate } from "@renderer/utils/app-navigate";
import type { IAppConfig } from "@/types/app-config";

export default function useBootstrap() {
    const navigate = useNavigate();
    const navigateRef = useRef(navigate);

    useLayoutEffect(() => {
        void Themepack.setupThemePacks();
        applyUiStyle(AppConfig.getConfig("normal.uiStyle"));
    }, []);

    useLayoutEffect(() => {
        navigateRef.current = navigate;
        setAppNavigate(navigate);
    }, [navigate]);

    useEffect(() => {
        const disposeNavigate = messageBus.onCommand("Navigate", (route) => {
            navigateRef.current(route);
        });

        const onConfigUpdate = (patch: IAppConfig, config: IAppConfig) => {
            if ("normal.uiStyle" in patch) {
                applyUiStyle(config["normal.uiStyle"]);
            }
        };
        AppConfig.onConfigUpdate(onConfigUpdate);

        if (AppConfig.getConfig("normal.checkUpdate")) {
            checkUpdate();
        }
        logger.logPerf("Bundle First Screen");

        return () => {
            disposeNavigate?.();
            AppConfig.offConfigUpdate(onConfigUpdate);
        };
    }, []);
}
