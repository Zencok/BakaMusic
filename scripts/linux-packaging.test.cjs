const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const forgeConfig = require(path.join(projectRoot, "forge.config.ts")).default;
const workflowSource = fs.readFileSync(
    path.join(projectRoot, ".github/workflows/build.yml"),
    "utf8",
);

async function run() {
    const appImageMaker = forgeConfig.makers.find((maker) => maker.name === "appimage");
    assert.ok(appImageMaker, "Forge must configure an AppImage maker");
    assert.deepEqual(appImageMaker.platforms, ["linux"]);

    await appImageMaker.prepareConfig("x64");
    assert.equal(appImageMaker.config.appId, "com.zencok.bakamusic");
    assert.equal(appImageMaker.config.compression, "maximum");
    assert.equal(appImageMaker.config.linux.executableName, "BakaMusic");
    assert.equal(appImageMaker.config.linux.category, "AudioVideo");
    assert.equal(
        appImageMaker.config.appImage.artifactName,
        "BakaMusic-${version}-linux-${arch}.${ext}",
    );
    assert.equal(appImageMaker.config.appImage.compression, "xz");

    assert.match(workflowSource, /find \.\/out\/make -name '\*\.AppImage'/);
    assert.match(workflowSource, /BakaMusic-\$\{VERSION\}-\$\{\{ matrix\.asset_suffix \}\}\.AppImage/);
    assert.match(workflowSource, /BakaMusic-\$\{VERSION\}-\$\{\{ matrix\.asset_suffix \}\}\.deb/);

    console.log("linux-packaging: all assertions passed");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
