/** Built-in default theme — bakamusic-theme@2 */

export const THEME_SPEC_V2 = "bakamusic-theme@2";

/** localStorage / path sentinel for the built-in default pack */
export const BUILTIN_DEFAULT_THEME_PATH = "@builtin/default";

export const BUILTIN_DEFAULT_THEME_HASH = "builtin-default-v2";

/** Token-only CSS matching the historical BakaMusic defaults */
export const BUILTIN_DEFAULT_THEME_CSS = `/* bakamusic-theme@2 — built-in default */
:root {
    --theme-primary: #f17d34;
    --theme-bg: #fdfdfd;
    --theme-text: #333333;
    --theme-scheme: light;
    --theme-text-secondary: color-mix(in srgb, #333333 72%, transparent);
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
}
`;

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
        scheme: "light",
        version: "2.0.0",
        description: "Built-in bakamusic-theme@2 default",
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
