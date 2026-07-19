import { isSameMedia } from "@/common/media-util";
import { useCurrentMusic } from "@renderer/core/track-player/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SvgAsset from "../SvgAsset";
import "./index.scss";

interface ICurrentMusicLocatorProps {
    musicList: IMusic.IMusicItem[];
    getScrollElement: () => HTMLElement | null;
    scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
    placement?: "fixed" | "container";
}

const LOCATE_BUTTON_HIDE_DELAY = 3000;
const LOCATE_SCROLL_END_DELAY = 180;
const LOCATE_SCROLL_FALLBACK_DELAY = 800;

export default function CurrentMusicLocator(props: ICurrentMusicLocatorProps) {
    const {
        musicList,
        getScrollElement,
        scrollToIndex,
        placement = "fixed",
    } = props;
    const { t } = useTranslation();
    const currentMusic = useCurrentMusic();
    const [visible, setVisible] = useState(false);
    const isHoveringRef = useRef(false);
    const isLocatingRef = useRef(false);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const hasCurrentMusic = !!currentMusic && musicList.some((item) =>
        isSameMedia(item, currentMusic),
    );

    const clearTimer = useCallback((timerRef: { current: ReturnType<typeof setTimeout> | null }) => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const scheduleHide = useCallback(() => {
        clearTimer(hideTimerRef);
        if (isHoveringRef.current || isLocatingRef.current) {
            return;
        }
        hideTimerRef.current = setTimeout(() => {
            if (!isHoveringRef.current && !isLocatingRef.current) {
                setVisible(false);
            }
            hideTimerRef.current = null;
        }, LOCATE_BUTTON_HIDE_DELAY);
    }, [clearTimer]);

    useEffect(() => {
        if (!hasCurrentMusic) {
            setVisible(false);
            isLocatingRef.current = false;
            clearTimer(hideTimerRef);
            clearTimer(scrollEndTimerRef);
            clearTimer(fallbackTimerRef);
            return;
        }

        const scrollElement = getScrollElement();
        if (!scrollElement) {
            return;
        }

        const handleScroll = () => {
            if (!hasCurrentMusic) {
                return;
            }

            setVisible(true);
            if (isLocatingRef.current) {
                clearTimer(hideTimerRef);
                clearTimer(fallbackTimerRef);
                clearTimer(scrollEndTimerRef);
                scrollEndTimerRef.current = setTimeout(() => {
                    isLocatingRef.current = false;
                    setVisible(false);
                    scrollEndTimerRef.current = null;
                }, LOCATE_SCROLL_END_DELAY);
                return;
            }
            scheduleHide();
        };

        scrollElement.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            scrollElement.removeEventListener("scroll", handleScroll);
            clearTimer(hideTimerRef);
            clearTimer(scrollEndTimerRef);
            clearTimer(fallbackTimerRef);
        };
    }, [clearTimer, getScrollElement, hasCurrentMusic, scheduleHide]);

    useEffect(() => () => {
        clearTimer(hideTimerRef);
        clearTimer(scrollEndTimerRef);
        clearTimer(fallbackTimerRef);
    }, [clearTimer]);

    const locateCurrentMusic = () => {
        if (!currentMusic || !hasCurrentMusic) {
            return;
        }
        const index = musicList.findIndex((item) => isSameMedia(item, currentMusic));
        if (index < 0) {
            return;
        }

        isLocatingRef.current = true;
        setVisible(true);
        clearTimer(hideTimerRef);
        clearTimer(scrollEndTimerRef);
        clearTimer(fallbackTimerRef);
        fallbackTimerRef.current = setTimeout(() => {
            isLocatingRef.current = false;
            setVisible(false);
            fallbackTimerRef.current = null;
        }, LOCATE_SCROLL_FALLBACK_DELAY);
        scrollToIndex(Math.max(index - 2, 0), "smooth");
    };

    if (!visible || !hasCurrentMusic) {
        return null;
    }

    return (
        <button
            type="button"
            className="current-music-locator"
            data-placement={placement}
            aria-label={t("panel.locate_current_music")}
            title={t("panel.locate_current_music")}
            onClick={locateCurrentMusic}
            onMouseEnter={() => {
                isHoveringRef.current = true;
                clearTimer(hideTimerRef);
            }}
            onMouseLeave={() => {
                isHoveringRef.current = false;
                scheduleHide();
            }}
            onFocus={() => {
                isHoveringRef.current = true;
                clearTimer(hideTimerRef);
            }}
            onBlur={() => {
                isHoveringRef.current = false;
                scheduleHide();
            }}
        >
            <SvgAsset iconName="map-aiming" size={19}></SvgAsset>
        </button>
    );
}
