import type { IMod } from "./type";
import { parseThemeCss } from "./contract";
import {
    BUILTIN_DEFAULT_DARK_THEME_CSS,
    BUILTIN_DEFAULT_LIGHT_THEME_CSS,
    BUILTIN_DEFAULT_THEME_PATH,
    createBuiltinDefaultThemePack,
    isBuiltinDefaultTheme,
} from "./default-theme";

const themeNodeId = "themepack-node";
const darkSchemeMediaQuery = "(prefers-color-scheme: dark)";
const reducedTransparencyMediaQuery = "(prefers-reduced-transparency: reduce)";
export const themePathKey = "themepack-path";
let themeBackgroundIframe: HTMLIFrameElement | null = null;
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
    document.documentElement.setAttribute("data-theme-spec", "2");
    document.documentElement.setAttribute("data-theme-scheme", scheme);
    document.documentElement.setAttribute("data-theme-source", source);
    document.body?.setAttribute("data-theme-spec", "2");
    document.body?.setAttribute("data-theme-scheme", scheme);
    document.body?.setAttribute("data-theme-source", source);
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
}

function stopFollowingSystemTheme() {
    if (systemThemeQuery && systemThemeChangeListener) {
        systemThemeQuery.removeEventListener("change", systemThemeChangeListener);
    }
    systemThemeQuery = null;
    systemThemeChangeListener = null;
}

function applyThemeCss(themePack: ICommon.IThemePack, rawCss: string, bridge: IMod) {
    const parsed = parseThemeCss(rawCss);
    let themeNode = document.querySelector(`#${themeNodeId}`) as HTMLStyleElement | null;
    if (!themeNode) {
        themeNode = document.createElement("style");
        themeNode.id = themeNodeId;
    }
    document.head.appendChild(themeNode);
    applyThemeDocumentAttributes(themePack, parsed.tokens);
    void syncBuiltinWindowMaterial(bridge, isBuiltinDefaultTheme(themePack));
    themeNode.textContent = isBuiltinDefaultTheme(themePack)
        ? parsed.css
        : replaceThemeAlias(parsed.css, themePack.path);
}

function applyBuiltinDefaultTheme(themePack: ICommon.IThemePack, bridge: IMod) {
    stopFollowingSystemTheme();
    systemThemeQuery = window.matchMedia(darkSchemeMediaQuery);

    const applyCurrentSystemTheme = () => {
        applyThemeCss(
            themePack,
            systemThemeQuery?.matches
                ? BUILTIN_DEFAULT_DARK_THEME_CSS
                : BUILTIN_DEFAULT_LIGHT_THEME_CSS,
            bridge,
        );
    };

    systemThemeChangeListener = applyCurrentSystemTheme;
    systemThemeQuery.addEventListener("change", systemThemeChangeListener);
    applyCurrentSystemTheme();
}

function applyThemeIframe(themePack: ICommon.IThemePack, iframeHtml: string | null) {
    clearThemeIframe();
    if (!themePack.iframe?.app || !iframeHtml) {
        return;
    }
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.scrolling = "no";
    iframe.srcdoc = replaceThemeAlias(iframeHtml, themePack.path);
    document.querySelector(".app-container")?.prepend(iframe);
    themeBackgroundIframe = iframe;
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
    applyThemeCss(themePack, contents.rawCss, bridge);
    stopFollowingSystemTheme();
    applyThemeIframe(themePack, contents.iframeHtml);
    localStorage.setItem(themePathKey, themePack.path);
    return themePack;
}
