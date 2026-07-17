const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    CLIENT_OWNED_COMPATIBILITY_TOKENS,
    THEME_SPEC_V2,
    parseThemeCss,
    validateThemePackConfig,
} = require("../src/shared/themepack/contract");

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
