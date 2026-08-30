import type { IMod } from "./type";
import { parseThemeCss } from "./contract";
import {
    BUILTIN_DEFAULT_THEME_CSS,
    BUILTIN_DEFAULT_THEME_PATH,
    createBuiltinDefaultThemePack,
    isBuiltinDefaultTheme,
} from "./default-theme";

const themeNodeId = "themepack-node";
const themeIframeRuntimeStyleId = "bakamusic-theme-background-runtime";
const darkSchemeMediaQuery = "(prefers-color-scheme: dark)";
const reducedTransparencyMediaQuery = "(prefers-reduced-transparency: reduce)";
const themeIframeRuntimeCss = `
html,
body {
    width: 100%;
    height: 100%;
}

body {
    margin: 0;
    overflow: hidden;
}

video {
    display: block;
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
    object-fit: cover !important;
}
`;
export const themePathKey = "themepack-path";
let themeBackgroundIframe: HTMLIFrameElement | null = null;
let themeBackgroundIframeSource: string | null = null;
let systemThemeQuery: MediaQueryList | null = null;
let systemThemeChangeListener: (() => void) | null = null;
let reducedTransparencyQuery: MediaQueryList | null = null;
let reducedTransparencyChangeListener: (() => void) | null = null;
let windowMaterialSyncGeneration = 0;
let windowMaterialBridge: IMod | null = null;
let windowMaterialRequested = false;

function addTailSlash(value: string) {
    return value.endsWith("/") || value.endsWith("\\") ? value : `${value}/`;
}

export function replaceThemeAlias(
    rawText: string,
    basePath: string,
    _withFileScheme = true,
) {
    return rawText.replaceAll("@/", addTailSlash(basePath));
}

function resolveThemeScheme(
    themePack: ICommon.IThemePack,
    themeTokens: ReadonlyMap<string, string>,
): "light" | "dark" {
    if (themePack.scheme === "system") {
        return systemThemeQuery?.matches
            ?? window.matchMedia(darkSchemeMediaQuery).matches
            ? "dark"
            : "light";
    }
    if (themePack.scheme === "dark" || themePack.scheme === "light") {
        return themePack.scheme;
    }
    const cssScheme = themeTokens.get("--theme-scheme");
    if (cssScheme === "dark" || cssScheme === "light") {
        return cssScheme;
    }
    const text = themeTokens.get("--theme-text") ?? "";
    const rgb = text.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (rgb) {
        const luminance = (
            0.2126 * Number(rgb[1])
            + 0.7152 * Number(rgb[2])
            + 0.0722 * Number(rgb[3])
        ) / 255;
        return luminance > 0.55 ? "dark" : "light";
    }
    const hex = text.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
    if (hex) {
        const full = hex.length === 3
            ? Array.from(hex, (character) => character.repeat(2)).join("")
            : hex;
        const color = Number.parseInt(full, 16);
        const luminance = (
            0.2126 * ((color >> 16) & 255)
            + 0.7152 * ((color >> 8) & 255)
            + 0.0722 * (color & 255)
        ) / 255;
        return luminance > 0.55 ? "dark" : "light";
    }
    return "light";
}

function applyThemeDocumentAttributes(
    themePack: ICommon.IThemePack,
    themeTokens: ReadonlyMap<string, string>,
) {
    const scheme = resolveThemeScheme(themePack, themeTokens);
    const source = isBuiltinDefaultTheme(themePack) ? "builtin" : "pack";
    const attributes = {
        "data-theme-spec": "2",
        "data-theme-scheme": scheme,
        "data-theme-source": source,
    };
    [document.documentElement, document.body].forEach((element) => {
        if (!element) {
            return;
        }
        Object.entries(attributes).forEach(([name, value]) => {
            if (element.getAttribute(name) !== value) {
                element.setAttribute(name, value);
            }
        });
    });
}

function prefersReducedTransparency() {
    return window.matchMedia(reducedTransparencyMediaQuery).matches;
}

function applyWindowMaterialAttribute(value: "acrylic" | "none") {
    document.documentElement.setAttribute("data-window-material", value);
    document.body?.setAttribute("data-window-material", value);
}

function readActiveThemeScheme(): "light" | "dark" {
    const value = document.documentElement.getAttribute("data-theme-scheme");
    return value === "dark" ? "dark" : "light";
}

async function syncBuiltinWindowMaterial(bridge: IMod, enabled: boolean) {
    windowMaterialBridge = bridge;
    windowMaterialRequested = enabled;
    ensureReducedTransparencyFollow();
    const generation = ++windowMaterialSyncGeneration;
    const allowAcrylic = enabled && !prefersReducedTransparency();
    const scheme = readActiveThemeScheme();
    try {
        const active = await bridge.setWindowMaterial(allowAcrylic, scheme);
        if (generation !== windowMaterialSyncGeneration) {
            return;
        }
        applyWindowMaterialAttribute(active ? "acrylic" : "none");
    } catch {
        if (generation !== windowMaterialSyncGeneration) {
            return;
        }
        applyWindowMaterialAttribute("none");
    }
}

