import { CSSProperties, useEffect, useRef, useState } from "react";
import Slider from "./widgets/Slider";
import MusicInfo from "./widgets/MusicInfo";
import Controller from "./widgets/Controller";
import Extra from "./widgets/Extra";
import { useCurrentMusic } from "@renderer/core/track-player/hooks";
import normalizeArtworkDisplaySrc, {
    getArtworkCacheKey,
} from "@/renderer/utils/normalize-artwork-display-src";
import { musicDetailShownStore } from "@renderer/components/MusicDetail/store";
import { getCurrentPanel } from "@/renderer/components/Panel";
import { isQualitySelectPopoverOpen } from "@/renderer/components/QualitySelectPopover";
import useAppConfig from "@/hooks/useAppConfig";
import LiquidGlassFilter, { useMusicBarLiquidGlass } from "./LiquidGlassFilter";
import {
    buildMusicBarPalette,
    DEFAULT_MUSIC_BAR_PALETTES,
    type MusicBarPaletteTone,
} from "./palette";

import "./index.scss";

type MusicBarPaletteStyle = CSSProperties & Record<string, string>;
type MusicBarPaletteVariantStyles = Record<
    MusicBarPaletteTone,
    MusicBarPaletteStyle
>;

const DEFAULT_MUSIC_BAR_STYLES: MusicBarPaletteVariantStyles =
    DEFAULT_MUSIC_BAR_PALETTES;
const MAX_MUSIC_BAR_PALETTE_CACHE_SIZE = 40;
const musicBarPaletteCache = new Map<string, MusicBarPaletteVariantStyles>();

function getCachedMusicBarPalette(artwork: string) {
    const cacheKey = getArtworkCacheKey(artwork);
    const cached = musicBarPaletteCache.get(cacheKey);
    if (!cached) {
        return null;
    }

    musicBarPaletteCache.delete(cacheKey);
    musicBarPaletteCache.set(cacheKey, cached);
    return cached;
}

function setCachedMusicBarPalette(
    artwork: string,
    styles: MusicBarPaletteVariantStyles,
) {
    const cacheKey = getArtworkCacheKey(artwork);
    if (musicBarPaletteCache.has(cacheKey)) {
        musicBarPaletteCache.delete(cacheKey);
    }
    musicBarPaletteCache.set(cacheKey, styles);

    if (musicBarPaletteCache.size <= MAX_MUSIC_BAR_PALETTE_CACHE_SIZE) {
        return;
    }

    const oldestKey = musicBarPaletteCache.keys().next().value;
    if (oldestKey) {
        musicBarPaletteCache.delete(oldestKey);
    }
}

async function extractMusicBarStyle(artwork?: string | null) {
    if (!artwork) {
        return DEFAULT_MUSIC_BAR_STYLES;
    }

    const cachedStyle = getCachedMusicBarPalette(artwork);
    if (cachedStyle) {
        return cachedStyle;
    }

    try {
        const image = new Image();
        image.decoding = "async";
        image.crossOrigin = "anonymous";
        image.referrerPolicy = "no-referrer";

        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("image load failed"));
            image.src = artwork;
        });

        const canvas = document.createElement("canvas");
        const width = 32;
        const height = 32;
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
            return DEFAULT_MUSIC_BAR_STYLES;
        }

        context.drawImage(image, 0, 0, width, height);
        const { data } = context.getImageData(0, 0, width, height);
        const nextStyle = buildMusicBarPalette(data, width, height)
            ?? DEFAULT_MUSIC_BAR_STYLES;
        setCachedMusicBarPalette(artwork, nextStyle);
        return nextStyle;
    } catch {
        return DEFAULT_MUSIC_BAR_STYLES;
    }
}

const FLAT_DOCK_STYLE: MusicBarPaletteStyle = {
    // Clean theme surface — no gray mix with textColor (looks dirty on white themes)
    "--musicBarSurface": "var(--backgroundColor)",
    "--musicBarSurfaceAlt": "var(--backgroundColor)",
    "--musicBarText": "var(--textColor)",
    "--musicBarTextSecondary": "color-mix(in srgb, var(--textColor) 58%, transparent)",
    "--musicBarAccent": "var(--primaryColor)",
    "--musicBarPrimaryText": "#ffffff",
    "--musicBarBackdropOpacity": "0",
};

function isFlatUiStyleActive() {
    return typeof document !== "undefined"
        && document.documentElement.getAttribute("data-ui-style") === "flat";
}

function getActiveThemeScheme(): MusicBarPaletteTone {
    return document.documentElement.getAttribute("data-theme-scheme") === "dark"
        ? "dark"
        : "light";
}

function toFlatDetailStyle(palette: MusicBarPaletteStyle): MusicBarPaletteStyle {
    const accent = palette["--musicBarAccent"];
    const primaryText = palette["--musicBarPrimaryText"];
    return {
        "--musicBarSurface": "transparent",
        "--musicBarSurfaceAlt": "transparent",
        "--musicBarText": "rgba(248, 250, 252, 0.95)",
        "--musicBarTextSecondary": "rgba(248, 250, 252, 0.62)",
        "--musicBarAccent": typeof accent === "string" && accent
            ? accent
            : "var(--primaryColor)",
        "--musicBarPrimaryText": typeof primaryText === "string" && primaryText
            ? primaryText
            : "#0b0b0f",
        "--musicBarBackdropOpacity": "0",
    };
}

