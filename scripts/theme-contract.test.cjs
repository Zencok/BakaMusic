const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    CLIENT_OWNED_COMPATIBILITY_TOKENS,
    THEME_SPEC_V2,
    THEME_TOKENS,
    parseThemeCss,
    validateThemePackConfig,
} = require("../src/shared/themepack/contract");
const {
    matchesThemeSearch,
} = require("../src/renderer/pages/main-page/views/theme-view/theme-search");
const {
    buildMusicBarPalette,
    compositeRgb,
    getContrastRatio,
    getRelativeLuminance,
    MUSIC_BAR_GLASS_TINT_ALPHA,
} = require("../src/renderer/components/MusicBar/palette");
const {
    bindMediaToPlugin,
    buildPlayByIdMusicItem,
    createMusicIdentifierBase,
    getMediaPluginDelegate,
    matchesMusicIdentifier,
    resolveMusicItemId,
} = require("../src/renderer/core/track-player/plugin-media");

const themeMainSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/themepack/main.ts",
), "utf8");
const themeRuntimeSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/themepack/renderer-runtime.ts",
), "utf8");
const themeBridgeSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/document/styles/theme-bridge.scss",
), "utf8");
const defaultAcrylicSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/document/styles/default-acrylic.scss",
), "utf8");
const globalStyleEntrySource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/document/styles/index.scss",
), "utf8");
const toastStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/document/styles/tables.scss",
), "utf8");
const modalBaseStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/Modal/templates/Base/index.scss",
), "utf8");
const qualitySelectStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/QualitySelectPopover/index.scss",
), "utf8");
const contextMenuStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/ContextMenu/index.scss",
), "utf8");
const windowMaterialSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/themepack/window-material.ts",
), "utf8");
const windowManagerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/main/window-manager/index.ts",
), "utf8");
const musicBarComponentSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicBar/index.tsx",
), "utf8");
const musicBarStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicBar/index.scss",
), "utf8");
const musicBarSliderStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicBar/widgets/Slider/index.scss",
), "utf8");
const musicBarSliderComponentSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicBar/widgets/Slider/index.tsx",
), "utf8");
const recommendSheetsViewSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/views/recommend-sheets-view/index.tsx",
), "utf8");
const liquidGlassSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicBar/LiquidGlassFilter.tsx",
), "utf8");
const controllerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicBar/widgets/Controller/index.tsx",
), "utf8");
const defaultThemeSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/themepack/default-theme.ts",
), "utf8");

function extractStyleBlocks(source, selectorPattern) {
    const blocks = [];
    const re = new RegExp(selectorPattern + "\\s*\\{", "g");
    let match = re.exec(source);
    while (match) {
        let depth = 1;
        let index = match.index + match[0].length;
        while (index < source.length && depth > 0) {
            const character = source[index];
            if (character === "{") {
                depth += 1;
            } else if (character === "}") {
                depth -= 1;
            }
            index += 1;
        }
        blocks.push(source.slice(match.index, index));
        match = re.exec(source);
    }
    return blocks;
}

function createSolidImageData(red, green, blue, count = 64) {
    const data = new Uint8ClampedArray(count * 4);
    for (let index = 0; index < count; index += 1) {
        data.set([red, green, blue, 255], index * 4);
    }
    return data;
}

function parseRgbColor(value) {
    const match = value.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
    assert.ok(match, `Expected RGB color, received: ${value}`);
    return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
    };
}

function readDefaultThemeCss(exportName) {
    const match = defaultThemeSource.match(new RegExp(
        "export const " + exportName + " = \`([\\s\\S]*?)\`;",
    ));
    assert.ok(match, "Missing " + exportName);
    return match[1];
}

assert.equal(matchesThemeSearch({}, ""), true);
assert.equal(matchesThemeSearch({
    name: "Midnight Blue",
    author: "Baka Team",
}, "midnight baka"), true);
assert.equal(matchesThemeSearch({
    description: "柔和的浅色主题",
}, "浅色"), true);
assert.equal(matchesThemeSearch({ name: "Aurora" }, "store-slug", ["store-slug"]), true);
assert.equal(matchesThemeSearch({ name: "Aurora" }, "missing"), false);

const themeViewSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/views/theme-view/index.tsx",
), "utf8");
const localThemesSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/views/theme-view/components/LocalThemes/index.tsx",
), "utf8");
const remoteThemesSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/views/theme-view/components/RemoteThemes/index.tsx",
), "utf8");
assert.match(themeViewSource, /className="theme-view-search"/);
assert.match(themeViewSource, /<LocalThemes searchText=\{searchText\}/);
assert.match(themeViewSource, /<RemoteThemes searchText=\{searchText\}/);
assert.match(localThemesSource, /matchesThemeSearch\(it, normalizedSearch\)/);
assert.match(remoteThemesSource, /matchesThemeSearch\(\s*theme\.config,\s*normalizedSearch,/);

assert.equal(THEME_SPEC_V2, "bakamusic-theme@2");
assert.match(defaultThemeSource, /scheme:\s*"system"/);
assert.match(defaultThemeSource, /BUILTIN_DEFAULT_THEME_HASH = "builtin-default-v2"/);
const builtinDefaultLightThemeCss = readDefaultThemeCss(
    "BUILTIN_DEFAULT_LIGHT_THEME_CSS",
);
const builtinDefaultDarkThemeCss = readDefaultThemeCss(
    "BUILTIN_DEFAULT_DARK_THEME_CSS",
);
assert.equal(
    parseThemeCss(builtinDefaultLightThemeCss).tokens.get("--theme-scheme"),
    "light",
);
assert.equal(
    parseThemeCss(builtinDefaultDarkThemeCss).tokens.get("--theme-scheme"),
    "dark",
);
assert.equal(
    parseThemeCss(builtinDefaultDarkThemeCss).tokens.get("--theme-bg"),
    "#111318",
);
assert.match(themeRuntimeSource, /matchMedia\(darkSchemeMediaQuery\)/);
assert.match(themeRuntimeSource, /addEventListener\("change", systemThemeChangeListener\)/);
assert.match(themeRuntimeSource, /removeEventListener\("change", systemThemeChangeListener\)/);
assert.match(themeRuntimeSource, /data-theme-source/);
assert.match(themeRuntimeSource, /bridge\.setWindowMaterial\(allowAcrylic,\s*scheme\)/);
assert.match(themeRuntimeSource, /prefers-reduced-transparency:\s*reduce/);
assert.match(themeRuntimeSource, /reducedTransparencyQuery\.addEventListener/);
// The builtin default theme ships as one adaptive stylesheet, so the runtime
// must not branch between separate light/dark constants any more.
assert.doesNotMatch(
    themeRuntimeSource,
    /BUILTIN_DEFAULT_(DARK|LIGHT)_THEME_CSS/,
    "renderer runtime must use the unified adaptive builtin CSS",
);
assert.match(
    themeRuntimeSource,
    /themePack\.scheme === "system" && darkTokens/,
    "installed system themes must follow the OS scheme only with a dark block",
);
assert.match(themeRuntimeSource, /followSystemTheme\(applyCurrentTheme\)/);
// applyTheme must parse the theme CSS once and reapply it on scheme change.
assert.match(
    themeRuntimeSource,
    /const contents = await bridge\.readThemeContents\(themePack\.path\);\s*const \{ darkTokens \} = parseThemeCss\(contents\.rawCss\);/,
);
assert.equal(
    (themeRuntimeSource.match(/parseThemeCss\(contents\.rawCss\)/g) ?? []).length,
    1,
    "applyTheme must not parse the theme CSS twice",
);

// Adaptive theme shape: base light block plus a dark prefers-color-scheme block.
const adaptiveSample = parseThemeCss(`
    :root {
        --theme-primary: #5ee2d4;
        --theme-bg: #f5f7fa;
        --theme-text: #111;
        --theme-scheme: light;
    }
    @media (prefers-color-scheme: dark) {
        :root {
            --theme-primary: #5ee2d4;
            --theme-bg: #111318;
            --theme-text: #e8eaed;
            --theme-scheme: dark;
        }
    }
`);
assert.equal(adaptiveSample.tokens.get("--theme-scheme"), "light");
assert.equal(adaptiveSample.darkTokens?.get("--theme-scheme"), "dark");
assert.equal(adaptiveSample.darkTokens?.get("--theme-bg"), "#111318");
assert.match(
    adaptiveSample.css,
    /@media \(prefers-color-scheme: dark\)\s*\{\s*html\[data-theme-spec="2"\]/,
);
const adaptiveCssBaseBlock = adaptiveSample.css.slice(
    0,
    adaptiveSample.css.indexOf("@media"),
);
assert.doesNotMatch(
    adaptiveCssBaseBlock,
    /--theme-bg:\s*#111318/,
    "dark values must stay inside the dark media block",
);
// Error combos: wrong scheme polarity in either block must be rejected.
assert.throws(() => parseThemeCss(`
    :root {
        --theme-primary: red;
        --theme-bg: #fff;
        --theme-text: #000;
        --theme-scheme: dark;
    }
    @media (prefers-color-scheme: dark) {
        :root {
            --theme-primary: red;
            --theme-bg: #111;
            --theme-text: #eee;
            --theme-scheme: dark;
        }
    }
`), "adaptive base block must be light");
assert.throws(() => parseThemeCss(`
    :root {
        --theme-primary: red;
        --theme-bg: #fff;
        --theme-text: #000;
        --theme-scheme: light;
    }
    @media (prefers-color-scheme: dark) {
        :root {
            --theme-primary: red;
            --theme-bg: #111;
            --theme-text: #eee;
            --theme-scheme: light;
        }
    }
`), "adaptive dark block must be dark");
assert.throws(() => parseThemeCss(`
    :root {
        --theme-primary: red;
        --theme-bg: #fff;
        --theme-text: #000;
        --theme-scheme: light;
    }
    @media (prefers-color-scheme: dark) {
        :root {
            --theme-primary: red;
            --theme-bg: #111;
            --theme-text: #eee;
        }
    }
`), "adaptive dark block must redeclare the scheme token");

// The builtin default theme is composed from the two block constants and must
// parse as an adaptive theme.
assert.match(
    defaultThemeSource,
    /BUILTIN_DEFAULT_THEME_CSS = `\$\{BUILTIN_DEFAULT_LIGHT_THEME_CSS\}\s*@media \(prefers-color-scheme: dark\) \{\s*\$\{BUILTIN_DEFAULT_DARK_THEME_CSS\}\s*\}`;/,
);
const builtinAdaptiveParsed = parseThemeCss(`${builtinDefaultLightThemeCss}
@media (prefers-color-scheme: dark) {
${builtinDefaultDarkThemeCss}
}`);
assert.equal(builtinAdaptiveParsed.tokens.get("--theme-scheme"), "light");
assert.equal(builtinAdaptiveParsed.darkTokens?.get("--theme-scheme"), "dark");

// Background video iframe: client injects runtime rules so window resize and
// maximize keep the source aspect ratio via object-fit.
assert.match(themeRuntimeSource, /themeIframeRuntimeCss/);
assert.match(themeRuntimeSource, /object-fit:\s*cover\s*!important/);
assert.match(themeRuntimeSource, /prepareThemeIframeHtml\(iframeHtml\)/);
assert.match(themeRuntimeSource, /styleNode\.textContent = themeIframeRuntimeCss/);
assert.match(
    themeBridgeSource,
    /@media \(prefers-color-scheme:\s*dark\)[\s\S]*:root:not\(\[data-theme-spec="2"\]\)/,
);
assert.match(
    defaultAcrylicSource,
    /data-theme-source="builtin"\]\[data-ui-style="glass"/,
);
assert.match(
    defaultAcrylicSource,
    /data-theme-source="builtin"\]\[data-ui-style="flat"/,
);
assert.match(defaultAcrylicSource, /backdrop-filter:\s*var\(--appGlassFilter\)/);
assert.match(defaultAcrylicSource, /prefers-reduced-transparency:\s*reduce/);
const glassAcrylicBlocks = extractStyleBlocks(
    defaultAcrylicSource,
    '(?::root|html)\\[data-theme-source="builtin"\\]\\[data-ui-style="glass"\\]',
);
assert.ok(
    glassAcrylicBlocks.length >= 2,
    "default acrylic should define glass token and element blocks",
);
for (const block of glassAcrylicBlocks) {
    // Glass keeps the existing floating dock chrome; only detail-open (shared)
    // and auto-hide clearing may touch the bar, never restyle .music-bar-shell.
    assert.doesNotMatch(block, /\.music-bar-shell/);
}
assert.match(
    defaultAcrylicSource,
    /music-bar-container\[data-auto-hide="true"\]\[data-revealed="false"\][\s\S]*backdrop-filter:\s*none\s*!important/,
);
assert.match(
    defaultAcrylicSource,
    /data-ui-style="flat"[\s\S]*music-bar-container\[data-detail-open="true"\][\s\S]*\.music-bar-overlay[\s\S]*display:\s*none\s*!important/,
);
// Glass must keep dynamic album-color dock chrome on the detail page.
assert.doesNotMatch(
    defaultAcrylicSource,
    /data-ui-style="glass"[\s\S]{0,400}music-bar-container\[data-detail-open="true"\][\s\S]{0,200}display:\s*none\s*!important/,
);
assert.match(
    defaultAcrylicSource,
    /data-window-material="acrylic"[\s\S]*\.app-container[\s\S]*--defaultAcrylicWindowTint/,
);
assert.match(defaultAcrylicSource, /--defaultAcrylicWindowTint/);
assert.match(
    defaultAcrylicSource,
    /data-theme-scheme="dark"\]\[data-ui-style="glass"/,
);
assert.match(
    defaultAcrylicSource,
    /music-list-container\[data-surface-mode="header-only"\][\s\S]*backdrop-filter:\s*none\s*!important/,
);
assert.match(
    defaultAcrylicSource,
    /music-list-container\[data-surface-mode="header-only"\][\s\S]*music-list-virtual-spacer[\s\S]*margin-top:\s*12px\s*!important/,
);
assert.match(
    defaultAcrylicSource,
    /\.music-list-virtual-spacer\s*\{[^}]*backdrop-filter:\s*none\s*!important/,
);
assert.match(
    defaultAcrylicSource,
    /data-theme-source="builtin"[\s\S]*?music-list-glass-layer[\s\S]*?backdrop-filter:\s*var\(--appGlassFilter\)/,
);
assert.match(
    defaultAcrylicSource,
    /data-ui-style="flat"[\s\S]*?\.music-list-glass-layer\s*\{\s*display:\s*none/,
);
assert.match(globalStyleEntrySource, /@use '\.\/default-acrylic\.scss';/);

// Page transition animations must not outlive their enter phase. A
// transform/opacity animation that keeps filling forwards leaves the animated
// element a backdrop root, so every descendant backdrop-filter surface — the
// music list sticky glass layer, the theme cards — samples an empty backdrop
// and loses its frost. Enter animations therefore use `backwards` and are
// scoped to a state that is removed once the animation finishes.
const mainPageStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/index.scss",
), "utf8");
const mainPageComponentSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/index.tsx",
), "utf8");
const themeViewStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/views/theme-view/index.scss",
), "utf8");

