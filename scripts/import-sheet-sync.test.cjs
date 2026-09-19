const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(relative, mocks = {}) {
    const filename = path.join(__dirname, "..", relative);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", output)((name) => {
        if (name in mocks) return mocks[name];
        throw new Error(`Unexpected dependency: ${name}`);
    }, module, module.exports);
    return module.exports;
}
const helpers = load("src/renderer/core/music-sheet/import-sync.ts");
const source = { pluginHash: "old-hash", platform: "fixture", input: "123" };
const track = (id, platform = "fixture") => ({ id, platform, title: String(id), artist: "artist" });
const snapshot = (musicList, origin = source) => [{ source: origin, musicList }];
const ownership = (id, manual = false, origins = [source]) => ({ platform: "fixture", id: String(id), manual, sourceKeys: origins.map(helpers.importSourceKey) });
assert.deepEqual(helpers.mergeImportSources([source], [source]), [source]);
assert.throws(() => helpers.validateImportSources([{ ...source, input: "" }]));
assert.throws(() => helpers.validateImportSources(Array(101).fill(source)));
assert.deepEqual(helpers.importedTracks([track(1), track("1"), track(1, "other")]), [track(1), track(1, "other")]);
assert.deepEqual(helpers.importedTracks({ musicList: [] }), []);
assert.throws(() => helpers.importedTracks(null));
assert.throws(() => helpers.importedTracks({ title: "incomplete" }));
assert.throws(() => helpers.importedTracks([{ id: "bad" }]));

const sourceB = { ...source, input: "456" };
const initialPlan = helpers.planImportedSheetSync([], undefined, [source, sourceB], [
    { source, musicList: [track("shared"), track("a")] },
    { source: sourceB, musicList: [track("shared"), track("b")] },
]);
assert.equal(initialPlan.total, 3);
assert.deepEqual(initialPlan.importOwnership.find((entry) => entry.id === "shared").sourceKeys, [source, sourceB].map(helpers.importSourceKey));
const nextPlan = helpers.planImportedSheetSync(initialPlan.musicList, initialPlan.importOwnership, [source, sourceB], [
    { source, musicList: [] }, { source: sourceB, musicList: [track("shared")] },
]);
assert.deepEqual(nextPlan.musicList.map((item) => item.id), ["shared"]);
assert.deepEqual(nextPlan.importOwnership[0].sourceKeys, [helpers.importSourceKey(sourceB)]);
const lastPlan = helpers.planImportedSheetSync(nextPlan.musicList, nextPlan.importOwnership, [source, sourceB], [
    { source, musicList: [] }, { source: sourceB, musicList: [] },
]);
assert.equal(lastPlan.total, 0);
assert.equal(helpers.planImportedSheetSync([track("legacy")], undefined, [source], snapshot([])).total, 1);
assert.equal(helpers.planImportedSheetSync([track("manual")], [ownership("manual", true)], [source], snapshot([])).total, 1);
assert.throws(() => helpers.planImportedSheetSync(initialPlan.musicList, initialPlan.importOwnership, [source, sourceB], snapshot([])), /Incomplete/);
assert.throws(() => helpers.validateImportOwnership([ownership("x", false, [sourceB])], [source]));

const backup = load("src/renderer/core/backup-resume/format.ts", {
    "../music-sheet/import-sync": helpers,
});
const backupSheet = { importOwnership: [ownership("one", true)], id: "sheet", platform: "local", title: "Backup", importSources: [source], musicList: [track("one")] };
assert.deepEqual(backup.parseBackupPayload(backup.createBackupPayload([backupSheet])), [backupSheet]);
assert.throws(() => backup.createBackupPayload([{ ...backupSheet, importSources: [{ ...source, input: "" }] }]));
const oldBackup = JSON.parse(backup.createBackupPayload([backupSheet]));
oldBackup.version = 3;
delete oldBackup.data.musicSheets[0].importOwnership;
assert.equal(backup.parseBackupPayload(oldBackup)[0].importOwnership, undefined);
for (const file of [
    "src/renderer/components/Modal/templates/AddMusicToSheet/index.tsx",
    "src/renderer/components/Modal/templates/AddNewSheet/index.tsx",
    "src/renderer/components/MusicSheetlikeView/components/Body/index.tsx",
]) {
    assert.match(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), /importSources/);
}

