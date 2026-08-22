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
const {
    lyricStartMsToSeekSeconds,
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
assert.equal(lyricStartMsToSeekSeconds(12_500), 12.5);
assert.equal(lyricStartMsToSeekSeconds(-500), 0);
assert.equal(lyricStartMsToSeekSeconds(Number.NaN), null);

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
// Line seek is React-layer only: listen to existing AMLL line-click, no core chrome.
assert.match(lyricPlayerSource, /"line-click"/);
assert.match(lyricPlayerSource, /apple-music-lyric-player--line-seek/);
assert.doesNotMatch(lyricPlayerSource, /setLineClickEnabled/);

const amllDomPlayerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/amll-core/lyric-player/dom/index.ts",
), "utf8");
const amllLyricLineSource = fs.readFileSync(path.join(
    __dirname,
    "../src/amll-core/lyric-player/dom/lyric-line.ts",
), "utf8");
assert.match(amllDomPlayerSource, /calcLayout\(true, true\)/);
assert.doesNotMatch(amllDomPlayerSource, /setLineClickEnabled/);
assert.doesNotMatch(amllDomPlayerSource, /dataset\.clickable/);
// ResizeObserver can report a line while its computed padding/size is transient;
// mask keyframes must never receive NaN dimensions or timeline divisions.
assert.match(amllLyricLineSource, /Number\.isFinite\(padding\)/);
assert.match(amllLyricLineSource, /const timelineDuration = totalFadeDuration > 0/);
assert.match(amllLyricLineSource, /moveOffset !== 0 \? Math\.abs\(duration \/ moveOffset\) : 0/);

const amllScrollSource = fs.readFileSync(path.join(
    __dirname,
    "../src/amll-core/lyric-player/base/scroll.ts",
), "utf8");
// Manual scroll must rAF-coalesce input and keep spring continuous animation.
assert.match(amllScrollSource, /requestAnimationFrame\(flushWheel\)/);
assert.match(amllScrollSource, /requestAnimationFrame\(flushTouchMove\)/);
assert.match(amllScrollSource, /callbacks\.onLayout\(true, false\)/);
assert.match(amllScrollSource, /WHEEL_IDLE_END_MS/);

const amllDomGroupSource = fs.readFileSync(path.join(
    __dirname,
    "../src/amll-core/lyric-player/dom/lyric-group.ts",
), "utf8");
// Off-screen lines unmount but must keep built word DOM for smooth re-entry.
assert.match(amllDomGroupSource, /element\.remove\(\)/);
assert.doesNotMatch(
    amllDomGroupSource.slice(
        amllDomGroupSource.indexOf("hide():"),
        amllDomGroupSource.indexOf("override update"),
    ),
    /teardownContent/,
);

const amllBasePlayerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/amll-core/lyric-player/base/index.ts",
), "utf8");
assert.match(amllBasePlayerSource, /ensureScrollAnimation\(\)/);
assert.match(amllBasePlayerSource, /getIsUserScrolling\(\)/);

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
assert.match(musicListSource, /className="music-list-glass-layer"/);
assert.match(musicListSource, /--musicListGlassHeight/);
assert.match(musicListSource, /--musicListGlassBottomRadius/);
assert.match(
    musicListStyleSource,
    /--musicListGlassHeight:\s*100vh;[\s\S]*\.music-list-glass-layer\s*\{[\s\S]*height:\s*var\(--musicListGlassHeight\);[\s\S]*backdrop-filter:\s*var\(--appGlassFilter\)/,
);
assert.doesNotMatch(
    musicListStyleSource,
    /\[data-scrolling="true"\][\s\S]*backdrop-filter:\s*none\s*!important/,
);
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
assert.match(lyricContextMenuSource, /onLineClick=\{handleLyricLineClick\}/);
assert.match(lyricContextMenuSource, /lyricStartMsToSeekSeconds/);
assert.match(nodeRuntimeMainSource, /@shared\/node-runtime\/overwrite-embedded-lyric/);
assert.match(nodeRuntimeMainSource, /extensions: supportLocalMediaType/);
assert.match(embeddedLyricWriterSource, /bakamusic-lyric-/);
assert.match(embeddedLyricWriterSource, /Embedded lyric verification failed/);
// 歌词写入已从 node-taglib-sharp 迁移到 native TagLib：句柄生命周期与
// 残留 SYLT 清理都在 addon 内完成，JS 侧只保证走 facade 并读回校验。
assert.match(embeddedLyricWriterSource, /from "@\/common\/taglib-native"/);
assert.match(embeddedLyricWriterSource, /writeTags\(filePath, \{\s*lyrics: lyricContent,/);
assert.match(embeddedLyricWriterSource, /readTags\(filePath, \{[^}]*skipCovers: true,/);

// 歌词面板在详情页关闭后仍然挂载（AnimatedDiv keepMounted）：不能直接订阅
// 每 200ms 变化的进度和逐字歌词对象，否则整棵子树全程每秒重渲染 5-10 次。
assert.match(lyricContextMenuSource, /useIsLyricLoading/);
assert.match(lyricContextMenuSource, /useLyricParser/);
assert.match(lyricContextMenuSource, /useProgressMsWhenActive\(active\)/);
assert.doesNotMatch(lyricContextMenuSource, /useProgress\(\)|useLyric\(\)/);
const trackPlayerHooksSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/core/track-player/hooks.ts",
), "utf8");
assert.match(trackPlayerHooksSource, /currentLyricStore\.useSelector/);
assert.match(trackPlayerHooksSource, /active \? Math\.round\(\(progress\.currentTime \?\? 0\) \* 1000\) : 0/);

// MusicList 的 memo 比较器：两边都没有 musicSheet 也要算相等，
// 否则本地音乐/下载/搜索等不传歌单的调用方永远无法命中 memo。
assert.match(
    musicListSource,
    /if \(Boolean\(prev\.musicSheet\) !== Boolean\(curr\.musicSheet\)\) \{/,
);
assert.match(musicListSource, /memoComparedKeys\.every\(\(key\) => prev\[key\] === curr\[key\]\)/);
// 排序键预计算 + 多选集合提到行渲染之外。
assert.match(musicListSource, /key: getSortValue\(item, sortField\),/);
assert.match(musicListSource, /const multiSelectedItems = useMemo\(/);
assert.match(musicListSource, /const selectedItems = isActive \? multiSelectedItems : null;/);
// 调用方必须用稳定引用，否则上面的 memo 依然不会生效。
for (const relativePath of [
    "../src/renderer/pages/main-page/views/local-music-view/views/list/index.tsx",
    "../src/renderer/pages/main-page/views/local-music-view/views/album/index.tsx",
    "../src/renderer/pages/main-page/views/local-music-view/views/artist/index.tsx",
    "../src/renderer/pages/main-page/views/local-music-view/views/folder/index.tsx",
]) {
    const viewSource = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
    assert.match(viewSource, /virtualProps=\{virtualProps\}/, relativePath);
    assert.doesNotMatch(viewSource, /musicList=\{[^}]*\?\? \[\]\}/, relativePath);
}

console.log("runtime-performance: all assertions passed");