for (const [label, styleSource] of [
    ["main route wrapper", mainPageStyleSource],
    ["theme view panel", themeViewStyleSource],
]) {
    for (const block of extractStyleBlocks(styleSource, "@keyframes\\s+[\\w-]+")) {
        assert.doesNotMatch(
            block,
            /backdrop-filter/,
            `${label} keyframes must not animate backdrop-filter`,
        );
        // Over a translucent theme background (video wallpaper) an opacity
        // fade reads as the whole page dimming for the animation's duration,
        // and opacity is also the one animated property that turns the
        // animated element into a backdrop root, blanking descendant
        // backdrop-filter surfaces (music list sticky glass, theme cards).
        // Transform-only enter animations keep brightness and frost stable.
        assert.doesNotMatch(
            block,
            /opacity/,
            `${label} keyframes must not animate opacity: ${block.trim()}`,
        );
    }
    const animationDeclarations = styleSource.match(/animation:[^;]*;/g) ?? [];
    assert.ok(
        animationDeclarations.length > 0,
        `${label} should declare an enter animation`,
    );
    for (const declaration of animationDeclarations) {
        assert.doesNotMatch(
            declaration,
            /\b(both|forwards)\b/,
            `${label} enter animation must not fill forwards: ${declaration.trim()}`,
        );
    }
}

