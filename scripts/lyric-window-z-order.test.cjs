const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    isFullscreenNotificationState,
} = require("../src/main/window-manager/fullscreen-notification-state");
const {
    isFullscreenWindowBounds,
} = require("../src/main/window-manager/fullscreen-window-bounds");

for (const state of [
    "QUNS_BUSY",
    "QUNS_RUNNING_D3D_FULL_SCREEN",
    "QUNS_PRESENTATION_MODE",
]) {
    assert.equal(isFullscreenNotificationState(state), true, state);
}

for (const state of [
    "QUNS_NOT_PRESENT",
    "QUNS_ACCEPTS_NOTIFICATIONS",
    "QUNS_QUIET_TIME",
    "QUNS_APP",
    "UNKNOWN_ERROR",
]) {
    assert.equal(isFullscreenNotificationState(state), false, state);
}

const primaryDisplay = { x: 0, y: 0, width: 1920, height: 1080 };
const secondaryDisplay = { x: -2560, y: 0, width: 2560, height: 1440 };

assert.equal(isFullscreenWindowBounds({
    bounds: primaryDisplay,
    contentBounds: primaryDisplay,
}, [primaryDisplay]), true, "borderless fullscreen video");

assert.equal(isFullscreenWindowBounds({
    bounds: { x: -2559, y: 1, width: 2558, height: 1438 },
    contentBounds: secondaryDisplay,
}, [primaryDisplay, secondaryDisplay]), true, "secondary display tolerance");

assert.equal(isFullscreenWindowBounds({
    bounds: { x: -8, y: -8, width: 1936, height: 1056 },
    contentBounds: { x: 0, y: 0, width: 1920, height: 1040 },
}, [primaryDisplay]), false, "maximized window with taskbar");

assert.equal(isFullscreenWindowBounds({
    bounds: { x: 0, y: 0, width: 1920, height: 1040 },
    contentBounds: { x: 0, y: 0, width: 1920, height: 1040 },
}, [primaryDisplay]), false, "work-area window");

const projectRoot = path.join(__dirname, "..");
const windowManagerSource = fs.readFileSync(path.join(
    projectRoot,
    "src/main/window-manager/index.ts",
), "utf8");
const utilsMainSource = fs.readFileSync(path.join(
    projectRoot,
    "src/shared/utils/main.ts",
), "utf8");
const bootstrapSource = fs.readFileSync(path.join(
    projectRoot,
    "src/renderer/document/bootstrap.ts",
), "utf8");
const musicDetailSource = fs.readFileSync(path.join(
    projectRoot,
    "src/renderer/components/MusicDetail/index.tsx",
), "utf8");
const musicDetailStyles = fs.readFileSync(path.join(
    projectRoot,
    "src/renderer/components/MusicDetail/index.scss",
), "utf8");

assert.match(windowManagerSource, /setAuxiliaryWindowsSuppressed\(suppressed: boolean\)/);
assert.match(windowManagerSource, /lyricWindow\.hide\(\)/);
assert.match(windowManagerSource, /miniModeWindow\.hide\(\)/);
assert.match(windowManagerSource, /@shared\/utils\/main-window-f11/);
assert.match(
    windowManagerSource,
    /Renderer toggles OS fullscreen globally|music detail only adapts chrome/,
);

assert.match(utilsMainSource, /powerSaveBlocker\.start\("prevent-display-sleep"\)/);
assert.match(utilsMainSource, /powerSaveBlocker\.stop\(this\.displaySleepBlockerId\)/);
assert.match(utilsMainSource, /setAuxiliaryWindowsSuppressed\(true\)/);
assert.match(utilsMainSource, /setAuxiliaryWindowsSuppressed\(false\)/);

