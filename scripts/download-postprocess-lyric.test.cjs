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
const LyricParser = require("../src/renderer/utils/lyric-parser.ts").default;

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

const qqOpeningParser = new LyricParser([
    "[00:00.150]Written by：Jacob Kasher/Charlie Puth/Hindlin/Selena Gomez",
    "[00:00.860]Charlie Puth：",
    "[00:00.860]<00:00.860>We <00:01.200>don't <00:01.600>talk <00:02.000>anymore <00:03.000>we <00:03.400>don't <00:03.800>talk <00:04.200>anymore<00:05.200>",
    "[00:00.860]只剩沉默 我们之间只剩沉默",
    "[00:05.523]We don't talk anymore like we used to do",
    "[00:05.523]只剩沉默 耳语亲昵已是从前",
].join("\n"), {
    musicItem: {
        artist: "Charlie Puth, Selena Gomez",
        id: "105539541",
        platform: "QQ音乐",
        title: "We Don't Talk Anymore",
    },
});
const qqOpeningExport = formatLyricsFromItems(
    qqOpeningParser.getLyricItems(),
    ["original", "translation"],
    {
        enableWordByWord: true,
        withTimestamp: true,
    },
);
const qqOpeningExportWithoutWordTags = qqOpeningExport.replace(
    /<\d{2}:\d{2}\.\d{3}>/g,
    "",
);
assert.match(
    qqOpeningExportWithoutWordTags,
    /\[00:00\.860\].*Charlie Puth：We don't talk anymore we don't talk anymore/,
);
assert.match(
    qqOpeningExportWithoutWordTags,
    /\[00:05\.523\].*We don't talk anymore like we used to do/,
);

console.log("download-postprocess-lyric: all assertions passed");
