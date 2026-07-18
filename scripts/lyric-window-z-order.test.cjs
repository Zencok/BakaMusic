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
assert.match(utilsMainSource, /powerSaveBlocker\.start\("prevent-display-sleep"\)/);
assert.match(utilsMainSource, /powerSaveBlocker\.stop\(this\.displaySleepBlockerId\)/);
assert.match(utilsMainSource, /setAuxiliaryWindowsSuppressed\(true\)/);
assert.match(utilsMainSource, /setAuxiliaryWindowsSuppressed\(false\)/);
assert.match(musicDetailSource, /FULLSCREEN_CURSOR_IDLE_MS = 1600/);
assert.match(musicDetailSource, /data-cursor-hidden=\{isFullscreenCursorHidden/);
assert.match(
    musicDetailStyles,
    /\[data-fullscreen="true"\]\[data-cursor-hidden="true"\][\s\S]*?cursor: none !important;/,
);

console.log("lyric window z-order tests passed");
