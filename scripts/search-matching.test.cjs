const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    createSearchMatcher,
    matchesSearchValues,
    normalizeSearchValue,
} = require("../src/common/search-matcher.ts");

const projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

assert.equal(normalizeSearchValue("ＡＢＣ 音樂"), "abc 音乐");
assert.equal(matchesSearchValues(["周杰倫", "葉惠美"], "周杰伦 叶惠美"), true);
assert.equal(matchesSearchValues(["周杰伦", "叶惠美"], "周杰倫 葉惠美"), true);
assert.equal(matchesSearchValues(["Take-Me Hand"], "take me"), true);
assert.equal(matchesSearchValues(["Tiny Me"], "tinyme"), true);
assert.equal(matchesSearchValues(["Beyoncé"], "beyonce"), true);
assert.equal(matchesSearchValues(["C language"], "C++"), false);
assert.equal(matchesSearchValues(["C++ Primer"], "C++"), true);
assert.equal(matchesSearchValues(["ABC"], "abc", { caseSensitive: true }), false);
assert.equal(createSearchMatcher("")([]), true);

const synchronizedSearchFiles = [
    "src/renderer/pages/main-page/views/local-music-view/index.tsx",
    "src/renderer/components/MusicSheetlikeView/components/Body/index.tsx",
    "src/renderer/pages/main-page/views/download-view/components/Downloading/index.tsx",
    "src/renderer/pages/main-page/views/statistics-view/index.tsx",
    "src/renderer/pages/main-page/views/theme-view/theme-search.ts",
];
for (const file of synchronizedSearchFiles) {
    assert.match(read(file), /(createSearchMatcher|matchesSearchValues)/, file);
}
assert.match(read(synchronizedSearchFiles[0]), /item\.\$\$localPath/);

console.log("search-matching: all assertions passed");
