/**
 * Install prebuilt baka-native modules into res/.service/native/.
 *
 * Order:
 *   1. Dev prebuilt tree (res/.service/native/prebuilt/<platform>/) — vendored for
 *      developers; not a substitute for release packaging to end users
 *   2. Pinned release archive from scripts/native-modules-manifest.json (SHA-256)
 *   3. Existing flat .node files already in res/.service/native/
 *   4. Source build from native/ (maintainers only)
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { URL } = require("node:url");
const { path7za } = require("7zip-bin");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(__dirname, "native-modules-manifest.json");
const packageJsonPath = path.join(root, "package.json");
const outDir = path.join(root, "res", ".service", "native");
const prebuiltRoot = path.join(outDir, "prebuilt");
const cacheDir = path.join(root, "artifacts", "native-modules-cache");
const platformKey = `${process.platform}-${process.arch}`;
const MAX_REDIRECTS = 5;
const DEFAULT_MODULES = ["qmc2", "ence", "taglib"];

function log(message) {
    console.log(`[native-install] ${message}`);
}

function loadManifest() {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function appElectronVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        return String(pkg.devDependencies?.electron || "")
            .replace(/^[^\d]*/, "");
    } catch {
        return "";
    }
}

function authToken() {
    return process.env.NATIVE_REPO_TOKEN
        || process.env.GH_TOKEN
        || process.env.GITHUB_TOKEN
        || "";
}

function request(url, headers = {}, redirects = 0) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                "user-agent": "BakaMusic native modules installer",
                ...headers,
            },
        }, (response) => {
            const location = response.headers.location;
            if (
                location
                && response.statusCode >= 300
                && response.statusCode < 400
                && redirects < MAX_REDIRECTS
            ) {
                response.resume();
                resolve(request(new URL(location, url).toString(), headers, redirects + 1));
                return;
            }
            if (response.statusCode !== 200 && response.statusCode !== 206) {
                response.resume();
                reject(new Error(`Native download failed (${response.statusCode}): ${url}`));
                return;
            }
            resolve(response);
        });
        req.once("error", reject);
    });
}

async function hashFile(filePath) {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(filePath)) {
        hash.update(chunk);
    }
    return hash.digest("hex");
}

