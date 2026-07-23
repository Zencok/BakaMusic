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
    "src/renderer/core/track-player/controller/libmpv-audio-controller.ts",
);
assert.match(controllerSource, /normalizePitchSemitones\(semitones\)/);
assert.match(controllerSource, /operation: "pitch"/);
assert.match(controllerSource, /setPitch\(semitones: number\)/);

const nativeHostSource = read(
    "src/shared/native-playback/utility/native-playback-host.ts",
);
assert.match(nativeHostSource, /rubberband=pitch=/);
assert.match(nativeHostSource, /2 \*\* \(normalized \/ 12\)/);
assert.doesNotMatch(nativeHostSource, /AudioWorklet|createMediaElementSource/);
assert.equal(fs.existsSync(path.join(
    projectRoot,
    "src/renderer/core/track-player/controller/pitch-shifter.worklet.js",
)), false);

const playerSource = read("src/renderer/core/track-player/index.ts");
assert.match(playerSource, /setUserPreference\("pitch", semitones\)/);
assert.match(playerSource, /getUserPreference\("pitch"\)/);

console.log("pitch-shift: all assertions passed");
