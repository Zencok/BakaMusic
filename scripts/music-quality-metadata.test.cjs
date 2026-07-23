const assert = require("node:assert/strict");

const {
    formatQualitySize,
    getBestMusicQualityInfo,
} = require("../src/renderer/utils/music-quality-metadata.ts");
const {
    qualityKeys,
    qualityText,
} = require("../src/common/constant.ts");

assert.deepEqual(qualityKeys.slice(-4), [
    "dolby",
    "atmos",
    "atmos_plus",
    "master",
]);
assert.equal(qualityText.dolby, "空间音频 Dolby");
assert.equal(qualityText.master, "无损音质 Master");

function music(overrides = {}) {
    return {
        id: "fixture",
        platform: "fixture",
        title: "Fixture",
        artist: "Test Artist",
        ...overrides,
    };
}

assert.deepEqual(getBestMusicQualityInfo(music({
    qualities: {
        "320k": { size: 3 * 1024 * 1024 },
        "flac": { size: 5 * 1024 * 1024 },
    },
})), {
    quality: "flac",
    label: "SQ",
    sizeText: "5.0MB",
});

assert.deepEqual(getBestMusicQualityInfo(music({
    source: {
        master: { url: "fixture://master" },
    },
    size: 10 * 1024 * 1024,
})), {
    quality: "master",
    label: "MS",
    sizeText: "10.0MB",
});

assert.deepEqual(getBestMusicQualityInfo(music({
    source: {
        dolby: { url: "fixture://dolby", size: 8 * 1024 * 1024 },
    },
})), {
    quality: "dolby",
    label: "DB",
    sizeText: "8.0MB",
});

assert.deepEqual(getBestMusicQualityInfo(music({
    size: "12 MB",
    $: {
        downloadData: {
            quality: "320k",
        },
    },
})), {
    quality: "320k",
    label: "HQ",
    sizeText: "12 MB",
});

assert.equal(getBestMusicQualityInfo(music({ size: 1024 })), null);
assert.equal(formatQualitySize("2048"), "2.0KB");

console.log("Music quality metadata tests passed.");