function hasPinnedMusicBarOverlay() {
    if (typeof document === "undefined") {
        return false;
    }
    return Boolean(
        document.querySelector(".volume-bubble-container")
        || isQualitySelectPopoverOpen()
        || getCurrentPanel()?.type,
    );
}

export default function MusicBar() {
    const shellRef = useRef<HTMLDivElement>(null);
    const liquidGlass = useMusicBarLiquidGlass(shellRef);
    const currentMusic = useCurrentMusic();
    const artwork = currentMusic?.coverImg ?? currentMusic?.artwork;
    const musicDetailShown = musicDetailShownStore.useValue();
    // Default true: pure detail stage; settings can keep bar always visible (glass + flat)
    const detailAutoHideMusicBar = useAppConfig("normal.detailAutoHideMusicBar") !== false;
    const [musicBarStyle, setMusicBarStyle] = useState<MusicBarPaletteStyle>(
        DEFAULT_MUSIC_BAR_STYLES.light,
    );
    const [appearanceTick, setAppearanceTick] = useState(0);
    // Detail open: dock auto-hides; hover / pinned overlays reveal it
    const [autoHideRevealed, setAutoHideRevealed] = useState(false);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const autoHide = musicDetailShown && detailAutoHideMusicBar;

    useEffect(() => {
        const root = document.documentElement;
        const sync = () => {
            setAppearanceTick((value) => value + 1);
        };
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(root, {
            attributes: true,
            attributeFilter: ["data-ui-style", "data-theme-scheme"],
        });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!autoHide) {
            setAutoHideRevealed(false);
            if (hideTimerRef.current !== null) {
                clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
        }
    }, [autoHide]);

    // Keep dock visible while volume bubble / quality / panel is open
    useEffect(() => {
        if (!autoHide) {
            return;
        }
        const syncPinned = () => {
            if (hasPinnedMusicBarOverlay()) {
                if (hideTimerRef.current !== null) {
                    clearTimeout(hideTimerRef.current);
                    hideTimerRef.current = null;
                }
                setAutoHideRevealed(true);
            }
        };
        syncPinned();
        const observer = new MutationObserver(syncPinned);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [autoHide]);

    useEffect(() => {
        return () => {
            if (hideTimerRef.current !== null) {
                clearTimeout(hideTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        let aborted = false;

        const syncMusicBarArtwork = async () => {
            const flat = isFlatUiStyleActive();

            // Flat dock: solid readable theme colors (never light text on forced white)
            if (flat && !musicDetailShown) {
                if (!aborted) {
                    setMusicBarStyle(FLAT_DOCK_STYLE);
                }
                return;
            }

            const nextArtwork = await normalizeArtworkDisplaySrc(artwork);
            if (aborted) {
                return;
            }

            const resolvedArtwork = nextArtwork ?? artwork;
            const nextStyles = await extractMusicBarStyle(resolvedArtwork);
            if (aborted) {
                return;
            }

            // Flat + detail: light-on-dark immersive, keep artwork accent
            if (flat && musicDetailShown) {
                setMusicBarStyle(toFlatDetailStyle(nextStyles.dark));
                return;
            }

            const tone = musicDetailShown ? "dark" : getActiveThemeScheme();
            setMusicBarStyle(nextStyles[tone]);
        };

        void syncMusicBarArtwork();

        return () => {
            aborted = true;
        };
    }, [appearanceTick, artwork, musicDetailShown]);

    const clearHideTimer = () => {
        if (hideTimerRef.current !== null) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    };

    const revealBar = () => {
        if (!autoHide) {
            return;
        }
        clearHideTimer();
        setAutoHideRevealed(true);
    };

    const scheduleHideBar = () => {
        if (!autoHide) {
            return;
        }
        clearHideTimer();
        hideTimerRef.current = setTimeout(() => {
            hideTimerRef.current = null;
            // Stay if a bar-related overlay is still up
            if (!hasPinnedMusicBarOverlay()) {
                setAutoHideRevealed(false);
            }
        }, 320);
    };

    return (
        <div
            className="music-bar-container"
            style={musicBarStyle}
            data-detail-open={musicDetailShown ? "true" : "false"}
            data-auto-hide={autoHide ? "true" : "false"}
            data-revealed={autoHide ? (autoHideRevealed ? "true" : "false") : "true"}
            data-liquid-glass-svg={
                liquidGlass.supported && liquidGlass.mapHref ? "true" : "false"
            }
            onMouseEnter={revealBar}
            onMouseLeave={scheduleHideBar}
            onFocusCapture={revealBar}
        >
            <LiquidGlassFilter mapHref={liquidGlass.mapHref}></LiquidGlassFilter>
            {autoHide ? (
                <div
                    className="music-bar-hover-zone"
                    onMouseEnter={revealBar}
                    aria-hidden="true"
                ></div>
            ) : null}
            <div className="music-bar-motion-layer">
                <div className="music-bar-overlay"></div>
                <div ref={shellRef} className="music-bar-shell">
                    <Slider></Slider>
                    <div className="music-bar-controls">
                        <MusicInfo></MusicInfo>
                        <Controller></Controller>
                        <Extra></Extra>
                    </div>
                </div>
            </div>
        </div>
    );
}
