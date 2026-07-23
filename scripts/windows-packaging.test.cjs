const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const packageJson = require(path.join(projectRoot, "package.json"));
const {
    githubAcceleratorPrefixes,
} = require(path.join(projectRoot, "src/common/constant.ts"));
const {
    createNsisWebPackageUrl,
} = require(path.join(projectRoot, "config/forge-nsis-maker.ts"));
const forgeConfig = require(path.join(projectRoot, "forge.config.ts")).default;
const workflowSource = fs.readFileSync(
    path.join(projectRoot, ".github/workflows/build.yml"),
    "utf8",
);

async function run() {
    const nsisMaker = forgeConfig.makers.find((maker) => maker.name === "nsis");
    assert.ok(nsisMaker, "Forge must configure an NSIS maker");
    assert.deepEqual(nsisMaker.platforms, ["win32"]);

    await nsisMaker.prepareConfig("x64");
    assert.equal(nsisMaker.config.appId, "com.zencok.bakamusic");
    assert.equal(nsisMaker.config.compression, "maximum");
    assert.deepEqual(nsisMaker.config.targets, ["nsis", "nsis-web"]);
    assert.equal(
        nsisMaker.config.webPackageBaseUrl,
        "https://github.com/Zencok/BakaMusic/releases/download",
    );
    assert.equal(
        nsisMaker.config.webPackageUrlPrefix,
        githubAcceleratorPrefixes[0],
    );
    assert.equal(nsisMaker.config.nsis.oneClick, false);
    assert.equal(nsisMaker.config.nsis.perMachine, false);
    assert.equal(nsisMaker.config.nsis.selectPerMachineByDefault, true);
    assert.equal(nsisMaker.config.nsis.allowToChangeInstallationDirectory, true);
    assert.equal(
        nsisMaker.config.nsis.include,
        path.join(projectRoot, "release/installer.nsh"),
    );
    assert.equal(
        nsisMaker.config.nsis.artifactName,
        "BakaMusic-${version}-win32-${arch}-setup.${ext}",
    );
    assert.deepEqual(
        nsisMaker.config.nsis.installerLanguages,
        ["en_US", "zh_CN"],
    );
    assert.equal(
        nsisMaker.config.nsisWeb.artifactName,
        "BakaMusic-${version}-win32-${arch}-web-setup.${ext}",
    );
    assert.equal(
        createNsisWebPackageUrl(
            nsisMaker.config.webPackageBaseUrl,
            nsisMaker.config.webPackageName,
            packageJson.version,
            "x64",
            githubAcceleratorPrefixes[0],
        ),
        `${githubAcceleratorPrefixes[0]}`
        + "https://github.com/Zencok/BakaMusic/releases/download/"
        + "v1.0.0/bakamusic-1.0.0-x64.nsis.7z",
    );
    assert.equal(
        createNsisWebPackageUrl(
            nsisMaker.config.webPackageBaseUrl,
            nsisMaker.config.webPackageName,
            packageJson.version,
            "x64",
            "",
        ),
        "https://github.com/Zencok/BakaMusic/releases/download/"
        + "v1.0.0/bakamusic-1.0.0-x64.nsis.7z",
    );

    assert.equal(packageJson.devDependencies["app-builder-lib"], "26.15.3");
    assert.equal(
        packageJson.devDependencies["@electron-forge/maker-base"],
        "7.11.2",
    );
    assert.match(workflowSource, /npm run make -- .*--skip-package/);
    assert.match(workflowSource, /\.nsis\.7z/);
    assert.match(workflowSource, /-web-setup\.exe/);
    assert.doesNotMatch(workflowSource, /\biscc\b|innosetup/i);
    assert.equal(
        fs.existsSync(path.join(projectRoot, "release/build-windows.iss")),
        false,
    );
    const nsisIncludeSource = fs.readFileSync(
        path.join(projectRoot, "release/installer.nsh"),
        "utf8",
    );
    assert.match(nsisIncludeSource, /\{BakaMusic\}_is1/);
    assert.match(nsisIncludeSource, /!macro customInstallMode/);
    assert.match(nsisIncludeSource, /!macro customInstall/);

    console.log("windows-packaging: all assertions passed");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