async function download(url, destination, expectedDigest, expectedSize) {
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) {
        const existingSize = (await fsp.stat(destination)).size;
        const existingHash = await hashFile(destination);
        if (existingSize === expectedSize && existingHash === expectedDigest) {
            log("cached archive verified (sha256 + size)");
            return;
        }
        await fsp.rm(destination, { force: true });
    }

    let downloadUrl = url;
    const token = authToken();
    const apiMatch = url.match(
        /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/,
    );
    if (token && apiMatch) {
        const [, owner, repo, tag, fileName] = apiMatch;
        const releaseMetaUrl =
            `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
        const metaResponse = await request(releaseMetaUrl, {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
        });
        const chunks = [];
        for await (const chunk of metaResponse) {
            chunks.push(chunk);
        }
        const release = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const asset = (release.assets || []).find(
            (item) => item.name === decodeURIComponent(fileName),
        );
        if (!asset?.url) {
            throw new Error(`Release asset not found: ${fileName} in ${tag}`);
        }
        downloadUrl = asset.url;
    }

    const headers = token
        ? {
            authorization: `Bearer ${token}`,
            accept: "application/octet-stream",
            "user-agent": "BakaMusic native modules installer",
        }
        : { "user-agent": "BakaMusic native modules installer" };

    log(`downloading ${path.basename(destination)}`);
    const response = await request(downloadUrl, headers);
    const hash = crypto.createHash("sha256");
    let received = 0;
    response.on("data", (chunk) => {
        hash.update(chunk);
        received += chunk.length;
    });
    await pipeline(response, fs.createWriteStream(destination, { flags: "w" }));
    const digest = hash.digest("hex");
    if (digest !== expectedDigest) {
        await fsp.rm(destination, { force: true });
        throw new Error(`sha256 mismatch: expected ${expectedDigest}, got ${digest}`);
    }
    if (received !== expectedSize) {
        await fsp.rm(destination, { force: true });
        throw new Error(`size mismatch: expected ${expectedSize}, got ${received}`);
    }
}

function safeArchivePath(entryPath) {
    const normalized = entryPath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    if (
        !parts.length
        || normalized.startsWith("/")
        || /^[A-Za-z]:\//.test(normalized)
        || parts.some((part) => part === ".." || part.includes("\0"))
    ) {
        throw new Error(`Rejected archive path: ${entryPath}`);
    }
    return parts;
}

async function extractArchive(archivePath, destination) {
    await fsp.rm(destination, { recursive: true, force: true });
    await fsp.mkdir(destination, { recursive: true });
    const lower = archivePath.toLowerCase();

    if (lower.endsWith(".7z")) {
        const result = spawnSync(path7za, ["x", "-y", `-o${destination}`, archivePath], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (result.status !== 0) {
            throw new Error(`7z extract failed: ${result.stderr || result.stdout}`);
        }
        return;
    }

    if (lower.endsWith(".zip")) {
        const result = spawnSync("tar", ["-xf", archivePath, "-C", destination], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (result.status !== 0) {
            throw new Error(`zip extract failed: ${result.stderr || result.stdout}`);
        }
        return;
    }

    if (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) {
        const listing = spawnSync("tar", ["-tJf", archivePath], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (listing.status !== 0) {
            throw new Error(`tar list failed: ${listing.stderr || listing.stdout}`);
        }
        for (const entry of listing.stdout.split(/\r?\n/).filter(Boolean)) {
            safeArchivePath(entry);
        }
        const extraction = spawnSync("tar", ["-xJf", archivePath, "-C", destination], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (extraction.status !== 0) {
            throw new Error(`tar extract failed: ${extraction.stderr || extraction.stdout}`);
        }
        return;
    }

    throw new Error(`Unsupported native archive: ${archivePath}`);
}

function modulePath(name) {
    return path.join(outDir, `${name}.node`);
}

function prebuiltDir(platform = platformKey) {
    return path.join(prebuiltRoot, platform);
}

function prebuiltModulePath(name, platform = platformKey) {
    return path.join(prebuiltDir(platform), `${name}.node`);
}

function localModulesPresent(modules) {
    return modules.every((name) => fs.existsSync(modulePath(name)));
}

function prebuiltModulesPresent(modules) {
    return modules.every((name) => fs.existsSync(prebuiltModulePath(name)));
}

async function copyModuleFile(from, to) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try {
        await fsp.copyFile(from, to);
        return;
    } catch (error) {
        // Windows may lock a previously loaded .node; write beside then rename.
        const tmp = `${to}.tmp-install`;
        await fsp.copyFile(from, tmp);
        try {
            await fsp.rm(to, { force: true });
        } catch {
            // still locked
        }
        try {
            await fsp.rename(tmp, to);
        } catch (renameError) {
            await fsp.rm(tmp, { force: true }).catch(() => undefined);
            throw renameError ?? error;
        }
    }
}

/**
 * Developer convenience: multi-platform binaries vendored under prebuilt/.
 * Prefer this over network so offline clones can run npm run dev.
 */
async function installFromDevPrebuilt(modules, artifact) {
    if (!prebuiltModulesPresent(modules)) {
        return false;
    }

    log(`using vendored prebuilt for ${platformKey} (${prebuiltDir()})`);
    for (const name of modules) {
        const from = prebuiltModulePath(name);
        const to = modulePath(name);
        if (artifact?.modules?.[name]?.sha256) {
            const expected = artifact.modules[name].sha256;
            const sourceDigest = await hashFile(from);
            if (sourceDigest !== expected) {
                throw new Error(
                    `prebuilt ${name}.node sha256 mismatch for ${platformKey}`,
                );
            }
            if (fs.existsSync(to)) {
                const destDigest = await hashFile(to);
                if (destDigest === expected) {
                    log(`ok ${name}.node (already current)`);
                    continue;
                }
            }
        }
        await copyModuleFile(from, to);
        if (artifact?.modules?.[name]?.sha256) {
            const digest = await hashFile(to);
            if (digest !== artifact.modules[name].sha256) {
                throw new Error(`${name}.node digest mismatch after prebuilt copy`);
            }
        }
        log(`-> res/.service/native/${name}.node (from prebuilt)`);
    }
    return true;
}

async function localModulesMatchManifest(modules, artifact) {
    if (!localModulesPresent(modules) || !artifact?.modules) {
        return false;
    }
    for (const name of modules) {
        const expected = artifact.modules[name]?.sha256;
        if (!expected) {
            return false;
        }
        const digest = await hashFile(modulePath(name));
        if (digest !== expected) {
            return false;
        }
    }
    return true;
}

function canSourceBuild() {
    const nativeDir = path.join(root, "native");
    if (!fs.existsSync(nativeDir)) {
        return false;
    }
    return DEFAULT_MODULES.every((name) =>
        fs.existsSync(path.join(nativeDir, name, "binding.gyp")));
}

function sourceBuild() {
    log("building from native/ source ...");
    const result = spawnSync(process.execPath, [path.join(__dirname, "build-native.js")], {
        cwd: root,
        stdio: "inherit",
        env: process.env,
    });
    if (result.status !== 0) {
        throw new Error("Source build of native modules failed");
    }
}

function warnElectronMismatch(manifest) {
    const appElectron = appElectronVersion();
    if (
        manifest.electron
        && appElectron
        && manifest.electron !== appElectron
    ) {
        console.warn(
            `[native-install] warning: manifest electron=${manifest.electron} `
            + `but package.json electron=${appElectron}`,
        );
    }
}

async function installFromManifest(manifest) {
    const modules = manifest.modules || DEFAULT_MODULES;
    const artifact = manifest.platforms?.[platformKey];
    if (!artifact) {
        throw new Error(`No native artifact for ${platformKey} in manifest`);
    }
    if (artifact.status !== "verified") {
        throw new Error(`Native artifact for ${platformKey} is not verified`);
    }

    warnElectronMismatch(manifest);
    log(
        `release=${manifest.release || "?"} platform=${platformKey}`
        + `${manifest.taglib ? ` taglib=${manifest.taglib}` : ""}`
        + `${manifest.electron ? ` electron=${manifest.electron}` : ""}`,
    );

    if (await localModulesMatchManifest(modules, artifact)) {
        log("local modules already match manifest digests; skip download");
        return;
    }

    await fsp.mkdir(cacheDir, { recursive: true });
    const archiveName = path.basename(new URL(artifact.url).pathname);
    const archivePath = path.join(cacheDir, archiveName);
    await download(artifact.url, archivePath, artifact.sha256, artifact.size);

    const extractRoot = path.join(cacheDir, `extract-${platformKey}-${manifest.release || "bootstrap"}`);
    await extractArchive(archivePath, extractRoot);

    let sourceDir = extractRoot;
    const entries = await fsp.readdir(extractRoot, { withFileTypes: true });
    if (entries.length === 1 && entries[0].isDirectory()) {
        sourceDir = path.join(extractRoot, entries[0].name);
    }

    await fsp.mkdir(outDir, { recursive: true });
    for (const name of modules) {
        const from = path.join(sourceDir, `${name}.node`);
        const to = modulePath(name);
        let sourceFile = from;
        if (!fs.existsSync(sourceFile)) {
            const nested = path.join(sourceDir, name, `${name}.node`);
            if (!fs.existsSync(nested)) {
                throw new Error(`Archive missing ${name}.node`);
            }
            sourceFile = nested;
        }
        await fsp.copyFile(sourceFile, to);
        if (artifact.modules?.[name]?.sha256) {
            const digest = await hashFile(to);
            if (digest !== artifact.modules[name].sha256) {
                throw new Error(`${name}.node sha256 mismatch after extract`);
            }
        }
        log(`-> res/.service/native/${name}.node`);
    }
}

async function main() {
    const forceSource = process.argv.includes("--from-source")
        || process.env.NATIVE_MODULES_FROM_SOURCE === "1";
    const localOnly = process.argv.includes("--local-only")
        || process.env.NATIVE_MODULES_LOCAL_ONLY === "1";

    const manifest = loadManifest();
    const modules = manifest.modules || DEFAULT_MODULES;

    if (forceSource) {
        if (!canSourceBuild()) {
            throw new Error("--from-source requested but native/ sources are incomplete");
        }
        sourceBuild();
        return;
    }

    const artifact = manifest.platforms?.[platformKey];

    // Developers: prefer git-vendored multi-platform prebuilts (no network).
    if (!localOnly) {
        try {
            if (await installFromDevPrebuilt(modules, artifact)) {
                return;
            }
        } catch (error) {
            console.warn(`[native-install] prebuilt sync failed: ${error.message}`);
            if (process.env.CI === "true" && process.env.NATIVE_MODULES_ALLOW_FALLBACK !== "1") {
                // In CI prefer download path when prebuilt is wrong/stale.
            }
        }
    }

    if (manifest.complete === true && artifact && !localOnly) {
        try {
            await installFromManifest(manifest);
            return;
        } catch (error) {
            console.warn(`[native-install] manifest install failed: ${error.message}`);
            if (process.env.CI === "true" && process.env.NATIVE_MODULES_ALLOW_FALLBACK !== "1") {
                throw error;
            }
        }
    } else if (!manifest.complete) {
        log("manifest is bootstrap (not pinned); prefer prebuilt/local modules or source build");
    }

    if (localModulesPresent(modules)) {
        log(`using existing modules in ${outDir}`);
        return;
    }

    if (canSourceBuild()) {
        sourceBuild();
        return;
    }

    throw new Error(
        "Native modules unavailable. Publish a baka-native release and run "
        + "`npm run native:update-manifest`, or checkout native/ and run "
        + "`npm run build:native` / `npm run native:install -- --from-source`",
    );
}

main().catch((error) => {
    console.error(`[native-install] ${error && error.stack ? error.stack : error}`);
    process.exit(1);
});