assert.match(
    mainPageStyleSource,
    /\.main-route-view-wrapper\s*\{[\s\S]*?&\[data-route-enter="true"\]\s*\{[^}]*animation:\s*main-route-view-enter/,
    "route enter animation must be gated behind the transient data-route-enter state",
);
assert.match(
    mainPageComponentSource,
    /dataset\.routeEnter\s*=\s*"true"/,
    "route wrapper must mark the enter phase",
);
assert.match(
    mainPageComponentSource,
    /delete\s+wrapper\.dataset\.routeEnter/,
    "route wrapper must clear the enter phase so descendants regain their backdrop",
);
assert.match(
    mainPageComponentSource,
    /addEventListener\("animationend"/,
    "route wrapper must settle on animationend",
);

const readZIndex = (source, pattern, layerName) => {
    const match = source.match(pattern);
    assert.ok(match, `${layerName} must declare an explicit z-index`);
    return Number(match[1]);
};
const modalZIndex = readZIndex(
    modalBaseStyleSource,
    /\.components--modal-base\s*\{[\s\S]*?z-index:\s*(\d+)/,
    "modal",
);
const qualitySelectZIndex = readZIndex(
    qualitySelectStyleSource,
    /\.quality-select-popover-layer\s*\{[\s\S]*?z-index:\s*(\d+)/,
    "quality select popover",
);
const toastZIndex = readZIndex(
    toastStyleSource,
    /\.Toastify__toast-container\s*\{[\s\S]*?--toastify-z-index:\s*(\d+)/,
    "toast container",
);
const contextMenuZIndex = readZIndex(
    contextMenuStyleSource,
    /\.context-menu--single-column-container\s*\{[\s\S]*?z-index:\s*(\d+)/,
    "context menu",
);
assert.ok(toastZIndex > modalZIndex, "toasts must render above modal backdrops");
assert.ok(
    toastZIndex > qualitySelectZIndex,
    "toasts must render above modal-local popovers",
);
assert.ok(
    toastZIndex < contextMenuZIndex,
    "context menus must remain the top interactive overlay",
);
assert.match(windowMaterialSource, /WINDOWS_ACRYLIC_MIN_BUILD\s*=\s*22621/);
assert.match(windowMaterialSource, /ACRYLIC_TINT_DARK/);
assert.match(windowMaterialSource, /getInitialWindowSurfaceOptions/);
assert.match(
    windowMaterialSource,
    /if \(supportsNativeAcrylic\(\)\)[\s\S]*?transparent:\s*false[\s\S]*?backgroundMaterial:\s*"none"/,
    "DWM Acrylic must not use Electron's layered transparent-window path",
);
assert.match(windowManagerSource, /getInitialWindowSurfaceOptions/);
assert.match(musicBarComponentSource, /data-liquid-glass-svg/);
assert.match(musicBarComponentSource, /LiquidGlassFilter/);
assert.match(
    musicBarComponentSource,
    /attributeFilter:\s*\["data-ui-style",\s*"data-theme-scheme"\]/,
);
assert.match(
    musicBarComponentSource,
    /const tone = musicDetailShown \? "dark" : getActiveThemeScheme\(\);/,
    "music detail must use the dark artwork palette while the dock follows the theme",
);
assert.match(
    musicBarStyleSource,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content\s+minmax\(0,\s*1fr\)/,
);
assert.match(musicBarComponentSource, /className="music-bar-controls"/);
assert.match(
    musicBarStyleSource,
    /html\[data-ui-style="glass"\][\s\S]*?\.music-bar-controls\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0\s+18px;[^}]*align-items:\s*center;/,
);
assert.match(
    musicBarStyleSource,
    /html\[data-ui-style="glass"\][\s\S]*?\.music-bar-container\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*auto\s+0\s+0;/,
);
assert.match(
    musicBarStyleSource,
    /html\[data-ui-style="glass"\][\s\S]*?\.music-bar-motion-layer\s*\{[^}]*pointer-events:\s*none;[^}]*\}[\s\S]*?\.music-bar-shell,\s*\.music-bar-hover-zone\s*\{[^}]*pointer-events:\s*auto;/,
    "glass music bar gutters must pass pointer input through to page content",
);
assert.match(
    musicBarStyleSource,
    /html\[data-ui-style="glass"\]\s*\.music-bar-container\[data-auto-hide="true"\]\[data-revealed="true"\]\s*\{[^}]*pointer-events:\s*none;[\s\S]*?\.music-bar-motion-layer\s*\{[^}]*pointer-events:\s*none;[\s\S]*?\.music-bar-shell\s*\{[^}]*pointer-events:\s*auto;/,
    "revealing the glass music bar must not reactivate its viewport-wide hitbox",
);
assert.match(
    musicBarStyleSource,
    /html\[data-ui-style="glass"\][\s\S]*?\.music-bar--slider-container\s*\{[^}]*left:\s*22px;[^}]*right:\s*22px;/,
);
assert.match(
    musicBarSliderStyleSource,
    /html\[data-ui-style="glass"\] \.music-bar--slider-container\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/,
);
assert.match(
    musicBarSliderComponentSource,
    /className="timeline-time timeline-time-summary"[\s\S]*?\{currentTimeText\}[\s\S]*?<span>\/<\/span>[\s\S]*?\{durationText\}/,
);
assert.match(
    musicBarSliderStyleSource,
    /html\[data-ui-style="glass"\] \.music-bar--slider-container\s*\{[\s\S]*?& \.timeline-track\s*\{[^}]*position:\s*absolute;[^}]*top:\s*-2px;[^}]*left:\s*0;[^}]*right:\s*0;/,
);

