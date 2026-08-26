const assert = require("node:assert/strict");
const {
    DESKTOP_LYRIC_HORIZONTAL_SNAP_DISTANCE,
    snapWindowBoundsToWorkAreaCenter,
} = require("../src/renderer-lrc/pages/window-snap");

const primaryWorkArea = {
    x: 0,
    y: 0,
    width: 1920,
    height: 1040,
};
const windowSize = {
    width: 940,
    height: 180,
};
const centeredX = (primaryWorkArea.width - windowSize.width) / 2;

assert.equal(
    snapWindowBoundsToWorkAreaCenter({
        ...windowSize,
        x: centeredX,
        y: 100,
    }, [primaryWorkArea]).x,
    centeredX,
    "an already centered window stays centered",
);

assert.equal(
    snapWindowBoundsToWorkAreaCenter({
        ...windowSize,
        x: centeredX - DESKTOP_LYRIC_HORIZONTAL_SNAP_DISTANCE,
        y: 100,
    }, [primaryWorkArea]).x,
    centeredX,
    "a window within the center threshold snaps",
);

assert.equal(
    snapWindowBoundsToWorkAreaCenter({
        ...windowSize,
        x: centeredX - DESKTOP_LYRIC_HORIZONTAL_SNAP_DISTANCE - 1,
        y: 100,
    }, [primaryWorkArea]).x,
    centeredX - DESKTOP_LYRIC_HORIZONTAL_SNAP_DISTANCE - 1,
    "custom positions outside the threshold remain untouched",
);

const secondaryWorkArea = {
    x: -2560,
    y: 0,
    width: 2560,
    height: 1440,
};
const secondaryCenteredX = secondaryWorkArea.x
    + (secondaryWorkArea.width - windowSize.width) / 2;
assert.equal(
    snapWindowBoundsToWorkAreaCenter({
        ...windowSize,
        x: secondaryCenteredX + 8,
        y: 200,
    }, [primaryWorkArea, secondaryWorkArea]).x,
    secondaryCenteredX,
    "the display containing the window receives the snap",
);

const unchangedBounds = {
    ...windowSize,
    x: 120,
    y: 100,
};
assert.deepEqual(
    snapWindowBoundsToWorkAreaCenter(unchangedBounds, []),
    unchangedBounds,
    "missing display information leaves dragging unchanged",
);

console.log("lyric-window-snap: all assertions passed");
