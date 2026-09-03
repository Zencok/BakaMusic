const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    collectBundleLayout,
    isMachOImage,
} = require("./sign-macos-bundle.cjs");

function makeFakeMacho(filePath, magic = "cffaedfe") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.concat([
        Buffer.from(magic, "hex"),
        Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
    ]));
}

function makeFakeText(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bakamusic-sign-test-"));
    const app = path.join(root, "BakaMusic.app");

    makeFakeMacho(path.join(app, "Contents", "MacOS", "BakaMusic"));
    makeFakeText(path.join(app, "Contents", "Info.plist"), "<plist/>");
    makeFakeMacho(path.join(app, "Contents", "Frameworks", "Electron Framework.framework", "Electron Framework"));
    makeFakeMacho(path.join(app, "Contents", "Frameworks", "Electron Helper (Plugin).app", "Contents", "MacOS", "Electron Helper (Plugin)"));
    makeFakeMacho(path.join(app, "Contents", "Frameworks", "Electron Helper (Plugin).app", "Contents", "Resources", "nested.dylib"), "cefaedfe");
    makeFakeMacho(path.join(app, "Contents", "Resources", "app.asar.unpacked", "node_modules", "koffi", "koffi.node"));
    makeFakeMacho(path.join(app, "Contents", "Resources", "res", ".runtime", "mpv", "darwin-arm64", "lib", "libmpv.2.dylib"));
    makeFakeMacho(path.join(app, "Contents", "Resources", "res", ".runtime", "mpv", "darwin-arm64", "lib", "libgraphite2.3.dylib"));
    makeFakeText(path.join(app, "Contents", "Resources", "app.asar"), "fake-asar-archive");
    makeFakeText(path.join(app, "Contents", "Resources", "res", "logo.png"), "pngbytes");
    fs.symlinkSync(
        "Info.plist",
        path.join(app, "Contents", "Resources", "res", "alias"),
    );

    const { looseMachOFiles, nestedBundles } = collectBundleLayout(app);
    const looseNames = looseMachOFiles.map((file) => path.relative(app, file));
    assert.deepEqual(looseNames, [
        path.join("Contents", "Resources", "app.asar.unpacked", "node_modules", "koffi", "koffi.node"),
        path.join("Contents", "Resources", "res", ".runtime", "mpv", "darwin-arm64", "lib", "libgraphite2.3.dylib"),
        path.join("Contents", "Resources", "res", ".runtime", "mpv", "darwin-arm64", "lib", "libmpv.2.dylib"),
    ], "loose Mach-O targets must be exactly the unpacked addons and runtime dylibs");
    assert.equal(
        looseNames.some((name) => name.includes("MacOS")),
        false,
        "the root bundle main executable must not be a loose target",
    );

    const bundleNames = nestedBundles.map((bundle) => path.relative(app, bundle));
    assert.deepEqual(bundleNames, [
        path.join("Contents", "Frameworks", "Electron Framework.framework"),
        path.join("Contents", "Frameworks", "Electron Helper (Plugin).app"),
    ], "nested helper bundles are collected; nested bundle payloads are never loose targets");

    assert.equal(isMachOImage(path.join(app, "Contents", "Resources", "app.asar")), false, "non-Mach-O files are rejected");
    assert.equal(isMachOImage(path.join(app, "Contents", "Resources", "res", "logo.png")), false, "resource files are rejected");
    assert.equal(isMachOImage(path.join(app, "Contents", "Resources", "res", "alias")), false, "symlinks are rejected");

    const magics = fs.mkdtempSync(path.join(os.tmpdir(), "bakamusic-magic-test-"));
    for (const [magic, expected] of [
        ["cffaedfe", true],
        ["cefaedfe", true],
        ["feedfacf", true],
        ["feedface", true],
        ["cafebabe", true],
        ["deadbeef", false],
    ]) {
        const probe = path.join(magics, `probe-${magic}.bin`);
        makeFakeMacho(probe, magic);
        assert.equal(isMachOImage(probe), expected, `magic ${magic}`);
    }
    const tiny = path.join(magics, "tiny.bin");
    fs.writeFileSync(tiny, Buffer.from([0xcf, 0xfa]));
    assert.equal(isMachOImage(tiny), false, "files shorter than four bytes are rejected");

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(magics, { recursive: true, force: true });
    console.log("sign-macos-bundle tests passed");
}

run();
