const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { smoke, runtimeBinary } = require("./plugin-runtime-smoke.cjs");
const { prunePackagedRuntime } = require("./build-plugin-runtime.cjs");

async function main() {
    const root = path.resolve(__dirname, "..");
    const workspace = path.join(root, "plugin-runtime");
    const upstream = JSON.parse(fs.readFileSync(path.join(workspace, "UPSTREAM.json"), "utf8"));
    assert.equal(upstream.commit, "236e46302cfb4334bd964bde38991fbbeb339d07");
    for (const entry of upstream.importedFiles) {
        const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(workspace, entry.path))).digest("hex");
        assert.equal(actual, entry.sha256, `Vendored upstream source changed: ${entry.path}`);
    }
    const manifest = fs.readFileSync(path.join(workspace, "Cargo.toml"), "utf8");
    assert.doesNotMatch(manifest, /\.\.\/.*BakaMusicFlutter|[A-Za-z]:[\\/]/);
    assert.match(manifest, /rquickjs-sys = \{ path = "rust\/vendor\/rquickjs-sys" \}/);
    const webpack = fs.readFileSync(path.join(root, "config/webpack.main.config.ts"), "utf8");
    assert.doesNotMatch(webpack, /(?:^|\n)\s*(?:lx_)?plugin_host:/);
    const forge = fs.readFileSync(path.join(root, "forge.config.ts"), "utf8");
    assert.ok(forge.includes("native|plugin-runtime"), "Rust source must be excluded from ASAR");
    assert.match(forge, /afterCopyExtraResources/, "Target filtering must run before code signing");
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "baka-runtime-package-"));
    try {
        for (const platform of ["win32", "darwin", "linux"]) {
            const staged = path.join(fixture, platform);
            const stagedRoot = path.join(staged, platform === "darwin" ? "Contents/Resources" : "resources", "res/.service/plugin-v2");
            fs.mkdirSync(path.join(stagedRoot, `${platform}-x64`), { recursive: true });
            fs.mkdirSync(path.join(stagedRoot, "other-platform"), { recursive: true });
            fs.writeFileSync(path.join(stagedRoot, `${platform}-x64`, "runtime.json"), JSON.stringify({ platform, arch: "x64", runtime: "rust-quickjs-v2" }));
            fs.writeFileSync(path.join(stagedRoot, `${platform}-x64`, `baka-plugin-runtime${platform === "win32" ? ".exe" : ""}`), "fixture");
            await prunePackagedRuntime(staged, platform, "x64");
            assert.deepEqual(fs.readdirSync(stagedRoot), [`${platform}-x64`]);
            await assert.rejects(prunePackagedRuntime(staged, platform, "arm64"));
        }
    } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    for (const name of ["start", "dev", "package", "make", "publish"]) {
        assert.ok(pkg.scripts[name].includes("build:plugin-runtime"), `${name} must build the native runtime`);
    }
    let binary = runtimeBinary();
    if (process.argv.includes("--packaged")) {
        const app = path.join(root, "out", `BakaMusic-${process.platform}-${process.arch}`);
        const resources = process.platform === "darwin"
            ? path.join(app, "BakaMusic.app/Contents/Resources") : path.join(app, "resources");
        const runtimeRoot = path.join(resources, "res/.service/plugin-v2");
        assert.deepEqual(fs.readdirSync(runtimeRoot).filter((name) => fs.statSync(path.join(runtimeRoot, name)).isDirectory()),
            [`${process.platform}-${process.arch}`], "Package must contain only its own target runtime");
        binary = path.join(runtimeRoot, `${process.platform}-${process.arch}`, path.basename(binary));
        assert.ok(!fs.existsSync(path.join(resources, "app/plugin-runtime")));
        const asar = require("@electron/asar");
        assert.ok(!asar.listPackage(path.join(resources, "app.asar")).some((entry) => /(?:^|\/)plugin-runtime\//.test(entry)),
            "Cargo source/artifacts must not enter ASAR");
    }
    const runtimeRoot = path.dirname(binary);
    const runtime = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "runtime.json"), "utf8"));
    assert.equal(runtime.runtime, "rust-quickjs-v2");
    assert.equal(runtime.protocolVersion, 2);
    assert.equal(runtime.platform, process.platform);
    assert.equal(runtime.arch, process.arch);
    for (const license of ["BakaMusicFlutter-SOURCE-AVAILABLE.txt", "QuickJS-MIT.txt", "OpenCC-LICENSE.txt", "lyrics/LICENSE-AMLL", "lyrics/LICENSE-BakaMusic", "lyrics/LICENSE-xmldom"]) {
        assert.ok(fs.existsSync(path.join(runtimeRoot, "licenses", license)), `Missing distributed notice ${license}`);
    }
    await smoke(binary);
    console.log("plugin-runtime-packaging: standalone provenance, build wiring, notices and executable passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
