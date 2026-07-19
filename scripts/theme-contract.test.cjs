const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    CLIENT_OWNED_COMPATIBILITY_TOKENS,
    THEME_SPEC_V2,
    parseThemeCss,
    validateThemePackConfig,
} = require("../src/shared/themepack/contract");
const {
    matchesThemeSearch,
} = require("../src/renderer/pages/main-page/views/theme-view/theme-search");
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
const windowMaterialSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/themepack/window-material.ts",
), "utf8");
const windowManagerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/main/window-manager/index.ts",
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
assert.match(
    themeRuntimeSource,
    /systemThemeQuery\?\.matches\s*\?\s*BUILTIN_DEFAULT_DARK_THEME_CSS\s*:\s*BUILTIN_DEFAULT_LIGHT_THEME_CSS/,
);
assert.match(
    themeRuntimeSource,
    /const contents = await bridge\.readThemeContents\(themePack\.path\);\s*applyThemeCss[^;]+;\s*stopFollowingSystemTheme\(\)/,
);
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
assert.match(globalStyleEntrySource, /@use '\.\/default-acrylic\.scss';/);
assert.match(windowMaterialSource, /WINDOWS_ACRYLIC_MIN_BUILD\s*=\s*22621/);
assert.match(windowMaterialSource, /ACRYLIC_TINT_DARK/);
assert.match(windowMaterialSource, /getInitialWindowSurfaceOptions/);
assert.match(windowManagerSource, /getInitialWindowSurfaceOptions/);
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
    /className="music-bar-motion-layer">\s*<div className="music-bar-overlay"><\/div>\s*<div className="music-bar-shell">/s,
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
assert.match(statisticsViewSource, /getBestMusicQualityInfo\(entry\.musicItem\)/);
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
assert.match(pluginInputPanelSource, /className="plugin-input-plugin-grid"/);
assert.match(pluginInputPanelSource, /className="plugin-input-field"/);
assert.match(pluginInputPanelSource, /className="plugin-input-hints"/);
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
assert.match(importMusicSheetSource, /!Array\.isArray\(result\) \|\| !result\.length/);
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

console.log("theme-contract: all assertions passed");
