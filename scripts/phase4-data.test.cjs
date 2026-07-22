const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const LyricParser = require("../src/renderer/utils/lyric-parser.ts").default;

const { mapWithConcurrency } = require(
    "../src/common/concurrency-util.ts"
);
const {
    getLocalPathComparisonKey,
    normalizeLocalLyricText,
    normalizeLocalFilePath,
} = require("../src/common/file-util.ts");
const {
    MAX_LOCAL_ARTWORK_BYTES,
    createLocalArtworkDataUrl,
} = require("../src/common/local-artwork.ts");
const {
    BACKUP_SCHEMA,
    BACKUP_VERSION,
    MAX_BACKUP_BYTES,
    createBackupFileName,
    createBackupPayload,
    parseBackupPayload,
} = require("../src/renderer/core/backup-resume/format.ts");
const {
    MAX_BACKUP_TRANSFER_BYTES,
} = require("../src/shared/backup/common.ts");

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
    const untitledSheet = { ...fixtureSheet(), title: "" };
    assert.deepEqual(
        parseBackupPayload(createBackupPayload([untitledSheet], 1234)),
        [untitledSheet],
    );
    // Legacy DBs / module-load race: favorite sheet may have missing title.
    const missingTitleSheet = {
        id: "favorite",
        platform: "local",
        musicList: [fixtureMusic("fav-1")],
    };
    const missingTitlePayload = createBackupPayload([missingTitleSheet], 1234);
    assert.deepEqual(parseBackupPayload(missingTitlePayload), [{
        ...missingTitleSheet,
        title: "",
    }]);
    assert.equal(
        JSON.parse(missingTitlePayload).data.musicSheets[0].title,
        "",
    );
    assert.throws(
        () => createBackupPayload([{
            ...fixtureSheet(),
            title: 123,
        }]),
        /musicSheets\[0\]\.title/,
    );
    assert.equal(
        createBackupFileName(Date.UTC(2026, 6, 20, 12, 34, 56)),
        "BakaMusicBackup-2026-07-20T12-34-56Z.json",
    );
    assert.ok(MAX_BACKUP_BYTES >= 1024 * 1024);
    assert.equal(MAX_BACKUP_BYTES, MAX_BACKUP_TRANSFER_BYTES);
    assert.throws(
        () => parseBackupPayload(JSON.stringify({
            schema: BACKUP_SCHEMA,
            version: BACKUP_VERSION + 1,
            data: { musicSheets: [] },
        })),
        /schema or version/,
    );
    // Plugin tracks often use numeric ids; coerce instead of failing backup.
    const numericIdSheet = {
        id: "favorite",
        platform: "netease",
        title: "Favorites",
        musicList: [{
            id: 1234567890,
            platform: "netease",
            title: "Numeric id track",
        }],
    };
    const numericPayload = createBackupPayload([numericIdSheet], 1234);
    assert.deepEqual(parseBackupPayload(numericPayload), [{
        ...numericIdSheet,
        musicList: [{
            id: "1234567890",
            platform: "netease",
            title: "Numeric id track",
        }],
    }]);

    // Unusable tracks are dropped so one bad row cannot block the whole backup.
    const mixedSheet = {
        id: "mixed",
        platform: "local",
        title: "Mixed",
        musicList: [
            { id: "ok", platform: "local", title: "Keep" },
            { id: "missing-platform", title: "Drop" },
            null,
            { platform: "local", title: "Drop missing id" },
        ],
    };
    const mixedPayload = createBackupPayload([mixedSheet], 1234);
    assert.deepEqual(
        JSON.parse(mixedPayload).data.musicSheets[0].musicList,
        [{ id: "ok", platform: "local", title: "Keep" }],
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

async function testLocalArtworkIsBoundedBeforeRuntimeTransfer() {
    const sharp = require("sharp");
    const width = 320;
    const height = 320;
    const pixels = Buffer.alloc(width * height * 3);
    let seed = 0x12345678;
    for (let index = 0; index < pixels.length; index++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        pixels[index] = seed & 0xff;
    }
    const original = await sharp(pixels, {
        raw: { width, height, channels: 3 },
    }).png().toBuffer();
    assert.ok(original.length > MAX_LOCAL_ARTWORK_BYTES);

    const artwork = await createLocalArtworkDataUrl({
        format: "image/png",
        data: original,
    });
    assert.match(artwork, /^data:image\/webp;base64,/);
    assert.ok(
        Buffer.from(artwork.split(",", 2)[1], "base64").length
            <= MAX_LOCAL_ARTWORK_BYTES,
    );

    assert.equal(
        await createLocalArtworkDataUrl({
            format: "image/png",
            data: Buffer.alloc(MAX_LOCAL_ARTWORK_BYTES + 1, 0xff),
        }),
        undefined,
    );
}

function testWindowsPathNormalization() {
    const normalized = normalizeLocalFilePath(
        path.join(process.cwd(), "fixture", "..", "fixture", "track.mp3"),
    );
    assert.equal(normalized, path.normalize(normalized));

    const comparisonKey = getLocalPathComparisonKey(normalized);
    if (process.platform === "win32") {
        // Windows paths are compared case-insensitively
        assert.equal(comparisonKey, normalized.toLocaleLowerCase("en-US"));
        assert.equal(
            comparisonKey,
            getLocalPathComparisonKey(normalized.toLocaleLowerCase("en-US")),
        );
        return;
    }

    // Case-sensitive platforms keep the resolved path case as identity
    assert.equal(comparisonKey, normalized);
}

function testLocalSynchronizedLyricsKeepTheirTimeline() {
    assert.equal(
        normalizeLocalLyricText([{
            contentType: 1,
            timeStampFormat: 2,
            text: "First line\nSecond line",
            syncText: [
                { timestamp: 1_230, text: "First line" },
                { timestamp: 65_004, text: "Second line" },
            ],
        }]),
        "[00:01.230]First line\n[01:05.004]Second line",
    );

    assert.equal(
        normalizeLocalLyricText([{
            contentType: 1,
            timeStampFormat: 2,
            syncText: [
                { timestamp: 10_000, text: "逐" },
                { timestamp: 10_200, text: "字" },
            ],
        }, {
            contentType: 1,
            timeStampFormat: 0,
            text: "[00:10.000]完整歌词行\n[00:15.500]下一行",
            syncText: [],
        }]),
        "[00:10.000]完整歌词行\n[00:15.500]下一行",
    );

    assert.equal(
        normalizeLocalLyricText([{
            contentType: 1,
            timeStampFormat: 0,
            text: "Line one\\nLine two",
            syncText: [],
        }]),
        "Line one\nLine two",
    );

    const wordTimeline = normalizeLocalLyricText([{
        contentType: 1,
        timeStampFormat: 2,
        text: "认[00:32.075]得[00:32.374]一[00:33.000]",
        syncText: [{
            timestamp: 31_824,
            text: "认[00:32.075]得[00:32.374]一[00:33.000]",
        }],
    }]);
    assert.equal(
        wordTimeline,
        "[00:31.824]认[00:32.075]得[00:32.374]一[00:33.000]",
    );
    const [parsedWordTimeline] = new LyricParser(wordTimeline).getLyricItems();
    assert.equal(parsedWordTimeline.lrc, "认得一");
    assert.equal(parsedWordTimeline.translation, undefined);
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

    const localMusicSource = readSource("src/renderer/core/local-music/index.ts");
    assert.match(
        localMusicSource,
        /scanDirectories\(selectedDirs, \[\]\)[\s\S]*?musicSheetDB\.transaction\([\s\S]*?localMusicStore\.clear\(\)/,
    );
    assert.match(
        localMusicSource,
        /trashLocalMusicFiles[\s\S]*?fsUtil\.trashFile\(filePath\)[\s\S]*?localMusicStore\.bulkDelete/,
    );

    const musicListSource = readSource("src/renderer/components/MusicList/index.tsx");
    assert.match(
        musicListSource,
        /delete_local_file[\s\S]*?showModal\("Reconfirm"[\s\S]*?trashLocalMusicFiles/,
    );

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
    await testLocalArtworkIsBoundedBeforeRuntimeTransfer();
    testWindowsPathNormalization();
    testLocalSynchronizedLyricsKeepTheirTimeline();
    testArchitectureGuards();
    console.log("Phase 4 data architecture tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
