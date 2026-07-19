const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

// Resolve @/* path aliases used by src/common/download-postprocess.ts
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithAliases(request, parent, isMain, options) {
    if (request.startsWith("@/")) {
        request = path.join(__dirname, "..", "src", request.slice(2));
    } else if (request.startsWith("@shared/")) {
        request = path.join(__dirname, "..", "src", "shared", request.slice("@shared/".length));
    } else if (request.startsWith("@renderer/")) {
        request = path.join(__dirname, "..", "src", "renderer", request.slice("@renderer/".length));
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};

const {
    formatLyricsFromItems,
    resolveLyricExportOrder,
} = require("../src/common/download-postprocess.ts");

// Display toggles filter export order; original always kept
assert.deepEqual(
    resolveLyricExportOrder({
        showTranslation: true,
        showRomanization: false,
        preferredOrder: ["romanization", "original", "translation"],
    }),
    ["original", "translation"],
);

assert.deepEqual(
    resolveLyricExportOrder({
        showTranslation: false,
        showRomanization: true,
        preferredOrder: ["original", "translation", "romanization"],
    }),
    ["original", "romanization"],
);

const items = [{
    time: 1.5,
    lrc: "こんにちは",
    translation: "你好",
    romanization: "konnichiwa",
    hasWordTimeline: true,
    words: [
        { text: "こん", startTime: 1.5, endTime: 1.8 },
        { text: "にちは", startTime: 1.8, endTime: 2.2 },
    ],
    endTime: 2.2,
}];

// Translation + original, word-by-word original
const lrc = formatLyricsFromItems(items, ["original", "translation"], {
    enableWordByWord: true,
    withTimestamp: true,
});
assert.match(lrc, /\[00:01\.500\]<00:01\.500>こん<00:01\.800>にちは<00:02\.200>/);
assert.match(lrc, /\[00:01\.500\]你好/);
assert.doesNotMatch(lrc, /konnichiwa/);

// Plain text without timestamps
const txt = formatLyricsFromItems(items, ["original", "romanization"], {
    enableWordByWord: true,
    withTimestamp: false,
});
assert.equal(txt, "こんにちは\nkonnichiwa");

// Without word-by-word
const plainLrc = formatLyricsFromItems(items, ["original"], {
    enableWordByWord: false,
    withTimestamp: true,
});
assert.equal(plainLrc, "[00:01.500]こんにちは");

console.log("download-postprocess-lyric: all assertions passed");