const stableBluePixels = createSolidImageData(45, 105, 165, 1024);
const stableBluePalettes = buildMusicBarPalette(stableBluePixels, 32, 32);
const outlierPixels = stableBluePixels.slice();
outlierPixels.set([255, 0, 180, 255], 0);
assert.deepEqual(
    buildMusicBarPalette(outlierPixels, 32, 32),
    stableBluePalettes,
    "a single saturated pixel must not destabilize the artwork palette",
);

const paletteBackdrops = {
    light: { r: 247, g: 249, b: 252 },
    dark: { r: 13, g: 16, b: 23 },
};
for (const palettes of [
    stableBluePalettes,
    buildMusicBarPalette(createSolidImageData(225, 215, 185), 8, 8),
]) {
    assert.ok(palettes);
    for (const tone of ["light", "dark"]) {
        const palette = palettes[tone];
        const surface = parseRgbColor(palette["--musicBarSurface"]);
        const surfaceAlt = parseRgbColor(palette["--musicBarSurfaceAlt"]);
        const accent = parseRgbColor(palette["--musicBarAccent"]);
        const text = parseRgbColor(palette["--musicBarText"]);
        const primaryText = parseRgbColor(palette["--musicBarPrimaryText"]);
        const effectiveSurfaces = [surface, surfaceAlt].map((color) => compositeRgb(
            color,
            paletteBackdrops[tone],
            MUSIC_BAR_GLASS_TINT_ALPHA,
        ));

        for (const effectiveSurface of effectiveSurfaces) {
            assert.ok(getContrastRatio(text, effectiveSurface) >= 4.5);
            assert.ok(getContrastRatio(accent, effectiveSurface) >= 3);
        }
        assert.ok(getContrastRatio(primaryText, accent) >= 4.5);
    }
}

const grayBelowOldThreshold = buildMusicBarPalette(
    createSolidImageData(184, 184, 184),
    8,
    8,
);
const grayAboveOldThreshold = buildMusicBarPalette(
    createSolidImageData(185, 185, 185),
    8,
    8,
);
assert.ok(grayBelowOldThreshold && grayAboveOldThreshold);
for (const tone of ["light", "dark"]) {
    const belowSurface = parseRgbColor(
        grayBelowOldThreshold[tone]["--musicBarSurface"],
    );
    const aboveSurface = parseRgbColor(
        grayAboveOldThreshold[tone]["--musicBarSurface"],
    );
    assert.ok(
        Math.abs(
            getRelativeLuminance(belowSurface)
            - getRelativeLuminance(aboveSurface),
        ) < 0.02,
        "adjacent artwork tones must not flip the music bar surface polarity",
    );
}
assert.ok(
    getRelativeLuminance(parseRgbColor(
        grayBelowOldThreshold.light["--musicBarSurface"],
    )) > getRelativeLuminance(parseRgbColor(
        grayBelowOldThreshold.dark["--musicBarSurface"],
    )),
    "artwork extraction must always provide distinct light and dark surfaces",
);

const transparentPixels = createSolidImageData(20, 20, 20, 16);
for (let index = 3; index < transparentPixels.length; index += 4) {
    transparentPixels[index] = 0;
}
assert.equal(buildMusicBarPalette(transparentPixels, 4, 4), null);

assert.doesNotMatch(
    musicBarStyleSource,
    /\.music-bar-container,\s*\.music-bar-container\[data-detail-open="true"\]/,
);
assert.match(musicBarStyleSource, /--liquidGlassEdgeWidth:\s*0\.5px/);
assert.doesNotMatch(
    musicBarStyleSource,
    /border:\s*1px\s+solid\s+var\(--liquidGlassBorder\)/,
);
assert.match(
    recommendSheetsViewSource,
    /className="page-container recommend-sheets-view--container"/,
);
assert.match(
    musicBarStyleSource,
    /\.recommend-sheets-view--container \.music-sheet-like-list--container::after/,
);
assert.match(
    musicBarStyleSource,
    /\.plugin-manager-view-container \.plugin-manager-content::after/,
);
assert.match(liquidGlassSource, /ResizeObserver/);
assert.match(liquidGlassSource, /feDisplacementMap/);
assert.match(controllerSource, /liquid-controller-primary/);
assert.match(themeMainSource, /from "\.\/window-material"/);
assert.match(themeMainSource, /setBackgroundMaterial\(enabled \? "acrylic" : "none"\)/);
assert.match(themeMainSource, /stream:\s*true/);
assert.match(themeMainSource, /resolveLocalMediaByteRange/);
assert.match(themeMainSource, /Content-Range/);
assert.match(themeMainSource, /"\.mp4":\s*"video\/mp4"/);
assert.match(themeMainSource, /Access-Control-Allow-Origin/);
assert.deepEqual(CLIENT_OWNED_COMPATIBILITY_TOKENS, [
    "--theme-detail-bg",
    "--theme-detail-overlay",
    "--theme-detail-text",
    "--theme-detail-text-secondary",
    "--theme-detail-surface",
    "--theme-detail-surface-hover",
    "--theme-detail-border",
    "--theme-detail-accent",
]);

const valid = parseThemeCss(`
    /* comments are discarded */
    :root {
        --theme-primary: #5ee2d4;
        --theme-bg: rgba(94, 226, 212, 0.12);
        --theme-text: #111;
        --theme-scheme: light;
        --theme-header-bg: var(--theme-bg);
        --theme-bg-image: url("@/imgs/bg.jpg");
    }
`);
assert.equal(valid.tokens.get("--theme-header-bg"), "var(--theme-bg)");
assert.match(valid.css, /^html\[data-theme-spec="2"\]/);

