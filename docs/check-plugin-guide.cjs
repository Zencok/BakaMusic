// Run from any directory: node docs/check-plugin-guide.cjs
// This checks documentation coverage and links, not client/runtime compatibility.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const guidePath = path.join(__dirname, "plugin-development.md");
const guide = fs.readFileSync(guidePath, "utf8");
const rpc = fs.readFileSync(path.join(root, "src/shared/plugin-manager/rpc.ts"), "utf8");
const methodBlock = rpc.match(/pluginMethodNames\s*=\s*\[([\s\S]*?)\]\s*as const/);
assert.ok(methodBlock, "Desktop public method list must remain discoverable");
const methods = [...methodBlock[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
const mobile = [
    "getHotSearch", "getHotSearches", "getHotSearchList", "getHotSearchWords",
    "hotSearch", "getDailyRecommendations", "getAppleMusicKey",
];
for (const name of [...methods, ...mobile]) {
    assert.ok(guide.includes("`" + name + "`") || guide.includes("`" + name + "("), "Missing API coverage: " + name);
}

const anchors = [...guide.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]);
assert.equal(new Set(anchors).size, anchors.length, "Explicit anchors must be unique");
for (const name of ["capabilities", "pagination", "recognition", "hot-search", "daily", "apple-hls", "runtime", "lx", "publishing", "compatibility", "testing", "sources"]) {
    assert.ok(anchors.includes(name), "Missing documented module: " + name);
}

const documents = [guidePath, path.join(__dirname, "plugin-templates/README.md")];
let linkCount = 0;
for (const file of documents) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(!source.includes("\uFFFD"), "Broken UTF-8: " + file);
    assert.equal([...source.matchAll(/^```/gm)].length % 2, 0, "Unclosed code fence: " + file);
    for (const match of source.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
        const target = match[1];
        if (/^https?:/.test(target)) continue;
        if (target.startsWith("#")) {
            assert.ok(anchors.includes(target.slice(1)), "Broken guide anchor: " + target);
        } else {
            assert.ok(fs.existsSync(path.resolve(path.dirname(file), target)), "Broken local link: " + target);
        }
        linkCount++;
    }
}

// Optional local audit of the separate Flutter checkout: paths must be exact.
const flutterRoot = path.resolve(root, "../BakaMusicFlutter");
let flutterPaths = 0;
if (fs.existsSync(path.join(flutterRoot, "pubspec.yaml"))) {
    function expandBraces(value) {
        const match = value.match(/\{([^{}]+)\}/);
        return match
            ? match[1].split(",").flatMap(part => expandBraces(value.replace(match[0], part)))
            : [value];
    }
    for (const match of guide.matchAll(/`((?:rust\/crates\/|lib\/)[^`]+)`/g)) {
        for (const relative of expandBraces(match[1])) {
            assert.ok(fs.existsSync(path.join(flutterRoot, relative)), "Broken Flutter source reference: " + relative);
            flutterPaths++;
        }
    }
}

console.log(`Plugin guide checks passed: ${methods.length} desktop methods, ${mobile.length} mobile exports/aliases, ${linkCount} local links, ${flutterPaths} Flutter paths.`);
