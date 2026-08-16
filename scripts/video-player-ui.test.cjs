const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const musicList = read("src/renderer/components/MusicList/index.tsx");
assert.match(musicList, /music_list_context_menu\.play_mv/);
assert.match(musicList, /showModal\("MvPlayer", \{ musicItem \}\)/);
assert.match(musicList, /canPlayMusicVideo\(musicItem\)/);

const badge = read("src/renderer/components/MusicVideoBadge/index.tsx");
assert.match(badge, /canPlayMusicVideo\(musicItem\)/);
assert.match(badge, /showModal\("MvPlayer", \{ musicItem \}\)/);

const player = read("src/renderer/components/Modal/templates/MvPlayer/index.tsx");
assert.match(player, /"getMvSource"/);
assert.match(player, /nativePlayback\.openVideo/);
assert.match(player, /nativePlayback\.prepareVideoOverlay\(sessionId\)/);
assert.match(player, /normalizeVideoUpstreamUrl\(source\.url\)/);
assert.match(player, /source\.backupUrls\?\.map\(normalizeVideoUpstreamUrl\)/);
assert.match(player, /nativePlayback\.updateVideoSources/);
assert.match(player, /nativePlayback\.selectVideoSource/);
assert.match(player, /nativePlayback\.videoCommand/);
assert.match(player, /nativePlayback\.updateVideoSurface/);
assert.match(player, /VIDEO_SPEED_PRESETS/);
assert.match(player, /VIDEO_SPEED_PRESETS = \[2, 1\.5, 1\.25, 1, 0\.75, 0\.5\]/);
assert.match(player, /mv-player-speed-trigger[\s\S]*?iconName="mv-speed"/);
assert.match(player, /mv-player-speed-trigger[\s\S]*?mv-player-download-picker/);
assert.match(player, /mv_player\.playback_speed/);
assert.match(player, /operation: "speed"/);
assert.match(player, /nativePlayback\.closeVideo/);
assert.match(player, /nativePlayback\.onVideoEvent/);
assert.match(player, /trackPlayer\.suspendForVideo/);
assert.match(player, /trackPlayer\.restoreAfterVideo/);
assert.match(player, /dolby\[\\s_-\]\*vision/);
assert.match(player, /dynamicRange === "dolby-vision"/);
assert.match(player, /function getVideoSourceFingerprint/);
assert.match(player, /function getActualQuality/);
assert.match(player, /source\.actualKey/);
assert.match(player, /item\.sourceFingerprint === source\.sourceFingerprint/);
assert.match(player, /dedupeSources\(candidates, initialSource\.key\)/);
assert.match(player, /const surfaceVisible = nativeOpened && nativeFrameReady && !error/);
assert.match(player, /snapshot\.currentTime > 0/);
assert.match(player, /!nativeFrameReady \|\| !nativeSurfaceRevealed/);
assert.match(player, /setNativeSurfaceRevealed\(true\)/);
assert.match(player, /data-native-surface-visible=\{surfaceVisible/);
assert.match(player, /root\.dataset\.nativeVideoOverlay = "true"/);
assert.match(player, /const \[closing, setClosing\] = useState\(false\)/);
assert.match(player, /waitForOpacityTransition\(closeCurtainRef\.current/);
assert.match(player, /setCloseCovered\(true\)[\s\S]*?nativePlayback\.closeVideo/);
assert.match(player, /setExiting\(true\)/);
assert.match(player, /await waitForRendererPaint\(\)/);
assert.match(player, /visible: false/);
assert.match(player, /<Base animated=\{false\} withBlur=\{false\} onRequestClose=\{requestClose\}>/);
assert.doesNotMatch(player, /native_active/);
assert.doesNotMatch(player, /<kbd>SPACE<\/kbd>/);
assert.doesNotMatch(player, /surfaceVisible = nativeOpened\s*&& playing/);
assert.doesNotMatch(player, /<video/);
assert.doesNotMatch(player, /HTMLVideoElement/);
assert.doesNotMatch(player, /hls\.js|\bHls\b/);
assert.doesNotMatch(player, /videoProxy/);
assert.match(player, /startMusicVideoDownload/);
assert.match(player, /mv-player-download-picker/);

const nativeMain = read("src/shared/native-playback/main.ts");
assert.match(nativeMain, /@shared\/native-playback\/open-video/);
assert.match(nativeMain, /@shared\/native-playback\/prepare-video-overlay/);
assert.match(nativeMain, /setBackgroundMaterial\("none"\)/);
assert.match(nativeMain, /normalizeVideoUpstreamUrl\(value\.url\)/);
assert.match(nativeMain, /@shared\/native-playback\/update-video-sources/);
assert.match(nativeMain, /@shared\/native-playback\/close-video/);
assert.match(nativeMain, /@shared\/native-playback\/video-command/);
assert.match(nativeMain, /@shared\/native-playback\/update-video-surface/);
assert.match(nativeMain, /getNativeWindowHandle\(\)/);
assert.match(nativeMain, /new BaseWindow\(/);
assert.match(nativeMain, /WS_POPUP/);
assert.match(nativeMain, /initiallyVisible/);
assert.match(nativeMain, /private videoWindowPriming = false/);
assert.match(nativeMain, /this\.videoWindowPriming = true;[\s\S]*?this\.syncVideoWindowBounds\(\)/);
assert.match(nativeMain, /optional SWP_SHOWWINDOW/);
assert.match(nativeMain, /screen\.dipToScreenRect/);
assert.doesNotMatch(nativeMain, /0x40000000 \/\/ WS_CHILD/);
assert.match(nativeMain, /BAKAMUSIC_MPV_WID/);
assert.match(nativeMain, /frame: false/);
assert.match(nativeMain, /setIgnoreMouseEvents\(true/);
assert.doesNotMatch(nativeMain, /Menu\.buildFromTemplate/);
assert.match(nativeMain, /switchVideoSource/);
assert.match(nativeMain, /videoSpeed/);
assert.match(nativeMain, /operation: "speed"/);
assert.match(nativeMain, /window\.hide\(\);[\s\S]*?window\.destroy\(\);/);

const baseModal = read("src/renderer/components/Modal/templates/Base/index.tsx");
assert.match(baseModal, /onRequestClose\?:/);
assert.match(baseModal, /if \(onRequestClose\)/);

const videoUrl = read("src/common/video-url.ts");
assert.match(videoUrl, /parsed\.protocol === "https:"/);
assert.match(videoUrl, /fsmvpc\(\?:\\\.tx\)\?\\\.kugou\\\.com/);
assert.match(videoUrl, /parsed\.protocol = "http:"/);

const nativeHost = read("src/shared/native-playback/utility/native-playback-host.ts");
assert.match(nativeHost, /videoWindowId/);
assert.match(nativeHost, /\["vo", "gpu-next"\]/);
assert.match(nativeHost, /\["hwdec", "auto-safe"\]/);
assert.match(nativeHost, /\["target-colorspace-hint", "yes"\]/);
assert.match(nativeHost, /\["gpu-api", "d3d11"\]/);
assert.match(nativeHost, /\["osc", "no"\]/);

const nativePreload = read("src/shared/native-playback/preload.ts");
assert.match(nativePreload, /openVideo/);
assert.match(nativePreload, /prepareVideoOverlay/);
assert.match(nativePreload, /updateVideoSources/);
assert.match(nativePreload, /selectVideoSource/);
assert.match(nativePreload, /videoCommand/);
assert.match(nativePreload, /updateVideoSurface/);
assert.match(nativePreload, /closeVideo/);
assert.match(nativePreload, /onVideoEvent/);

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.dependencies?.["hls.js"], undefined);
assert.equal(packageJson.devDependencies?.["hls.js"], undefined);
assert.equal(fs.existsSync(path.join(root, "src/shared/video-proxy/main.ts")), false);
assert.equal(fs.existsSync(path.join(root, "src/renderer/utils/download-music-video.ts")), true);

const playerStyles = read("src/renderer/components/Modal/templates/MvPlayer/index.scss");
assert.match(playerStyles, /modal--mv-player/);
assert.match(playerStyles, /mv-player-native-surface/);
assert.match(playerStyles, /mv-player-speed-menu/);
assert.match(playerStyles, /\.mv-player-speed-menu[\s\S]*?right:\s*auto;[\s\S]*?left:\s*0;/);
assert.match(playerStyles, /mv-player-download-menu/);
assert.match(playerStyles, /\.mv-player-quality-menu[\s\S]*?scrollbar-width:\s*thin/);
assert.match(playerStyles, /\.mv-player-quality-menu[\s\S]*?::-webkit-scrollbar-thumb:hover/);
assert.match(playerStyles, /prefers-reduced-motion/);
assert.match(playerStyles, /data-native-video-overlay="true"/);
assert.match(playerStyles, /\.mv-player-close-curtain/);
assert.match(playerStyles, /data-exiting="true"/);
assert.match(playerStyles, /#components--modal-base-container:has\(> \.modal--mv-player\)[\s\S]*?background:\s*var\(--appOverlayMask\) !important/);
assert.match(playerStyles, /html\[data-native-video-overlay="true"\][\s\S]*?#components--modal-base-container:has\(> \.modal--mv-player\)[\s\S]*?background:\s*transparent !important/);
assert.match(playerStyles, /data-native-surface-visible="true"[\s\S]*?visibility:\s*hidden/);
assert.match(playerStyles, /native-video-rounded-cutout/);
assert.match(playerStyles, /--native-video-radius-near/);
assert.match(playerStyles, /--native-video-radius-mid/);
assert.match(playerStyles, /--native-video-radius-far/);
assert.match(playerStyles, /\[data-ui-style="flat"\] #components--modal-base-container > \.modal--mv-player \.mv-player-close/);
assert.match(playerStyles, /\.mv-player-control-row \.mv-player-icon-button[\s\S]*?box-shadow:\s*none !important/);
assert.match(playerStyles, /\.mv-player-control-row \.mv-player-icon-button[\s\S]*?&:hover[\s\S]*?background:\s*transparent !important/);
assert.match(playerStyles, /\[aria-expanded="true"\][\s\S]*?var\(--mv-accent\)/);
assert.match(playerStyles, /\.mv-player-native-surface\s*\{[\s\S]*?inset:\s*0;/);
assert.match(playerStyles, /\.mv-player-topbar[\s\S]*?linear-gradient/);
assert.match(playerStyles, /\.mv-player-controls[\s\S]*?linear-gradient/);
assert.doesNotMatch(playerStyles, /inset:\s*74px 0 84px/);
assert.doesNotMatch(playerStyles, /inset:\s*58px 0 72px/);
assert.doesNotMatch(playerStyles, /data-fullscreen[^\n]*data-controls-visible/);

for (const lang of ["zh-CN", "zh-TW", "en-US"]) {
    const messages = JSON.parse(read(`res/lang/${lang}.json`));
    for (const key of [
        "video_quality", "loading", "error", "retry",
        "playback_progress", "playback_speed", "fullscreen", "exit_fullscreen",
        "download", "cancel_download", "download_complete", "download_failed", "native_active",
    ]) {
        assert.equal(typeof messages.mv_player[key], "string", `${lang}: mv_player.${key}`);
    }
}

console.log("Native libmpv video player tests passed.");
