const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    shouldPersistPlaybackProgress,
} = require("../src/renderer/core/track-player/progress-persistence");
const {
    getLyricFrameDelta,
    settlePausedLyricLayout,
    shouldRunLyricAnimation,
} = require("../src/renderer/components/AppleMusicLyricPlayer/animation-state");
const {
    getLyricLineSeekTimeSeconds,
} = require("../src/renderer/components/AppleMusicLyricPlayer/line-seek");
const {
    getDragAutoScrollDelta,
} = require("../src/renderer/components/MusicList/drag-auto-scroll");

assert.equal(shouldPersistPlaybackProgress(-Infinity, 0, false), true);
assert.equal(shouldPersistPlaybackProgress(1_000, 2_000, false), false);
assert.equal(shouldPersistPlaybackProgress(1_000, 4_000, false), true);
assert.equal(shouldPersistPlaybackProgress(1_000, 1_001, true), true);

assert.equal(shouldRunLyricAnimation(true, true, true), true);
assert.equal(shouldRunLyricAnimation(false, true, true), false);
assert.equal(shouldRunLyricAnimation(true, false, true), false);
assert.equal(shouldRunLyricAnimation(true, true, false), false);
assert.equal(getLyricFrameDelta(1_016, 1_000), 16);
assert.equal(getLyricFrameDelta(1_200, 1_000), 200);
assert.equal(getLyricFrameDelta(900, 1_000), 0);
assert.equal(getLyricFrameDelta(Number.NaN, 1_000), 0);
assert.equal(getLyricLineSeekTimeSeconds(12_500), 12.5);
assert.equal(getLyricLineSeekTimeSeconds(-500), 0);
assert.equal(getLyricLineSeekTimeSeconds(Number.NaN), null);

assert.equal(getDragAutoScrollDelta(100, 100, 600), -24);
assert.equal(getDragAutoScrollDelta(350, 100, 600), 0);
assert.equal(getDragAutoScrollDelta(600, 100, 600), 24);
assert.equal(getDragAutoScrollDelta(120, 100, 180), -12);
assert.equal(getDragAutoScrollDelta(Number.NaN, 100, 600), 0);

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
assert.match(lyricPlayerSource, /setLineClickEnabled/);
assert.match(lyricPlayerSource, /"line-click"/);

const amllDomPlayerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/amll-core/lyric-player/dom/index.ts",
), "utf8");
assert.match(amllDomPlayerSource, /calcLayout\(true, true\)/);
assert.match(amllDomPlayerSource, /const hasViewport = this\.measureViewport\(\)/);
assert.match(amllDomPlayerSource, /setLineClickEnabled/);
assert.match(amllDomPlayerSource, /groupEl\.click\(\)/);

const amllBasePlayerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/amll-core/lyric-player/base/index.ts",
), "utf8");
assert.match(amllBasePlayerSource, /scheduleResizeCommit\(\)/);
assert.match(amllBasePlayerSource, /this\.needsInitialViewportLayout \|\| !this\.timelineState\.isPlaying/);
assert.match(amllBasePlayerSource, /Math\.max\(this\.size\[1\] \/ 5, fontSize \* 1\.6\)/);

const amllDomGroupSource = fs.readFileSync(path.join(
    __dirname,
    "../src/amll-core/lyric-player/dom/lyric-group.ts",
), "utf8");
assert.match(amllDomGroupSource, /hasUsableViewport\(\)/);
assert.doesNotMatch(
    amllDomGroupSource.slice(0, amllDomGroupSource.indexOf("get isInSight")),
    /resizeObserver\.observe/,
);

const amllScrollSource = fs.readFileSync(path.join(
    __dirname,
    "../src/amll-core/lyric-player/base/scroll.ts",
), "utf8");
assert.match(amllScrollSource, /requestAnimationFrame\(flushWheel\)/);
assert.match(amllScrollSource, /pendingWheelDelta \+= evt\.deltaY/);

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
assert.match(musicListSource, /document\.addEventListener\("dragover", handleDragOver\)/);
assert.match(musicListSource, /startDragAutoScroll\(e\.clientY\)/);
assert.doesNotMatch(musicListSource, /translateY\(\$\{virtualController\.startTop\}/);
assert.match(
    musicListStyleSource,
    /\.music-list-row-wrapper\s*\{[^}]*position:\s*absolute;[^}]*contain:\s*layout style;/,
);
assert.match(musicListStyleSource, /\[data-scrolling="true"\]/);
assert.doesNotMatch(musicListStyleSource, /will-change:\s*transform/);

const lyricContextMenuSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/MusicDetail/widgets/Lyric/index.tsx",
), "utf8");
const nodeRuntimeMainSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/node-runtime/main.ts",
), "utf8");
const embeddedLyricWriterSource = fs.readFileSync(path.join(
    __dirname,
    "../src/webworkers/embedded-lyric.ts",
), "utf8");
assert.match(lyricContextMenuSource, /overwriteEmbeddedLyric/);
assert.match(lyricContextMenuSource, /await unlinkLyric\(currentMusic\)/);
assert.match(lyricContextMenuSource, /onLineClick=\{seekToLyricLine\}/);
assert.match(nodeRuntimeMainSource, /@shared\/node-runtime\/overwrite-embedded-lyric/);
assert.match(nodeRuntimeMainSource, /extensions: supportLocalMediaType/);
assert.match(embeddedLyricWriterSource, /bakamusic-lyric-/);
assert.match(embeddedLyricWriterSource, /Embedded lyric verification failed/);
assert.match(embeddedLyricWriterSource, /songFile\.dispose\(\)/);
assert.match(embeddedLyricWriterSource, /removeFrames\(Id3v2FrameIdentifiers\.SYLT\)/);

console.log("runtime-performance: all assertions passed");
