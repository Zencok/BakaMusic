const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
    createExternalRuntimePlugin,
} = require("../config/forge-external-runtime-plugin.ts");

async function verifyManifestUpdaters(projectRoot) {
    const scriptsRoot = path.join(projectRoot, "scripts");
    const loadUpdater = (name, mockedFs = fs) => {
        const context = {
            require: (specifier) => specifier === "node:fs" ? mockedFs : require(specifier),
            __dirname: scriptsRoot,
            process: { argv: ["node", name], env: {} },
            console,
            URL,
        };
        vm.createContext(context);
        const source = fs.readFileSync(path.join(scriptsRoot, name), "utf8")
            .replace(/\nmain\(\)\.catch[\s\S]*$/, "");
        vm.runInContext(source, context);
        return context;
    };
    const runtime = loadUpdater("update-media-runtime-manifest.cjs");
    const pinnedUrl = "https://github.com/Zencok/mpv-libre-runtime/releases/download/"
        + "runtime-mpv-2a4eb8067c-librempeg-9c00336e26-fb08030026/runtime-manifest-v1.json";
    assert.equal(await runtime.resolveManifestUrl(), pinnedUrl);
    runtime.process.argv.push("--manifest-url=https://github.com/explicit/runtime-manifest-v1.json");
    assert.equal(await runtime.resolveManifestUrl(), "https://github.com/explicit/runtime-manifest-v1.json");

    const nativeManifestPath = path.join(scriptsRoot, "native-modules-manifest.json");
    let stored = fs.readFileSync(nativeManifestPath, "utf8");
    const original = JSON.parse(stored);
    const release = structuredClone(original);
    let writes = 0;
    const mockedFs = {
        ...fs,
        readFileSync: (filename, ...args) => filename === nativeManifestPath
            ? stored : fs.readFileSync(filename, ...args),
        writeFileSync: (filename, content) => {
            assert.equal(filename, nativeManifestPath);
            stored = content;
            writes++;
        },
    };
    const native = loadUpdater("update-native-modules-manifest.cjs", mockedFs);
    native.resolveManifestUrl = async () => original.releaseManifest.url;
    native.fetchReleaseAssetJson = async () => ({
        digest: original.releaseManifest.sha256, value: release,
    });
    await native.main();
    assert.equal(writes, 0);
    assert.equal(JSON.parse(stored).updatedAt, original.updatedAt);
    release.platforms["win32-x64"].modules.qmc2.sha256 = "a".repeat(64);
    await native.main();
    assert.equal(writes, 1);
    assert.deepEqual(JSON.parse(stored).devPrebuilt, original.devPrebuilt);
    assert.equal(JSON.parse(stored).notes, original.notes);
    await native.main();
    assert.equal(writes, 1);
}

async function main() {
    const projectRoot = path.join(__dirname, "..");
    await verifyManifestUpdaters(projectRoot);
    const plugin = createExternalRuntimePlugin([
        "sharp",
        "get-windows",
        "koffi",
        "@particle/dbus-next",
    ]);
    plugin.init(projectRoot);

    const forgeConfig = await plugin.getHooks().resolveForgeConfig({});
    const ignore = forgeConfig.packagerConfig.ignore;
    assert.equal(typeof ignore, "function");

    assert.equal(ignore("/node_modules/sharp/package.json"), false);
    assert.equal(ignore("/node_modules/sharp/dist/index.cjs"), false);
    assert.equal(ignore("/node_modules/sharp/dist/index.mjs"), true);
    assert.equal(ignore("/node_modules/sharp/src/sharp.cc"), true);

    const forgeSource = fs.readFileSync(
        path.join(projectRoot, "forge.config.ts"),
        "utf8",
    );
    assert.match(
        forgeSource,
        /unpack:\s*"\*\*\/node_modules\/@img\/sharp-\*\/\*\*\/\*"/,
    );

    const buildWorkflow = fs.readFileSync(
        path.join(projectRoot, ".github", "workflows", "build.yml"),
        "utf8",
    );
    for (const target of [
        "win32-x64",
        "darwin-x64",
        "darwin-arm64",
        "linux-amd64",
        "linux-arm64",
    ]) {
        assert.match(buildWorkflow, new RegExp(`asset_suffix: ${target}`));
    }
    assert.match(buildWorkflow, /runner: ubuntu-24\.04-arm/);
    assert.match(buildWorkflow, /out\/make\/deb\/\$\{\{ matrix\.arch \}\}/);

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
    assert.equal(ignore("/node_modules/koffi/index.cjs"), false);
    assert.equal(ignore("/node_modules/@particle/dbus-next/index.js"), false);
    assert.equal(ignore("/node_modules/event-stream/index.js"), false);
    assert.equal(ignore("/node_modules/xml2js/lib/parser.js"), false);
    assert.equal(
        ignore("/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node"),
        process.platform === "win32" && process.arch === "x64" ? false : true,
    );

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
