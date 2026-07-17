const assert = require("node:assert/strict");

const {
    addListeningDuration,
    createEmptyListeningStatistics,
    getActualListeningSeconds,
    getListeningDurationParts,
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

function testActualListeningDuration() {
    let statistics = createEmptyListeningStatistics();
    statistics = recordListeningStatistics(
        statistics,
        { ...music("first"), duration: 180 },
        1_000,
    );
    statistics = recordListeningStatistics(
        statistics,
        { ...music("first"), duration: 180 },
        2_000,
    );

    assert.equal(statistics.totalListeningSeconds, 0);
    statistics = addListeningDuration(statistics, 65);
    assert.equal(statistics.totalListeningSeconds, 65);
    assert.equal(addListeningDuration(statistics, Number.NaN), statistics);

    assert.equal(getActualListeningSeconds(10, 11, 1, 1), 1);
    assert.equal(getActualListeningSeconds(10, 12, 1, 2), 1);
    assert.equal(getActualListeningSeconds(10, 110, 0.25, 1), 0.25);
    assert.equal(getActualListeningSeconds(110, 10, 0.25, 1), 0);

    const normalizedStatistics = normalizeListeningStatistics(statistics);
    assert.ok(normalizedStatistics);
    assert.equal(normalizedStatistics.version, 2);
    assert.equal(normalizedStatistics.totalListeningSeconds, 65);

    const oldStatistics = normalizeListeningStatistics({
        ...statistics,
        version: 1,
        totalListeningSeconds: undefined,
    });
    assert.ok(oldStatistics);
    assert.equal(oldStatistics.totalListeningSeconds, 0);
}

function testListeningDurationParts() {
    assert.deepEqual(getListeningDurationParts(0), [
        { unit: "second", value: 0 },
    ]);
    assert.deepEqual(getListeningDurationParts(90), [
        { unit: "minute", value: 1 },
        { unit: "second", value: 30 },
    ]);
    assert.deepEqual(getListeningDurationParts(3661), [
        { unit: "hour", value: 1 },
        { unit: "minute", value: 1 },
    ]);
    assert.deepEqual(getListeningDurationParts(90061), [
        { unit: "day", value: 1 },
        { unit: "hour", value: 1 },
    ]);
    assert.deepEqual(getListeningDurationParts(31 * 86400), [
        { unit: "month", value: 1 },
        { unit: "day", value: 1 },
    ]);
    assert.deepEqual(getListeningDurationParts(370 * 86400), [
        { unit: "year", value: 1 },
        { unit: "day", value: 5 },
    ]);
}

testLegacyMigration();
testReplayMovesInsteadOfRemoving();
testRankingAndNormalization();
testActualListeningDuration();
testListeningDurationParts();

console.log("Listening statistics tests passed.");