// Detail tokens remain parser-compatible for installed early V2.1 packs, but
// the client must not consume them anywhere in detail or immersive UI styles.
assert.doesNotThrow(() => parseThemeCss(`
    :root {
        --theme-primary: #5ee2d4;
        --theme-bg: #111;
        --theme-text: #fff;
        --theme-scheme: dark;
        --theme-detail-surface: red;
        --theme-detail-accent: lime;
    }
`));
const clientOwnedDetailStyleFiles = [
    "src/renderer/components/MusicDetail/index.scss",
    "src/renderer/components/MusicDetail/widgets/Lyric/index.scss",
    "src/renderer/components/MusicBar/widgets/MusicInfo/index.scss",
    "src/renderer/components/MusicBar/widgets/Extra/index.scss",
    "src/renderer/document/styles/ui-style-flat.scss",
    "src/renderer/document/styles/theme-bridge.scss",
];
for (const relativePath of clientOwnedDetailStyleFiles) {
    const stylesheet = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    assert.doesNotMatch(stylesheet, /var\(--theme-detail-/);
}
const musicDetailStyles = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicDetail/index.scss",
), "utf8");
// 保留挂载的详情覆盖层在隐藏/退出时必须撤回自身与所有子元素的拖拽区域：
// Electron 拖拽命中测试忽略 pointer-events/inert，否则关闭后底层控件仍点不动。
assert.match(
    musicDetailStyles,
    /&\[inert\]\s*\{[^{}]*-webkit-app-region:\s*no-drag\s*!important;\s*&,\s*&\s*\*\s*\{\s*-webkit-app-region:\s*no-drag\s*!important;/,
);

const flatUiStyles = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/document/styles/ui-style-flat.scss",
), "utf8");
const musicBarSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicBar/index.tsx",
), "utf8");
const musicBarStyles = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicBar/index.scss",
), "utf8");
assert.match(
    musicBarSource,
    /className="music-bar-motion-layer">\s*<div className="music-bar-overlay"><\/div>\s*<div ref=\{shellRef\} className="music-bar-shell">/s,
);
assert.match(musicBarStyles, /\.music-bar-hover-zone\s*\{[^}]*height:\s*52px;/s);
assert.match(
    musicBarStyles,
    /\[data-revealed="false"\][\s\S]*?\.music-bar-motion-layer\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translate3d\(0, 12px, 0\);/s,
);
assert.match(musicBarStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
assert.match(
    flatUiStyles,
    /\.music-sheetlike-view--container,\s*\.music-sheetlike-view--body-container\s*\{[^}]*box-shadow:\s*none\s*!important;/s,
);
assert.doesNotMatch(flatUiStyles, /\.music-sheetlike-view--header\s*,/);
assert.match(
    flatUiStyles,
    /\.music-sheetlike-view--body-container \.operations\s*\{[^}]*border-radius:\s*var\(--cardRadius\)\s*!important;/s,
);
assert.match(
    flatUiStyles,
    /\.statistics-track-row\s*\{[^}]*border-radius:\s*var\(--listRowRadius\)/s,
);
assert.match(
    flatUiStyles,
    /\.music-bar-controls\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) max-content minmax\(0, 1fr\);/s,
);
assert.match(
    flatUiStyles,
    /\.music-controller \.liquid-controller-edge\s*\{[^}]*color:\s*var\(--flatDockButtonColor\)\s*!important;/s,
);
assert.match(controllerSource, /"--flatDockButtonColor":\s*skipColor/);

const statisticsViewSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/views/statistics-view/index.tsx",
), "utf8");
const statisticsViewStyles = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/views/statistics-view/index.scss",
), "utf8");
assert.match(statisticsViewSource, /className="statistics-track-meta-row"/);
assert.match(statisticsViewSource, /secondsToDuration\(entry\.musicItem\.duration\)/);
assert.match(
    statisticsViewSource,
    /getBestMusicQualityInfo\([\s\S]{0,120}entry\.musicItem[\s\S]{0,120}getLxQualityOverride/,
);
assert.match(statisticsViewSource, /statistics_page\.tracks_unit/);
assert.match(statisticsViewSource, /statistics-summary-value-unit/);
assert.match(
    statisticsViewSource,
    /<Tag fill>\s*\{entry\.musicItem\.platform\}\s*<\/Tag>/s,
);
assert.match(statisticsViewSource, /iconName=\{isCurrent \? "pause" : "play"\}/);
assert.doesNotMatch(statisticsViewSource, /speaker-wave/);
assert.match(
    statisticsViewSource,
    /\{String\(index \+ 1\)\.padStart\(2, "0"\)\}/,
);
assert.match(
    statisticsViewSource,
    /className="statistics-section-title-row">\s*<h2>[^<]+<\/h2>\s*<span className="statistics-section-count">\s*\{visibleEntries\.length\}/s,
);
assert.doesNotMatch(statisticsViewSource, /statistics_page\.track_count/);
assert.match(statisticsViewStyles, /--statisticsSmallTextSize:\s*0\.76rem/);
assert.match(
    statisticsViewStyles,
    /\.statistics-summary-copy\s*\{[\s\S]*?& > span\s*\{[^}]*font-size:\s*0\.82rem/s,
);
assert.match(statisticsViewStyles, /\.statistics-summary-value-unit\s*\{[\s\S]*font-size:\s*0\.78em/s);
assert.match(
    statisticsViewStyles,
    /\.statistics-track-last-played\s*\{\s*& strong\s*\{[^}]*font-size:\s*0\.82rem/s,
);
const undersizedStatisticsFonts = [...statisticsViewStyles.matchAll(/font-size:\s*([\d.]+)rem/g)]
    .map((match) => Number(match[1]))
    .filter((size) => size < 0.76);
assert.deepEqual(undersizedStatisticsFonts, []);

const sideBarSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/components/SideBar/index.tsx",
), "utf8");
const mySheetsSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/components/SideBar/widgets/MySheets/index.tsx",
), "utf8");
assert.match(
    sideBarSource,
    /title: t\("side_bar\.library"\),\s*action: \{[\s\S]*?iconName: "identification",[\s\S]*?showModal\("PlayMusicById"/,
);
assert.match(
    sideBarSource,
    /supportedMethod\.includes\("getMusicInfo"\)[\s\S]*?supportedMethod\.includes\("getMediaSource"\)/,
);
assert.doesNotMatch(mySheetsSource, /PlayMusicById|iconName="identification"/);

const pluginInputPanelSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/Modal/templates/PluginInputPanel/index.tsx",
), "utf8");
const playMusicByIdSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/Modal/templates/PlayMusicById/index.tsx",
), "utf8");
const importMusicSheetSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/Modal/templates/ImportMusicSheet/index.tsx",
), "utf8");
assert.match(pluginInputPanelSource, /resolveInitialPluginHash/);
assert.match(pluginInputPanelSource, /initialPluginHash/);
assert.match(pluginInputPanelSource, /onSelectedPluginChange/);
assert.match(pluginInputPanelSource, /plugin\.hints\?\.\[hintMethod\] \?\? \[\]/);
assert.match(pluginInputPanelSource, /className="plugin-input-plugin-rail"/);
assert.match(pluginInputPanelSource, /className="plugin-input-field"/);
assert.match(pluginInputPanelSource, /className="plugin-input-hints"/);
assert.doesNotMatch(pluginInputPanelSource, /plugin-input-intro/);
assert.match(playMusicByIdSource, /<PluginInputPanel/);
assert.match(playMusicByIdSource, /hintMethod="getMusicInfo"/);
assert.match(playMusicByIdSource, /playMusicByPluginId\(plugin, id\)/);
assert.match(playMusicByIdSource, /playByIdPluginHash/);
assert.match(playMusicByIdSource, /initialPluginHash=\{rememberedPluginHash\}/);
assert.match(playMusicByIdSource, /onSelectedPluginChange=\{rememberPlayByIdPlugin\}/);
assert.doesNotMatch(playMusicByIdSource, /SimpleInputWithState|showModal/);
assert.match(importMusicSheetSource, /<PluginInputPanel/);
assert.match(importMusicSheetSource, /hintMethod="importMusicSheet"/);
assert.match(importMusicSheetSource, /importMusicSheetPluginHash/);
assert.match(importMusicSheetSource, /initialPluginHash=\{rememberedPluginHash\}/);
assert.match(importMusicSheetSource, /onSelectedPluginChange=\{rememberImportMusicSheetPlugin\}/);
assert.doesNotMatch(importMusicSheetSource, /SimpleInputWithState/);
assert.match(importMusicSheetSource, /normalizeImportedMusicSheet/);
assert.match(importMusicSheetSource, /className="import-music-sheet-result-card"/);
assert.match(
    importMusicSheetSource,
    /className="import-music-sheet-result-artwork"[\s\S]*?root=\{null\}/,
    "import result artwork must observe the viewport outside #page-container",
);
assert.match(importMusicSheetSource, /navigate\(\s*`\/main\/musicsheet\//);
assert.doesNotMatch(importMusicSheetSource, /showModal\("AddMusicToSheet"/);
assert.equal(fs.existsSync(path.join(
    __dirname,
    "../src/renderer/components/Modal/templates/plugin-picker.scss",
)), false);

const identifierBase = createMusicIdentifierBase("QQ音乐[L2]", " 003Y82u91ZIDmO ");
assert.deepEqual(identifierBase, {
    platform: "QQ音乐[L2]",
    id: "003Y82u91ZIDmO",
    songid: "003Y82u91ZIDmO",
    songmid: "003Y82u91ZIDmO",
    mid: "003Y82u91ZIDmO",
    hash: "003Y82u91ZIDmO",
    copyrightId: "003Y82u91ZIDmO",
});
const boundIdentifier = bindMediaToPlugin(identifierBase, {
    platform: "QQ音乐[L2]",
    hash: "PLUGIN_HASH",
});
assert.deepEqual(getMediaPluginDelegate(boundIdentifier), {
    platform: "QQ音乐[L2]",
    hash: "PLUGIN_HASH",
});

// Prefer plugin canonical id; retain user-entered mid/hash aliases for getMediaSource.
assert.equal(
    resolveMusicItemId("003Y82u91ZIDmO", { id: "123456" }),
    "123456",
);
assert.equal(resolveMusicItemId("003Y82u91ZIDmO", { id: "  " }), "003Y82u91ZIDmO");
assert.equal(resolveMusicItemId("003Y82u91ZIDmO", null), "003Y82u91ZIDmO");

const resolvedWithInfo = buildPlayByIdMusicItem("QQ音乐[L2]", "003Y82u91ZIDmO", {
    id: "123456",
    title: "Demo Song",
    artist: "Demo Artist",
    songmid: "003Y82u91ZIDmO",
});
assert.equal(resolvedWithInfo.id, "123456");
assert.equal(resolvedWithInfo.songmid, "003Y82u91ZIDmO");
assert.equal(resolvedWithInfo.mid, "003Y82u91ZIDmO");
assert.equal(resolvedWithInfo.title, "Demo Song");
assert.equal(resolvedWithInfo.artist, "Demo Artist");
assert.equal(resolvedWithInfo.platform, "QQ音乐[L2]");

// Bare-id fallback when getMusicInfo is missing.
const bareItem = buildPlayByIdMusicItem("酷狗", "ABCDEFHASH", null);
assert.equal(bareItem.id, "ABCDEFHASH");
assert.equal(bareItem.hash, "ABCDEFHASH");
assert.equal(bareItem.title, "ABCDEFHASH");
assert.equal(bareItem.artist, "");

assert.equal(
    matchesMusicIdentifier(
        { platform: "QQ音乐[L2]", id: "123456", songmid: "003Y82u91ZIDmO" },
        "QQ音乐[L2]",
        "003Y82u91ZIDmO",
    ),
    true,
);
assert.equal(
    matchesMusicIdentifier(
        { platform: "QQ音乐[L2]", id: "123456" },
        "网易云",
        "123456",
    ),
    false,
);

const trackPlayerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/core/track-player/index.ts",
), "utf8");
assert.match(trackPlayerSource, /buildPlayByIdMusicItem/);
assert.match(trackPlayerSource, /matchesMusicIdentifier/);
assert.match(trackPlayerSource, /falling back to bare id/);

const bootstrapSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/document/bootstrap.ts",
), "utf8");
assert.match(
    bootstrapSource,
    /PlayMusicById[\s\S]*?playMusicById\([\s\S]*?\.then\([\s\S]*?play_by_id_success[\s\S]*?\.catch\([\s\S]*?play_by_id_failed/,
);

const searchHistoryStyles = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/Header/widgets/SearchHistory/index.scss",
), "utf8");
assert.doesNotMatch(searchHistoryStyles, /--searchHistoryBg:\s*var\(--theme-popover-bg\)/);

const desktopLyricView = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer-lrc/pages/index.tsx",
), "utf8");
const desktopLyricStyles = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer-lrc/pages/index.scss",
), "utf8");
assert.match(desktopLyricView, /LINE_TIMED_INACTIVE_OPACITY = 0\.62/);
assert.match(desktopLyricStyles, /line-inactive-opacity, 0\.62/);
assert.match(
    desktopLyricStyles,
    /\[class\*="lyricLineWrapper"\]:has\(\[data-lyric-timing="line"\]\)\s*\{\s*opacity:\s*1\s*!important;/s,
);

const invalidSamples = [
    ":root { --theme-primary: red; } .header-container { display: none; }",
    ":root { --theme-primary: red !important; --theme-bg: #fff; --theme-text: #000; --theme-scheme: light; }",
    ":root { --theme-primary: red; --theme-bg: #fff; --theme-text: #000; --theme-scheme: light; --appSurface: red; }",
    ":root { --theme-primary: red; --theme-bg: #fff; --theme-text: #000; --theme-scheme: light; --theme-card-bg: var(--appSurface); }",
    ":root { --theme-primary: red; --theme-bg: #fff; --theme-text: #000; --theme-scheme: auto; }",
    ":root { --theme-primary: red; --theme-bg: #fff; --theme-text: #000; --theme-scheme: light; --theme-surface-alpha: 1.2; }",
];
for (const sample of invalidSamples) {
    assert.throws(() => parseThemeCss(sample));
}

// The dedicated main-header button token must stay in the contract and keep
// its bridge mapping so window controls can hold contrast independently of
// the page text color.
assert.ok(
    THEME_TOKENS.includes("--theme-main-header-button-text"),
    "main header button text token must stay in the theme contract",
);
assert.match(
    themeBridgeSource,
    /--theme-main-header-button-text:\s*var\(--theme-header-text\)/,
);
assert.match(
    themeBridgeSource,
    /--mainHeaderButtonTextColor:\s*var\(--theme-main-header-button-text\)/,
);
const headerStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/Header/index.scss",
), "utf8");
assert.match(
    headerStyleSource,
    /color:\s*var\(--mainHeaderButtonTextColor,\s*var\(--headerTextColor,\s*var\(--textColor\)\)\)/,
);

// The marketplace publisher appends these fields to config.json. They must be
// readable after download even though authors do not write them in source.
assert.doesNotThrow(() => validateThemePackConfig({
    spec: THEME_SPEC_V2,
    id: "market-theme-id",
    createdAt: "2026-07-14T05:46:43.102Z",
    name: "Published Theme",
    author: "Baka",
    version: "2.1.0",
    preview: "@/imgs/preview.jpg",
    description: "Published config compatibility fixture",
    tags: ["简约"],
    scheme: "light",
}));
assert.throws(() => validateThemePackConfig({
    spec: THEME_SPEC_V2,
    id: "market-theme-id",
    createdAt: "2026-07-14T05:46:43.102Z",
    name: "Published Theme",
    author: "Baka",
    version: "2.1.0",
    preview: "#fff",
    description: "Unknown fields still fail",
    tags: ["简约"],
    scheme: "light",
    unexpected: true,
}));

// scheme: "system" is accepted for adaptive packs; unknown schemes still fail.
assert.doesNotThrow(() => validateThemePackConfig({
    spec: THEME_SPEC_V2,
    id: "market-theme-id",
    createdAt: "2026-07-14T05:46:43.102Z",
    name: "Adaptive Theme",
    author: "Baka",
    version: "2.1.0",
    preview: "#fff",
    description: "System adaptive config fixture",
    tags: ["简约"],
    scheme: "system",
}));
assert.throws(() => validateThemePackConfig({
    spec: THEME_SPEC_V2,
    id: "market-theme-id",
    createdAt: "2026-07-14T05:46:43.102Z",
    name: "Adaptive Theme",
    author: "Baka",
    version: "2.1.0",
    preview: "#fff",
    description: "Unknown scheme must fail",
    tags: ["简约"],
    scheme: "auto",
}));

console.log("theme-contract: all assertions passed");
