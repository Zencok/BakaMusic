const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    shouldShowAvailableUpdate,
} = require("../src/renderer/utils/update-version");
const {
    renderUpdateChangelog,
} = require("../src/renderer/utils/update-changelog");
const {
    appUpdateApiSources,
    appUpdateLatestPageSources,
    githubAcceleratorPrefixes,
    githubDownloadMirrors,
    themePackStoreBaseUrl,
} = require("../src/common/constant");

const latestReleaseApiUrl =
    "https://api.github.com/repos/Zencok/BakaMusic/releases/latest";
const themeStoreDirectUrl =
    "https://raw.githubusercontent.com/Toskysun/BakaThemePacks/v2/prod/";
const latestReleasePageUrl =
    "https://github.com/Zencok/BakaMusic/releases/latest";
for (const prefix of githubAcceleratorPrefixes) {
    assert.ok(appUpdateApiSources.includes(`${prefix}${latestReleaseApiUrl}`));
    assert.ok(appUpdateLatestPageSources.includes(`${prefix}${latestReleasePageUrl}`));
    assert.ok(themePackStoreBaseUrl.includes(`${prefix}${themeStoreDirectUrl}`));
    assert.ok(githubDownloadMirrors.includes(prefix));
}
assert.equal(appUpdateApiSources.at(-1), latestReleaseApiUrl);
assert.equal(appUpdateLatestPageSources.at(-1), latestReleasePageUrl);
assert.equal(githubDownloadMirrors.at(-1), "");

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
assert.match(updateMainSource, /Promise\.any\(requests\)/);
assert.match(updateMainSource, /"X-GitHub-Api-Version": "2022-11-28"/);
assert.match(updateMainSource, /normalizeGitHubRelease\(response\.data\)/);
assert.match(updateMainSource, /"https:\/\/github\.com\/Zencok\/BakaMusic\/releases\/download\/"/);
assert.match(updateMainSource, /throw new Error\("Release has no valid assets"\)/);
assert.match(updateMainSource, /createReleaseFromLatestRedirect\(response\.headers\.location\)/);
assert.match(updateMainSource, /BakaMusic-\$\{version\}-win32-x64-setup\.exe/);
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
