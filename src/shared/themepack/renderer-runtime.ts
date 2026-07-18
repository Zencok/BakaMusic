import type { IMod } from "./type";
import { parseThemeCss } from "./contract";
import {
    BUILTIN_DEFAULT_THEME_CSS,
    BUILTIN_DEFAULT_THEME_PATH,
    createBuiltinDefaultThemePack,
    isBuiltinDefaultTheme,
} from "./default-theme";

const themeNodeId = "themepack-node";
export const themePathKey = "themepack-path";
let themeBackgroundIframe: HTMLIFrameElement | null = null;

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
    document.documentElement.setAttribute("data-theme-spec", "2");
    document.documentElement.setAttribute("data-theme-scheme", scheme);
    document.body?.setAttribute("data-theme-spec", "2");
    document.body?.setAttribute("data-theme-scheme", scheme);
}

function clearThemeIframe() {
    themeBackgroundIframe?.remove();
    themeBackgroundIframe = null;
}

function applyThemeCss(themePack: ICommon.IThemePack, rawCss: string) {
    const parsed = parseThemeCss(rawCss);
    let themeNode = document.querySelector(`#${themeNodeId}`) as HTMLStyleElement | null;
    if (!themeNode) {
        themeNode = document.createElement("style");
        themeNode.id = themeNodeId;
    }
    document.head.appendChild(themeNode);
    applyThemeDocumentAttributes(themePack, parsed.tokens);
    themeNode.textContent = isBuiltinDefaultTheme(themePack)
        ? parsed.css
        : replaceThemeAlias(parsed.css, themePack.path);
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
        applyThemeCss(builtin, BUILTIN_DEFAULT_THEME_CSS);
        localStorage.setItem(themePathKey, BUILTIN_DEFAULT_THEME_PATH);
        return builtin;
    }
    const contents = await bridge.readThemeContents(themePack.path);
    applyThemeCss(themePack, contents.rawCss);
    applyThemeIframe(themePack, contents.iframeHtml);
    localStorage.setItem(themePathKey, themePack.path);
    return themePack;
}
