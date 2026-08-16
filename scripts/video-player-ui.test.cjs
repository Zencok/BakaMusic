const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const musicList = read("src/renderer/components/MusicList/index.tsx");
assert.match(musicList, /music_list_context_menu\.play_mv/);
assert.match(musicList, /showModal\("MvPlayer", \{ musicItem \}\)/);
assert.match(musicList, /canPlayMusicVideo\(musicItem\)/);
assert.match(musicList, /<MusicVideoBadge musicItem=\{musicItem\}/);

const queue = read("src/renderer/components/Panel/templates/PlayList/index.tsx");
assert.match(queue, /<MusicVideoBadge musicItem=\{musicItem\} compact/);

const musicInfo = read("src/renderer/components/MusicBar/widgets/MusicInfo/index.tsx");
assert.match(musicInfo, /<MusicVideoBadge musicItem=\{musicItem\} compact/);

const badge = read("src/renderer/components/MusicVideoBadge/index.tsx");
assert.match(badge, /canPlayMusicVideo\(musicItem\)/);
assert.match(badge, /showModal\("MvPlayer", \{ musicItem \}\)/);

const musicBar = read("src/renderer/components/MusicBar/widgets/Extra/index.tsx");
assert.match(musicBar, /function MvBtn\(\)/);
assert.match(musicBar, /showModal\("MvPlayer", \{ musicItem: currentMusic \}\)/);

