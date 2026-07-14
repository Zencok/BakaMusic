const assert = require("node:assert/strict");
const {
    THEME_SPEC_V2,
    parseThemeCss,
    validateThemePackConfig,
} = require("../src/shared/themepack/contract");

assert.equal(THEME_SPEC_V2, "bakamusic-theme@2");

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
