const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    MAX_PITCH_SEMITONES,
    MIN_PITCH_SEMITONES,
    normalizePitchSemitones,
    semitonesToPitchRatio,
} = require(
    "../src/renderer/core/track-player/controller/pitch-shifter.ts",
);

const projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

assert.equal(MIN_PITCH_SEMITONES, -12);
assert.equal(MAX_PITCH_SEMITONES, 12);
assert.equal(normalizePitchSemitones(Number.NaN), 0);
assert.equal(normalizePitchSemitones(-99), -12);
assert.equal(normalizePitchSemitones(99), 12);
assert.equal(normalizePitchSemitones(2.6), 3);
assert.equal(semitonesToPitchRatio(-12), 0.5);
assert.equal(semitonesToPitchRatio(0), 1);
assert.equal(semitonesToPitchRatio(12), 2);

const controllerSource = read(
    "src/renderer/core/track-player/controller/audio-controller.ts",
);
assert.match(controllerSource, /createMediaElementSource\(this\.audio\)/);
assert.match(controllerSource, /audioWorklet\.addModule/);
assert.match(controllerSource, /this\.audio\.preservesPitch = true/);
assert.match(controllerSource, /setPitch\(semitones: number\)/);

const workletSource = read(
    "src/renderer/core/track-player/controller/pitch-shifter.worklet.js",
);
assert.match(workletSource, /registerProcessor\(PROCESSOR_NAME/);
assert.match(workletSource, /2 \*\* \(semitones \/ 12\)/);
assert.match(workletSource, /firstWindow/);
assert.match(workletSource, /secondWindow/);
assert.doesNotMatch(workletSource, /playbackRate/);

const playerSource = read("src/renderer/core/track-player/index.ts");
assert.match(playerSource, /setUserPreference\("pitch", semitones\)/);
assert.match(playerSource, /getUserPreference\("pitch"\)/);

console.log("pitch-shift: all assertions passed");
