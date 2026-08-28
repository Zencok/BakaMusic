import darkAlbumCover from "@/assets/imgs/album-cover-dark.png";
import lightAlbumCover from "@/assets/imgs/album-cover-light.png";
import { useSyncExternalStore } from "react";

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

type CoverListener = () => void;

const listeners = new Set<CoverListener>();
let mediaQuery: MediaQueryList | null = null;
let currentAlbumCover = lightAlbumCover;

function readSystemAlbumCover() {
    if (typeof window === "undefined") {
        return lightAlbumCover;
    }

    return window.matchMedia(DARK_SCHEME_QUERY).matches
        ? darkAlbumCover
        : lightAlbumCover;
}

function updateAlbumCover() {
    const nextAlbumCover = readSystemAlbumCover();
    if (nextAlbumCover === currentAlbumCover) {
        return;
    }

    currentAlbumCover = nextAlbumCover;

    listeners.forEach((listener) => listener());
}

function ensureMediaQuery() {
    if (mediaQuery || typeof window === "undefined") {
        return;
    }

    mediaQuery = window.matchMedia(DARK_SCHEME_QUERY);
    currentAlbumCover = mediaQuery.matches ? darkAlbumCover : lightAlbumCover;

    if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", updateAlbumCover);
    } else {
        // Older Chromium builds expose the legacy MediaQueryList listener API.
        mediaQuery.addListener(updateAlbumCover);
    }
}

export function getDefaultAlbumCover() {
    ensureMediaQuery();
    return currentAlbumCover;
}

export function subscribeDefaultAlbumCover(listener: CoverListener) {
    ensureMediaQuery();
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Subscribe a component to system theme changes and return the active cover. */
export function useDefaultAlbumCover() {
    return useSyncExternalStore(
        subscribeDefaultAlbumCover,
        getDefaultAlbumCover,
        () => lightAlbumCover,
    );
}

export function isDefaultAlbumCoverSource(value?: string | null) {
    return value === darkAlbumCover || value === lightAlbumCover;
}

// Keep the existing default-import API for lazy-image callers. Components that
// render a fallback directly use `useDefaultAlbumCover` so they re-render when
// the operating-system scheme changes.
export { currentAlbumCover as default };