function ensureReducedTransparencyFollow() {
    if (reducedTransparencyQuery && reducedTransparencyChangeListener) {
        return;
    }
    reducedTransparencyQuery = window.matchMedia(reducedTransparencyMediaQuery);
    reducedTransparencyChangeListener = () => {
        if (!windowMaterialBridge) {
            return;
        }
        void syncBuiltinWindowMaterial(
            windowMaterialBridge,
            windowMaterialRequested,
        );
    };
    reducedTransparencyQuery.addEventListener(
        "change",
        reducedTransparencyChangeListener,
    );
}

function clearThemeIframe() {
    themeBackgroundIframe?.remove();
    themeBackgroundIframe = null;
    themeBackgroundIframeSource = null;
}

function prepareThemeIframeHtml(rawHtml: string) {
    const iframeDocument = new DOMParser().parseFromString(rawHtml, "text/html");
    let styleNode = iframeDocument.getElementById(themeIframeRuntimeStyleId);
    if (!styleNode) {
        styleNode = iframeDocument.createElement("style");
        styleNode.id = themeIframeRuntimeStyleId;
        iframeDocument.head.appendChild(styleNode);
    }
    styleNode.textContent = themeIframeRuntimeCss;
    return `<!DOCTYPE html>\n${iframeDocument.documentElement.outerHTML}`;
}

function stopFollowingSystemTheme() {
    if (systemThemeQuery && systemThemeChangeListener) {
        systemThemeQuery.removeEventListener("change", systemThemeChangeListener);
    }
    systemThemeQuery = null;
    systemThemeChangeListener = null;
}

function applyThemeCss(
    themePack: ICommon.IThemePack,
    rawCss: string,
    bridge: IMod,
) {
    const parsed = parseThemeCss(rawCss);
    let themeNode = document.querySelector(`#${themeNodeId}`) as HTMLStyleElement | null;
    if (!themeNode) {
        themeNode = document.createElement("style");
        themeNode.id = themeNodeId;
    }
    if (themeNode.dataset.runtimeMounted !== "true") {
        document.head.appendChild(themeNode);
        themeNode.dataset.runtimeMounted = "true";
    }
    const nextCss = isBuiltinDefaultTheme(themePack)
        ? parsed.css
        : replaceThemeAlias(parsed.css, themePack.path);
    const activeTokens = themePack.scheme === "system" && parsed.darkTokens
        && (systemThemeQuery?.matches ?? window.matchMedia(darkSchemeMediaQuery).matches)
        ? parsed.darkTokens
        : parsed.tokens;
    applyThemeDocumentAttributes(themePack, activeTokens);
    void syncBuiltinWindowMaterial(bridge, isBuiltinDefaultTheme(themePack));
    if (themeNode.textContent !== nextCss) {
        themeNode.textContent = nextCss;
    }
}

function followSystemTheme(listener: () => void) {
    stopFollowingSystemTheme();
    systemThemeQuery = window.matchMedia(darkSchemeMediaQuery);
    systemThemeChangeListener = listener;
    systemThemeQuery.addEventListener("change", systemThemeChangeListener);
}

function applyBuiltinDefaultTheme(themePack: ICommon.IThemePack, bridge: IMod) {
    const applyCurrentSystemTheme = () => {
        applyThemeCss(
            themePack,
            BUILTIN_DEFAULT_THEME_CSS,
            bridge,
        );
    };
    followSystemTheme(applyCurrentSystemTheme);
    applyCurrentSystemTheme();
}

function applyThemeIframe(themePack: ICommon.IThemePack, iframeHtml: string | null) {
    if (!themePack.iframe?.app || !iframeHtml) {
        clearThemeIframe();
        return;
    }
    const nextSource = replaceThemeAlias(
        prepareThemeIframeHtml(iframeHtml),
        themePack.path,
    );
    if (
        themeBackgroundIframe?.isConnected
        && themeBackgroundIframeSource === nextSource
    ) {
        return;
    }
    clearThemeIframe();
    const iframe = document.createElement("iframe");
    iframe.className = "theme-background-iframe";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.scrolling = "no";
    iframe.srcdoc = nextSource;
    document.querySelector(".app-container")?.prepend(iframe);
    themeBackgroundIframe = iframe;
    themeBackgroundIframeSource = nextSource;
}

export async function applyTheme(
    bridge: IMod,
    themePack: ICommon.IThemePack | null,
) {
    if (!themePack || isBuiltinDefaultTheme(themePack)) {
        const builtin = createBuiltinDefaultThemePack(themePack?.name);
        clearThemeIframe();
        applyBuiltinDefaultTheme(builtin, bridge);
        localStorage.setItem(themePathKey, BUILTIN_DEFAULT_THEME_PATH);
        return builtin;
    }
    const contents = await bridge.readThemeContents(themePack.path);
    const { darkTokens } = parseThemeCss(contents.rawCss);
    const applyCurrentTheme = () => {
        applyThemeCss(themePack, contents.rawCss, bridge);
    };
    stopFollowingSystemTheme();
    applyCurrentTheme();
    // main.ts rejects system themes without a dark block, so following the
    // media query is only needed when one is actually present.
    if (themePack.scheme === "system" && darkTokens) {
        followSystemTheme(applyCurrentTheme);
    }
    applyThemeIframe(themePack, contents.iframeHtml);
    localStorage.setItem(themePathKey, themePack.path);
    return themePack;
}
