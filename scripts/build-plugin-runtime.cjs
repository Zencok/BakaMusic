const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const workspace = path.join(root, "plugin-runtime");

async function prunePackagedRuntime(buildPath, platform, arch) {
    const runtimePlatform = platform === "mas" ? "darwin" : platform;
    const resources = path.join(buildPath,
        runtimePlatform === "darwin" ? "Contents/Resources" : "resources");
    const runtimeRoot = path.join(resources, "res", ".service", "plugin-v2");
    const target = `${runtimePlatform}-${arch}`;
    const binary = `baka-plugin-runtime${runtimePlatform === "win32" ? ".exe" : ""}`;
    const metadata = JSON.parse(await fs.promises.readFile(path.join(runtimeRoot, target, "runtime.json"), "utf8"));
    if (metadata.platform !== runtimePlatform || metadata.arch !== arch || metadata.runtime !== "rust-quickjs-v2") {
        throw new Error(`Packaged plugin runtime target does not match ${target}`);
    }
    await fs.promises.access(path.join(runtimeRoot, target, binary));
    for (const entry of await fs.promises.readdir(runtimeRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== target) {
            await fs.promises.rm(path.join(runtimeRoot, entry.name), { recursive: true, force: true });
        }
    }
}

function option(name, fallback) {
    const args = process.argv.slice(2);
    const direct = args.find((arg) => arg.startsWith(`${name}=`));
    if (direct) return direct.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
}

function execute(command, args, cwd = workspace) {
    const result = spawnSync(command, args, {
        cwd, env: process.env, stdio: "inherit", windowsHide: true, shell: false,
    });
    if (result.error || result.status !== 0) {
        throw new Error(`Native plugin runtime build failed: ${result.error?.message || result.status}`);
    }
}

function sourceHash() {
    const hash = crypto.createHash("sha256");
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name === "target" || entry.name === ".git") continue;
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(filename);
            else if (entry.isFile()) {
                hash.update(path.relative(workspace, filename).replaceAll("\\", "/"));
                hash.update("\0");
                hash.update(fs.readFileSync(filename));
            }
        }
    };
    visit(workspace);
    return hash.digest("hex");
}

function main() {
    const platform = option("--platform", process.platform);
    const arch = option("--arch", process.arch);
    const profile = option("--profile", process.env.BAKA_PLUGIN_RUNTIME_PROFILE || "release");
    const target = option("--target", process.env.BAKA_PLUGIN_RUNTIME_TARGET || "");
    if (!["win32", "darwin", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)) {
        throw new Error(`Unsupported plugin runtime platform: ${platform}-${arch}`);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error("Invalid Cargo profile");
    if (!target && (platform !== process.platform || arch !== process.arch)) {
        throw new Error("Cross builds must set --target and matching target C/C++ tools");
    }
    const cargo = process.env.CARGO || "cargo";
    if (!fs.existsSync(path.join(workspace, "Cargo.lock"))) {
        execute(cargo, ["generate-lockfile"]);
    }
    const args = ["build", "--locked", "--package", "baka-plugin-runtime", "--profile", profile];
    if (target) args.push("--target", target);
    execute(cargo, args);
    const targetDirectory = process.env.CARGO_TARGET_DIR
        ? path.resolve(workspace, process.env.CARGO_TARGET_DIR)
        : path.join(workspace, "target");
    const binary = `baka-plugin-runtime${platform === "win32" ? ".exe" : ""}`;
    const built = path.join(targetDirectory, target, profile === "dev" ? "debug" : profile, binary);
    const destination = path.join(root, "res", ".service", "plugin-v2", `${platform}-${arch}`);
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(built, path.join(destination, binary));
    if (platform !== "win32") fs.chmodSync(path.join(destination, binary), 0o755);
    const licenseDirectory = path.join(destination, "licenses");
    fs.mkdirSync(licenseDirectory, { recursive: true });
    fs.cpSync(path.join(workspace, "licenses"), licenseDirectory, { recursive: true });
    for (const [source, filename] of [
        ["rust/vendor/rquickjs-sys/quickjs/LICENSE", "QuickJS-MIT.txt"],
        ["rust/crates/baka-core/data/OpenCC-LICENSE", "OpenCC-LICENSE.txt"],
    ]) fs.copyFileSync(path.join(workspace, source), path.join(licenseDirectory, filename));
    fs.cpSync(path.join(workspace, "rust/crates/baka-plugin-host/licenses/lyrics"),
        path.join(licenseDirectory, "lyrics"), { recursive: true });
    fs.copyFileSync(path.join(workspace, "UPSTREAM.json"), path.join(destination, "UPSTREAM.json"));
    fs.writeFileSync(path.join(destination, "runtime.json"), JSON.stringify({
        protocolVersion: 2, runtime: "rust-quickjs-v2", platform, arch,
        target: target || "host", profile, sourceSha256: sourceHash(), binary,
    }, null, 2) + "\n");
    console.log(`[plugin-runtime] staged ${path.relative(root, destination)}`);
    if (platform === process.platform && arch === process.arch) {
        execute(process.execPath, [path.join(__dirname, "plugin-runtime-smoke.cjs"),
            "--binary", path.join(destination, binary)], root);
    }
}

if (require.main === module) main();
module.exports = { main, sourceHash, prunePackagedRuntime };
