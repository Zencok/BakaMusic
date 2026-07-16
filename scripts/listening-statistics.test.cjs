const assert = require("node:assert/strict");

const {
    createEmptyListeningStatistics,
    getMostPlayedEntries,
    getRecentListeningEntries,
    migrateLegacyListeningStatistics,
    normalizeListeningStatistics,
    recordListeningStatistics,
} = require("../src/renderer/core/listening-statistics/model.ts");

function music(id, title = id) {
    return {
        id,
        platform: "fixture",
        title,
        artist: "Test Artist",
    };
}

function testLegacyMigration() {
    const first = music("first");
    const second = music("second");
    const statistics = migrateLegacyListeningStatistics(
        [first, second],
        {
            "fixture@first": 7,
            "fixture@second": 3,
        },
        10_000,
    );

    assert.deepEqual(
        getRecentListeningEntries(statistics).map((entry) => entry.musicItem.id),
        ["first", "second"],
    );
    assert.equal(statistics.entries["fixture@first"].playCount, 7);
    assert.equal(statistics.totalPlays, 10);
}

function testReplayMovesInsteadOfRemoving() {
    const first = music("first", "First title");
    const second = music("second");
    let statistics = createEmptyListeningStatistics();
    statistics = recordListeningStatistics(statistics, first, 1_000);
    statistics = recordListeningStatistics(statistics, second, 2_000);
    statistics = recordListeningStatistics(
        statistics,
        { ...first, title: "Updated title" },
        3_000,
    );

    const recentEntries = getRecentListeningEntries(statistics);
    assert.deepEqual(
        recentEntries.map((entry) => entry.musicItem.id),
        ["first", "second"],
    );
    assert.equal(recentEntries[0].musicItem.title, "Updated title");
    assert.equal(recentEntries[0].playCount, 2);
    assert.equal(new Set(statistics.recentKeys).size, statistics.recentKeys.length);
}

function testRankingAndNormalization() {
    let statistics = createEmptyListeningStatistics();
    statistics = recordListeningStatistics(statistics, music("first"), 1_000);
    statistics = recordListeningStatistics(statistics, music("second"), 2_000);
    statistics = recordListeningStatistics(statistics, music("second"), 3_000);

    assert.deepEqual(
        getMostPlayedEntries(statistics).map((entry) => entry.musicItem.id),
        ["second", "first"],
    );

    const normalized = normalizeListeningStatistics({
        ...statistics,
        recentKeys: ["fixture@second", "fixture@second", "missing"],
        totalPlays: -1,
    }, 4_000);
    assert.ok(normalized);
    assert.deepEqual(normalized.recentKeys, ["fixture@second"]);
    assert.equal(normalized.totalPlays, 3);
}

testLegacyMigration();
testReplayMovesInsteadOfRemoving();
testRankingAndNormalization();

console.log("Listening statistics tests passed.");
