const assert = require("node:assert/strict");
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

console.log("lyric window z-order tests passed");
