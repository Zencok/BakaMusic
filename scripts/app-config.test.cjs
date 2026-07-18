const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    createChangedConfigPatch,
    createResetConfigUpdate,
} = require("../src/shared/app-config/config-utils");

const sharedValue = { enabled: true };
assert.deepEqual(createChangedConfigPatch(
    { alpha: 1, beta: sharedValue },
    { alpha: 1, beta: sharedValue },
), {});
assert.deepEqual(createChangedConfigPatch(
    { alpha: 1, beta: sharedValue },
    { alpha: 2, beta: sharedValue },
), { alpha: 2 });

assert.deepEqual(createResetConfigUpdate(
    { alpha: 1, secret: "stored" },
    { alpha: 2 },
), {
    config: { alpha: 2 },
    patch: { alpha: 2, secret: null },
});

const mainSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/app-config/main.ts",
), "utf8");
assert.match(mainSource, /CONFIG_WRITE_DEBOUNCE_MS/);
assert.match(mainSource, /originalFs\.renameSync\(temporaryPath, this\.configPath\)/);
assert.match(mainSource, /createResetConfigUpdate/);
assert.match(mainSource, /catch \(error\) \{[\s\S]*?配置更新回调执行失败/);

const rendererSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/app-config/renderer.ts",
), "utf8");
assert.match(rendererSource, /private setupPromise: Promise<void> \| null = null/);
assert.match(rendererSource, /update\.replace/);

console.log("app-config: all assertions passed");
