#!/usr/bin/env node
// Ad-hoc code-sign every Mach-O inside a packaged macOS .app bundle.
//
// Why this exists: `codesign --force --deep --sign -` only re-signs nested
// bundles and the main executable. It never touches loose Mach-O files under
// Contents/Resources (koffi.node, the libmpv runtime dylibs under
// res/.runtime, sharp addons in app.asar.unpacked). One image with stale page
// hashes is enough for macOS to SIGKILL a child process: Chromium-derived
// hosts spawn utility processes with CS_KILL|CS_HARD, so the kernel kills the
// libmpv playback host the moment an invalid page is paged in ("libmpv
// playback runtime exited with code 9"). Plain ad-hoc signatures carry no
// hardened runtime and no entitlements, so Library Validation stays off —
// what must be repaired is signature *validity*, not provenance.
//
// Sign order matters: loose files first, nested bundles deepest-first, and
// the outer .app last so its CodeResources seal covers the final bytes.
//
// Usage:
//   node scripts/sign-macos-bundle.cjs <BakaMusic.app>          # sign + verify
//   node scripts/sign-macos-bundle.cjs <BakaMusic.app> --verify # verify only
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MACHO_MAGICS = new Set([
    "cffaedfe", // MH_MAGIC_64 little-endian
    "cefaedfe", // MH_MAGIC little-endian
    "feedfacf", // MH_MAGIC_64 big-endian
    "feedface", // MH_MAGIC big-endian
    "cafebabe", // FAT/universal
]);
const BUNDLE_EXTENSIONS = [".app", ".framework", ".xpc"];

function isMachOImage(filePath) {
    let fd;
    try {
        fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(4);
        const bytesRead = fs.readSync(fd, buffer, 0, 4, 0);
        if (bytesRead < 4) {
            return false;
        }
        return MACHO_MAGICS.has(buffer.toString("hex"));
    } catch {
        return false;
    } finally {
        if (fd !== undefined) {
            fs.closeSync(fd);
        }
    }
}

// Walk the bundle and classify its contents for signing. Nested bundles
// (helper .apps, the Electron Framework) are collected as bundles — signing
// the bundle seals their Info.plist and resources — while every other Mach-O
// file outside Contents/MacOS of the root bundle is a loose target.
function collectBundleLayout(appRoot) {
    const looseMachOFiles = [];
    const nestedBundles = [];

    const walk = (dir, relativeParts) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            const entryParts = [...relativeParts, entry.name];
            if (entry.isSymbolicLink()) {
                continue;
            }
            if (entry.isDirectory()) {
                if (BUNDLE_EXTENSIONS.includes(path.extname(entry.name))) {
                    nestedBundles.push({ path: entryPath, depth: entryParts.length });
                }
                walk(entryPath, entryParts);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const insideNestedBundle = relativeParts.some((part) =>
                BUNDLE_EXTENSIONS.includes(path.extname(part)));
            if (insideNestedBundle) {
                continue;
            }
            // The root bundle's own main executable is signed by the final
            // whole-bundle signature, not as a loose file.
            if (relativeParts.length === 2
                && relativeParts[0] === "Contents"
                && relativeParts[1] === "MacOS") {
                continue;
            }
            if (isMachOImage(entryPath)) {
                looseMachOFiles.push(entryPath);
            }
        }
    };
    walk(appRoot, []);

    looseMachOFiles.sort();
    // Deepest first: a bundle nested inside another bundle must carry its own
    // signature before the outer bundle seals it into CodeResources.
    nestedBundles.sort((a, b) => b.depth - a.depth);
    return {
        looseMachOFiles,
        nestedBundles: nestedBundles.map((bundle) => bundle.path),
    };
}

function assertDarwin() {
    if (process.platform !== "darwin") {
        throw new Error("sign-macos-bundle requires macOS (codesign)");
    }
}

function runCodesign(args, what) {
    try {
        execFileSync("codesign", args, { stdio: "inherit" });
    } catch (error) {
        throw new Error(`codesign failed for ${what}: ${error.message}`);
    }
}

function signAppBundle(appPath) {
    assertDarwin();
    const { looseMachOFiles, nestedBundles } = collectBundleLayout(appPath);
    for (const file of looseMachOFiles) {
        console.log(`==> ad-hoc signing ${path.relative(appPath, file)}`);
        runCodesign(["--force", "--sign", "-", file], file);
    }
    for (const bundle of nestedBundles) {
        console.log(`==> ad-hoc signing ${path.relative(appPath, bundle)}`);
        runCodesign(["--force", "--sign", "-", bundle], bundle);
    }
    console.log(`==> ad-hoc signing ${path.basename(appPath)} (bundle seal)`);
    runCodesign(["--force", "--sign", "-", appPath], appPath);
    verifyAppBundle(appPath);
}

function verifyAppBundle(appPath) {
    assertDarwin();
    const identityConfigured = Boolean(process.env.MACOS_SIGN_IDENTITY);
    const { looseMachOFiles, nestedBundles } = collectBundleLayout(appPath);
    // With a real identity, osxSign seals the bundle and loose files ship as
    // sealed resources, so per-file signature checks only apply to the ad-hoc
    // flow this script produced.
    if (!identityConfigured) {
        for (const file of looseMachOFiles) {
            runCodesign(["--verify", "--strict", "--verbose=1", file], file);
        }
    }
    for (const bundle of nestedBundles) {
        runCodesign(["--verify", "--strict", "--verbose=1", bundle], bundle);
    }
    runCodesign(["--verify", "--deep", "--strict", "--verbose=2", appPath], appPath);
    console.log(
        `==> verified ${looseMachOFiles.length} loose Mach-O file(s), `
        + `${nestedBundles.length} nested bundle(s) in ${path.basename(appPath)}`,
    );
}

function main(argv) {
    const verifyOnly = argv.includes("--verify");
    const appPath = argv.find((arg) => !arg.startsWith("--"));
    if (!appPath || path.extname(appPath) !== ".app" || !fs.existsSync(appPath)) {
        console.error("Usage: node scripts/sign-macos-bundle.cjs <BakaMusic.app> [--verify]");
        process.exitCode = 2;
        return;
    }
    const resolved = path.resolve(appPath);
    if (verifyOnly) {
        verifyAppBundle(resolved);
    } else {
        signAppBundle(resolved);
    }
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    collectBundleLayout,
    isMachOImage,
    signAppBundle,
    verifyAppBundle,
};
