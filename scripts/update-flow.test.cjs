const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    shouldShowAvailableUpdate,
} = require("../src/renderer/utils/update-version");
const {
    renderUpdateChangelog,
} = require("../src/renderer/utils/update-changelog");

assert.equal(shouldShowAvailableUpdate("1.2.3", null, false), true);
assert.equal(shouldShowAvailableUpdate("1.2.3", "1.2.3", false), false);
assert.equal(shouldShowAvailableUpdate("1.2.3", "1.3.0", false), false);
assert.equal(shouldShowAvailableUpdate("1.3.0", "1.2.3", false), true);
assert.equal(shouldShowAvailableUpdate("1.2.3", "1.2.3", true), true);

const safeChangelog = renderUpdateChangelog([
    "## Changes",
    "- Fixed <script>alert(1)</script>",
    "[Release](https://example.com/\" onmouseover=\"alert(1))",
    "[Blocked](javascript:alert(1))",
]);
assert.match(safeChangelog, /<strong>Changes<\/strong>/);
assert.match(safeChangelog, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(safeChangelog, /href="javascript:/);
assert.doesNotMatch(safeChangelog, /href="[^"]*" onmouseover=/);

const updateMainSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/utils/main.ts",
), "utf8");
assert.match(updateMainSource, /new AbortController\(\)/);
assert.match(updateMainSource, /signal:\s*downloadState\.controller\.signal/);
assert.match(updateMainSource, /UPDATE_PROGRESS_INTERVAL_MS/);
assert.match(updateMainSource, /completedUpdateDownloads\.get\(evt\.sender\.id\)/);
assert.match(updateMainSource, /await fs\.unlink\(filePath\)\.catch/);
assert.match(updateMainSource, /sender\.once\("destroyed", abortOnSenderDestroyed\)/);
assert.doesNotMatch(
    updateMainSource,
    /@shared\/utils\/install-update",\s*\(_,\s*filePath:/,
);

const updateComponentSource = fs.readFileSync(path.join(
    __dirname,
    "../src/renderer/components/Modal/templates/Update/index.tsx",
), "utf8");
assert.match(updateComponentSource, /await appUtil\.installUpdate\(\)/);
assert.match(updateComponentSource, /includes\("Download cancelled"\)/);

console.log("update-flow: all assertions passed");