const player = read("src/renderer/components/Modal/templates/MvPlayer/index.tsx");
assert.match(player, /"getMvSource"/);
assert.match(player, /videoProxy\.register/);
assert.match(player, /videoProxy\.release/);
assert.match(player, /Hls\.isSupported/);
assert.match(player, /Hls\.ErrorTypes\.NETWORK_ERROR/);
assert.match(player, /Hls\.ErrorTypes\.MEDIA_ERROR/);
assert.match(player, /playbackIntentRef/);
assert.match(player, /\.m3u8\(\?:\$\|\[\?#\]\)/);
assert.match(player, /video\.pause\(\)/);
assert.match(player, /type="range"/);
assert.match(player, /mv-player-volume/);
assert.match(player, /mv-player-quality-picker/);
assert.match(player, /role="menuitemradio"/);
assert.match(player, /toggleFullscreen/);
assert.match(player, /requestFullscreen/);
assert.match(player, /setMainWindowFullScreen\?\.\(true\)/);
assert.match(player, /onMainWindowFullScreenChanged/);
assert.doesNotMatch(player, /toggleMainWindowFullScreen/);
assert.doesNotMatch(player, /<select/);
assert.doesNotMatch(player, /quality_short/);
assert.doesNotMatch(player, /mv_player\.now_playing/);
assert.match(player, /availableVideoQualities/);
assert.match(player, /qualityOptions\.length > 0/);
assert.match(player, /mv-player-quality-size/);
assert.match(player, /mv-player-heading-quality/);
assert.match(player, /cog-8-tooth/);
assert.match(player, /dedupeVerifiedQualityOptions/);
assert.match(player, /sourceFingerprint/);
assert.match(player, /highestDeclaredQuality/);
assert.match(player, /autoSelectHighestRef/);
assert.match(player, /mv-player-download-menu/);
assert.match(player, /downloadMenuOpen/);
assert.match(player, /handleDownload\(item\)/);
assert.match(player, /downloadSessionRef/);
assert.match(player, /qualitySourceCacheRef/);
assert.match(player, /toLocaleUpperCase\("en-US"\)/);
assert.doesNotMatch(player, /optionMeta \|\| "—"/);
assert.match(player, /getBufferedPercent/);
assert.match(player, /handleWheelVolume/);
assert.match(player, /rangeInteractionRef/);
assert.match(player, /onPointerMove=\{handlePointerActivity\}/);
assert.match(player, /revealControlsRef\.current\(\)/);
assert.match(player, /syncElementFullscreen[\s\S]*?setMainWindowFullScreen\?\.\(true\)/);
assert.match(player, /supportedVideoQualities/);
assert.match(player, /probeProxyVideoSize/);
assert.match(player, /content-range/);
assert.doesNotMatch(player, /className="sr-only"/);
assert.match(player, /startMusicVideoDownload/);
assert.match(player, /shellUtil\.showItemInFolder/);
assert.match(player, /downloadPhase === "downloading"/);
assert.match(player, /defaultClose/);

const playerStyles = read("src/renderer/components/Modal/templates/MvPlayer/index.scss");
assert.match(playerStyles, /#components--modal-base-container > \.modal--mv-player/);
assert.doesNotMatch(playerStyles, /#components--modal-base > \.modal--mv-player/);
assert.match(playerStyles, /flex:\s*0 0 auto/);
assert.match(playerStyles, /aspect-ratio:\s*16 \/ 9/);
assert.match(playerStyles, /height:\s*100vh/);
assert.match(playerStyles, /background:\s*#050505 !important/);
assert.match(playerStyles, /backdrop-filter:\s*none !important/);
assert.match(playerStyles, /&:fullscreen/);
assert.match(playerStyles, /mv-player-quality-menu/);
assert.match(playerStyles, /mv-player-heading-quality/);
assert.match(playerStyles, /var\(--primaryColor, #f17d34\)/);
assert.match(playerStyles, /width:\s*248px/);
assert.match(playerStyles, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(64px, auto\)/);
assert.match(playerStyles, /text-align:\s*left/);
assert.match(playerStyles, /text-align:\s*right/);
assert.match(playerStyles, /right:\s*43px/);
assert.doesNotMatch(playerStyles, /0 0 0 1\.5px rgba\(5, 5, 5/);
assert.match(playerStyles, /mv-player-seek-preview/);
assert.match(playerStyles, /mv-player-volume-control/);
assert.match(playerStyles, /\.mv-player-stage\s*\{[\s\S]*?cursor:\s*default/);
assert.match(playerStyles, /data-controls-visible="false"[\s\S]*?\.mv-player-stage,[\s\S]*?cursor:\s*none/);
assert.match(playerStyles, /\.mv-player-progress,[\s\S]*?cursor:\s*pointer/);
assert.match(playerStyles, /\.mv-player-controls\s*\{[\s\S]*padding:\s*72px 0 16px/);

const utilsMain = read("src/shared/utils/main.ts");
assert.match(utilsMain, /powerSaveBlocker\.start\("prevent-display-sleep"\)/);
assert.match(utilsMain, /setImmersiveSessionEffects\(true\)/);

const baseModal = read("src/renderer/components/Modal/templates/Base/index.tsx");
assert.match(baseModal, /if \(document\.fullscreenElement\)/);

const downloadUtil = read("src/renderer/utils/download-music-video.ts");
assert.match(downloadUtil, /nodeRuntime\.downloadFile/);
assert.match(downloadUtil, /nodeRuntime\.abortDownload/);
assert.match(downloadUtil, /"AbortError"/);

const proxyMain = read("src/shared/video-proxy/main.ts");
assert.match(proxyMain, /assertIpcSender\(event, \["main"\]\)/);
assert.match(proxyMain, /assertUrl\(value\.url/);
assert.match(proxyMain, /request\.headers\.range/);
assert.match(proxyMain, /rewritePlaylist/);
assert.match(proxyMain, /writeHlsDownload/);
assert.match(proxyMain, /parseHlsSegments/);
assert.match(proxyMain, /proxyDownloadUrl/);
assert.match(proxyMain, /access-control-allow-origin/);
assert.match(proxyMain, /access-control-expose-headers/);
assert.match(proxyMain, /request\.method === "OPTIONS"/);
assert.match(proxyMain, /MAX_PLAYLIST_BYTES/);
assert.match(proxyMain, /ERR_BLOCKED_BY_CLIENT/);
assert.match(proxyMain, /fetch\(/);
assert.match(proxyMain, /normalizeVideoUpstreamUrl/);

const integrity = read("src/webworkers/download-integrity.ts");
assert.match(integrity, /video\/mp2t/);
assert.match(integrity, /video\/webm/);
assert.match(integrity, /\.ts/);
assert.match(integrity, /\.webm/);

for (const lang of ["zh-CN", "zh-TW", "en-US"]) {
    const messages = JSON.parse(read(`res/lang/${lang}.json`));
    assert.equal(typeof messages.music_bar.play_mv, "string");
    assert.equal(typeof messages.music_list_context_menu.play_mv, "string");
    assert.equal(typeof messages.mv_player.title, "string");
    assert.equal(typeof messages.mv_player.video_quality, "string");
    for (const key of [
        "now_playing", "retry", "playback_progress", "quality_short",
        "fullscreen", "exit_fullscreen", "download", "cancel_download",
        "retry_download", "show_download", "download_canceled",
        "download_complete", "download_failed", "size_loading",
        "size_stream", "size_unknown",
    ]) {
        assert.equal(typeof messages.mv_player[key], "string", `${lang}: mv_player.${key}`);
    }
}

console.log("Video player UI tests passed.");
