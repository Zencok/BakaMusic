import type { IAppConfig } from "@/types/app-config";

export type UiStyle = NonNullable<IAppConfig["normal.uiStyle"]>;

const UI_STYLE_ATTR = "data-ui-style";

function normalizeUiStyle(style?: string | null): UiStyle {
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
