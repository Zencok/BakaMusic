/**
 * Cross-platform native module builder.
 *
 * Compiles every module under native/<name>/ that has a binding.gyp via
 * node-gyp, and copies the resulting *.node into res/.service/native/.
 * Replaces the previous bash-only `cd ... && mkdir -p && cp` recipe so it
 * works on Windows (cmd), macOS and Linux alike.
 *
 * N-API (NAPI_VERSION) keeps the binaries ABI-stable, so a host-node build
 * loads fine inside the Electron child process at runtime.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const nativeDir = path.join(root, "native");
const outDir = path.join(root, "res", ".service", "native");
const isCi = process.env.CI === "true";
const requiredModules = (process.env.REQUIRED_NATIVE_MODULES || "qmc2,ence")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

if (!fs.existsSync(nativeDir)) {
    if (isCi) {
        throw new Error("[build-native] native/ directory is required in CI");
    }
    console.log("[build-native] no native/ directory, nothing to do");
    process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
if (isCi) {
    for (const mod of requiredModules) {
        fs.rmSync(path.join(outDir, `${mod}.node`), { force: true });
    }
}

const modules = fs
    .readdirSync(nativeDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(nativeDir, d.name, "binding.gyp")))
    .map((d) => d.name);

if (modules.length === 0) {
    if (isCi) {
        throw new Error("[build-native] no native modules found in CI");
    }
    console.log("[build-native] no native modules found");
    process.exit(0);
}

const missingRequiredModules = requiredModules.filter((mod) => !modules.includes(mod));
if (missingRequiredModules.length) {
    const message = `[build-native] missing required native modules: ${missingRequiredModules.join(", ")}`;
    if (isCi) {
        throw new Error(message);
    }
    console.log(`${message}; skipping missing local modules`);
}

const builtModules = new Set();

for (const mod of modules) {
    const modDir = path.join(nativeDir, mod);
    console.log(`[build-native] building ${mod} ...`);
    execSync("npm exec node-gyp -- rebuild", { cwd: modDir, stdio: "inherit" });

    const releaseDir = path.join(modDir, "build", "Release");
    if (!fs.existsSync(releaseDir)) {
        throw new Error(`[build-native] ${mod}: build/Release not found after build`);
    }
    const nodeFiles = fs.readdirSync(releaseDir).filter((f) => f.endsWith(".node"));
    if (nodeFiles.length === 0) {
        throw new Error(`[build-native] ${mod}: no .node produced`);
    }
    for (const f of nodeFiles) {
        const dest = path.join(outDir, f);
        fs.copyFileSync(path.join(releaseDir, f), dest);
        builtModules.add(path.basename(f, ".node"));
        console.log(`[build-native] -> ${path.relative(root, dest).replace(/\\/g, "/")}`);
    }
}

if (isCi) {
    const missingOutputs = requiredModules.filter((mod) => !builtModules.has(mod));
    if (missingOutputs.length) {
        throw new Error(`[build-native] required native outputs were not built: ${missingOutputs.join(", ")}`);
    }
}

execFileSync(process.execPath, [
    path.join(__dirname, "native-smoke.cjs"),
    "--dir",
    outDir,
    "--arch",
    process.arch,
    "--platform",
    process.platform,
    "--modules",
    [...builtModules].join(","),
], { cwd: root, stdio: "inherit" });

console.log("[build-native] done");
