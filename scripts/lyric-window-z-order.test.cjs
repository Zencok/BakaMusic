const assert = require("node:assert/strict");
const {
    isFullscreenNotificationState,
} = require("../src/main/window-manager/fullscreen-notification-state");

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

console.log("lyric window z-order tests passed");
