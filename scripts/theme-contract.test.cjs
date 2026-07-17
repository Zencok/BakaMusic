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