const immersiveMainSource = utilsMainSource.slice(
    utilsMainSource.indexOf("private setImmersiveFullScreen"),
    utilsMainSource.indexOf("private toggleImmersiveFullScreen"),
);
assert.notEqual(immersiveMainSource.indexOf("private setImmersiveFullScreen"), -1);
assert.ok(
    immersiveMainSource.indexOf("mainWindow.setFullScreen(true)")
        < immersiveMainSource.indexOf("mainWindow.unmaximize()"),
    "native fullscreen should run before the bounds-fallback unmaximize",
);
assert.match(immersiveMainSource, /if \(restore\?\.usedBoundsFallback\)/);
assert.match(
    immersiveMainSource,
    /process\.platform === "darwin" \|\| mainWindow\.isFullScreen\(\)/,
);

// Global F11: any page can toggle OS fullscreen.
assert.match(bootstrapSource, /onMainWindowF11/);
assert.match(bootstrapSource, /toggleMainWindowFullScreen/);
assert.match(bootstrapSource, /Global F11/);

assert.match(musicDetailSource, /FULLSCREEN_CURSOR_IDLE_MS = 1600/);
assert.match(musicDetailSource, /data-cursor-hidden=\{isFullscreenCursorHidden/);
assert.match(musicDetailSource, /data-fullscreen=\{isFullscreen/);
assert.match(musicDetailSource, /data-immersive-busy=\{isImmersiveBusy/);
assert.match(musicDetailSource, /IMMERSIVE_OS_EXIT_DELAY_MS/);
// Detail adopts OS fullscreen on open and must not exit OS FS merely on close.
assert.match(musicDetailSource, /isMainWindowFullScreen/);
assert.match(
    musicDetailSource,
    /keep the main window fullscreen|clear chrome only/i,
);
assert.doesNotMatch(
    musicDetailSource,
    /osDelayMs:\s*0/,
    "closing detail must not force an immediate OS fullscreen exit",
);
// F11 OS toggle is owned globally; detail only leads immersive chrome when open.
assert.match(musicDetailSource, /onMainWindowF11/);
assert.match(musicDetailSource, /lead immersive chrome|F11 OS toggle is global/i);

assert.match(
    musicDetailStyles,
    /\[data-fullscreen="true"\]\[data-cursor-hidden="true"\][\s\S]*?cursor: none !important;/,
);
// Topbar fades without layout collapse; cover is transform-only.
assert.match(musicDetailStyles, /\.music-detail-topbar-slot/);
assert.match(musicDetailStyles, /--md-cover-rest-scale/);
assert.match(musicDetailStyles, /--md-dur-cover/);
assert.doesNotMatch(
    musicDetailStyles,
    /grid-template-rows:\s*0fr/,
    "topbar must not collapse layout (causes cover position jumps)",
);
assert.match(
    musicDetailStyles,
    /&\[aria-hidden="true"\][\s\S]*?-webkit-app-region:\s*no-drag/,
);
assert.match(
    musicDetailStyles,
    /@keyframes music-detail-exit[\s\S]*?visibility:\s*hidden/,
);

// Top-level content rule (not nested under [data-fullscreen]) must stay in flow.
const contentRuleMatch = musicDetailStyles.match(
    /(?:^|\n)\.music-detail-content\s*\{([^}]*)\}/,
);
assert.ok(contentRuleMatch, "expected top-level .music-detail-content rule");
assert.match(contentRuleMatch[1], /flex:\s*1/);
assert.doesNotMatch(
    contentRuleMatch[1],
    /position:\s*absolute/,
    "detail content must stay in document flow to avoid topbar/lyric overlap",
);
assert.match(musicDetailStyles, /data-immersive-busy="true"/);
// Cover size is transform-only (no width tween) to avoid reflow jumps.
const stageRuleMatch = musicDetailStyles.match(
    /(?:^|\n)\.music-detail-primary-stage\s*\{([^}]*)\}/,
);
assert.ok(stageRuleMatch, "expected top-level .music-detail-primary-stage rule");
assert.match(stageRuleMatch[1], /transition:\s*transform/);
assert.doesNotMatch(stageRuleMatch[1], /transition:[^;]*width/);
assert.match(musicDetailStyles, /--md-cover-rest-scale:\s*0\.88/);

console.log("lyric window z-order tests passed");
