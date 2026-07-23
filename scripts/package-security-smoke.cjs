const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    FuseV1Options,
    getCurrentFuseWire,
} = require("@electron/fuses");

const root = path.resolve(__dirname, "..");
const platform = process.platform;
const arch = process.arch;
const bundleRoot = path.join(root, "out", `BakaMusic-${platform}-${arch}`);
const resourcesPath = platform === "darwin"
    ? path.join(bundleRoot, "BakaMusic.app", "Contents", "Resources")
    : path.join(bundleRoot, "resources");
const executablePath = platform === "darwin"
    ? path.join(bundleRoot, "BakaMusic.app", "Contents", "MacOS", "BakaMusic")
    : platform === "win32"
        ? path.join(bundleRoot, "BakaMusic.exe")
        : path.join(bundleRoot, "BakaMusic");

const enabled = 49;
const disabled = 48;

async function run() {
    assert.ok(fs.existsSync(executablePath), `packaged executable is missing: ${executablePath}`);
    assert.ok(
        fs.existsSync(path.join(resourcesPath, "app.asar")),
        "packaged application must use app.asar",
    );
    assert.equal(
        fs.existsSync(path.join(resourcesPath, "app")),
        false,
        "loose resources/app source tree must not be packaged",
    );
    const mediaRuntimeRoot = path.join(
        resourcesPath,
        "res",
        ".runtime",
    );
    const platformRuntimeKey = `${platform}-${arch}`;
    const mpvRoot = path.join(mediaRuntimeRoot, "mpv", platformRuntimeKey);
    const libraryPath = platform === "win32"
        ? "libmpv-2.dll"
        : platform === "darwin"
            ? path.join("lib", "libmpv.2.dylib")
            : path.join("lib", "libmpv.so.2");
    const executableSuffix = platform === "win32" ? ".exe" : "";
    for (const relativePath of [
        libraryPath,
        `ffmpeg${executableSuffix}`,
        `ffprobe${executableSuffix}`,
        "runtime.json",
    ]) {
        assert.ok(
            fs.existsSync(path.join(mpvRoot, relativePath)),
            `packaged libmpv runtime entry is missing: ${relativePath}`,
        );
    }
    const mpvManifest = JSON.parse(fs.readFileSync(
        path.join(mpvRoot, "runtime.json"),
        "utf8",
    ));
    assert.equal(mpvManifest.engine, "libmpv");
    assert.equal(mpvManifest.mediaBackend, "librempeg");
    assert.ok(mpvManifest.decoders.includes("ac4"));

    if (platform === "win32" && arch === "x64") {
        const koffiAddon = path.join(
            resourcesPath,
            "app.asar.unpacked",
            "node_modules",
            "@koromix",
            "koffi-win32-x64",
            "win32_x64",
            "koffi.node",
        );
        assert.ok(fs.existsSync(koffiAddon), "packaged Koffi native addon is missing");
    }

    const fuses = await getCurrentFuseWire(executablePath);
    assert.equal(fuses[FuseV1Options.RunAsNode], disabled, "RunAsNode fuse must be disabled");
    assert.equal(
        fuses[FuseV1Options.EnableCookieEncryption],
        enabled,
        "cookie encryption fuse must be enabled",
    );
    assert.equal(
        fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable],
        disabled,
        "NODE_OPTIONS fuse must be disabled",
    );
    assert.equal(
        fuses[FuseV1Options.EnableNodeCliInspectArguments],
        disabled,
        "Node CLI inspect fuse must be disabled",
    );
    assert.equal(
        fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
        enabled,
        "embedded ASAR integrity fuse must be enabled",
    );
    assert.equal(
        fuses[FuseV1Options.OnlyLoadAppFromAsar],
        enabled,
        "OnlyLoadAppFromAsar fuse must be enabled",
    );
    assert.equal(
        fuses[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot],
        disabled,
        "browser-specific V8 snapshot fuse must be disabled",
    );
    assert.equal(
        fuses[FuseV1Options.GrantFileProtocolExtraPrivileges],
        enabled,
        "file protocol privilege fuse must support packaged renderer entries",
    );
    assert.equal(
        fuses[FuseV1Options.WasmTrapHandlers],
        enabled,
        "WebAssembly trap-handler fuse must be enabled",
    );

    console.log(`package-security-smoke: ASAR and Electron fuses verified (${platform}/${arch})`);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
