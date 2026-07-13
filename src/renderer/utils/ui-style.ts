import type { IAppConfig } from "@/types/app-config";

export type UiStyle = NonNullable<IAppConfig["normal.uiStyle"]>;

export const DEFAULT_UI_STYLE: UiStyle = "glass";
export const UI_STYLE_ATTR = "data-ui-style";

export function normalizeUiStyle(style?: string | null): UiStyle {
    return style === "flat" ? "flat" : "glass";
}

export function applyUiStyle(style?: string | null): UiStyle {
    const next = normalizeUiStyle(style);
    if (typeof document !== "undefined") {
        document.documentElement.setAttribute(UI_STYLE_ATTR, next);
        document.body?.setAttribute(UI_STYLE_ATTR, next);
    }
    return next;
}

export function getAppliedUiStyle(): UiStyle {
    if (typeof document === "undefined") {
        return DEFAULT_UI_STYLE;
    }
    return normalizeUiStyle(document.documentElement.getAttribute(UI_STYLE_ATTR));
}
