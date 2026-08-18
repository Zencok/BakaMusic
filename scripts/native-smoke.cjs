const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

function readOption(name, fallback) {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

if (args.includes("--electron") && !process.versions.electron) {
    const electronPath = require("electron");
    const forwardedArgs = args.filter((arg) => arg !== "--electron");
    const result = spawnSync(electronPath, [__filename, ...forwardedArgs], {
        cwd: root,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
        },
        stdio: "inherit",
    });
    process.exit(result.status ?? 1);
}

const nativeDir = path.resolve(readOption(
    "--dir",
    path.join(root, "res", ".service", "native"),
));
const expectedArch = readOption("--arch", process.arch);
const expectedPlatform = readOption("--platform", process.platform);
const manifestModules = JSON.parse(fs.readFileSync(
    path.join(root, "scripts", "native-modules-manifest.json"),
    "utf8",
)).modules || ["qmc2", "ence", "taglib", "transcode"];
const defaultModules = new Set(manifestModules);
if (process.platform === "win32" || process.platform === "darwin") {
    defaultModules.add("smtc");
}
const modules = readOption(
    "--modules",
    process.env.REQUIRED_NATIVE_MODULES || [...defaultModules].join(","),
).split(",").map((name) => name.trim()).filter(Boolean);

assert.equal(process.arch, expectedArch, `runtime arch mismatch: ${process.arch}`);
assert.equal(process.platform, expectedPlatform, `runtime platform mismatch: ${process.platform}`);
assert.ok(process.versions.napi, "runtime does not expose an N-API version");
assert.ok(modules.length > 0, "at least one native module is required");

const requiredExports = {
    qmc2: ["decryptEKey", "createDecoder", "decrypt", "destroyDecoder"],
    ence: ["createDecoder", "getInfo", "getHeader", "decrypt", "destroyDecoder"],
    taglib: ["readTags", "writeTags"],
    transcode: ["probeMp4AudioCodec", "probeAudioCodec", "transcode"],
    smtc: ["isSupported", "initialize", "update", "clear", "dispose"],
};

let taglibVersion = null;
for (const moduleName of modules) {
    const modulePath = path.join(nativeDir, `${moduleName}.node`);
    assert.ok(fs.existsSync(modulePath), `native module is missing: ${modulePath}`);
    const nativeModule = require(modulePath);
    assert.ok(nativeModule && typeof nativeModule === "object", `${moduleName} did not load`);
    for (const exportName of requiredExports[moduleName] || []) {
        assert.equal(
            typeof nativeModule[exportName],
            "function",
            `${moduleName}.${exportName} is missing`,
        );
    }
    if (moduleName === "taglib" && typeof nativeModule.taglibVersion === "string") {
        taglibVersion = nativeModule.taglibVersion;
        assert.match(taglibVersion, /^\d+\.\d+(\.\d+)?$/, "taglibVersion format");
    }
    if (moduleName === "smtc") {
        assert.equal(
            nativeModule.isSupported(),
            process.platform === "win32" || process.platform === "darwin",
            "native media controls platform support mismatch",
        );
        if (process.platform === "darwin") {
            nativeModule.initialize(Buffer.alloc(0), () => undefined);
            nativeModule.update({
                mediaType: "music",
                title: "BakaMusic native smoke",
                artist: "BakaMusic",
                album: "System Media Controls",
                artwork: "",
                appMediaId: "native-smoke:darwin",
                state: "paused",
                position: 1,
                duration: 2,
                playbackRate: 1,
                volume: 0.5,
                repeatMode: "queue-repeat",
                nextEnabled: true,
                previousEnabled: true,
                updateMetadata: true,
            });
            nativeModule.clear();
            nativeModule.dispose();
        }
    }
}

console.log(
    `native-smoke: ${modules.join(", ")} loaded on ${process.platform}/${process.arch} `
    + `(Node ABI ${process.versions.modules}, N-API ${process.versions.napi}`
    + `${process.versions.electron ? `, Electron ${process.versions.electron}` : ""}`
    + `${taglibVersion ? `, TagLib ${taglibVersion}` : ""})`,
);