class Table {
    constructor(key) { this.key = key; this.rows = new Map(); }
    async get(key) { return structuredClone(this.rows.get(JSON.stringify(key))); }
    async put(row) { this.rows.set(JSON.stringify(this.key(row)), structuredClone(row)); }
    async bulkPut(rows) { for (const row of rows) await this.put(row); }
    async bulkAdd(rows) {
        if (this.failAdd) throw new Error("write failed");
        for (const row of rows) {
            assert.ok(!this.rows.has(JSON.stringify(this.key(row))), "duplicate relation");
            await this.put(row);
        }
    }
    async bulkGet(keys) { return Promise.all(keys.map((key) => this.get(key))); }
    async bulkDelete(keys) { keys.forEach((key) => this.rows.delete(JSON.stringify(key))); }
    async update(key, update) { const row = await this.get(key); if (row) await this.put({ ...row, ...update }); }
    async toArray() { return structuredClone([...this.rows.values()]); }
    where(field) {
        return {
            between: ([sheetId]) => ({
                first: async () => (await this.toArray()).filter((row) => row.sheetId === sheetId).sort((a, b) => a.position - b.position)[0],
                last: async () => (await this.toArray()).filter((row) => row.sheetId === sheetId).sort((a, b) => b.position - a.position)[0],
            }),
            equals: (value) => ({
            toArray: async () => (await this.toArray()).filter((row) => row[field] === value),
            delete: async () => { for (const [key, row] of this.rows) if (row[field] === value) this.rows.delete(key); },
        }) };
    }
}
const db = {
    sheets: new Table((row) => row.id),
    musicStore: new Table((row) => [row.platform, row.id]),
    sheetMusic: new Table((row) => [row.sheetId, row.platform, row.musicId]),
    async transaction(...args) {
        const tables = args.slice(1, -1);
        const snapshots = tables.map((table) => structuredClone(table.rows));
        try { return await args.at(-1)(); }
        catch (error) { tables.forEach((table, index) => { table.rows = snapshots[index]; }); throw error; }
    },
};
const constants = { localPluginName: "local", musicRefSymbol: "refs", MusicSheetSortType: { None: "None" } };
const media = { getMediaPrimaryKey: (item) => `${item.platform}@${item.id}`, isSameMedia: (a, b) => a.id === b.id && a.platform === b.platform };
let restoredId = 0;
const repository = load("src/renderer/core/music-sheet/repository.ts", {
    "@/common/constant": constants,
    "@/common/media-util": media,
    "@/renderer/utils/user-perference": { setUserPreferenceIDB: async () => {} },
    "@/renderer/utils/optimize-artwork-data-url": { shouldOptimizeArtworkDataUrl: () => false },
    "@shared/app-config/renderer": {},
    dexie: { maxKey: Infinity }, nanoid: { nanoid: () => `restored-${++restoredId}` },
    "./database": db,
    "./default-sheet": { id: "favorite" },
    "./sort": { normalizeMusicSheetSortType: () => "None", sortMusicSheetMusicList: (tracks) => tracks },
    "./import-sync": helpers,
});
class Store {
    constructor(value) { this.value = value; }
    getValue = () => this.value;
    setValue = (value) => { this.value = value; };
    useValue = () => this.value;
}
async function main() {
    await db.sheets.put({ id: "sheet", platform: "local", title: "Keep my name" });
    await db.musicStore.bulkPut([{ ...track("old"), refs: 2 }, { ...track("kept"), refs: 1 }]);
    await db.sheetMusic.bulkPut(["old", "kept"].map((id, position) => ({ sheetId: "sheet", platform: "fixture", musicId: id, position, addedAt: 1, manual: false, sourceKeys: [helpers.importSourceKey(source)] })));
    await repository.queryAllSheets();
    await repository.addMusicToSheet([track("kept"), track("kept")], "sheet", [source]);
    assert.deepEqual((await db.sheets.get("sheet")).importSources, [source], "even duplicate-only imports bind the source");
    assert.equal((await db.sheetMusic.toArray()).length, 2);
    const result = await repository.replaceImportedSheetMusic("sheet", [source], snapshot([track("kept"), track("new"), track("new")]));
    assert.deepEqual(result, { added: 1, removed: 1, total: 2 });
    assert.equal((await db.musicStore.get(["fixture", "old"])).refs, 1, "other sheets retain references");
    assert.equal((await db.musicStore.get(["fixture", "kept"])).refs, 1);
    assert.equal((await db.sheets.get("sheet")).title, "Keep my name");
    assert.deepEqual(await repository.replaceImportedSheetMusic("sheet", [source], snapshot([track("kept"), track("new")])), { added: 0, removed: 0, total: 2 });
    const before = await db.sheetMusic.toArray();
    db.sheetMusic.failAdd = true;
    await assert.rejects(repository.replaceImportedSheetMusic("sheet", [source], snapshot([track("failure")])), /write failed/);
    assert.deepEqual(await db.sheetMusic.toArray(), before);
    assert.equal(await db.musicStore.get(["fixture", "failure"]), undefined);
    db.sheetMusic.failAdd = false;
    await assert.rejects(repository.replaceImportedSheetMusic("missing", [source], snapshot([])));
    await assert.rejects(repository.replaceImportedSheetMusic("sheet", [{ ...source, input: "changed" }], snapshot([])));
    assert.deepEqual(await repository.replaceImportedSheetMusic("sheet", [source], snapshot([])), { added: 0, removed: 2, total: 0 });
    assert.equal((await db.sheetMusic.toArray()).length, 0);
    assert.equal(await db.musicStore.get(["fixture", "new"]), undefined);

    // Manual addition (including a duplicate) must survive source removals.
    await repository.addMusicToSheet([track("manual")], "sheet");
    await repository.addMusicToSheet([track("managed"), track("pinned")], "sheet", [source]);
    await repository.addMusicToSheet([track("pinned")], "sheet");
    assert.equal((await db.musicStore.get(["fixture", "pinned"])).refs, 1);
    assert.equal((await db.sheetMusic.get(["sheet", "fixture", "pinned"])).manual, true);
    assert.deepEqual(await repository.replaceImportedSheetMusic("sheet", [source], snapshot([])), { added: 0, removed: 1, total: 2 });
    assert.deepEqual((await db.sheetMusic.toArray()).map((row) => row.musicId).sort(), ["manual", "pinned"]);
    await repository.addMusicToSheet([track("pinned")], "sheet", [source]);
    assert.equal((await db.sheetMusic.get(["sheet", "fixture", "pinned"])).manual, true, "importing an existing manual track preserves its manual flag");
    await repository.replaceImportedSheetMusic("sheet", [source], snapshot([]));
    assert.equal((await db.sheetMusic.toArray()).length, 2);
    // Untracked historical relations retain their songs, even when the source is empty.
    await db.musicStore.put({ ...track("legacy"), refs: 1 });
    await db.sheetMusic.put({ sheetId: "sheet", platform: "fixture", musicId: "legacy", position: 8 });
    await repository.replaceImportedSheetMusic("sheet", [source], snapshot([]));
    assert.equal((await db.sheetMusic.get(["sheet", "fixture", "legacy"])).manual, true);
    // Actual repository export/restore retains provenance without embedding it in metadata.
    await repository.addMusicToSheet([track("managed-again")], "sheet", [source]);
    const detail = await repository.getSheetItemDetail("sheet");
    const restored = backup.parseBackupPayload(backup.createBackupPayload([detail]));
    await repository.restoreSheetDetails(restored, false);
    assert.equal((await db.sheets.get("restored-1")).importOwnership, undefined);
    assert.equal((await db.sheetMusic.get(["restored-1", "fixture", "managed-again"])).manual, false);
    assert.equal((await db.sheetMusic.get(["restored-1", "fixture", "manual"])).manual, true);
    assert.deepEqual(await repository.replaceImportedSheetMusic("restored-1", [source], snapshot([])), { added: 0, removed: 1, total: 3 });
    // Explicit local deletion still takes effect, and source membership restores it next sync.
    await repository.removeMusicFromSheet(track("managed-again"), "sheet");
    assert.equal(await db.sheetMusic.get(["sheet", "fixture", "managed-again"]), undefined);
    assert.equal((await repository.replaceImportedSheetMusic("sheet", [source], snapshot([track("managed-again")]))).added, 1);

    await repository.addMusicToSheet([track(1)], "sheet", [source]);
    await repository.addMusicToSheet([track("1")], "sheet");
    assert.equal((await db.sheetMusic.toArray()).filter((row) => row.sheetId === "sheet" && String(row.musicId) === "1").length, 1);
    assert.equal((await db.sheetMusic.get(["sheet", "fixture", 1])).manual, true);
    assert.equal((await db.musicStore.get(["fixture", 1])).refs, 1);
    await db.sheets.put({ id: "multi", platform: "local", title: "Multiple sources" });
    await repository.queryAllSheets();
    await repository.addMusicToSheet(initialPlan.musicList, "multi", [source, sourceB], initialPlan.importOwnership);
    assert.deepEqual((await db.sheetMusic.get(["multi", "fixture", "a"])).sourceKeys, [helpers.importSourceKey(source)]);
    assert.deepEqual((await db.sheetMusic.get(["multi", "fixture", "shared"])).sourceKeys, [source, sourceB].map(helpers.importSourceKey));
    await repository.replaceImportedSheetMusic("multi", [source, sourceB], [
        { source, musicList: [] }, { source: sourceB, musicList: [track("shared")] },
    ]);
    assert.equal(await db.sheetMusic.get(["multi", "fixture", "a"]), undefined);
    assert.deepEqual((await db.sheetMusic.get(["multi", "fixture", "shared"])).sourceKeys, [helpers.importSourceKey(sourceB)]);

    await repository.setStarredMusicSheets([
        { id: "a", platform: "fixture", importSources: [source], musicList: [track("old")], importOwnership: [ownership("old")] },
        { id: "b", platform: "fixture", importSources: [source], musicList: [track("old")], importOwnership: [ownership("old")] },
    ]);
    await Promise.all(["a", "b"].map((id) => repository.replaceStarredImportedSheet({ id, platform: "fixture" }, [source], snapshot([track(id)]))));
    assert.deepEqual(repository.getAllStarredSheets().map((sheet) => sheet.musicList[0].id), ["a", "b"]);
    await repository.unstarMusicSheet({ id: "a", platform: "fixture" });
    await assert.rejects(repository.replaceStarredImportedSheet({ id: "a", platform: "fixture" }, [source], snapshot([])));
    assert.equal(repository.getAllStarredSheets().length, 1, "deleted starred playlist stays deleted");

    let sheets = [{ id: "sheet", platform: "local", title: "Local", importSources: [source] }];
    let stars = [{ id: "remote", platform: "fixture", title: "Remote", importSources: [source], isImported: true, musicList: [track("old")] }];
    let calls = 0;
    let commits = 0;
    let reply = [track("new"), track("new")];
    let plugins = [{ hash: "updated-hash", platform: "fixture" }];
    let block;
    const service = load("src/renderer/core/music-sheet/service.ts", {
        "@/common/store": Store,
        "./repository": {
            queryAllSheets: async () => sheets,
            queryAllStarredSheets: async () => stars,
            getAllSheets: () => sheets,
            getAllStarredSheets: () => stars,
            getSheetItemDetail: async () => sheets[0],
            replaceImportedSheetMusic: async (_id, _sources, snapshots) => { commits++; const tracks = snapshots.flatMap((item) => item.musicList); return { added: tracks.length, removed: 0, total: tracks.length }; },
            replaceStarredImportedSheet: async (_sheet, _sources, snapshots) => {
                const tracks = snapshots.flatMap((item) => item.musicList);
                stars = [{ ...stars[0], musicList: tracks }];
                return { added: 1, removed: 1, total: tracks.length };
            },
        },
        "./default-sheet": { id: "favorite" },
        react: {},
        "@/common/constant": constants,
        "@shared/plugin-manager/renderer": {
            getSortedSupportedPlugin: () => plugins,
            callPluginDelegateMethod: async (_plugin, method, input) => {
                assert.equal(method, "importMusicSheet"); assert.equal(input, "123");
                calls++; if (block) await block; return reply;
            },
        },
        "./import-sync": helpers,
    });
    await service.setupMusicSheets();
    assert.equal((await service.syncImportedSheet(sheets[0])).total, 1, "updated plugin resolves by unique platform");
    assert.equal(commits, 1);
    reply = null;
    await assert.rejects(service.syncImportedSheet(sheets[0]));
    assert.equal(commits, 1, "failed fetch must not commit");
    plugins = [];
    await assert.rejects(service.syncImportedSheet(sheets[0]), /sync_sheet_missing_plugin/);
    plugins = [{ hash: "updated-hash", platform: "fixture" }];
    reply = [];
    let release;
    block = new Promise((resolve) => { release = resolve; });
    const pending = service.syncImportedSheet(sheets[0]);
    await assert.rejects(service.syncImportedSheet(sheets[0]), /sync_sheet_busy/);
    release(); await pending; block = undefined;
    assert.equal(commits, 2, "empty successful snapshot commits");
    reply = [track("new")];
    assert.deepEqual(await service.syncImportedSheet(stars[0], true), { added: 1, removed: 1, total: 1 });
    assert.deepEqual(stars[0].musicList, reply);
    sheets = [{ ...sheets[0], importSources: [source, { ...source, platform: "other", pluginHash: "other-hash" }] }];
    await service.setupMusicSheets();
    const beforePartialFailure = commits;
    await assert.rejects(service.syncImportedSheet(sheets[0]), /sync_sheet_missing_plugin/);
    assert.equal(commits, beforePartialFailure, "a later failed source leaves the whole playlist untouched");
    assert.ok(calls >= 4);
    console.log("Imported playlist full-sync tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
