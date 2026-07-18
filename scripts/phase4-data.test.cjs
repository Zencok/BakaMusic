const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { mapWithConcurrency } = require(
    "../src/common/concurrency-util.ts"
);
const {
    getLocalPathComparisonKey,
    normalizeLocalFilePath,
} = require("../src/common/file-util.ts");
const {
    BACKUP_SCHEMA,
    BACKUP_VERSION,
    MAX_BACKUP_BYTES,
    createBackupPayload,
    parseBackupPayload,
} = require("../src/renderer/core/backup-resume/format.ts");

function fixtureMusic(id) {
    return {
        id,
        platform: "fixture",
        title: `Track ${id}`,
    };
}

function fixtureSheet() {
    return {
        id: "sheet-fixture",
        platform: "fixture",
        title: "Fixture sheet",
        musicList: [fixtureMusic("one"), fixtureMusic("two")],
    };
}

function testBackupFormat() {
    const serialized = createBackupPayload([fixtureSheet()], 1234);
    const envelope = JSON.parse(serialized);
    assert.equal(envelope.schema, BACKUP_SCHEMA);
    assert.equal(envelope.version, BACKUP_VERSION);
    assert.equal(envelope.createdAt, 1234);
    assert.deepEqual(parseBackupPayload(serialized), [fixtureSheet()]);
    assert.deepEqual(
        parseBackupPayload(JSON.stringify({ musicSheets: [fixtureSheet()] })),
        [fixtureSheet()],
    );
    assert.ok(MAX_BACKUP_BYTES >= 1024 * 1024);
    assert.throws(
        () => parseBackupPayload(JSON.stringify({
            schema: BACKUP_SCHEMA,
            version: BACKUP_VERSION + 1,
            data: { musicSheets: [] },
        })),
        /schema or version/,
    );
    assert.throws(
        () => createBackupPayload([{
            ...fixtureSheet(),
            musicList: [{ id: "missing-platform" }],
        }]),
        /platform/,
    );
}

async function testConcurrencyLimit() {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency(
        [1, 2, 3, 4, 5, 6, 7],
        3,
        async (value) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active--;
            return value * 2;
        },
    );
    assert.equal(maxActive, 3);
    assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14]);
}

function testWindowsPathNormalization() {
    const normalized = normalizeLocalFilePath(
        path.join(process.cwd(), "fixture", "..", "fixture", "track.mp3"),
    );
    assert.equal(normalized, path.normalize(normalized));
    assert.equal(
        getLocalPathComparisonKey(normalized),
        getLocalPathComparisonKey(normalized.toLocaleLowerCase("en-US")),
    );
}

function readSource(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function testArchitectureGuards() {
    const storeSource = readSource("src/common/store.ts");
    assert.match(storeSource, /useSyncExternalStore/);
    assert.match(storeSource, /useSelector/);

    const databaseSource = readSource(
        "src/renderer/core/music-sheet/database.ts"
    );
    assert.match(databaseSource, /sheetMusic/);
    assert.match(databaseSource, /\[sheetId\+platform\+musicId\]/);
    assert.match(databaseSource, /\.upgrade\(/);

    const repositorySource = readSource(
        "src/renderer/core/music-sheet/repository.ts"
    );
    assert.match(repositorySource, /restoreSheetDetails/);
    assert.match(repositorySource, /new Set\(/);
    assert.match(repositorySource, /musicSheetDB\.transaction/);

    const watcherSource = readSource("src/webworkers/local-file-watcher.ts");
    assert.doesNotMatch(watcherSource, /\._watched|_removeWatcher/);
    assert.match(watcherSource, /nextWatcher\.on\("change"/);
    assert.match(watcherSource, /LOCAL_METADATA_CONCURRENCY = 4/);

    const statisticsSource = readSource(
        "src/renderer/core/listening-statistics/index.ts"
    );
    assert.match(statisticsSource, /SAVE_DELAY_MS = 15_000/);
    assert.match(statisticsSource, /persistenceGeneration/);
    assert.match(statisticsSource, /dirtyEntryKeys/);
}

async function main() {
    testBackupFormat();
    await testConcurrencyLimit();
    testWindowsPathNormalization();
    testArchitectureGuards();
    console.log("Phase 4 data architecture tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
