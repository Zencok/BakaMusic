const assert = require("node:assert/strict");

const {
    formatQualitySize,
    getBestMusicQualityInfo,
} = require("../src/renderer/utils/music-quality-metadata.ts");
const {
    qualityKeys,
    qualityText,
} = require("../src/common/constant.ts");

assert.equal(qualityKeys[0], "96k");
assert.equal(qualityText["96k"], "流畅音质 96K");
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

// 拼接歌手名的拆分不能误伤单个艺人：feat/ft 必须是独立单词，间隔号只在
// 两侧带空格时才算分隔符（"迈克尔·杰克逊" 是一个人）。
const { getMusicArtists } = require("../src/common/music-identity.ts");
function artistNames(overrides) {
    return getMusicArtists({
        id: "fixture",
        platform: "fixture",
        title: "Fixture",
        ...overrides,
    }).map((entry) => entry.name);
}
for (const singleName of [
    "Daft Punk",
    "Soft Cell",
    "Taylor Swift",
    "迈克尔·杰克逊",
]) {
    assert.deepEqual(
        artistNames({ singerList: [{ name: singleName, id: "1" }] }),
        [singleName],
        singleName,
    );
}
assert.deepEqual(
    artistNames({ singerList: [{ name: "A&B", id: "1&2" }] }),
    ["A", "B"],
);
assert.deepEqual(
    artistNames({ singerList: [{ name: "A feat. B", id: "1&2" }] }),
    ["A", "B"],
);
assert.deepEqual(
    artistNames({ singerList: [{ name: "A · B", id: "1&2" }] }),
    ["A", "B"],
);

console.log("Music quality metadata tests passed.");
