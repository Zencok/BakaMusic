import SvgAsset from "../SvgAsset";
import "./index.scss";
import { showModal } from "../Modal";
import { useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import HeaderNavigator from "./widgets/Navigator";
import MusicDetail from "../MusicDetail";
import Condition from "../Condition";
import SearchHistory from "./widgets/SearchHistory";
import { addSearchHistory } from "@/renderer/utils/search-history";
import { useTranslation } from "react-i18next";
import useAppConfig from "@/hooks/useAppConfig";
import AppConfig from "@shared/app-config/renderer";
import { appUtil, appWindowUtil } from "@shared/utils/renderer";
import { musicDetailShownStore } from "@renderer/components/MusicDetail/store";

export default function AppHeader() {
    const navigate = useNavigate();
    const inputRef = useRef<HTMLInputElement>(null);
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const isHistoryFocusRef = useRef(false);

    const isMiniMode = useAppConfig("private.minimode");

    const { t } = useTranslation();

    if (!showSearchHistory) {
        isHistoryFocusRef.current = false;
    }

    function onSearchSubmit() {
        const keyword = inputRef.current?.value;
        if (keyword) {
            search(keyword);
        }
    }

    function search(keyword: string) {
        navigate(`/main/search/${encodeURIComponent(keyword)}`);
        musicDetailShownStore.setValue(false);
        addSearchHistory(keyword);
        setShowSearchHistory(false);
    }

    return (
        <div className="header-container">
            <div className="left-part">
                <div className="logo">
                    <SvgAsset iconName="logo"></SvgAsset>
                </div>
                <HeaderNavigator></HeaderNavigator>
                <div id="header-search" className="header-search">
                    <input
                        ref={inputRef}
                        className="header-search-input"
                        placeholder={t("app_header.search_placeholder")}
                        maxLength={50}
                        onClick={() => {
                            setShowSearchHistory(true);
                        }}
                        onKeyDown={(key) => {
                            if (key.key === "Enter") {
                                onSearchSubmit();
                            }
                        }}
                        onFocus={() => {
                            setShowSearchHistory(true);
                        }}
                        onBlur={() => {
                            setTimeout(() => {
                                if (!isHistoryFocusRef.current) {
                                    setShowSearchHistory(false);
                                }
                            }, 0);
                        }}
                    ></input>
                    <button
                        type="button"
                        className="search-submit"
                        aria-label={t("app_header.search")}
                        title={t("app_header.search")}
                        onClick={onSearchSubmit}
                    >
                        <SvgAsset iconName="magnifying-glass"></SvgAsset>
                    </button>
                    <Condition condition={showSearchHistory}>
                        <SearchHistory
                            onHistoryClick={(item) => {
                                search(item);
                                if (inputRef.current) {
                                    inputRef.current.value = item;
                                }
                            }}
                            onHistoryPanelBlur={() => {
                                isHistoryFocusRef.current = false;
                                setShowSearchHistory(false);
                            }}
                            onHistoryPanelFocus={() => {
                                isHistoryFocusRef.current = true;
                                setShowSearchHistory(true);
                            }}
                        ></SearchHistory>
                    </Condition>
                </div>
            </div>

            <div className="right-part">
                <button
                    type="button"
                    className="header-button sparkles-icon"
                    title={t("app_header.developer_message")}
                    aria-label={t("app_header.developer_message")}
                    onClick={() => {
                        showModal("Sparkles");
                    }}
                >
                    <SvgAsset iconName="sparkles"></SvgAsset>
                </button>
                <button
                    type="button"
                    className="header-button"
                    title={t("app_header.theme")}
                    aria-label={t("app_header.theme")}
                    onClick={() => {
                        navigate("/main/theme");
                        MusicDetail.hide();
                    }}
                >
                    <SvgAsset iconName="t-shirt-line"></SvgAsset>
                </button>
                <button
                    type="button"
                    className="header-button"
                    title={t("app_header.settings")}
                    aria-label={t("app_header.settings")}
                    onClick={() => {
                        navigate("/main/setting");
                        MusicDetail.hide();
                    }}
                >
                    <SvgAsset iconName="cog-8-tooth"></SvgAsset>
                </button>
                <div className="header-divider" role="separator" aria-orientation="vertical"></div>
                <button
                    type="button"
                    title={t("app_header.minimode")}
                    aria-label={t("app_header.minimode")}
                    className="header-button"
                    onClick={() => {
                        appWindowUtil.setMinimodeWindow(!isMiniMode);
                        if (!isMiniMode) {
                            appWindowUtil.minMainWindow(true);
                        }
                    }}
                >
                    <SvgAsset iconName="picture-in-picture-line"></SvgAsset>
                </button>
                <button
                    type="button"
                    title={t("app_header.minimize")}
                    aria-label={t("app_header.minimize")}
                    className="header-button"
                    onClick={() => {
                        appWindowUtil.minMainWindow();
                    }}
                >
                    <SvgAsset iconName="minus"></SvgAsset>
                </button>
                <button
                    type="button"
                    className="header-button"
                    title={t("app_header.maximize")}
                    aria-label={t("app_header.maximize")}
                    onClick={() => {
                        appWindowUtil.toggleMainWindowMaximize();
                    }}
                >
                    <SvgAsset iconName="square"></SvgAsset>
                </button>
                <button
                    type="button"
                    title={t("app_header.exit")}
                    aria-label={t("app_header.exit")}
                    className="header-button"
                    onClick={() => {
                        const exitBehavior = AppConfig.getConfig("normal.closeBehavior");
                        if (exitBehavior === "minimize") {
                            appWindowUtil.minMainWindow(true);
                        } else {
                            appUtil.exitApp();
                        }
                    }}
                >
                    <SvgAsset iconName="x-mark"></SvgAsset>
                </button>
            </div>
        </div>
    );
}
