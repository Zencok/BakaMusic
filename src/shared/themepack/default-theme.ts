/** Built-in default theme — bakamusic-theme@2 */

export { THEME_SPEC_V2 } from "./contract";
import { THEME_SPEC_V2 } from "./contract";

/** localStorage / path sentinel for the built-in default pack */
export const BUILTIN_DEFAULT_THEME_PATH = "@builtin/default";

export const BUILTIN_DEFAULT_THEME_HASH = "builtin-default-v2";

/** Light half of the system-adaptive built-in default theme. */
export const BUILTIN_DEFAULT_LIGHT_THEME_CSS = `/* bakamusic-theme@2 — built-in default light */
:root {
    --theme-primary: #f17d34;
    --theme-primary-hover: #d96924;
    --theme-primary-active: #bd591b;
    --theme-bg: #fdfdfd;
    --theme-text: #333333;
    --theme-scheme: light;
    --theme-text-secondary: color-mix(in srgb, #333333 72%, transparent);
    --theme-text-muted: color-mix(in srgb, #333333 52%, transparent);
    --theme-text-on-primary: #0b0b0f;
    --theme-header-text: #333333;
    --theme-link: #f17d34;
    --theme-divider: color-mix(in srgb, #333333 12%, transparent);
    --theme-mask: color-mix(in srgb, #333333 32%, transparent);
    --theme-placeholder: #f4f4f4;
    --theme-surface-alpha: 0.88;
    --theme-blur: 22px;
    --theme-bg-image: none;
    --theme-scrollbar-thumb: color-mix(in srgb, #333333 38%, #fdfdfd);
    --theme-scrollbar-thumb-hover: #d96924;
    --theme-scrollbar-thumb-active: #bd591b;
}
`;

/** Dark half of the same built-in theme; it is not a separate selectable pack. */
export const BUILTIN_DEFAULT_DARK_THEME_CSS = `/* bakamusic-theme@2 — built-in default dark */
:root {
    --theme-primary: #ff9850;
    --theme-primary-hover: #ffad75;
    --theme-primary-active: #e87931;
    --theme-bg: #111318;
    --theme-text: #f2f4f8;
    --theme-scheme: dark;
    --theme-text-secondary: rgba(242, 244, 248, 0.76);
    --theme-text-muted: rgba(242, 244, 248, 0.54);
    --theme-text-on-primary: #18100a;
    --theme-header-text: #f2f4f8;
    --theme-link: #ffad75;
    --theme-divider: rgba(242, 244, 248, 0.13);
    --theme-mask: rgba(3, 5, 9, 0.68);
    --theme-placeholder: #252932;
    --theme-surface-alpha: 0.9;
    --theme-surface: rgba(25, 28, 35, 0.88);
    --theme-surface-strong: #1d2028;
    --theme-surface-muted: rgba(22, 25, 32, 0.82);
    --theme-surface-border: rgba(242, 244, 248, 0.12);
    --theme-surface-border-strong: rgba(242, 244, 248, 0.2);
    --theme-interactive: rgba(242, 244, 248, 0.07);
    --theme-interactive-hover: rgba(255, 152, 80, 0.14);
    --theme-interactive-active: rgba(255, 152, 80, 0.2);
    --theme-page-bg:
        radial-gradient(circle at top left, rgba(255, 152, 80, 0.1), transparent 34%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent);
    --theme-popover-bg: #1b1e26;
    --theme-blur: 22px;
    --theme-bg-image: none;
    --theme-scrollbar-thumb: rgba(242, 244, 248, 0.34);
    --theme-scrollbar-thumb-hover: #ffad75;
    --theme-scrollbar-thumb-active: #ff9850;
}
`;

/** Backward-compatible light token export for non-renderer consumers. */
export const BUILTIN_DEFAULT_THEME_CSS = BUILTIN_DEFAULT_LIGHT_THEME_CSS;

export function createBuiltinDefaultThemePack(
    name = "Default",
): ICommon.IThemePack {
    return {
        spec: THEME_SPEC_V2,
        id: "builtin-default",
        name,
        preview: "#f17d34",
        path: BUILTIN_DEFAULT_THEME_PATH,
        hash: BUILTIN_DEFAULT_THEME_HASH,
        scheme: "system",
        version: "2.1.0",
        description: "Built-in system-adaptive bakamusic-theme@2 default",
    };
}

export function isBuiltinDefaultTheme(
    themePack: ICommon.IThemePack | null | undefined,
): boolean {
    if (!themePack) {
        return false;
    }
    return (
        themePack.path === BUILTIN_DEFAULT_THEME_PATH
        || themePack.hash === BUILTIN_DEFAULT_THEME_HASH
        || themePack.id === "builtin-default"
    );
}
