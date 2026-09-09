const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/main/tray-manager/index.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const context = {
    exports: {},
    require: () => ({}),
};
vm.runInNewContext(outputText, context);
const manager = context.exports.default;
const titles = [];
manager.constructor.trayInstance = { setTitle: (title) => titles.push(title) };

for (const lyric of ["", "短歌词", "一二三四五六七", "这是一句超过七个字符的完整歌词", "A long lyric line with its ending intact", "一二三四五六🎵👨‍👩‍👧‍👦e\u0301尾声"]) {
    manager.setTitle(lyric);
    assert.equal(titles.at(-1), lyric ? ` ${lyric}` : "");
}
manager.setTitle("");
assert.equal(titles.at(-1), "", "Clearing lyrics removes the previous title");
manager.constructor.trayInstance = null;
assert.doesNotThrow(() => manager.setTitle("尚未创建托盘"));
console.log("Tray lyric regression tests passed");
