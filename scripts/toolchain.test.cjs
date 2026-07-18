const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(
    path.join(projectRoot, "package.json"),
    "utf8",
));
const packageLock = JSON.parse(fs.readFileSync(
    path.join(projectRoot, "package-lock.json"),
    "utf8",
));
const workflowSource = fs.readFileSync(
    path.join(projectRoot, ".github/workflows/build.yml"),
    "utf8",
);
const nativeBuildSource = fs.readFileSync(
    path.join(projectRoot, "scripts/build-native.js"),
    "utf8",
);
const preCommitSource = fs.readFileSync(
    path.join(projectRoot, ".husky/pre-commit"),
    "utf8",
);
const projectNodeVersion = fs.readFileSync(
    path.join(projectRoot, ".node-version"),
    "utf8",
).trim();

assert.equal(packageJson.scripts.postinstall, undefined);
assert.equal(packageJson.scripts.prepare, "husky");
assert.equal(packageJson.devDependencies["node-gyp"], "13.0.1");
assert.equal(packageJson.overrides["node-gyp"], "13.0.1");
assert.equal(packageJson.overrides.tmp, "0.2.7");
assert.equal(packageJson.overrides.uuid, "11.1.1");
assert.equal(packageJson.overrides["webpack-dev-server"], "6.0.0");
assert.equal(packageLock.packages["node_modules/tmp"].version, "0.2.7");
assert.equal(packageLock.packages["node_modules/uuid"].version, "11.1.1");
assert.equal(
    packageLock.packages["node_modules/webpack-dev-server"].version,
    "6.0.0",
);
assert.equal(
    packageJson.overrides["get-windows"]["@mapbox/node-pre-gyp"],
    "2.0.3",
);
assert.equal(
    packageLock.packages["node_modules/@mapbox/node-pre-gyp"].version,
    "2.0.3",
);
assert.equal(
    packageLock.packages[
        "node_modules/get-windows/node_modules/@mapbox/node-pre-gyp"
    ],
    undefined,
);
assert.equal(
    packageJson.engines.node,
    "^24.15.0",
);
assert.equal(projectNodeVersion, "24.15.0");
assert.equal(
    fs.existsSync(path.join(projectRoot, "scripts/patch-node-gyp.js")),
    false,
);
assert.equal(
    fs.existsSync(path.join(projectRoot, "scripts/feishu-upload.js")),
    false,
);
assert.equal(packageJson.devDependencies["@larksuiteoapi/node-sdk"], undefined);
assert.doesNotMatch(preCommitSource, /_\/husky\.sh/);

assert.match(workflowSource, /NODE_VERSION:\s*"24\.15\.0"/);
assert.match(workflowSource, /NODE_GYP_VERSION:\s*"13\.0\.1"/);
assert.match(workflowSource, /Verify node-gyp toolchain/);
assert.doesNotMatch(workflowSource, /patch-node-gyp/);
assert.match(nativeBuildSource, /npm exec node-gyp -- rebuild/);

console.log("toolchain: all assertions passed");
