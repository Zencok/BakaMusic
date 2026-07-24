/**
 * Cross-platform native module builder (source fallback).
 *
 * Preferred path for app CI/dev is prebuilt install:
 *   npm run native:install
 * which downloads SHA-256 verified archives from Zencok/baka-native.
 *
 * This script remains for maintainers with a local native/ checkout
 * (or `npm run native:install -- --from-source`).
 *
 * Compiles every module under native/<name>/ that has a binding.gyp via
 * node-gyp, and copies the resulting *.node into res/.service/native/.
 * Runs prepare.cjs when present (e.g. taglib downloads TagLib latest).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const nativeDir = path.join(root, "native");
const outDir = path.join(root, "res", ".service", "native");
const isCi = process.env.CI === "true";
const requiredModules = (process.env.REQUIRED_NATIVE_MODULES || "qmc2,ence,taglib")
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
    const prepareScript = path.join(modDir, "prepare.cjs");
    if (fs.existsSync(prepareScript)) {
        console.log(`[build-native] preparing ${mod} ...`);
        execFileSync(process.execPath, [prepareScript], {
            cwd: modDir,
            stdio: "inherit",
            env: process.env,
        });
    }
    console.log(`[build-native] building ${mod} ...`);
    const electronVersion = process.env.ELECTRON_VERSION
        || (() => {
            try {
                return JSON.parse(
                    fs.readFileSync(path.join(root, "package.json"), "utf8"),
                ).devDependencies.electron.replace(/^[^\d]*/, "");
            } catch {
                return "";
            }
        })();
    const rebuildArgs = electronVersion
        ? `npm exec node-gyp -- rebuild --target=${electronVersion} --arch=${process.arch} --dist-url=https://electronjs.org/headers`
        : "npm exec node-gyp -- rebuild";
    execSync(rebuildArgs, { cwd: modDir, stdio: "inherit" });

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
