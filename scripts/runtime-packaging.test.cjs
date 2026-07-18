const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    createExternalRuntimePlugin,
} = require("../config/forge-external-runtime-plugin.ts");

async function main() {
    const projectRoot = path.join(__dirname, "..");
    const plugin = createExternalRuntimePlugin([
        "sharp",
        "get-windows",
    ]);
    plugin.init(projectRoot);

    const forgeConfig = await plugin.getHooks().resolveForgeConfig({});
    const ignore = forgeConfig.packagerConfig.ignore;
    assert.equal(typeof ignore, "function");

    assert.equal(ignore("/node_modules/sharp/package.json"), false);
    assert.equal(ignore("/node_modules/sharp/dist/index.cjs"), false);
    assert.equal(ignore("/node_modules/sharp/dist/index.mjs"), true);
    assert.equal(ignore("/node_modules/sharp/src/sharp.cc"), true);

    const sharpMetadata = JSON.parse(fs.readFileSync(
        path.join(projectRoot, "node_modules/sharp/package.json"),
        "utf8",
    ));
    const installedPlatformPackage = Object.keys(
        sharpMetadata.optionalDependencies,
    ).find((packageName) => fs.existsSync(
        path.join(projectRoot, "node_modules", packageName),
    ));
    assert.ok(installedPlatformPackage);
    assert.equal(
        ignore(`/node_modules/${installedPlatformPackage}/package.json`),
        false,
    );

    assert.equal(ignore("/node_modules/get-windows/lib/windows.js"), false);
    assert.equal(
        ignore("/node_modules/@mapbox/node-pre-gyp/lib/pre-binding.js"),
        false,
    );
    assert.equal(ignore("/node_modules/consola/index.js"), false);
    assert.equal(ignore("/node_modules/detect-libc/lib/detect-libc.js"), false);
    assert.equal(ignore("/node_modules/nopt/lib/nopt-lib.js"), false);
    assert.equal(ignore("/node_modules/semver/index.js"), false);

    for (const packageName of [
        "https-proxy-agent",
        "node-addon-api",
        "node-fetch",
        "node-gyp",
        "tar",
    ]) {
        assert.equal(ignore(`/node_modules/${packageName}`), true);
    }

    console.log("runtime packaging: all assertions passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
