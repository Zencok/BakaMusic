const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    shouldPersistPlaybackProgress,
} = require("../src/renderer/core/track-player/progress-persistence");
const {
    settlePausedLyricLayout,
    shouldRunLyricAnimation,
} = require("../src/renderer/components/AppleMusicLyricPlayer/animation-state");

assert.equal(shouldPersistPlaybackProgress(-Infinity, 0, false), true);
assert.equal(shouldPersistPlaybackProgress(1_000, 2_000, false), false);
assert.equal(shouldPersistPlaybackProgress(1_000, 4_000, false), true);
assert.equal(shouldPersistPlaybackProgress(1_000, 1_001, true), true);

assert.equal(shouldRunLyricAnimation(true, true, true), true);
assert.equal(shouldRunLyricAnimation(false, true, true), false);
assert.equal(shouldRunLyricAnimation(true, false, true), false);
assert.equal(shouldRunLyricAnimation(true, true, false), false);

{
    const deltas = [];
    settlePausedLyricLayout((delta) => deltas.push(delta), 3, 16);
    assert.deepEqual(deltas, [16, 16, 16]);
}

const trackPlayerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/core/track-player/index.ts",
), "utf8");
assert.match(trackPlayerSource, /PROGRESS_PERSIST_INTERVAL_MS = 3_000/);
assert.match(trackPlayerSource, /this\.flushProgressPreference\(\)/);
assert.match(trackPlayerSource, /window\.addEventListener\("pagehide", this\.flushProgressPreference\)/);

const lyricPlayerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/AppleMusicLyricPlayer/index.tsx",
), "utf8");
assert.match(lyricPlayerSource, /document\.visibilityState/);
assert.match(lyricPlayerSource, /shouldRunLyricAnimation/);
assert.match(lyricPlayerSource, /settlePausedLyricLayout/);

const amllDomPlayerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/amll-core/lyric-player/dom/index.ts",
), "utf8");
assert.match(amllDomPlayerSource, /calcLayout\(true, true\)/);

const watchLocalDirSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/Modal/templates/WatchLocalDir/index.tsx",
), "utf8");
assert.match(watchLocalDirSource, /await Promise\.all\(\[/);

const searchLyricSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/Modal/templates/SearchLyric/hooks/useSearchLyric.ts",
), "utf8");
assert.match(searchLyricSource, /modal\.search_lyric_result_empty/);
assert.doesNotMatch(searchLyricSource, /modal\.serach_lyric_result_empty/);

const settingsViewSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/pages/main-page/views/setting-view/index.tsx",
), "utf8");
assert.match(settingsViewSource, /root\.scrollTo\(/);
assert.doesNotMatch(settingsViewSource, /target\.scrollIntoView\(/);

const appSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/app.tsx",
), "utf8");
const appStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/app.scss",
), "utf8");
assert.match(appSource, /overflow: "clip"/);
assert.match(appStyleSource, /\.app-container[\s\S]*overflow: clip/);

const virtualListSource = fs.readFileSync(path.join(
    __dirname,
    "../src/hooks/useVirtualList.ts",
), "utf8");
assert.match(virtualListSource, /requestAnimationFrame/);
assert.doesNotMatch(virtualListSource, /lodash\.throttle/);

const musicListSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicList/index.tsx",
), "utf8");
const musicListStyleSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicList/index.scss",
), "utf8");
assert.match(musicListSource, /top:\s*virtualItem\.top/);
assert.match(musicListSource, /container\.dataset\.scrolling = "true"/);
assert.doesNotMatch(musicListSource, /translateY\(\$\{virtualController\.startTop\}/);
assert.match(
    musicListStyleSource,
    /\.music-list-row-wrapper\s*\{[^}]*position:\s*absolute;[^}]*contain:\s*layout style;/,
);
assert.match(musicListStyleSource, /\[data-scrolling="true"\]/);
assert.doesNotMatch(musicListStyleSource, /will-change:\s*transform/);

console.log("runtime-performance: all assertions passed");
